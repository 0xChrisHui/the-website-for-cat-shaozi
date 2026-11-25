import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diagnosticsEnabled } from "@/lib/env";
import { readSample } from "@/features/foundation/samples";
import { maintainNavigation } from "@/lib/maintain-navigation";
import { exportAccess, readExportStatus } from "@/features/exports/access";
import { reviewScope } from "@/features/review/store";
import { ReviewInbox } from "./review/inbox";
import { ExportControls } from "./exports/controls";

export default async function MaintainPage({ searchParams }: { searchParams: Promise<{ status?: string; inboxPage?: string }> }) {
  const sample = await readSample();
  const scope = await reviewScope();
  if (!scope) redirect("/maintain/login");
  if (!sample) {
    const access = await exportAccess();
    const snapshot = access && await readExportStatus(null).catch(() => ({ unavailable: true as const }));
    const { status, inboxPage } = await searchParams;
    const page = inboxPage && /^[1-9]\d{0,5}$/.test(inboxPage) ? Number(inboxPage) : 1;
    return <section className="space-y-6 py-6">
      <h1 className="font-heading text-3xl font-semibold">维护后台</h1>
      <ReviewInbox scope={scope} status={status} page={page} />
      {snapshot && <section className="space-y-3" aria-labelledby="exports-heading">
        <h2 id="exports-heading" className="font-heading text-xl font-semibold">离线快照</h2>
        {"unavailable" in snapshot ? <p role="status">离线快照暂不可用。</p> : <ExportControls {...snapshot} />}
      </section>}
      <form action="/maintain/logout" method="post"><Button type="submit">退出登录</Button></form>
    </section>;
  }

  const diagnostics = diagnosticsEnabled();
  const links = maintainNavigation.filter(({ flag, path }) =>
    flag.delivered || path === "/maintain/review" || (diagnostics && path === "/maintain/intake") ||
    (sample && path === "/maintain/exports"),
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
