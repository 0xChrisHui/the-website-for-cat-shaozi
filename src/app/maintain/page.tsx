import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diagnosticsEnabled } from "@/lib/env";
import { readSample } from "@/features/foundation/samples";
import { maintainNavigation } from "@/lib/maintain-navigation";
import { requireMaintainer } from "@/lib/supabase/server";

export default async function MaintainPage() {
  const sample = await readSample();
  const user = sample ? null : await requireMaintainer();
  if (!sample && !user) redirect("/maintain/login");
  return <>
    <h1 className="font-heading text-2xl">维护后台</h1>
    {diagnosticsEnabled() && <p><Link href={sample ? "/debug/samples" : "/debug"}>{sample ? "查看样本" : "任务诊断"}</Link></p>}
    <ul>{maintainNavigation.filter(({ flag }) => flag.delivered).map(({ name, path }) =>
      <li key={path}><Link href={path}>{name}</Link></li>)}</ul>
    <form action="/maintain/logout" method="post"><Button type="submit">退出登录</Button></form>
  </>;
}
