import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { FileRef } from "@/lib/contracts/intake";

const allowedFormats: Record<FileRef["mediaType"], string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/heic": "heif", "image/heif": "heif",
};

export async function saveOriginal(
  directory: string, name: string, stream: ReadableStream<Uint8Array>, file: FileRef,
) {
  if (!/^[a-f0-9-]+$/.test(name)) throw new Error("Invalid file name");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, "." + randomUUID());
  const destination = join(directory, name);
  const output = await open(temp, "wx", 0o600);
  let bytes = 0;
  const hash = createHash("sha256");
  const reader = stream.getReader();
  try {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > file.sizeBytes) throw new Error("File length");
        hash.update(chunk.value);
        await output.writeFile(chunk.value);
      }
      if (bytes !== file.sizeBytes || hash.digest("hex") !== file.sha256) throw new Error("File integrity");
      await output.sync();
    } finally {
      await reader.cancel().catch(() => undefined);
      await output.close();
    }
    const metadata = await sharp(temp, { limitInputPixels: 100_000_000 }).metadata();
    if (metadata.format !== allowedFormats[file.mediaType] || !metadata.width || !metadata.height ||
        metadata.width * metadata.height > 100_000_000) throw new Error("File type or size");
    await sharp(temp, { limitInputPixels: 100_000_000 }).resize({ width: 64 }).toBuffer();
    await rename(temp, destination);
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await rm(temp, { force: true });
  }
}
