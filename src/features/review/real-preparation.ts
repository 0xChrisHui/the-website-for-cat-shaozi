import "server-only";

import type { PoolClient } from "pg";
import { z } from "zod";
import { normalizeIntakeDate } from "@/features/intake/normalize";
import { displayBinding, displayJobKind, reviewDisplayBlob } from "@/features/intake/review-display";
import { displayKey } from "@/features/public/media-key";
import { readSiteEnv } from "@/lib/env";
import { withWebsiteDb } from "@/lib/supabase/database";
import { ReviewConflict } from "./approve";
import { testPhotoReview } from "./photo-decision";
import { findSubmission, readReviewItems, reviewScope, type ReviewScope } from "./store";

const hintsSchema = z.object({
  commonDateHint: z.string().optional(),
  items: z.array(z.object({ position: z.number(), dateHint: z.string().optional(), exclusionQuote: z.string().optional() })),
});
type JobStatus = z.infer<typeof import("@/lib/contracts/jobs").jobStatus>;

export function realPreparationEnabled(scope: ReviewScope, senderHash: string) {
  return scope.ready && testPhotoReview(readSiteEnv().environment, scope.sample) &&
    Boolean(scope.sender && scope.sender === senderHash);
}

export async function readRealPreparation(db: PoolClient, submissionId: string, receivedAt: string | Date) {
  const { rows: [intake] } = await db.query<{ hints: unknown }>(`
    select payload->'hints' as hints from jobs
    where kind='foundation.intake' and schema_version=1 and sample_run_id is null and payload->>'submissionId'=$1
    order by created_at desc, id desc limit 1
  `, [submissionId]);
  const hints = hintsSchema.safeParse(intake?.hints ?? { items: [] });
  const { rows: jobs } = await db.query<{ id: string; status: JobStatus; item_id: string; version_id: string }>(`
    select j.id, j.status, i.id as item_id, v.id as version_id
    from items i join lateral (select id from item_versions where item_id=i.id order by version desc limit 1) v on true
    join jobs j on j.payload=jsonb_build_object('itemId', i.id::text, 'versionId', v.id::text)
    where i.submission_id=$1 and j.kind=$2 and j.schema_version=1 and j.sample_run_id is null
  `, [submissionId, displayJobKind]);
  const received = new Date(receivedAt).toISOString();
  return {
    job: (itemId: string, versionId: string) => jobs.find((entry) => entry.item_id === itemId && entry.version_id === versionId),
    metadata(position: number) {
      const entry = hints.data?.items.find((item) => item.position === position);
      const date = normalizeIntakeDate({ receivedAt: received, commonDateHint: hints.data?.commonDateHint,
        dateHint: entry?.dateHint });
      return { blocked: !intake || !hints.success || entry?.exclusionQuote !== undefined,
        date: date.status === "resolved" ? date.localDate : null };
    },
  };
}

async function readBlob(key: string, signal?: AbortSignal) {
  const { BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = readSiteEnv();
  if (!token || !host) throw new Error("Review Blob unavailable");
  return reviewDisplayBlob(token, host).read(key, signal);
}

export async function changeRealPreparation(submissionId: string, binding: unknown,
  change: { kind: "prepare" } | { kind: "save"; date: unknown; publicView: boolean; privateExport: boolean; arweave: boolean; nft: boolean },
) {
  const scope = await reviewScope();
  if (!scope?.ready || scope.sample || !z.uuid().safeParse(submissionId).success) throw new ReviewConflict();
  const { itemId, versionId } = displayBinding.parse(binding);
  return withWebsiteDb(async (db) => {
    const submission = await findSubmission(db, scope, submissionId, true);
    if (!submission || !realPreparationEnabled(scope, submission.sender_hash)) throw new ReviewConflict();
    const items = await readReviewItems(db, submissionId, true);
    const item = items.find(({ id }) => id === itemId);
    if (!item || item.version_id !== versionId || item.withdrawn_at || item.approval || item.exclusion !== "none") {
      throw new ReviewConflict();
    }
    const setup = await readRealPreparation(db, submissionId, submission.received_at);
    const job = setup.job(itemId, versionId);
    if (setup.metadata(item.position).blocked) throw new ReviewConflict();

    if (change.kind === "prepare") {
      if (item.kind !== "photo") throw new ReviewConflict();
      if (!job) {
        await db.query("insert into jobs (kind,payload) values ($1,$2)", [displayJobKind, { itemId, versionId }]);
      } else if (job.status === "needs_attention" || job.status === "done") {
        // A done job can be retried if a previously verified object became unavailable.
        await db.query(`update jobs set status='queued', reason=null, updated_at=now()
          where id=$1 and status=$2`, [job.id, job.status]);
      }
      return;
    }
    const date = z.iso.date().refine((value) => !value.startsWith("0000-")).parse(change.date);
    const { publicView, privateExport, arweave, nft } = change;
    if ((arweave && (!publicView || item.kind !== "photo")) || (nft && !arweave)) throw new ReviewConflict();
    if (publicView && item.kind === "diary" && !item.diary_text?.trim()) throw new ReviewConflict();
    if ((publicView || privateExport) && item.kind === "photo") {
      const key = displayKey(itemId, versionId);
      if (job?.status !== "done" || !(await readBlob(key).catch(() => null))) throw new ReviewConflict();
      await db.query(`
        insert into item_version_display (version_id,processed_media_ref) values ($1,$2)
        on conflict (version_id) do update set processed_media_ref=excluded.processed_media_ref
      `, [versionId, key]);
    }
    await db.query("update item_versions set local_date=$2 where id=$1", [versionId, date]);
    await db.query(`
      insert into item_usage_rights (item_id,public_view,private_export,arweave,nft) values ($1,$2,$3,$4,$5)
      on conflict (item_id) do update set public_view=excluded.public_view, private_export=excluded.private_export,
        arweave=excluded.arweave, nft=excluded.nft
    `, [itemId, publicView, privateExport, arweave, nft]);
  });
}

export async function readPrivateReviewDisplay(submissionId: string, binding: unknown, signal: AbortSignal) {
  const scope = await reviewScope();
  const parsed = displayBinding.safeParse(binding);
  if (!scope?.ready || scope.sample || !parsed.success || !z.uuid().safeParse(submissionId).success) return null;
  const { itemId, versionId } = parsed.data;
  return withWebsiteDb(async (db) => {
    const submission = await findSubmission(db, scope, submissionId);
    if (!submission || !realPreparationEnabled(scope, submission.sender_hash)) return null;
    const item = (await readReviewItems(db, submissionId)).find(({ id }) => id === itemId);
    if (!item || item.version_id !== versionId || item.withdrawn_at || item.kind !== "photo" || item.exclusion !== "none") return null;
    const setup = await readRealPreparation(db, submissionId, submission.received_at);
    if (setup.metadata(item.position).blocked || setup.job(itemId, versionId)?.status !== "done") return null;
    return readBlob(displayKey(itemId, versionId), signal);
  });
}
