import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { z } from "zod";
import type { WorkerContext } from "@/lib/contracts/jobs";
import type { ExportPhotoSource } from "./content";

export function exportPhotoReader(root: string, files: WorkerContext["files"]) {
  return async (source: ExportPhotoSource, signal: AbortSignal): Promise<Readable> => {
    signal.throwIfAborted();
    if (source.kind === "display") {
      if (!/^memorial\/display\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(source.key)) {
        throw new Error("Invalid approved display key");
      }
      return Readable.fromWeb((await files.read(source.key)) as NodeReadableStream<Uint8Array>, { signal });
    }

    const key = z.string().regex(/^[a-f0-9-]{36}\/(?:0|[1-9][0-9]?)$/).parse(source.file.objectKey);
    const handle = await open(join(root, key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== source.file.sizeBytes) throw new Error("Invalid approved original file");
      return handle.createReadStream({ signal });
    } catch (error) {
      await handle.close();
      throw error;
    }
  };
}
