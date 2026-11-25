import "server-only";

import { readPublicSample, readSample } from "@/features/foundation/samples";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import { readSiteEnv } from "@/lib/env";
import { queryRows, type BusinessRow } from "@/lib/supabase/database";
import { requireMaintainer } from "@/lib/supabase/server";
import type { PoolClient } from "pg";

import { displayKey, sampleDisplayKey, sampleEvent, sampleSource } from "@/features/public/media-key";

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

export async function findSubmission(db: PoolClient, scope: ReviewScope, id: string, lock = false) {
  const [row] = await queryRows<Pick<BusinessRow<"submissions">, "received_at" | "sender_hash">>(db, `
    select received_at, sender_hash from submissions where ${scopeFilter} and id = $3
    ${lock ? "for update" : ""}
  `, [scope.source, scope.event, id]);
  return row;
}

type Rights = Pick<BusinessRow<"item_usage_rights">, "public_view" | "private_export" | "arweave" | "nft">;
type Current = Pick<BusinessRow<"item_versions">, "id" | "local_date" | "diary_text">;
export type ReviewItem = Pick<BusinessRow<"items">, "id" | "kind" | "position" | "withdrawn_at" | "exclusion"> & {
  version_id: string;
  local_date: Current["local_date"];
  diary_text: Current["diary_text"];
  title: string | null;
  processed_media_ref: string | null;
  rights: Rights | null;
  approval: BusinessRow<"approvals"> | null;
};

export async function readReviewItems(db: PoolClient, id: string, lock = false) {
  if (lock) {
    // Parent locks block concurrent FK inserts while the current versions are selected.
    await db.query("select id from items where submission_id = $1 order by id for update", [id]);
    await db.query(`
      select v.id from item_versions v join items i on i.id = v.item_id
      where i.submission_id = $1 order by v.id for update of v
    `, [id]);
    await db.query(`
      select r.item_id from item_usage_rights r join items i on i.id = r.item_id
      where i.submission_id = $1 order by r.item_id for update of r
    `, [id]);
    await db.query(`
      select d.version_id from item_version_display d
      join item_versions v on v.id = d.version_id join items i on i.id = v.item_id
      where i.submission_id = $1 order by d.version_id for update of d
    `, [id]);
  }
  return queryRows<ReviewItem>(db, `
    select i.id, i.kind, i.position, i.withdrawn_at, i.exclusion,
           v.id as version_id, to_char(v.local_date, 'YYYY-MM-DD') as local_date, v.diary_text,
           d.title, d.processed_media_ref, to_jsonb(r) as rights,
           case when a.item_id is not null then
             to_jsonb(a) || jsonb_build_object('approved_at', to_char(a.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           end as approval
    from items i
    join lateral (
      select id, local_date, diary_text from item_versions
      where item_id = i.id order by version desc limit 1
    ) v on true
    left join item_usage_rights r on r.item_id = i.id
    left join item_version_display d on d.version_id = v.id
    left join approvals a on a.item_id = i.id and a.version_id = v.id
    where i.submission_id = $1 order by i.position
  `, [id]);
}

export function canPublish(item: ReviewItem, sample: boolean) {
  return item.exclusion === "none" && !item.withdrawn_at && item.rights?.public_view === true &&
    Boolean(item.local_date && (item.kind === "diary" ? item.diary_text?.trim() :
      item.processed_media_ref === (sample ? sampleDisplayKey : displayKey(item.id, item.version_id))));
}
