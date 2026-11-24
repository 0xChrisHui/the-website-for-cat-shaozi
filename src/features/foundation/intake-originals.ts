import { join } from "node:path";
import type { PoolClient } from "pg";
import { z } from "zod";
import { fileRefSchema, type FileRef } from "@/lib/contracts/intake";
import type { BusinessRow } from "@/lib/supabase/database";
import { saveOriginal } from "./originals";

const stagePrefix = "stage0/test/";
const stagedFileSchema = fileRefSchema.refine(({ objectKey }) =>
  objectKey.startsWith(stagePrefix) && z.uuid().safeParse(objectKey.slice(stagePrefix.length)).success,
);
const payloadSchema = z.object({
  submissionId: z.uuid(),
  items: z.array(z.object({ position: z.number().int().min(0).max(99), attachmentRef: stagedFileSchema })).min(1).max(100),
}).refine(({ items }) => new Set(items.map(({ position }) => position)).size === items.length);

type OriginalResult =
  | { position: number; status: "persisted" | "replayed"; file: FileRef }
  | { position: number; status: "source_failed" | "conflict" };

interface Staging {
  read(key: string): Promise<ReadableStream<Uint8Array>>;
  remove(key: string): Promise<void>;
}

export function bindIntakeOriginals(db: Pick<PoolClient, "query">, input: unknown, root: string, staging: Staging) {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return null;
  const { submissionId, items } = parsed.data;

  async function persist(): Promise<OriginalResult[]> {
    const results: OriginalResult[] = [];
    for (const { position, attachmentRef } of items) {
      const name = String(position);
      const file = { ...attachmentRef, objectKey: submissionId + "/" + name };
      const { rows: [existing] } = await db.query<Pick<BusinessRow<"item_versions">, "file_ref">>(`
        select v.file_ref from items i left join item_versions v on v.item_id=i.id and v.version=1
        where i.submission_id=$1 and i.position=$2
      `, [submissionId, position]);
      if (existing) {
        const stored = fileRefSchema.safeParse(existing.file_ref);
        if (!stored.success || stored.data.objectKey !== file.objectKey || stored.data.sha256 !== file.sha256 ||
            stored.data.sizeBytes !== file.sizeBytes || stored.data.mediaType !== file.mediaType) {
          results.push({ position, status: "conflict" });
          continue;
        }
      } else {
        try {
          await saveOriginal(join(root, submissionId), name, await staging.read(attachmentRef.objectKey), attachmentRef);
        } catch {
          results.push({ position, status: "source_failed" });
          continue;
        }
        await db.query("begin");
        try {
          const { rows: [item] } = await db.query<Pick<BusinessRow<"items">, "id">>(
            "insert into items(submission_id,position,kind) values($1,$2,'photo') returning id", [submissionId, position],
          );
          if (!item) throw new Error("Intake item was not created");
          await db.query("insert into item_versions(item_id,version,file_ref) values($1,1,$2)", [item.id, file]);
          await db.query("commit");
        } catch (error) {
          await db.query("rollback").catch(() => undefined);
          throw error;
        }
      }
      await db.query("select 1");
      await staging.remove(attachmentRef.objectKey).catch(() => console.warn("暂存清理失败，等待对象到期"));
      results.push({ position, status: existing ? "replayed" : "persisted", file });
    }
    return results;
  }

  let result: Promise<OriginalResult[]> | undefined;
  return { persistPhotos: () => result ??= persist() };
}
