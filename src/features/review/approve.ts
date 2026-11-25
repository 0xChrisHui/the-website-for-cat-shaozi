import "server-only";

import { withExportMutation } from "@/features/foundation/private-export";
import { approvalSchema, reviewDecisionSchema, type ApprovalSnapshot, type ReviewDecision } from "@/lib/contracts/review";
import { withWebsiteDb } from "@/lib/supabase/database";
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
    const result: ApprovalSnapshot[] = [];
    let exportChanged = false;
    for (const decision of decisions) {
      const item = items.find(({ id }) => id === decision.itemId);
      if (!item || item.version_id !== decision.versionId || item.withdrawn_at) throw new ReviewConflict();
      if (decision.publicView && !canPublish(item, Boolean(scope.sample))) throw new ReviewConflict();

      // Permanent approvals require their own recipient and eligibility integration.
      if (decision.arweave || decision.nft || decision.recipientConfigVersion) throw new ReviewConflict();

      const previous = item.approval;
      if (previous) {
        if (previous.source !== "manual" || previous.public_view !== decision.publicView ||
            previous.published !== decision.publicView || previous.arweave || previous.nft) throw new ReviewConflict();
        result.push(approvalSchema.parse({ ...decision, approvedAt: previous.approved_at, source: "manual" }));
        continue;
      }

      const privateExport = item.exclusion !== "ambiguous" && item.rights?.private_export === true;
      const saved = await db.query<{ approved_at: Date }>(`
        insert into approvals (item_id, version_id, source, published, public_view, private_export)
        values ($1, $2, 'manual', $3, $3, $4)
        returning approved_at
      `, [decision.itemId, decision.versionId, decision.publicView, privateExport]);
      const approvedAt = saved.rows[0]?.approved_at;
      if (!approvedAt) throw new ReviewConflict();
      exportChanged ||= privateExport;
      result.push(approvalSchema.parse({ ...decision, approvedAt: approvedAt.toISOString(), source: "manual" }));
    }
    return { value: result, exportChanged };
  }));
}
