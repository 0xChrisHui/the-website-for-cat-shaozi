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
  status: z.infer<typeof jobStatus>;
  photo_count: number;
  original_bytes: string | null;
};

export async function readMaintainerQueue() {
  if (await readSample() || await readPublicSample()) return { state: "unavailable" } as const;
  if (!(await requireMaintainer())) return { state: "signed-out" } as const;

  const env = readSiteEnv();
  if (env.ci || !env.environment || !env.DATABASE_URL) return { state: "unavailable" } as const;

  const rows = await withWebsiteDb((db) => queryRows<QueueRow>(db, `
    with latest as (
      select s.id, s.received_at, intake_job.status, intake_job.payload
      from submissions s
      join lateral (
        select j.status, j.payload
        from jobs j
        where j.kind = 'foundation.intake' and j.sample_run_id is null
          and j.payload->>'submissionId' = s.id::text
        order by j.created_at desc, j.id desc
        limit 1
      ) intake_job on true
      where s.source = $1
    )
    select p.id, p.received_at, p.status, originals.photo_count, originals.original_bytes
    from latest p
    cross join lateral (
      select count(*)::int as photo_count,
        case when count(*) = count(*) filter (where ref.size_bytes between 1 and 104857600)
          then sum(ref.size_bytes)::text end as original_bytes,
        count(*) filter (where i.withdrawn_at is null and i.exclusion = 'none'
          and not exists (select 1 from approvals a where a.item_id = i.id)
          and not exists (select 1 from item_versions newer where newer.item_id = i.id and newer.version > 1)
          and exists (
            select 1 from jsonb_array_elements(
              case when jsonb_typeof(p.payload->'items') = 'array' then p.payload->'items' else '[]'::jsonb end
            ) expected(item)
            where expected.item->'position' = to_jsonb(i.position)
              and (expected.item->'attachmentRef') - 'objectKey' = v.file_ref - 'objectKey'
          )
          and ref.size_bytes between 1 and 104857600
        ) as reviewable_count
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
    where p.status in ('queued', 'running', 'needs_attention')
      or (p.status = 'done' and originals.reviewable_count > 0)
    order by p.received_at desc, p.id desc
    limit $2
  `, [stage0IntakeSource, queueLimit]));

  return { state: "ready", rows } as const;
}
