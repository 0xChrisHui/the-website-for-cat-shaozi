import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import sharp from "sharp";
import { withSnapshotZip } from "./archive";

const run = promisify(execFile);

export async function withExtractedFixture(check: (html: string, media: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "offline-export-"));
  const itemId = "531c9eed-83d0-4b86-a676-9518db71a321";
  const versionId = "81cddb00-1e77-45cc-9d89-f70e1b2e9a02";
  try {
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#3355aa" } }).webp().toBuffer();
    await withSnapshotZip(root, [
      { itemId, versionId, kind: "photo", caption: "合成图注", source: { kind: "display", key: `memorial/display/${itemId}/${versionId}` } },
      { itemId: versionId, versionId, kind: "diary", caption: null, text: "离线日记 <script>合成文字</script>" },
    ], new Date("2026-01-01T00:00:00Z"), async () => Readable.from([image]), async (path) => {
      const extracted = join(root, "extracted");
      await run("python3", ["-m", "zipfile", "-e", path, extracted], { timeout: 10_000 });
      const html = await readFile(join(extracted, "index.html"), "utf8");
      const media = await readFile(join(extracted, "media", "1.webp"), "base64");
      await check(html, "data:image/webp;base64," + media);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function inspectSampleZip(file: string) {
  const { stdout } = await run("python3", ["-c", `
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    manifest = json.loads(z.read("manifest.json"))
    print(json.dumps({"html": z.read("index.html").decode(),
        "items": [dict(item, digest=hashlib.sha256(z.read(item["path"])).hexdigest()) for item in manifest["items"]]}))
`, file], { timeout: 10_000 });
  return JSON.parse(stdout) as {
    html: string; items: { path: string; versionId: string; sha256: string; digest: string }[];
  };
}
