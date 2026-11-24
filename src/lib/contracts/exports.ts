import { z } from "zod";
import { sha256 } from "./intake";

export const exportRequestSchema = z.object({ requestId: z.uuid() }).strict();
export const exportManifestSchema = z.object({
  generatedAt: z.iso.datetime(),
  items: z.array(z.object({ itemId: z.uuid(), versionId: z.uuid(), path: z.string(), sha256 }).strict()),
}).strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportManifest = z.infer<typeof exportManifestSchema>;
