import { z } from "zod";
import type { ContentPolicyInput } from "../policy/content";

const decision = z.object({
  itemId: z.uuid(), versionId: z.uuid(), publicView: z.boolean(),
  arweave: z.boolean(), nft: z.boolean(), recipientConfigVersion: z.uuid().optional(),
}).strict();
export const reviewDecisionSchema = z.object({
  submissionId: z.uuid(), requestId: z.uuid(), decisions: z.array(decision).min(1),
}).strict();
export const approvalSchema = decision.extend({
  approvedAt: z.iso.datetime(), source: z.enum(["manual", "automatic"]),
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ApprovalSnapshot = z.infer<typeof approvalSchema>;

/**
 * Implemented by the review/site owner using one fresh, consistent read. Return null
 * for absent or inaccessible items. A withdrawn item hidden by worker RLS is inaccessible.
 * A revoked approval must set revoked and must never fall back to a historical approval.
 * Consumers deny new writes for null, revoked or withdrawn state, then use the
 * shared content policy on the current version. NFT writes also require matching,
 * non-null approved and current recipient config versions. Read again immediately
 * before any new external write.
 */
export interface PermanentApprovalReader {
  readCurrent(itemId: string): Promise<PermanentApprovalState | null>;
}

export interface PermanentApprovalState {
  policy: ContentPolicyInput;
  revoked: boolean;
  /** The version bound by the current approval, if any. */
  approvedRecipientConfigVersion: string | null;
  /** The version currently selected by the site. */
  currentRecipientConfigVersion: string | null;
}
