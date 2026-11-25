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

  const diagnostics = diagnosticsEnabled();
  const links = maintainNavigation.filter(({ flag, path }) =>
    flag.delivered || (diagnostics && path === "/maintain/intake"),
  );

  return (
    <section className="space-y-6 py-6">
      <h1 className="font-heading text-3xl font-semibold">维护后台</h1>
      {links.length > 0 && (
        <nav aria-label="维护操作">
          <ul className="grid gap-3 sm:grid-cols-2">
            {links.map(({ name, path }) => (
              <li key={path}>
                <Link href={path} className="block rounded-lg border border-border p-4 font-semibold underline hover:bg-muted">
                  {name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {diagnostics && <p><Link className="underline" href={sample ? "/debug/samples" : "/debug"}>{sample ? "查看样本" : "任务诊断"}</Link></p>}
      <form action="/maintain/logout" method="post"><Button type="submit">退出登录</Button></form>
    </section>
  );
}
