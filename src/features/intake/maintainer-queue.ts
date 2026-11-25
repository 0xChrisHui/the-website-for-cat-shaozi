import "server-only";

import { readPublicSample, readSample } from "@/features/foundation/samples";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import type { jobStatus } from "@/lib/contracts/jobs";
import { readSiteEnv } from "@/lib/env";
import { queryRows, withWebsiteDb } from "@/lib/supabase/database";
import { requireMaintainer } from "@/lib/supabase/server";
import type { z } from "zod";

const queueLimit = 50;

type QueueRow = {
  id: string;
  received_at: Date;
  status: Exclude<z.infer<typeof jobStatus>, "done">;
  photo_count: number;
  original_bytes: string | null;
};

export async function readMaintainerQueue() {
  if (await readSample() || await readPublicSample()) return { state: "unavailable" } as const;
  if (!(await requireMaintainer())) return { state: "signed-out" } as const;

  const env = readSiteEnv();
  if (env.ci || !env.environment || !env.DATABASE_URL) return { state: "unavailable" } as const;

  const rows = await withWebsiteDb((db) => queryRows<QueueRow>(db, `
    with pending as (
      select s.id, s.received_at, intake_job.status
      from submissions s
      join lateral (
        select j.status
        from jobs j
        where j.kind = 'foundation.intake' and j.sample_run_id is null
          and j.payload->>'submissionId' = s.id::text
        order by j.created_at desc, j.id desc
        limit 1
      ) intake_job on true
      where s.source = $1 and intake_job.status in ('queued', 'running', 'needs_attention')
      order by s.received_at desc, s.id desc
      limit $2
    )
    select p.id, p.received_at, p.status, originals.photo_count, originals.original_bytes
    from pending p
    cross join lateral (
      select count(*)::int as photo_count,
        case when count(*) = count(*) filter (where ref.size_bytes between 1 and 104857600)
          then sum(ref.size_bytes)::text end as original_bytes
      from items i
      join item_versions v on v.item_id = i.id and v.version = 1
      cross join lateral (
        select case when jsonb_typeof(v.file_ref->'sizeBytes') = 'number'
          and v.file_ref->>'sizeBytes' ~ '^[1-9][0-9]{0,8}$'
          then (v.file_ref->>'sizeBytes')::int end as size_bytes
      ) ref
      where i.submission_id = p.id and i.kind = 'photo'
        and v.file_ref->>'objectKey' = p.id::text || '/' || i.position::text
    ) originals
    order by p.received_at desc, p.id desc
  `, [stage0IntakeSource, queueLimit]));

  return { state: "ready", rows } as const;
}
