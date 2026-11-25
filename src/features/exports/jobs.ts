import { createReadStream } from "node:fs";
import { privateExportKind } from "@/features/foundation/private-export";
import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import { readWorkerEnv } from "@/lib/env";
import { withSnapshotZip } from "./archive";
import { privateExportBlob } from "./blob";
import { snapshotKey } from "./generate";
import { exportPhotoReader } from "./photo-reader";
import { reservedSnapshotItems } from "./reserved-items";

export async function handleJob(job: JobInput, context: WorkerContext): Promise<void> {
  const port = context.privateExport;
  if (!port || job.kind !== privateExportKind || job.schemaVersion !== 1 || job.jobId !== port.claim.jobId) {
    await context.jobs.finish(job.jobId, "不支持的导出任务");
    return;
  }

  const { claim } = port;
  if (claim.objectKey !== snapshotKey({ jobId: job.jobId, scope: { sampleRunId: null } })) return;
  const candidates = await port.recheck();
  if (!candidates) return;
  const items = reservedSnapshotItems(candidates, claim.versions);
  const { WORKER_FILE_ROOT: root, BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = readWorkerEnv();
  if (!root || !token || !host) return;
  const storage = privateExportBlob(token, host);
  const signal = AbortSignal.any([port.signal, AbortSignal.timeout(20 * 60_000)]);
  await withSnapshotZip(root, items, context.clock(), exportPhotoReader(root, context.files),
    async (path, size) => {
      if (!(await port.recheck())) return;
      signal.throwIfAborted();
      const body = createReadStream(path, { signal });
      try {
        await storage.upload(claim.objectKey, body, size, signal);
      } finally {
        body.destroy();
      }
      signal.throwIfAborted();
      await port.publish();
    }, signal);
}
