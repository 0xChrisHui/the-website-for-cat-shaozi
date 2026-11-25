import { get, put } from "@vercel/blob";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { z } from "zod";
import { readCheckedOriginal } from "@/features/foundation/originals";
import { displayKey } from "@/features/public/media-key";
import { fileRefSchema, stage0IntakeSource } from "@/lib/contracts/intake";

export const displayJobKind = "intake.review-display";
export const displayBinding = z.strictObject({ itemId: z.uuid(), versionId: z.uuid() });
const maxSide = 1600;
const maxBytes = 4 * 1024 * 1024;

export function reviewDisplayBlob(token: string, host: string) {
  const store = /^vercel_blob_rw_([A-Za-z0-9]{1,63})_[A-Za-z0-9_-]+$/.exec(token)?.[1];
  if (!store || host !== store.toLowerCase() + ".private.blob.vercel-storage.com") {
    throw new Error("Review Blob store mismatch");
  }

  function url(key: string) {
    return "https://" + host + "/" + key;
  }

  return {
    async read(key: string, signal?: AbortSignal) {
      const timeout = AbortSignal.timeout(15_000);
      const result = await get(url(key), { access: "private", token, useCache: false,
        abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!result) return null;
      const { stream, blob } = result;
      if (result.statusCode !== 200 || blob.pathname !== key || blob.url !== url(key) ||
          blob.contentType !== "image/webp" || !stream) {
        await stream?.cancel();
        throw new Error("Invalid review Blob");
      }
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > maxBytes) throw new Error("Review Blob length");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = Buffer.concat(chunks);
      const meta = await sharp(bytes, { limitInputPixels: maxSide ** 2 }).metadata();
      if (meta.format !== "webp" || !meta.width || !meta.height || meta.width > maxSide || meta.height > maxSide ||
          (meta.pages ?? 1) !== 1 || meta.exif || meta.xmp || meta.iptc || meta.icc) {
        throw new Error("Invalid review derivative");
      }
      return bytes;
    },
    async write(key: string, bytes: Buffer, signal: AbortSignal) {
      const saved = await put(key, bytes, { token, access: "private", contentType: "image/webp",
        addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      if (saved.pathname !== key || saved.url !== url(key)) throw new Error("Review Blob binding mismatch");
    },
  };
}

export async function prepareReviewDisplay(db: Pick<PoolClient, "query">, payload: unknown, root: string,
  blob: ReturnType<typeof reviewDisplayBlob>, signal: AbortSignal) {
  const { itemId, versionId } = displayBinding.parse(payload);
  const { rows: [row] } = await db.query<{ file_ref: unknown; object_key: string }>(`
    select v.file_ref, s.id::text || '/' || i.position::text as object_key
    from items i join submissions s on s.id=i.submission_id
    join lateral (select id, file_ref from item_versions where item_id=i.id order by version desc limit 1) v on true
    join item_versions original on original.item_id=i.id and original.version=1
    where i.id=$1 and v.id=$2 and s.source=$3 and i.kind='photo' and i.withdrawn_at is null
      and i.exclusion='none' and v.file_ref=original.file_ref
      and not exists (select 1 from approvals where item_id=i.id and version_id=v.id)
  `, [itemId, versionId, stage0IntakeSource]);
  if (!row) throw new Error("Review original unavailable");
  const file = fileRefSchema.parse(row.file_ref);
  if (file.objectKey !== row.object_key) throw new Error("Invalid original binding");
  signal.throwIfAborted();
  const original = await readCheckedOriginal(root, file);
  const bytes = await sharp(Buffer.from(await new Response(original).arrayBuffer()), { limitInputPixels: 100_000_000 })
    .autoOrient().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  if (bytes.length > maxBytes) throw new Error("Review derivative length");

  const key = displayKey(itemId, versionId);
  signal.throwIfAborted();
  const existing = await blob.read(key, signal);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error("Existing review derivative differs");
    return;
  }
  await blob.write(key, bytes, signal);
  if (!(await blob.read(key, signal))?.equals(bytes)) throw new Error("Review derivative unavailable");
}
