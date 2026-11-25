import type { PoolClient } from "pg";
import { queryRows, type BusinessRow } from "@/lib/supabase/database";
import { displayKey, sampleDisplayKey } from "@/features/public/media-key";

type Rights = Pick<BusinessRow<"item_usage_rights">, "public_view" | "private_export" | "arweave" | "nft">;
type Current = Pick<BusinessRow<"item_versions">, "id" | "local_date" | "diary_text">;
export type ReviewItem = Pick<BusinessRow<"items">, "id" | "kind" | "position" | "withdrawn_at" | "exclusion"> & {
  version_id: string;
  local_date: Current["local_date"];
  diary_text: Current["diary_text"];
  title: string | null;
  processed_media_ref: string | null;
  rights: Rights | null;
  historical_approval: boolean;
  version_number: number;
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
           v.id as version_id, v.version as version_number,
           exists (select 1 from approvals old where old.item_id=i.id and old.version_id<>v.id) as historical_approval,
           to_char(v.local_date, 'YYYY-MM-DD') as local_date, v.diary_text,
           d.title, d.processed_media_ref, to_jsonb(r) as rights,
           case when a.item_id is not null then
             to_jsonb(a) || jsonb_build_object('approved_at', to_char(a.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           end as approval
    from items i
    join lateral (
      select id, version, local_date, diary_text from item_versions
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
