import "server-only";

import { enqueueApprovedPhoto, readPhotoSettings } from "@/features/foundation/photo-approval";
import { withExportMutation } from "@/features/foundation/private-export";
import { readSiteEnv } from "@/lib/env";
import { approvalSchema, reviewDecisionSchema, type ApprovalSnapshot, type ReviewDecision } from "@/lib/contracts/review";
import { withWebsiteDb } from "@/lib/supabase/database";
import { z } from "zod";
import { displayKey } from "@/features/public/media-key";
import { readRealPreparation, readReviewBlob } from "./mail-preparation";
import { inboxPlan } from "./inbox-policy";
import { testPhotoReview } from "./photo-decision";
import { canPublish, findSubmission, readReviewItems, reviewScope } from "./store";

export class ReviewConflict extends Error {}

export async function approveSubmission(input: ReviewDecision): Promise<ApprovalSnapshot[]> {
  const scope = await reviewScope();
  if (!scope?.ready) throw new ReviewConflict();
  const { submissionId, decisions } = reviewDecisionSchema.parse(input);
  if (new Set(decisions.map(({ itemId }) => itemId)).size !== decisions.length) throw new ReviewConflict();

  return withWebsiteDb((db) => withExportMutation(db, scope.sample?.runId ?? null, async () => {
    const submission = await findSubmission(db, scope, submissionId, true);
    if (!submission || !scope.sender || submission.sender_hash !== scope.sender) throw new ReviewConflict();

    const items = await readReviewItems(db, submissionId, true);
    const preparation = !scope.sample && submission.received_at
      ? await readRealPreparation(db, submissionId, submission.received_at) : null;
    const result: ApprovalSnapshot[] = [];
    let exportChanged = false;
    for (const decision of decisions) {
      const item = items.find(({ id }) => id === decision.itemId);
      if (!item || item.version_id !== decision.versionId || item.withdrawn_at) throw new ReviewConflict();
      if (item.historical_approval && !item.approval) throw new ReviewConflict();
      const restrictions = preparation?.metadata(item.position).restrictions;
      if (!item.approval && restrictions && (
        restrictions.uncertain || (restrictions.site && decision.publicView) ||
        (restrictions.chain && (decision.arweave || decision.nft)) || (restrictions.nft && decision.nft)
      )) throw new ReviewConflict();
      if (decision.publicView && !canPublish(item, Boolean(scope.sample))) throw new ReviewConflict();

      if (decision.arweave || decision.nft || decision.recipientConfigVersion) {
        const environment = readSiteEnv().environment;
        if (!testPhotoReview(environment, scope.sample) ||
            item.kind !== "photo" || !decision.publicView || !decision.arweave || !item.rights?.arweave ||
            (decision.nft ? !item.rights.nft || !decision.recipientConfigVersion ||
              (await readPhotoSettings(db))?.recipientVersion !== decision.recipientConfigVersion :
              Boolean(decision.recipientConfigVersion))) throw new ReviewConflict();
      }

      const previous = item.approval;
      if (previous) {
        if (previous.source !== "manual" || previous.public_view !== decision.publicView ||
            previous.published !== decision.publicView || previous.arweave !== decision.arweave || previous.nft !== decision.nft ||
            (previous.recipient_config_version ?? undefined) !== decision.recipientConfigVersion) throw new ReviewConflict();
        result.push(approvalSchema.parse({ ...decision, approvedAt: previous.approved_at, source: "manual" }));
        continue;
      }

      const privateExport = item.exclusion !== "ambiguous" && !restrictions?.zip && item.rights?.private_export === true;
      const permanent = decision.arweave;
      const saved = await db.query<{ approved_at: Date }>(`
        insert into approvals (item_id, version_id, source, published, public_view, private_export
          ${permanent ? ", arweave, nft, recipient_config_version" : ""})
        values ($1, $2, 'manual', $3, $3, $4 ${permanent ? ", true, $5, $6" : ""})
        returning approved_at
      `, [decision.itemId, decision.versionId, decision.publicView, privateExport,
        ...(permanent ? [decision.nft, decision.recipientConfigVersion ?? null] : [])]);
      const approvedAt = saved.rows[0]?.approved_at;
      if (!approvedAt) throw new ReviewConflict();
      exportChanged ||= privateExport;
      if (decision.arweave) await enqueueApprovedPhoto(db, decision.itemId, decision.versionId);
      result.push(approvalSchema.parse({ ...decision, approvedAt: approvedAt.toISOString(), source: "manual" }));
    }
    return { value: result, exportChanged };
  }));
}

