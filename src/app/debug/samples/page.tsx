import { sampleLogin } from "@/app/maintain/login/actions";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diagnosticsEnabled } from "@/lib/env";
import { requireMaintainer } from "@/lib/supabase/server";
import { readSample } from "@/features/foundation/samples";
import { realSamples } from "@/features/foundation/diagnostics";

export default async function SamplePage() {
  if (!diagnosticsEnabled()) notFound();
  const sample = await readSample();
  if (!sample && !(await requireMaintainer())) notFound();
  if (sample) return <>
    <h1 className="font-heading text-2xl">查看样本</h1>
    <p>本轮编号 <output>{sample.runId}</output></p>
    <p>{sample.saved ? "样本已保存" : "本轮暂无样本"}</p>
    <form method="post" action="/api/debug/samples/state"><Button type="submit">保存样本</Button></form>
  </>;
  const rows = await realSamples();
  return <>
    <h1 className="font-heading text-2xl">查看样本</h1>
    <form action={sampleLogin}><Button type="submit">新建合成样本</Button></form>
    <ul className="space-y-2 break-all">{rows.map((row) =>
      <li key={row.id}>{row.event_id} · {row.count} 件已入库</li>)}</ul>
  </>;
}
