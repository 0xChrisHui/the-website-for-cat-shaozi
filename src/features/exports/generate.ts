import { createReadStream, type ReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { z } from "zod";
import { exportRequestSchema, type ExportRequest } from "@/lib/contracts/exports";
import type { JobSummary } from "@/lib/contracts/jobs";
import { withSnapshotZip } from "./archive";
import { selectSnapshotItems, type ExportCandidate, type ExportPhotoSource } from "./content";

export type ExportScope = { sampleRunId: string | null };
export type ExportClaim = { jobId: string; scope: ExportScope };

export interface ExportQueue {
  // The caller supplies scope from the server session. Claim and close the old pointer in one transaction.
  claim(scope: ExportScope, requestId: string): Promise<JobSummary>;
}

export interface ExportWorkerStore {
  // Verify the running job and capture current candidates in one database snapshot.
  readCurrent(claim: ExportClaim): Promise<readonly ExportCandidate[] | null>;
  // Return retired keys, excluding anything still eligible for publication. Keep them durable until acknowledged.
  retiredKeys(scope: ExportScope): Promise<readonly string[]>;
  acknowledgeRemoval(scope: ExportScope, key: string): Promise<void>;
  // Compare-and-set against revocation, job status and scope. Completion and pointer opening are atomic.
  publish(claim: ExportClaim): Promise<boolean>;
  // Atomically fail or retire the claim. Must preserve a committed publication if its response was lost.
  fail(claim: ExportClaim): Promise<void>;
}

export interface ExportStorage {
  upload(key: string, body: ReadStream, size: number, signal: AbortSignal): Promise<void>;
  removeAndConfirm(key: string): Promise<void>;
}

export function snapshotKey({ jobId, scope }: ExportClaim) {
  const id = z.uuid().parse(jobId);
  return scope.sampleRunId === null
    ? `exports/private/${id}.zip`
    : `exports/samples/${z.uuid().parse(scope.sampleRunId)}/${id}.zip`;
}

export async function createPrivateExport(input: ExportRequest, scope: ExportScope, queue: ExportQueue) {
  return queue.claim(scope, exportRequestSchema.parse(input).requestId);
}

export async function removeRetiredExports(scope: ExportScope, store: ExportWorkerStore, storage: ExportStorage) {
  for (const key of await store.retiredKeys(scope)) {
    await storage.removeAndConfirm(key);
    await store.acknowledgeRemoval(scope, key);
  }
}

export async function generateSnapshot(claim: ExportClaim, options: {
  root: string;
  clock: () => Date;
  store: ExportWorkerStore;
  storage: ExportStorage;
  readPhoto(source: ExportPhotoSource, signal: AbortSignal): Promise<Readable>;
}) {
  const { store, storage } = options;
  try {
    await removeRetiredExports(claim.scope, store, storage);
    const candidates = await store.readCurrent(claim);
    if (candidates) {
      await withSnapshotZip(options.root, selectSnapshotItems(candidates), options.clock(), options.readPhoto,
        async (path, size, signal) => {
          const body = createReadStream(path, { signal });
          try {
            await storage.upload(snapshotKey(claim), body, size, signal);
          } finally {
            body.destroy();
          }
          if (!(await store.publish(claim))) await store.fail(claim);
        });
    }
  } catch {
    await store.fail(claim);
  }
  await removeRetiredExports(claim.scope, store, storage);
}
