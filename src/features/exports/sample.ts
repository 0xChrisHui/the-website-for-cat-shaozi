import "server-only";

import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import sharp from "sharp";
import { generateSamplePrivateExport } from "@/features/foundation/private-export-access";
import { sampleExportOriginal } from "@/features/foundation/sample-export-media";
import { sampleDisplayKey } from "@/features/public/media-key";
import { withSnapshotZip } from "./archive";
import { reservedSnapshotItems } from "./reserved-items";

export function generateSampleSnapshot() {
  return generateSamplePrivateExport(async (candidates, readMedia) => {
    const items = reservedSnapshotItems(candidates, candidates, true);
    return withSnapshotZip(tmpdir(), items, new Date(), async (source, signal) => {
      const stream = await readMedia(source.kind === "display" ? sampleDisplayKey : sampleExportOriginal.objectKey);
      signal.throwIfAborted();
      if (source.kind === "original") return Readable.fromWeb(stream as NodeReadableStream<Uint8Array>, { signal });
      const bytes = await new Response(stream).arrayBuffer();
      return Readable.from([await sharp(Buffer.from(bytes)).webp().toBuffer()]);
    }, async (path, size) => {
      if (size > 8 * 1024 ** 2) throw new Error("Sample snapshot size exceeded");
      return readFile(path);
    }, AbortSignal.timeout(10_000));
  });
}
