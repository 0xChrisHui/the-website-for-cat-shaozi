import { z } from "zod";

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
