import { z } from "zod";
import { fileRefSchema, type FileRef } from "@/lib/contracts/intake";
import { evaluateContentPolicy, type ContentPolicyInput } from "@/lib/policy/content";

export type ExportCandidate = Pick<ContentPolicyInput, "itemId" | "currentVersionId" | "approvedVersionId" | "withdrawn" | "exclusion"> & {
  submissionId: string;
  position: number;
  approvalPrivateExport: boolean | null;
  itemPrivateExport: boolean | null;
  caption: string | null;
} & (
  | { kind: "diary"; text: string }
  | { kind: "photo"; processedKey: string | null; original: unknown }
);

export type ExportPhotoSource =
  | { kind: "display"; key: string }
  | { kind: "original"; file: FileRef };

export type SnapshotItem = { itemId: string; versionId: string; caption: string | null } & (
  | { kind: "diary"; text: string }
  | { kind: "photo"; source: ExportPhotoSource }
);

export function selectSnapshotItems(candidates: readonly ExportCandidate[]): SnapshotItem[] {
  return candidates.flatMap((candidate): SnapshotItem[] => {
    const { privateExport } = evaluateContentPolicy({
      ...candidate,
      published: false,
      usageRights: {
        privateExport: candidate.approvalPrivateExport === true && candidate.itemPrivateExport === true,
        publicView: false,
        arweave: false,
        nft: false,
      },
    });
    if (!privateExport) return [];
    const itemId = z.uuid().parse(candidate.itemId);
    const versionId = z.uuid().parse(candidate.currentVersionId);
    const base = { itemId, versionId, caption: candidate.caption };
    if (candidate.kind === "diary") return [{ ...base, kind: "diary", text: candidate.text }];
    if (candidate.exclusion === "explicit") {
      const file = fileRefSchema.parse(candidate.original);
      const position = z.number().int().min(0).max(99).parse(candidate.position);
      if (file.objectKey !== `${z.uuid().parse(candidate.submissionId)}/${position}`) {
        throw new Error("Approved original key does not match its item");
      }
      return [{ ...base, kind: "photo", source: { kind: "original", file } }];
    }
    const key = `memorial/display/${itemId}/${versionId}`;
    if (candidate.processedKey !== key) throw new Error("Approved display key does not match its revision");
    return [{ ...base, kind: "photo", source: { kind: "display", key } }];
  });
}
