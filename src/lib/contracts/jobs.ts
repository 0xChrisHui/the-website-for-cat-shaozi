import { z } from "zod";
import type { ExportClaim, recheckExport } from "@/features/foundation/private-export";
import type { PermanentWorker } from "./permanent";

export const jobStatus = z.enum(["queued", "running", "done", "needs_attention"]);
export const jobSummarySchema = z.object({
  jobId: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  status: jobStatus, reason: z.string().max(120).optional(),
}).strict();
export type JobSummary = z.infer<typeof jobSummarySchema>;
export interface JobInput {
  jobId: string;
  kind: string;
  schemaVersion: number;
  payload: unknown;
}
export interface WorkerContext {
  files: { read(objectKey: string): Promise<ReadableStream<Uint8Array>> };
  jobs: { finish(jobId: string, reason?: string): Promise<void> };
  clock: () => Date;
  permanent?: PermanentWorker;
  privateExport?: {
    claim: ExportClaim;
    signal: AbortSignal;
    recheck(): ReturnType<typeof recheckExport>;
    publish(): Promise<boolean>;
  };
}
