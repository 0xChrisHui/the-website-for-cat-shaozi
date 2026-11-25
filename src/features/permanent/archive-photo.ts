import sharp from "sharp";

export const archiveLimit = 100_000;
const originalLimit = 40_000_000;

export async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, bytes);
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("Image exceeds byte limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function archivePhoto(original: ReadableStream<Uint8Array>) {
  const image = sharp(await readBounded(original, originalLimit), {
    limitInputPixels: 48_000_000,
  }).autoOrient().flatten({ background: "#ffffff" });
  for (const edge of [2048, 1536, 1024, 768, 512, 256]) {
    for (const quality of [82, 65, 45]) {
      const jpeg = await image.clone().resize({
        width: edge, height: edge, fit: "inside", withoutEnlargement: true,
      }).jpeg({ quality }).toBuffer();
      if (jpeg.byteLength <= archiveLimit) return jpeg;
    }
  }
  throw new Error("Archive image exceeds byte limit");
}
