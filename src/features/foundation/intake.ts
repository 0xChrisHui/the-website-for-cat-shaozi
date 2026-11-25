import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { issueSignedToken, presignUrl } from "@vercel/blob";
import { z } from "zod";
import { intakeEventSchema, intakeEventStorageKey, prepareUploadSchema, stage0IntakeSource, type FileRef } from "@/lib/contracts/intake";
import { readSiteEnv } from "@/lib/env";
import { queryRows, withWebsiteDb, type BusinessRow } from "@/lib/supabase/database";
import { hidden } from "./samples";

class IntakeError extends Error {
  constructor(readonly status: number) { super("Sample intake rejected"); }
}

export function senderHash(sender: string) {
  return createHash("sha256").update(sender.trim().toLowerCase()).digest("hex");
}

export function secretsMatch(input: string | null, expected: string) {
  if (!input || input.length > 512) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(input), hash(expected));
}

async function boundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !request.body) {
    throw new IntakeError(415);
  }
  const chunks: Uint8Array[] = [];
  const stream = request.body.getReader();
  let length = 0;
  for (;;) {
    const chunk = await stream.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 256 * 1024) {
      await stream.cancel();
      throw new IntakeError(413);
    }
    chunks.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new IntakeError(400); }
}

export async function sampleIntake(request: Request, phase: "prepare" | "submit") {
  const env = readSiteEnv();
  if (env.environment !== "preview" || env.ci) return hidden();
  if (!env.TEST_CALLBACK_ORIGIN || !env.STAGE0_INTAKE_TOKEN || !env.GROK_SENDER_SHA256 ||
      !env.BLOB_READ_WRITE_TOKEN || !env.BLOB_STORE_HOST) return hidden();
  const requestOrigin = new URL(request.url).origin;
  if (requestOrigin !== new URL(env.TEST_CALLBACK_ORIGIN).origin) return hidden();
  if (!secretsMatch(request.headers.get("authorization"), "Bearer " + env.STAGE0_INTAKE_TOKEN)) {
    return new Response(null, { status: 401 });
  }
  try {
    const raw = await boundedJson(request);
    const credentials = z.object({ sender: z.email().max(254) }).parse(raw);
    const sender = senderHash(credentials.sender);
    if (!secretsMatch(sender, env.GROK_SENDER_SHA256)) throw new IntakeError(403);
    if (phase === "prepare") {
      const input = prepareUploadSchema.parse(raw);
      if (input.position >= env.INTAKE_MAX_ITEMS || input.sizeBytes > env.INTAKE_MAX_EVENT_BYTES) throw new IntakeError(413);
      const objectKey = "stage0/test/" + randomUUID();
      const expiresAt = new Date(Date.now() + env.UPLOAD_GRANT_TTL_SECONDS * 1000);
      const token = await issueSignedToken({
        token: env.BLOB_READ_WRITE_TOKEN, pathname: objectKey, operations: ["put"],
        validUntil: expiresAt.getTime(), allowedContentTypes: [input.mediaType], maximumSizeInBytes: input.sizeBytes,
      });
      const { presignedUrl } = await presignUrl(token, {
        access: "private", operation: "put", pathname: objectKey, maximumSizeInBytes: input.sizeBytes,
        allowedContentTypes: [input.mediaType], validUntil: expiresAt.getTime(),
        allowOverwrite: false, addRandomSuffix: false, ttlDays: 1,
      });
      await withWebsiteDb(async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["stage0:prepare:" + sender]);
        const [quota] = await queryRows<{ requests: number; bytes: string }>(db, `
          select count(*) filter (where expires_at > now() - interval '1 minute' + ($2::int * interval '1 second'))::int as requests,
            coalesce(sum(size_bytes) filter (where expires_at > now() and not used),0) as bytes
          from stage0_uploads where sender_hash=$1`, [sender, env.UPLOAD_GRANT_TTL_SECONDS]);
        if (!quota || quota.requests >= env.INTAKE_REQUESTS_PER_MINUTE ||
            Number(quota.bytes) + input.sizeBytes > env.INTAKE_MAX_STAGED_BYTES) throw new IntakeError(429);
        const limit = (await db.query<{ count: number; bytes: string }>(
          "select count(*)::int as count, coalesce(sum(size_bytes),0) as bytes from stage0_uploads where sender_hash=$1 and event_id=$2 and expires_at > now()",
          [sender, input.eventId],
        )).rows[0];
        if (!limit || limit.count >= env.INTAKE_MAX_ITEMS || Number(limit.bytes) + input.sizeBytes > env.INTAKE_MAX_EVENT_BYTES) {
          throw new IntakeError(429);
        }
        await db.query(`
          insert into stage0_uploads(object_key,event_id,sender_hash,position,media_type,size_bytes,sha256,expires_at)
          values($1,$2,$3,$4,$5,$6,$7,$8)`, [objectKey, input.eventId, sender, input.position,
          input.mediaType, input.sizeBytes, input.sha256, expiresAt]);
      });
      return Response.json({ objectKey, uploadUrl: presignedUrl, expiresAt: expiresAt.toISOString() });
    }
    const input = intakeEventSchema.parse(raw);
    const photos: { kind: "photo"; position: number; attachmentRef: FileRef }[] = [];
    const diaries: { position: number; diaryText: string }[] = [];
    for (const { kind, position, attachmentRef, diaryText } of input.items) {
      if (kind === "photo") {
        if (!attachmentRef || diaryText !== undefined) throw new IntakeError(400);
        photos.push({ kind, position, attachmentRef });
      } else {
        if (diaryText === undefined || attachmentRef !== undefined) throw new IntakeError(400);
        diaries.push({ position, diaryText });
      }
    }
    if (input.items.length > env.INTAKE_MAX_ITEMS ||
        photos.reduce((total, item) => total + item.attachmentRef.sizeBytes, 0) > env.INTAKE_MAX_EVENT_BYTES) throw new IntakeError(413);
    if (new Set(input.items.map((item) => item.position)).size !== input.items.length) throw new IntakeError(400);
    const itemHints = input.items.flatMap(({ position, dateHint, exclusionQuote }) =>
      dateHint === undefined && exclusionQuote === undefined ? [] : [{ position, dateHint, exclusionQuote }],
    );
    const hints = input.commonDateHint !== undefined || itemHints.length > 0
      ? { commonDateHint: input.commonDateHint, items: itemHints }
      : undefined;
    const storedEventId = intakeEventStorageKey(stage0IntakeSource, input.eventId);
    const result = await withWebsiteDb(async (db) => {
      await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", ["stage0:submit:" + storedEventId]);
      const [existing] = await queryRows<Pick<BusinessRow<"submissions">, "id" | "sender_hash"> & { job_id: string }>(db, `
        select s.id, s.sender_hash, j.id as job_id from submissions s join jobs j
        on j.payload->>'submissionId' = s.id::text and j.kind = 'foundation.intake'
        where s.event_id = $1 and s.source = $2`, [storedEventId, stage0IntakeSource]);
      if (existing) {
        if (existing.sender_hash !== sender) throw new IntakeError(409);
        return { submissionId: existing.id, jobId: existing.job_id, duplicate: true };
      }
      const submissionId = randomUUID();
      const jobId = randomUUID();
      for (const { position, attachmentRef: file } of photos) {
        const verified = await db.query(`
          update stage0_uploads set used = true
          where object_key=$1 and event_id=$2 and sender_hash=$3 and position=$4
            and media_type=$5 and size_bytes=$6 and sha256=$7 and expires_at > now() and used=false
        `, [file.objectKey, input.eventId, sender, position, file.mediaType, file.sizeBytes, file.sha256]);
        if (verified.rowCount !== 1) throw new IntakeError(400);
      }
      await db.query("insert into submissions(id,event_id,sender_hash,received_at,source) values($1,$2,$3,$4,$5)",
        [submissionId, storedEventId, sender, input.receivedAt, stage0IntakeSource]);
      for (const { position, diaryText } of diaries) {
        const itemId = randomUUID();
        await db.query("insert into items(id,submission_id,position,kind) values($1,$2,$3,'diary')",
          [itemId, submissionId, position]);
        await db.query("insert into item_versions(item_id,version,diary_text) values($1,1,$2)", [itemId, diaryText]);
      }
      const payload = { submissionId, items: photos, ...(hints && { hints }) };
      await db.query("insert into jobs(id,kind,payload,status) values($1,'foundation.intake',$2,$3)",
        [jobId, payload, photos.length > 0 ? "queued" : "done"]);
      return { submissionId, jobId, duplicate: false };
    });
    return Response.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    if (error instanceof IntakeError) return new Response(null, { status: error.status });
    if (error instanceof z.ZodError) return new Response(null, { status: 400 });
    return new Response(null, { status: 503 });
  }
}
