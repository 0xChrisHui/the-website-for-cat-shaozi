import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exportAccess, readExportStatus } from "@/features/exports/access";
import { requireMaintainer } from "@/lib/supabase/server";
import { ExportControls } from "./controls";

export default async function ExportsPage() {
  const access = await exportAccess();
  if (!access) {
    if (await requireMaintainer()) notFound();
    redirect("/maintain/login");
  }
  const status = await readExportStatus(access.sample?.runId ?? null).catch(() => ({ unavailable: true as const }));
  return <section className="space-y-4 py-6">
    <p><Link className="underline" href="/maintain">返回维护后台</Link></p>
    <h1 className="font-heading text-3xl font-semibold">离线快照</h1>
    {"unavailable" in status ? <p role="status">离线快照暂不可用。</p> : <ExportControls {...status} />}
  </section>;
}
