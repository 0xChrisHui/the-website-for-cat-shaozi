import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { displayKey } from "@/features/public/media-key";
import { prepareIntakeDisplays, prepareReviewDisplay } from "./review-display";

it("authenticates persisted bytes, strips metadata, bounds and reuses the exact private derivative", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-display-"));
  try {
    const submissionId = randomUUID();
    const itemId = randomUUID();
    const versionId = randomUUID();
    const binding = { itemId, versionId };
    const key = displayKey(itemId, versionId);
    const signal = new AbortController().signal;
    const original = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "blue" } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const object_key = submissionId + "/0";
    await mkdir(join(root, submissionId));
    await writeFile(join(root, object_key), original);
    const file_ref = { objectKey: object_key, sizeBytes: original.length, mediaType: "image/jpeg",
      sha256: createHash("sha256").update(original).digest("hex") };
    const query = vi.fn().mockResolvedValue({ rows: [{ object_key, file_ref }] });
    let derivative: Buffer<ArrayBuffer> | null = null;
    const blob = {
      read: vi.fn(async () => derivative),
      write: vi.fn(async (_key: string, bytes: Buffer) => { derivative = Buffer.from(bytes); }),
    };

    query.mockResolvedValueOnce({ rows: [binding] });
    await expect(prepareIntakeDisplays({ query }, submissionId, [0], root, blob, signal)).resolves.toBe(false);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("v.version=1"), [submissionId, [0]]);
    const bytes = await blob.read();
    expect(bytes).toBeInstanceOf(Buffer);
    const metadata = await sharp(bytes!).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 800, height: 1600 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(blob.write).toHaveBeenCalledWith(key, bytes, signal);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("v.id=$2"), [itemId, versionId, "stage0-grok"]);

    await prepareReviewDisplay({ query }, binding, root, blob, signal);
    expect(blob.write).toHaveBeenCalledOnce();
    await writeFile(join(root, object_key), Buffer.alloc(original.length));
    await expect(prepareReviewDisplay({ query }, binding, root, blob, signal)).rejects.toThrow("Original integrity");
    expect(blob.write).toHaveBeenCalledOnce();

    query.mockResolvedValue({ rows: [] });
    await expect(prepareReviewDisplay({ query }, { itemId, versionId: randomUUID() }, root, blob, signal))
      .rejects.toThrow("Review original unavailable");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
