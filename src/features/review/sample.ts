import "server-only";

import { invalidateExport, lockExportScope } from "@/features/foundation/private-export";
import { sampleExportOriginal } from "@/features/foundation/sample-export-media";
import { withWebsiteDb } from "@/lib/supabase/database";
import { sampleDisplayKey } from "@/features/public/media-key";
import { reviewScope } from "./store";

export async function prepareReviewSample(approveExportFixture = false) {
  const scope = await reviewScope();
  if (!scope?.ready || !scope.sample) return;
  const runId = scope.sample.runId;
  await withWebsiteDb(async (db) => {
    await lockExportScope(db, runId);
    const { rows } = await db.query<{ id: string }>(`
      insert into submissions (event_id, sender_hash, received_at, source)
      values ($1, $2, '2026-01-01T17:00:00Z', $3)
      on conflict (event_id) do nothing returning id
    `, [scope.event, scope.sender, scope.source]);
    const submission = rows[0];
    const fixtures = [
      { kind: "photo", exclusion: "none", title: "合成授权照片", text: null, publicView: true },
      { kind: "diary", exclusion: "none", title: "合成日记", text: "合成日记的当前修订。", publicView: true },
      { kind: "photo", exclusion: "explicit", title: "合成私有照片", text: null, publicView: false },
    ];
    if (submission) {
      for (const [position, fixture] of fixtures.entries()) {
        const item = await db.query<{ id: string }>(`
          insert into items (submission_id, position, kind, exclusion)
          values ($1, $2, $3, $4) returning id
        `, [submission.id, position, fixture.kind, fixture.exclusion]);
        const itemId = item.rows[0]?.id;
        if (!itemId) throw new Error("Missing sample item");
        await db.query("insert into item_usage_rights (item_id, public_view, private_export) values ($1, $2, true)", [itemId, fixture.publicView]);
        if (fixture.kind === "diary") {
          await db.query(`
            insert into item_versions (item_id, version, local_date, diary_text)
            values ($1, 1, '2026-01-02', '合成日记的历史修订。')
          `, [itemId]);
        }
        const version = await db.query<{ id: string }>(`
          insert into item_versions (item_id, version, local_date, file_ref, diary_text)
          values ($1, $2, '2026-01-02', $3, $4) returning id
        `, [itemId, fixture.kind === "diary" ? 2 : 1,
          fixture.kind === "photo" ? sampleExportOriginal : null, fixture.text]);
        await db.query("insert into item_version_display (version_id, title, processed_media_ref) values ($1, $2, $3)",
          [version.rows[0]?.id, fixture.title, position === 0 ? sampleDisplayKey : null]);
      }
    }

    if (!approveExportFixture) return;
    // Seed only an untouched fixture. Any prior approval or withdrawal leaves the whole submission to review.
    const seeded = await db.query<{ changed: boolean }>(`
      with seeded as (
        insert into approvals (item_id, version_id, source, published, public_view, private_export)
        select i.id, v.id, 'automatic', flags.publish, flags.publish, true
        from submissions s join items i on i.submission_id = s.id
        join item_versions v on v.item_id = i.id and v.version = case when i.kind = 'diary' then 2 else 1 end
        join item_usage_rights r on r.item_id = i.id and r.private_export
        cross join lateral (select i.position = 0 and i.exclusion = 'none' and r.public_view as publish) flags
        where s.event_id = $1 and s.source = $2 and s.sender_hash = $3
          and i.exclusion in ('none', 'explicit')
          and not exists (
            select 1 from items prior
            where prior.submission_id = s.id and (
              prior.withdrawn_at is not null
              or exists (select 1 from approvals a where a.item_id = prior.id)
              or exists (select 1 from item_versions newer where newer.item_id = prior.id
                and newer.version > case when prior.kind = 'diary' then 2 else 1 end)
            )
          )
        returning version_id
      ), captions as (
        update item_version_display d set caption = coalesce(d.caption, d.title)
        from seeded, item_versions v, items i
        where seeded.version_id = d.version_id and v.id = d.version_id and i.id = v.item_id and i.kind = 'photo'
      )
      select exists (select 1 from seeded) as changed
    `, [scope.event, scope.source, scope.sender]);
    if (seeded.rows[0]?.changed) await invalidateExport(db, runId);
  });
}
