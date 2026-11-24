import { z } from "zod";
import { sha256 } from "./intake";

const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
export const deployContractSchema = z.object({
  reviewedSha: commitSha, releaseSha: commitSha, chainId: z.number().int().positive(),
  artifactHash: sha256, constructorConfigVersion: z.uuid(),
}).strict();
export const operationReceiptSchema = z.object({
  operationKey: z.string().min(1), network: z.string().min(1), payloadHash: sha256,
  signedPayloadRef: z.string().optional(), dataItemId: z.string().optional(),
  txHash: z.string().optional(), tokenId: z.string().optional(), nonce: z.number().int().optional(),
  predictedAddress: z.string().optional(), confirmedAt: z.iso.datetime().optional(),
}).strict();
export type DeployContractJob = z.infer<typeof deployContractSchema>;
export type OperationReceipt = z.infer<typeof operationReceiptSchema>;
