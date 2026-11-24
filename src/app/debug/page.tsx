import Link from "next/link";
import { notFound } from "next/navigation";
import { diagnosticsEnabled } from "@/lib/env";
import { requireMaintainer } from "@/lib/supabase/server";
import { jobLabels, realJobSummaries } from "@/features/foundation/diagnostics";

export default async function DebugPage() {
  if (!diagnosticsEnabled() || !(await requireMaintainer())) notFound();
  const jobs = await realJobSummaries();
  return <>
    <h1 className="font-heading text-2xl">任务记录</h1>
    <p><Link href="/debug/samples">查看样本</Link></p>
    <ul className="space-y-2 break-all">{jobs.map((job) =>
      <li key={job.jobId}>{job.jobId} · <time>{job.createdAt}</time> · {jobLabels[job.status]} {job.reason}</li>)}</ul>
  </>;
}
