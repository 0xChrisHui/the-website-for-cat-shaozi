import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { expect, test, vi } from "vitest";
import { exportManifestSchema } from "@/lib/contracts/exports";
import { withSnapshotZip } from "./archive";
import { selectSnapshotItems, type ExportCandidate } from "./content";
import { generateSnapshot, snapshotKey, type ExportClaim, type ExportStorage, type ExportWorkerStore } from "./generate";

const itemId = "531c9eed-83d0-4b86-a676-9518db71a321";
const versionId = "81cddb00-1e77-45cc-9d89-f70e1b2e9a02";
const submissionId = "6043aad4-3178-4529-a185-b0c52df52fa3";
const clock = () => new Date("2026-01-01T00:00:00Z");
const diary: ExportCandidate = {
  itemId, currentVersionId: versionId, approvedVersionId: versionId, withdrawn: false, exclusion: "none",
  approvalPrivateExport: true, itemPrivateExport: true, submissionId, position: 0,
  caption: '"<caption>"', kind: "diary", text: "<script>synthetic</script> & text",
};

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("requires matching approval and explicit permission on both records", () => {
  expect(selectSnapshotItems([
    { ...diary, approvalPrivateExport: null },
    { ...diary, itemPrivateExport: false },
    { ...diary, approvedVersionId: submissionId },
    { ...diary, exclusion: "ambiguous" },
    { ...diary, withdrawn: true },
  ])).toEqual([]);
});

test("uses the revision display key and selects a verified original for explicit exclusion", async () => {
  const raw = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#ff9900" } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const photo = {
    ...diary, kind: "photo", itemId: submissionId, position: 1,
    processedKey: `memorial/display/${submissionId}/${versionId}`,
    original: { objectKey: `${submissionId}/1`, mediaType: "image/jpeg", sizeBytes: raw.length, sha256: digest(raw) },
  } satisfies ExportCandidate;
  expect(selectSnapshotItems([photo])).toMatchObject([{ source: { kind: "display", key: photo.processedKey } }]);
  expect(() => selectSnapshotItems([{ ...photo, processedKey: "wrong" }])).toThrow();
  const items = selectSnapshotItems([diary, { ...photo, exclusion: "explicit" }]);
  const root = await mkdtemp(join(tmpdir(), "exports-test-"));
  try {
    await withSnapshotZip(root, items, clock(), async (source) => {
      expect(source).toEqual({ kind: "original", file: photo.original });
      return Readable.from([raw]);
    }, async (archive) => {
      const read = (member: string) => execFileSync("python3", ["-c", "import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", archive, member], { timeout: 10_000 });
      const html = read("index.html").toString();
      expect(html).toContain('src="media/2.webp"');
      expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt; &amp; text");
      expect(html).toContain("&quot;&lt;caption&gt;&quot;");
      expect(html).not.toContain("<script>");
      const manifest = exportManifestSchema.parse(JSON.parse(read("manifest.json").toString()));
      expect(manifest.items.map(({ itemId, versionId, path }) => [itemId, versionId, path])).toEqual([
        [itemId, versionId, "diary/1.txt"], [submissionId, versionId, "media/2.webp"],
      ]);
      for (const member of manifest.items) expect(digest(read(member.path))).toBe(member.sha256);
      const image = await sharp(read("media/2.webp")).metadata();
      expect(image).toMatchObject({ format: "webp", width: 12, height: 16 });
      expect(image.exif).toBeUndefined();
      expect(image.xmp).toBeUndefined();
      expect(html).not.toContain(photo.original.objectKey);
    });
    await expect(withSnapshotZip(root, items, clock(), async () => Readable.from([Buffer.alloc(raw.length)]),
      async () => { throw new Error("must reject before upload"); })).rejects.toThrow("integrity mismatch");
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["revoked", "upload failure", "lost publication response", "success"] as const)(
  "cleans retired objects without removing a committed snapshot after %s", async (outcome) => {
    const root = await mkdtemp(join(tmpdir(), "exports-test-"));
    const claim: ExportClaim = { jobId: itemId, scope: { sampleRunId: null } };
    const previous = snapshotKey({ ...claim, jobId: versionId });
    const next = snapshotKey(claim);
    const retired = new Set([previous]);
    const objects = new Set([previous]);
    let current: string | null = null;
    let revoked = false;
    const store: ExportWorkerStore = {
      async readCurrent() { return [diary]; },
      async retiredKeys() { return [...retired]; },
      async acknowledgeRemoval(_scope, key) { retired.delete(key); },
      publish: vi.fn(async () => {
        if (revoked) return false;
        current = next;
        if (outcome === "lost publication response") throw new Error("synthetic network failure");
        return true;
      }),
      async fail() { if (current !== next) retired.add(next); },
    };
    const storage: ExportStorage = {
      async upload(key, body, size) {
        expect(objects.has(previous)).toBe(false);
        let bytes = 0;
        for await (const chunk of body) bytes += chunk.length;
        expect(bytes).toBe(size);
        objects.add(key);
        revoked = outcome === "revoked";
        if (outcome === "upload failure") throw new Error("synthetic upload failure");
      },
      async removeAndConfirm(key) { objects.delete(key); },
    };
    try {
      await generateSnapshot(claim, { root, clock, store, storage, readPhoto: async () => Readable.from([]) });
      const committed = outcome === "success" || outcome === "lost publication response";
      expect(current).toBe(committed ? next : null);
      expect([...objects]).toEqual(committed ? [next] : []);
      expect([...retired]).toEqual([]);
      expect(store.publish).toHaveBeenCalledTimes(outcome === "upload failure" ? 0 : 1);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
