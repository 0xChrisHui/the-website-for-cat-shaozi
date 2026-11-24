import { z } from "zod";

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const eventId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export const stage0IntakeSource = "stage0-grok";
const intakeSource = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

// The source comes from the authenticated server configuration. Legacy stage0 keys contain no colon.
export function intakeEventStorageKey(source: string, externalId: string) {
  const verifiedSource = intakeSource.parse(source);
  const validatedId = eventId.parse(externalId);
  return verifiedSource === stage0IntakeSource ? validatedId : verifiedSource + ":" + validatedId;
}

export const mediaType = z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const file = z.object({ mediaType, sizeBytes: z.number().int().min(1).max(100 * 1024 ** 2), sha256 });
export const fileRefSchema = file.extend({ objectKey: z.string().max(256) }).strict();
export const prepareUploadSchema = file.extend({
  eventId, sender: z.email().max(254), position: z.number().int().min(0).max(99),
}).strict();
export const uploadGrantSchema = z.object({ objectKey: z.string(), uploadUrl: z.url(), expiresAt: z.iso.datetime() }).strict();
export const intakeEventSchema = z.object({
  eventId,
  sender: z.email().max(254),
  receivedAt: z.iso.datetime(),
  sourceMessageId: z.string().max(256).optional(),
  sourceProof: z.string().max(512).optional(),
  inReplyToId: z.string().max(256).optional(),
  commonDateHint: z.string().max(160).optional(),
  items: z.array(z.object({
    kind: z.enum(["photo", "diary"]), position: z.number().int().min(0).max(99),
    dateHint: z.string().max(160).optional(), exclusionQuote: z.string().max(512).optional(),
    attachmentRef: fileRefSchema.optional(), diaryText: z.string().max(64_000).optional(),
  }).strict()).min(1).max(100),
}).strict();

export type PrepareUploadV1 = z.infer<typeof prepareUploadSchema>;
export type UploadGrantV1 = z.infer<typeof uploadGrantSchema>;
export type FileRef = z.infer<typeof fileRefSchema>;
export type IntakeEventV1 = z.infer<typeof intakeEventSchema>;
export interface SubmissionDraft {
  submissionId: string;
  receivedAt: string;
  source: string;
  pendingReasons: string[];
  items: {
    itemId: string;
    versionId: string;
    kind: "photo" | "diary";
    localDate?: string;
    dateSource?: string;
    disposition: "pending" | "excluded" | "eligible";
    candidates: string[];
    file?: FileRef;
    diaryText?: string;
  }[];
}
