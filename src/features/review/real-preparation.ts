import "server-only";

import type { PoolClient } from "pg";
import { z } from "zod";
import { displayBinding, displayJobKind } from "@/features/intake/review-display";
import { displayKey } from "@/features/public/media-key";
import { readSiteEnv } from "@/lib/env";
import { withWebsiteDb } from "@/lib/supabase/database";
import { readRealPreparation, readReviewBlob } from "./mail-preparation";
import { inboxRights } from "./inbox-policy";
import { ReviewConflict } from "./approve";
import { testPhotoReview } from "./photo-decision";
import { findSubmission, readReviewItems, reviewScope, type ReviewScope } from "./store";

export function realPreparationEnabled(scope: ReviewScope, senderHash: string) {
  return scope.ready && testPhotoReview(readSiteEnv().environment, scope.sample) &&
    Boolean(scope.sender && scope.sender === senderHash);
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
    if (!item || item.version_id !== versionId || item.withdrawn_at || item.approval || item.historical_approval || item.exclusion !== "none") {
      throw new ReviewConflict();
    }
    const setup = await readRealPreparation(db, submissionId, submission.received_at);
    const job = setup.job(itemId, versionId);
    const { restrictions } = setup.metadata(item.position);
    if (!setup.found || setup.active || restrictions.uncertain) throw new ReviewConflict();

    if (change.kind === "prepare") {
      if (item.kind !== "photo") throw new ReviewConflict();
      await queueDisplay(db, itemId, versionId, job);
      return;
    }
    const date = z.iso.date().refine((value) => !value.startsWith("0000-")).parse(change.date);
    const { publicView, privateExport, arweave, nft } = change;
    if ((restrictions.site && publicView) || (restrictions.zip && privateExport) ||
      (restrictions.chain && (arweave || nft)) || (restrictions.nft && nft)) throw new ReviewConflict();
    if ((arweave && (!publicView || item.kind !== "photo")) || (nft && !arweave)) throw new ReviewConflict();
    if (publicView && item.kind === "diary" && !item.diary_text?.trim()) throw new ReviewConflict();
    if ((publicView || privateExport) && item.kind === "photo") {
      const key = displayKey(itemId, versionId);
      if (!setup.displayReady(item) || !(await readReviewBlob(key).catch(() => null))) throw new ReviewConflict();
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
    if (!setup.found || setup.metadata(item.position).restrictions.uncertain || !setup.displayReady(item)) return null;
    return readReviewBlob(displayKey(itemId, versionId), signal);
  });
}

async function queueDisplay(db: PoolClient, itemId: string, versionId: string,
  job: ReturnType<Awaited<ReturnType<typeof readRealPreparation>>["job"]>,
) {
  if (!job) {
    await db.query("insert into jobs (kind,payload) values ($1,$2)", [displayJobKind, { itemId, versionId }]);
  } else if (job.status === "needs_attention" || job.status === "done") {
    await db.query("update jobs set status='queued', reason=null, updated_at=now() where id=$1 and status=$2",
      [job.id, job.status]);
  }
}

export async function retryInboxDisplays(submissionId: string, binding: unknown, force: boolean) {
  const scope = await reviewScope();
  if (!scope?.ready || scope.sample || !z.uuid().safeParse(submissionId).success) throw new ReviewConflict();
  const versions = z.array(displayBinding).min(1).max(100).parse(binding);
  return withWebsiteDb(async (db) => {
    const submission = await findSubmission(db, scope, submissionId, true);
    if (!submission || !realPreparationEnabled(scope, submission.sender_hash)) throw new ReviewConflict();
    const items = await readReviewItems(db, submissionId, true);
    const setup = await readRealPreparation(db, submissionId, submission.received_at);
    if (!setup.found || setup.active) throw new ReviewConflict();
    for (const { itemId, versionId } of versions) {
      const item = items.find(({ id }) => id === itemId);
      if (!item || item.version_id !== versionId || item.kind !== "photo" || item.exclusion !== "none" ||
          !inboxRights(item, setup.metadata(item.position).restrictions)) throw new ReviewConflict();
      if (force || !setup.displayReady(item)) await queueDisplay(db, itemId, versionId, setup.job(itemId, versionId));
    }
  });
}
