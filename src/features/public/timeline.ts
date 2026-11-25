import "server-only";

import { stage0IntakeSource } from "@/lib/contracts/intake";
import { publishedTimelineItemSchema, type PublishedTimelineItem } from "@/lib/contracts/public";
import { readSiteEnv } from "@/lib/env";
import { evaluateContentPolicy } from "@/lib/policy/content";
import { queryRows, withWebsiteDb, type BusinessRow } from "@/lib/supabase/database";

type TimelineRow = Pick<BusinessRow<"items">, "kind" | "position" | "exclusion" | "withdrawn_at"> &
  Pick<BusinessRow<"approvals">, "item_id" | "published"> &
  Pick<BusinessRow<"item_versions">, "local_date" | "diary_text"> &
  Pick<BusinessRow<"item_version_display">, "title" | "caption"> & {
    current_version_id: BusinessRow<"item_versions">["id"];
    approved_version_id: BusinessRow<"approvals">["version_id"];
    approval_public_view: BusinessRow<"approvals">["public_view"];
    rights_public_view: BusinessRow<"item_usage_rights">["public_view"];
  };

const timelineLimit = 100;

function project(row: TimelineRow): PublishedTimelineItem[] {
  const exclusion = row.exclusion === "none" || row.exclusion === "explicit" ? row.exclusion : "ambiguous";
  const { publicView } = evaluateContentPolicy({
    itemId: row.item_id,
    currentVersionId: row.current_version_id,
    approvedVersionId: row.approved_version_id,
    published: row.published === true,
    withdrawn: row.withdrawn_at !== null,
    exclusion,
    usageRights: {
      publicView: row.approval_public_view === true && row.rights_public_view === true,
      privateExport: false,
      arweave: false,
      nft: false,
    },
  });
  if (!publicView) return [];

  const result = publishedTimelineItemSchema.safeParse({
    itemId: row.item_id,
    currentVersionId: row.current_version_id,
    localDate: row.local_date,
    sortOrder: row.position,
    kind: row.kind,
    title: row.title ?? undefined,
    caption: row.caption ?? undefined,
    diaryText: row.kind === "diary" ? row.diary_text ?? undefined : undefined,
  });
  return result.success ? [result.data] : [];
}

export async function readPublishedTimeline(): Promise<PublishedTimelineItem[]> {
  const env = readSiteEnv();
  if (env.ci || !env.environment || !env.DATABASE_URL ||
      !env.SUPABASE_PROJECT_REF || !env.EXPECTED_DATABASE_HOST) return [];

  const rows = await withWebsiteDb((db) => queryRows<TimelineRow>(db, `
    select i.id as item_id, i.kind, i.position, i.exclusion, i.withdrawn_at,
           v.id as current_version_id, to_char(v.local_date, 'YYYY-MM-DD') as local_date,
           case when i.kind = 'diary' then v.diary_text end as diary_text,
           a.version_id as approved_version_id, a.published,
           a.public_view as approval_public_view, r.public_view as rights_public_view,
           d.title, d.caption
    from submissions s
    join items i on i.submission_id = s.id
    join lateral (
      select id, local_date, diary_text
      from item_versions
      where item_id = i.id
      order by version desc
      limit 1
    ) v on true
    join approvals a on a.item_id = i.id and a.version_id = v.id
    join item_usage_rights r on r.item_id = i.id
    left join item_version_display d on d.version_id = v.id
    where s.source = $1
      and i.withdrawn_at is null and i.exclusion = 'none'
      and a.published and a.public_view and r.public_view
      and v.local_date is not null
    order by v.local_date desc, i.position asc, s.received_at asc, i.id asc
    limit $2
  `, [stage0IntakeSource, timelineLimit]));
  return rows.flatMap(project);
}
