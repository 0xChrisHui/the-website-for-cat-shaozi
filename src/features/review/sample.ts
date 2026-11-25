import "server-only";

import { lockExportScope } from "@/features/foundation/private-export";
import { sampleExportOriginal } from "@/features/foundation/sample-export-media";
import { withWebsiteDb } from "@/lib/supabase/database";
import { sampleDisplayKey } from "@/features/public/media-key";
import { reviewScope } from "./store";

export async function prepareReviewSample(approveExportFixture = false) {
  const scope = await reviewScope();
  if (!scope?.ready || !scope.sample) return;
  const runId = scope.sample.runId;
  await withWebsiteDb(async (db) => {
    if (approveExportFixture) await lockExportScope(db, runId);
    const { rows } = await db.query<{ id: string }>(`
      insert into submissions (event_id, sender_hash, received_at, source)
      values ($1, $2, '2026-01-01T17:00:00Z', $3)
      on conflict (event_id) do nothing returning id
    `, [scope.event, scope.sender, scope.source]);
    const submission = rows[0];
    if (!submission) return;

    const fixtures = [
      { kind: "photo", exclusion: "none", title: "合成授权照片", text: null, publicView: true },
      { kind: "diary", exclusion: "none", title: "合成日记", text: "合成日记的当前修订。", publicView: true },
      { kind: "photo", exclusion: "explicit", title: "合成私有照片", text: null, publicView: false },
    ];
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
      const caption = approveExportFixture && fixture.kind === "photo" ? fixture.title : null;
      await db.query("insert into item_version_display (version_id, title, processed_media_ref, caption) values ($1, $2, $3, $4)",
        [version.rows[0]?.id, fixture.title, position === 0 ? sampleDisplayKey : null, caption]);
      if (approveExportFixture) {
        await db.query(`
          insert into approvals (item_id, version_id, source, published, public_view, private_export)
          values ($1, $2, 'automatic', $3, $3, true)
        `, [itemId, version.rows[0]?.id, position === 0]);
      }
    }
  });
}
