import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";

export async function handleJob(job: JobInput, context: WorkerContext): Promise<void> {
  await context.jobs.finish(job.jobId, "处理器尚未交付");
}
