import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

export const photoKind = "permanent.archive-photo";
export const photoSettingsKey = "test.photo-permanent";
const settingsSchema = z.strictObject({
  archive: z.boolean(),
  mint: z.boolean(),
  recipientVersion: z.uuid().nullable(),
});

export function parsePhotoSettings(value: unknown) {
  return settingsSchema.safeParse(value).data ?? null;
}

export async function readPhotoSettings(db: Pick<PoolClient, "query">) {
  const { rows: [row] } = await db.query<{ value: unknown }>(
    "select value from site_settings where key=$1", [photoSettingsKey],
  );
  return parsePhotoSettings(row?.value);
}

/** Called on the approval transaction's website connection. */
export async function enqueueApprovedPhoto(db: Pick<PoolClient, "query">, itemId: string, versionId: string) {
  const id = randomUUID();
  const bound = await db.query(`
    insert into test_photo_jobs (archive_job_id, bound_item_id, approved_version_id, original_ref)
    values ($1, $2, $3, (select file_ref from item_versions where id=$3)) on conflict (bound_item_id, approved_version_id) do nothing
  `, [id, itemId, versionId]);
  if (!bound.rowCount) return;
  await db.query("insert into jobs (id, kind, payload) values ($1, $2, $3)", [id, photoKind, { itemId }]);
}
