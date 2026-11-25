import "server-only";

import { readPublicSample, readSample } from "@/features/foundation/samples";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import { readSiteEnv } from "@/lib/env";
import { queryRows, type BusinessRow } from "@/lib/supabase/database";
import { requireMaintainer } from "@/lib/supabase/server";
import type { PoolClient } from "pg";

import { sampleEvent, sampleSource } from "@/features/public/media-key";

const sampleSender = "1".repeat(64);

export async function reviewScope() {
  const sample = await readSample();
  if (!sample && (await readPublicSample() || !(await requireMaintainer()))) return null;
  const env = readSiteEnv();
  return {
    sample,
    source: sample ? sampleSource : stage0IntakeSource,
    event: sample ? sampleEvent(sample.runId) : null,
    sender: sample ? sampleSender : env.GROK_SENDER_SHA256,
    ready: Boolean(!env.ci && env.environment && env.DATABASE_URL && env.SUPABASE_PROJECT_REF && env.EXPECTED_DATABASE_HOST),
  };
}

export type ReviewScope = NonNullable<Awaited<ReturnType<typeof reviewScope>>>;

const scopeFilter = "source = $1 and ($2::text is null or event_id = $2)";

export function readSubmissions(db: PoolClient, scope: ReviewScope) {
  return queryRows<{ id: string; received_at: Date; pending: boolean }>(db, `
    select s.id, s.received_at, exists (
      select 1 from items i
      join lateral (select id from item_versions where item_id = i.id order by version desc limit 1) v on true
      where i.submission_id = s.id and i.withdrawn_at is null
        and not exists (select 1 from approvals a where a.item_id = i.id and a.version_id = v.id)
    ) as pending
    from submissions s where ${scopeFilter}
      and exists (select 1 from items where submission_id = s.id)
    order by pending desc, s.received_at desc, s.id desc limit 50
  `, [scope.source, scope.event]);
}

export const inboxPageSize = 25;

export function readInboxSubmissions(db: PoolClient, scope: ReviewScope, page: number) {
  const offset = (page - 1) * inboxPageSize;
  return queryRows<{ id: string; received_at: Date; sender_hash: string; pending: boolean }>(db, `
    with inbox as (
      select s.id, s.received_at, s.sender_hash,
        (coalesce(intake.status in ('queued', 'running'), false)
          or (intake.status = 'needs_attention' and not exists (select 1 from items where submission_id=s.id))
          or exists (
            select 1 from items i
            join lateral (select id from item_versions where item_id=i.id order by version desc limit 1) v on true
            where i.submission_id=s.id and i.withdrawn_at is null
              and not exists (select 1 from approvals a where a.item_id=i.id and a.version_id=v.id)
          )) is true as pending
      from submissions s
      left join lateral (
        select status from jobs where kind='foundation.intake' and schema_version=1 and sample_run_id is null
          and payload->>'submissionId'=s.id::text order by created_at desc, id desc limit 1
      ) intake on true
      where s.source=$1 and (intake.status is not null or exists (select 1 from items where submission_id=s.id))
    )
    select id, received_at, sender_hash, pending from (
      select inbox.*, row_number() over (partition by pending order by received_at desc, id desc) as rank
      from inbox
    ) ranked where (pending and rank > $2 and rank <= $3) or (not pending and rank <= $4)
    order by pending desc, received_at desc, id desc
  `, [scope.source, offset, offset + inboxPageSize + 1, inboxPageSize]);
}

export async function findSubmission(db: PoolClient, scope: ReviewScope, id: string, lock = false) {
  const [row] = await queryRows<Pick<BusinessRow<"submissions">, "received_at" | "sender_hash">>(db, `
    select received_at, sender_hash from submissions where ${scopeFilter} and id = $3
    ${lock ? "for update" : ""}
  `, [scope.source, scope.event, id]);
  return row;
}

export { canPublish, readReviewItems, type ReviewItem } from "./review-rows";
