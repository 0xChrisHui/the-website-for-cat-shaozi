import type { PoolClient } from "pg";
import { z } from "zod";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import { queryRows, type BusinessRow } from "@/lib/supabase/database";
import type { ExportCandidate } from "./content";

type CandidateRow = Pick<BusinessRow<"items">, "kind" | "submission_id" | "position" | "exclusion" | "withdrawn_at"> &
  Pick<BusinessRow<"item_versions">, "file_ref" | "diary_text"> &
  Pick<BusinessRow<"item_version_display">, "caption" | "processed_media_ref"> & {
    item_id: BusinessRow<"items">["id"];
    current_version_id: BusinessRow<"item_versions">["id"];
    approved_version_id: BusinessRow<"approvals">["version_id"];
    approval_private_export: BusinessRow<"approvals">["private_export"];
    item_private_export: BusinessRow<"item_usage_rights">["private_export"];
  };

const candidateSchema = z.object({
  item_id: z.uuid(),
  current_version_id: z.uuid(),
  approved_version_id: z.uuid(),
  withdrawn_at: z.date().nullable(),
  exclusion: z.enum(["none", "explicit", "ambiguous"]),
  submission_id: z.uuid(),
  position: z.number().int().nonnegative(),
  approval_private_export: z.boolean(),
  item_private_export: z.boolean(),
  caption: z.string().nullable(),
  kind: z.enum(["photo", "diary"]),
  diary_text: z.string().nullable(),
  processed_media_ref: z.string().nullable(),
  file_ref: z.unknown(),
});

// Real worker collection only. Preview sample collection must have its own run-scoped projection.
export async function readPrivateExportCandidates(db: PoolClient): Promise<ExportCandidate[]> {
  const rows = await queryRows<CandidateRow>(db, `
    select i.id as item_id, i.kind, i.submission_id, i.position, i.exclusion, i.withdrawn_at,
           v.id as current_version_id, v.file_ref, v.diary_text, a.version_id as approved_version_id,
           a.private_export as approval_private_export, r.private_export as item_private_export,
           d.caption, d.processed_media_ref
    from items i
    join submissions s on s.id = i.submission_id
    join lateral (
      select id, file_ref, diary_text from item_versions where item_id = i.id order by version desc limit 1
    ) v on true
    join approvals a on a.item_id = i.id and a.version_id = v.id
    join item_usage_rights r on r.item_id = i.id
    left join item_version_display d on d.version_id = v.id
    where s.source = $1 and i.withdrawn_at is null and i.exclusion in ('none', 'explicit')
      and a.private_export and r.private_export
    order by i.id
    limit 501
  `, [stage0IntakeSource]);

  return rows.map((value) => {
    const row = candidateSchema.parse(value);
    const common = {
      itemId: row.item_id,
      currentVersionId: row.current_version_id,
      approvedVersionId: row.approved_version_id,
      withdrawn: row.withdrawn_at !== null,
      exclusion: row.exclusion,
      submissionId: row.submission_id,
      position: row.position,
      approvalPrivateExport: row.approval_private_export,
      itemPrivateExport: row.item_private_export,
      caption: row.caption,
    };
    return row.kind === "diary"
      ? { ...common, kind: "diary", text: z.string().parse(row.diary_text) }
      : { ...common, kind: "photo", processedKey: row.processed_media_ref, original: row.file_ref };
  });
}
