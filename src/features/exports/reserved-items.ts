import type { ExportClaim, recheckExport } from "@/features/foundation/private-export";
import { sampleExportOriginal } from "@/features/foundation/sample-export-media";
import { sampleDisplayKey } from "@/features/public/media-key";
import { fileRefSchema } from "@/lib/contracts/intake";
import { selectSnapshotItems, type ExportCandidate } from "./content";

type Candidates = NonNullable<Awaited<ReturnType<typeof recheckExport>>>;

export function reservedSnapshotItems(
  candidates: Candidates,
  versions: ExportClaim["versions"],
  sample = false,
) {
  const items = selectSnapshotItems(candidates.map((row): ExportCandidate => {
    const common = {
      itemId: row.itemId, currentVersionId: row.versionId, approvedVersionId: row.approved,
      withdrawn: false, exclusion: row.exclusion, submissionId: row.submission_id, position: row.position,
      approvalPrivateExport: row.allowed, itemPrivateExport: row.allowed, caption: row.caption,
    };
    if (row.kind === "diary") {
      if (row.diary_text === null) throw new Error("Approved diary is missing text");
      return { ...common, kind: "diary", text: row.diary_text };
    }
    const displayKey = `memorial/display/${row.itemId}/${row.versionId}`;
    let original = row.file_ref;
    if (sample && row.exclusion === "explicit") {
      const file = fileRefSchema.parse(original);
      if (file.objectKey !== sampleExportOriginal.objectKey || file.sha256 !== sampleExportOriginal.sha256 ||
          file.sizeBytes !== sampleExportOriginal.sizeBytes || file.mediaType !== sampleExportOriginal.mediaType) {
        throw new Error("Unknown sample export original");
      }
      original = { ...file, objectKey: `${row.submission_id}/${row.position}` };
    }
    return {
      ...common, kind: "photo", original,
      processedKey: sample ? (row.processed_media_ref === sampleDisplayKey ? displayKey : null) : row.processed_media_ref,
    };
  }));
  if (items.length !== versions.length || items.some(({ itemId, versionId }, i) =>
    itemId !== versions[i]?.itemId || versionId !== versions[i]?.versionId)) {
    throw new Error("Export archive does not match reserved versions");
  }
  return items;
}
