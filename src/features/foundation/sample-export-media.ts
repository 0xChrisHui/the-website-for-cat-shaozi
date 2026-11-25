import { createHash } from "node:crypto";
import { sampleDisplayKey } from "@/features/public/media-key";
import type { FileRef } from "@/lib/contracts/intake";

// A generated one-pixel image used only by the authenticated sample run.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWPY2ZoGAAOfAaWkC5IvAAAAAElFTkSuQmCC", "base64");
const originalKey = "memorial-sample/private-original";

export const sampleExportOriginal: FileRef = {
  objectKey: originalKey,
  mediaType: "image/png",
  sizeBytes: png.length,
  sha256: createHash("sha256").update(png).digest("hex"),
};

export async function readSampleExportMedia(key: string) {
  if (key !== originalKey && key !== sampleDisplayKey) throw new Error("Unknown sample export media");
  return new Blob([png]).stream();
}