const inboxBinding = z.array(z.tuple([z.uuid(), z.uuid(), z.string().regex(/^\d{4}-\d{2}-\d{2}\/[01]{4}$/).nullable()]))
  .min(1).max(100);

export async function approveInbox(submissionId: string, binding: unknown) {
  const scope = await reviewScope();
  if (!scope?.ready || scope.sample || !z.uuid().safeParse(submissionId).success) throw new ReviewConflict();
  const versions = inboxBinding.parse(binding);

  return withWebsiteDb((db) => withExportMutation(db, null, async () => {
    const submission = await findSubmission(db, scope, submissionId, true);
    if (!submission || !scope.sender || scope.sender !== submission.sender_hash) throw new ReviewConflict();
    const items = (await readReviewItems(db, submissionId, true)).filter((item) => !item.withdrawn_at);
    // Bind the whole live submission, including items already reviewed or awaiting clarification.
    if (items.length !== versions.length || items.some((item, index) =>
      versions[index]?.[0] !== item.id || versions[index]?.[1] !== item.version_id)) throw new ReviewConflict();
    const setup = await readRealPreparation(db, submissionId, submission.received_at);
    if (!setup.found || setup.active) throw new ReviewConflict();

    const plans = items.map((item, index) => {
      if (item.approval) return { item, plan: null };
      const plan = inboxPlan(item, setup.metadata(item.position));
      if ((plan?.snapshot ?? null) !== versions[index]?.[2]) throw new ReviewConflict();
      return { item, plan };
    });
    let exportChanged = false;
    let approved = false;
    for (const { item, plan } of plans) {
      if (!plan) continue;
      const { publicView, privateExport, arweave, nft, localDate } = plan;
      if ((publicView || privateExport) && item.kind === "photo" && item.exclusion === "none") {
        const key = displayKey(item.id, item.version_id);
        if (!setup.displayReady(item) || !(await readReviewBlob(key).catch(() => null))) throw new ReviewConflict();
        await db.query(`
          insert into item_version_display (version_id,processed_media_ref) values ($1,$2)
          on conflict (version_id) do update set processed_media_ref=excluded.processed_media_ref
        `, [item.version_id, key]);
      }
      if (!item.local_date) await db.query("update item_versions set local_date=$2 where id=$1", [item.version_id, localDate]);
      await db.query(`
        insert into item_usage_rights (item_id,public_view,private_export,arweave,nft) values ($1,$2,$3,$4,$5)
        on conflict (item_id) do update set public_view=excluded.public_view, private_export=excluded.private_export,
          arweave=excluded.arweave, nft=excluded.nft
      `, [item.id, publicView, privateExport, arweave, nft]);
      // Record the rights above. Chain execution still requires the separate explicit test decision and gate.
      await db.query(`
        insert into approvals (item_id,version_id,source,published,public_view,private_export)
        values ($1,$2,'manual',$3,$3,$4)
      `, [item.id, item.version_id, publicView, privateExport]);
      approved = true;
      exportChanged ||= privateExport;
    }
    if (!approved && !items.some(({ approval }) => approval?.source === "manual")) throw new ReviewConflict();
    return { value: undefined, exportChanged };
  }));
}
