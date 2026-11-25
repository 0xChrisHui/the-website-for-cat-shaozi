import "server-only";

import { readPublicSample, readSample } from "@/features/foundation/samples";
import { lockExportScope, currentExport, privateExportKind } from "@/features/foundation/private-export";
import type { JobSummary } from "@/lib/contracts/jobs";
import { readSiteEnv } from "@/lib/env";
import { maintainNavigation } from "@/lib/maintain-navigation";
import { queryRows, withWebsiteDb } from "@/lib/supabase/database";
import { requireMaintainer } from "@/lib/supabase/server";

const enabled = maintainNavigation.find(({ path }) => path === "/maintain/exports")?.flag.delivered;

export async function exportAccess() {
  const sample = await readSample();
  if (!sample && (!enabled || await readPublicSample() || !(await requireMaintainer()))) return null;
  return { sample };
}

export async function readExportStatus(sampleRunId: string | null) {
  const env = readSiteEnv();
  if (env.ci || !env.DATABASE_URL) return { unavailable: true as const };
  return withWebsiteDb(async (db) => {
    await lockExportScope(db, sampleRunId);
    const [latest] = await queryRows<{ status: JobSummary["status"]; reason: string | null }>(db, `
      select status, reason from jobs
      where sample_run_id is not distinct from $1::uuid and kind=$2
      order by (status in ('queued', 'running')) desc, created_at desc, id desc limit 1
    `, [sampleRunId, privateExportKind]);
    const pointer = await currentExport(db, sampleRunId);
    return { status: latest?.status, invalidated: latest?.reason === "导出已失效", current: pointer?.jobId };
  });
}
