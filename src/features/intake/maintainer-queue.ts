import "server-only";

import { readPublicSample, readSample } from "@/features/foundation/samples";
import { fileRefSchema, stage0IntakeSource, type SubmissionDraft } from "@/lib/contracts/intake";
import type { jobStatus } from "@/lib/contracts/jobs";
import { readSiteEnv } from "@/lib/env";
import { queryRows, withWebsiteDb } from "@/lib/supabase/database";
import { requireMaintainer } from "@/lib/supabase/server";
import { z } from "zod";

export const intakeJobLabels = {
  queued: "排队",
  running: "处理中",
  needs_attention: "需处理",
  done: "待审核",
};

const queueLimit = 50;

type QueueRow = {
  id: string;
  received_at: Date;
  status: z.infer<typeof jobStatus>;
  photo_count: number;
  original_bytes: string | null;
};

async function intakeAccess() {
  if (await readSample() || await readPublicSample()) return { state: "unavailable" } as const;
  if (!(await requireMaintainer())) return { state: "signed-out" } as const;

  const env = readSiteEnv();
  if (env.ci || !env.environment || !env.DATABASE_URL) return { state: "unavailable" } as const;

  return { state: "ready" } as const;
}

export async function readMaintainerQueue() {
  const access = await intakeAccess();
  if (access.state !== "ready") return access;

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
      select (count(*) filter (where ref.is_original))::int as photo_count,
        case when count(*) filter (where ref.is_original) =
          count(*) filter (where ref.is_original and ref.size_bytes between 1 and 104857600)
          then (sum(ref.size_bytes) filter (where ref.is_original))::text end as original_bytes,
        count(*) filter (where i.withdrawn_at is null and i.exclusion = 'none'
          and not exists (select 1 from approvals a where a.item_id = i.id)
          and not exists (select 1 from item_versions newer where newer.item_id = i.id and newer.version > 1)
          and (
            (i.kind = 'diary' and v.diary_text is not null and v.diary_text ~ '[^[:space:]]' and v.file_ref is null)
            or (ref.is_original and ref.size_bytes between 1 and 104857600 and exists (
              select 1 from jsonb_array_elements(
                case when jsonb_typeof(p.payload->'items') = 'array' then p.payload->'items' else '[]'::jsonb end
              ) expected(item)
              where expected.item->'position' = to_jsonb(i.position)
                and (expected.item->'attachmentRef') - 'objectKey' = v.file_ref - 'objectKey'
            ))
          )
        ) as reviewable_count
      from items i
      join item_versions v on v.item_id = i.id and v.version = 1
      cross join lateral (
        select i.kind = 'photo' and v.file_ref->>'objectKey' = p.id::text || '/' || i.position::text as is_original,
          case when jsonb_typeof(v.file_ref->'sizeBytes') = 'number'
            and v.file_ref->>'sizeBytes' ~ '^[1-9][0-9]{0,8}$'
            then (v.file_ref->>'sizeBytes')::int end as size_bytes
      ) ref
      where i.submission_id = p.id
    ) originals
    where p.status in ('queued', 'running', 'needs_attention')
      or (p.status = 'done' and originals.reviewable_count > 0)
    order by p.received_at desc, p.id desc
    limit $2
  `, [stage0IntakeSource, queueLimit]));

  return { state: "ready", rows } as const;
}

type DraftRow = {
  received_at: Date;
  status: QueueRow["status"];
  item_id: string | null;
  version_id: string | null;
  kind: "photo" | "diary" | null;
  position: number | null;
  local_date: string | null;
  file_ref: unknown;
  diary_text: string | null;
  excluded: boolean;
};

export async function readMaintainerDraft(submissionId: string) {
  const access = await intakeAccess();
  if (access.state !== "ready") return access;
  if (!z.uuid().safeParse(submissionId).success) return { state: "missing" } as const;

  const rows = await withWebsiteDb((db) => queryRows<DraftRow>(db, `
    select s.received_at, job.status, i.id as item_id, v.id as version_id, i.kind, i.position,
      v.local_date::text, case when exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(job.payload->'items') = 'array' then job.payload->'items' else '[]'::jsonb end
        ) expected(item)
        where expected.item->'position' = to_jsonb(i.position)
          and (expected.item->'attachmentRef') - 'objectKey' = v.file_ref - 'objectKey'
      ) then v.file_ref end as file_ref, v.diary_text,
      (i.exclusion <> 'none' or i.withdrawn_at is not null) as excluded
    from submissions s
    join lateral (
      select j.status, j.payload from jobs j
      where j.kind = 'foundation.intake' and j.sample_run_id is null
        and j.payload->>'submissionId' = s.id::text
      order by j.created_at desc, j.id desc
      limit 1
    ) job on true
    left join items i on i.submission_id = s.id
    left join item_versions v on v.item_id = i.id and v.version = 1
    where s.source = $1 and s.id = $2
    order by i.position
  `, [stage0IntakeSource, submissionId]));

  const first = rows[0];
  if (!first) return { state: "missing" } as const;

  const draft: SubmissionDraft = {
    submissionId,
    source: stage0IntakeSource,
    receivedAt: first.received_at.toISOString(),
    pendingReasons: first.status === "done" ? [] : [intakeJobLabels[first.status]],
    items: [],
  };
  for (const row of rows) {
    if (!row.item_id || !row.version_id || !row.kind) continue;
    const file = fileRefSchema.safeParse(row.file_ref);
    draft.items.push({
      itemId: row.item_id,
      versionId: row.version_id,
      kind: row.kind,
      localDate: row.local_date ?? undefined,
      disposition: row.excluded ? "excluded" : "pending",
      candidates: [],
      file: !row.excluded && row.kind === "photo" && file.success && file.data.objectKey === `${submissionId}/${row.position}`
        ? file.data : undefined,
      diaryText: !row.excluded && row.kind === "diary" ? row.diary_text ?? undefined : undefined,
    });
  }
  return { state: "ready", draft, status: first.status } as const;
}
