import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { FileRef } from "@/lib/contracts/intake";

const allowedFormats: Record<FileRef["mediaType"], string> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp", "image/heic": "heif", "image/heif": "heif",
};

async function matchesOriginal(path: string, file: FileRef) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.sizeBytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest("hex") === file.sha256;
  } finally {
    await handle.close();
  }
}

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
    try {
      await link(temp, destination);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      if (!(await matchesOriginal(destination, file))) throw new Error("Existing original differs");
    }
    // Windows cannot fsync directory handles through Node.
    if (process.platform !== "win32") {
      const parent = await open(directory, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally {
    await rm(temp, { force: true });
  }
}

/** Read and authenticate the same file descriptor before exposing any bytes. */
export async function readCheckedOriginal(root: string, file: FileRef) {
  const [, submission, position] = /^([0-9a-f-]{36})\/(0|[1-9][0-9]?)$/.exec(file.objectKey) ?? [];
  if (!submission || !position) throw new Error("Invalid original key");
  const directory = join(root, submission);
  // The worker owns the root. Reject a symlink in the per-submission directory.
  if (await realpath(directory) !== join(await realpath(root), submission)) throw new Error("Original directory changed");
  const handle = await open(join(directory, position), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== file.sizeBytes) throw new Error("Original length");
    const bytes = Buffer.alloc(file.sizeBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const content = bytes.subarray(0, length);
    if (length !== file.sizeBytes || createHash("sha256").update(content).digest("hex") !== file.sha256) {
      throw new Error("Original integrity");
    }
    return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(content); controller.close(); } });
  } finally {
    await handle.close();
  }
}
