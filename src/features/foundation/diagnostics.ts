import { jobSummarySchema } from "@/lib/contracts/jobs";
import { queryRows, withWebsiteDb, type BusinessRow } from "@/lib/supabase/database";

export const jobLabels = {
  queued: "排队", running: "处理中", done: "已完成", needs_attention: "需处理",
};

export async function realJobSummaries() {
  return withWebsiteDb(async (db) => {
    const rows = await queryRows<Pick<BusinessRow<"jobs">, "id" | "created_at" | "updated_at" | "status" | "reason">>(
      db, "select id, created_at, updated_at, status, reason from jobs where sample_run_id is null order by created_at desc limit 50",
    );
    return rows.map((job) => jobSummarySchema.parse({
      jobId: job.id, createdAt: new Date(job.created_at).toISOString(),
      updatedAt: new Date(job.updated_at).toISOString(), status: job.status, reason: job.reason ?? undefined,
    }));
  });
}

export async function realSamples() {
  return withWebsiteDb(async (db) => {
    const rows = await queryRows<{ id: string; event_id: string; count: number }>(db, `
      select s.id, s.event_id, count(v.id)::int as count
      from submissions s left join items i on i.submission_id = s.id
      left join item_versions v on v.item_id = i.id and v.version = 1
      where s.source = 'stage0-grok' group by s.id order by s.received_at desc limit 50
    `);
    return rows;
  });
}
