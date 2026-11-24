import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { saveOriginal } from "./originals";
import type { FileRef } from "@/lib/contracts/intake";

function item(bytes: Uint8Array): FileRef {
  return { objectKey: "mock", mediaType: "image/png", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 8));
      controller.enqueue(bytes.subarray(8));
      controller.close();
    },
  });
}

it("preserves original bytes and removes invalid staging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memorial-image-"));
  try {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();
    await saveOriginal(directory, "0", stream(bytes), item(bytes));
    expect(await readFile(join(directory, "0"))).toEqual(bytes);
    await expect(saveOriginal(directory, "1", stream(bytes), { ...item(bytes), sha256: "0".repeat(64) })).rejects.toThrow("File integrity");
    const broken = Buffer.from("not an image");
    await expect(saveOriginal(directory, "2", stream(broken), item(broken))).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["0"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
