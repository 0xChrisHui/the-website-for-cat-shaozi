import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipArchive } from "archiver";
import sharp from "sharp";
import { exportManifestSchema, type ExportManifest } from "@/lib/contracts/exports";
import type { ExportPhotoSource, SnapshotItem } from "./content";

const maxItems = 500;
const maxSourceBytes = 100 * 1024 ** 2;
const maxMediaBytes = 512 * 1024 ** 2;
const maxTextBytes = 256 * 1024;
const memberDate = new Date("1980-01-01T00:00:00Z");
const replacements: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}

function checkText(value: string) {
  if (Buffer.byteLength(value) > maxTextBytes) throw new Error("Snapshot text size exceeded");
  return escapeHtml(value);
}

async function preparePhoto(source: ExportPhotoSource, stream: Readable, directory: string, output: string, signal: AbortSignal) {
  const input = join(directory, "input");
  const hash = createHash("sha256");
  const expected = source.kind === "original" ? source.file : undefined;
  let bytes = 0;
  try {
    await pipeline(stream, new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > Math.min(expected?.sizeBytes ?? maxSourceBytes, maxSourceBytes)) return callback(new Error("Snapshot source size exceeded"));
        hash.update(chunk);
        callback(null, chunk);
      },
    }), createWriteStream(input, { flags: "wx", mode: 0o600 }), { signal });

    if (expected && (bytes !== expected.sizeBytes || hash.digest("hex") !== expected.sha256)) {
      throw new Error("Approved original integrity mismatch");
    }
    signal.throwIfAborted();
    // Sharp can retain an open handle to file-backed inputs on Windows.
    const imageInput = process.platform === "win32" ? await readFile(input, { signal }) : input;
    const image = sharp(imageInput, { limitInputPixels: 100_000_000 });
    const formats = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/heic": "heif", "image/heif": "heif" };
    if ((await image.metadata()).format !== (expected ? formats[expected.mediaType] : "webp")) {
      throw new Error("Approved photo format mismatch");
    }
    // Re-encode pixels without EXIF, IPTC, XMP or source filenames. Bake in orientation.
    await image.rotate().resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true }).webp().toFile(output);
    signal.throwIfAborted();
  } finally {
    await rm(input, { force: true });
  }
}

async function hashFile(path: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

export async function withSnapshotZip<T>(
  root: string,
  items: readonly SnapshotItem[],
  generatedAt: Date,
  read: (source: ExportPhotoSource, signal: AbortSignal) => Promise<Readable>,
  consume: (path: string, size: number, signal: AbortSignal) => Promise<T>,
  signal = AbortSignal.timeout(20 * 60_000),
): Promise<T> {
  if (items.length > maxItems) throw new Error("Snapshot item limit exceeded");
  const directory = await mkdtemp(join(root, ".export-"));
  try {
    const manifest: ExportManifest = { generatedAt: generatedAt.toISOString(), items: [] };
    const photos: { file: string; name: string }[] = [];
    const diary: { name: string; body: string }[] = [];
    const sections: string[] = [];
    let mediaBytes = 0;
    let textBytes = 0;
    for (const [index, { itemId, versionId, caption, ...item }] of items.entries()) {
      signal.throwIfAborted();
      const captionHtml = checkText(caption ?? "");
      const number = index + 1;
      if (item.kind === "diary") {
        const path = `diary/${number}.txt`;
        const text = checkText(item.text);
        textBytes += Buffer.byteLength(item.text) + Buffer.byteLength(text);
        if (textBytes > 8 * 1024 ** 2) throw new Error("Snapshot text limit exceeded");
        diary.push({ name: path, body: item.text });
        sections.push(`<article><h2>${captionHtml || "日记"}</h2><p>${text}</p></article>`);
        manifest.items.push({ itemId, versionId, path, sha256: createHash("sha256").update(item.text).digest("hex") });
      } else {
        const path = `media/${number}.webp`;
        const file = join(directory, `${number}.webp`);
        await preparePhoto(item.source, await read(item.source, signal), directory, file, signal);
        mediaBytes += (await stat(file)).size;
        if (mediaBytes > maxMediaBytes) throw new Error("Snapshot media limit exceeded");
        photos.push({ file, name: path });
        sections.push(`<figure><img src="${path}" alt="${captionHtml || "照片"}"><figcaption>${captionHtml}</figcaption></figure>`);
        manifest.items.push({ itemId, versionId, path, sha256: await hashFile(file, signal) });
      }
      textBytes += Buffer.byteLength(captionHtml);
      if (textBytes > 8 * 1024 ** 2) throw new Error("Snapshot text limit exceeded");
    }

    const filename = join(directory, "snapshot.zip");
    const archive = new ZipArchive({ store: true });
    const writing = pipeline(archive, createWriteStream(filename, { flags: "wx", mode: 0o600 }), { signal });
    archive.on("warning", (error) => archive.destroy(error));
    try {
      for (const { file, name } of photos) archive.file(file, { name, date: memberDate, mode: 0o600 });
      for (const { name, body } of diary) archive.append(body, { name, date: memberDate, mode: 0o600 });
      archive.append(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>离线快照</title><style>body{max-width:60rem;margin:auto;padding:1rem}img{max-width:100%;height:auto}p{white-space:pre-wrap;overflow-wrap:anywhere}</style><main><h1>离线快照</h1>${sections.join("")}</main></html>`, {
        name: "index.html", date: memberDate, mode: 0o600,
      });
      archive.append(JSON.stringify(exportManifestSchema.parse(manifest)), { name: "manifest.json", date: memberDate, mode: 0o600 });
      await Promise.all([archive.finalize(), writing]);
    } finally {
      archive.destroy();
      await writing.catch(() => undefined);
    }
    return await consume(filename, (await stat(filename)).size, signal);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
