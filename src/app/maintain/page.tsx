import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diagnosticsEnabled } from "@/lib/env";
import { maintainNavigation } from "@/lib/maintain-navigation";
import { readExportStatus } from "@/features/exports/access";
import { reviewScope } from "@/features/review/store";
import { ReviewInbox } from "./review/inbox";
import { ExportControls } from "./exports/controls";

const showExports = maintainNavigation.some(({ path, flag }) => path === "/maintain/exports" && flag.delivered);

async function SnapshotStatus() {
  const snapshot = await readExportStatus(null).catch(() => ({ unavailable: true as const }));
  return <section className="space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5" aria-labelledby="exports-heading">
    <h2 id="exports-heading" className="font-heading text-xl font-semibold">离线快照</h2>
    {"unavailable" in snapshot ? <p role="status">离线快照暂不可用。</p> : <ExportControls {...snapshot} />}
  </section>;
}

export default async function MaintainPage({ searchParams }: { searchParams: Promise<{ status?: string; inboxPage?: string }> }) {
  const scope = await reviewScope();
  if (!scope) redirect("/maintain/login");
  const { sample } = scope;
  if (!sample) {
    const { status, inboxPage } = await searchParams;
    const page = inboxPage && /^[1-9]\d{0,5}$/.test(inboxPage) ? Number(inboxPage) : 1;
    return <section className="review-workspace space-y-8 py-6">
      <h1 className="font-heading text-3xl font-semibold">维护后台</h1>
      <Suspense key={page} fallback={<p role="status" className="rounded-lg bg-muted p-5 text-muted-foreground">正在加载待审核投稿…</p>}>
        <ReviewInbox scope={scope} status={status} page={page} />
      </Suspense>
      {showExports && (
        <Suspense fallback={<p role="status" className="text-muted-foreground">正在读取离线快照状态…</p>}>
          <SnapshotStatus />
        </Suspense>
      )}
      <form action="/maintain/logout" method="post"><Button type="submit" variant="secondary">退出登录</Button></form>
    </section>;
  }

  const diagnostics = diagnosticsEnabled();
  const links = maintainNavigation.filter(({ flag, path }) =>
    flag.delivered || path === "/maintain/review" || (diagnostics && path === "/maintain/intake") ||
    (sample && path === "/maintain/exports"),
  );

  return (
    <section className="review-workspace space-y-8 py-6">
      <h1 className="font-heading text-3xl font-semibold">维护后台</h1>
      {links.length > 0 && (
        <nav aria-label="维护操作" className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-6">
          <p className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">样本模式。进入「审核投稿」即可准备合成稿并查看附件预览。</p>
          <Link href="/maintain/review" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground">
            审核投稿
          </Link>
          <ul className="grid gap-3 sm:grid-cols-2">
            {links.filter(({ path }) => path !== "/maintain/review").map(({ name, path }) => (
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
      <form action="/maintain/logout" method="post"><Button type="submit" variant="secondary">退出登录</Button></form>
    </section>
  );
}
