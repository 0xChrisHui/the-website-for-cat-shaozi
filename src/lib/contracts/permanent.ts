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

// Only a server-side provider that verifies protected release evidence may supply this input.
export const testDeploymentReleaseSchema = deployContractSchema.extend({
  environment: z.literal("test"),
  branch: z.literal("integration"),
  chainId: z.literal(11155420),
  migrationSha: commitSha,
  acceptanceSha: commitSha,
  deploymentVersion: z.string().regex(/^memorial-erc721-v[1-9][0-9]{0,8}$/),
});
export type TestDeploymentRelease = z.infer<typeof testDeploymentReleaseSchema>;

export interface TestDeploymentReleaseSource {
  workerSha: string;
  artifactHash: string;
  constructorConfigVersion: string;
  // Return null unless review, trusted migration and full acceptance succeeded for the merged SHA.
  // This provider must verify provenance independently of job payloads and website inputs.
  readVerifiedRelease(): Promise<TestDeploymentRelease | null>;
}

export const permanentDeploymentKind = "permanent.deploy-contract";
export const signedDeploymentSchema = z.object({
  rawTransaction: z.string().regex(/^0x(?:[a-f0-9]{2})+$/).max(262146),
  txHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  deployer: z.string().regex(/^0x[a-f0-9]{40}$/),
  nonce: z.number().int().nonnegative(),
  predictedAddress: z.string().regex(/^0x[a-f0-9]{40}$/),
}).strict();
export type SignedDeployment = z.infer<typeof signedDeploymentSchema>;

export type DeploymentReceipt = { stage: "reserved" } | {
  stage: "signed" | "unknown" | "confirmed";
  signed: SignedDeployment;
};

export interface LockedDeployment {
  operationKey: string;
  release: TestDeploymentRelease;
  receipt: DeploymentReceipt;
  /** Await this before first broadcast. Use only the returned stored transaction. */
  stageSigned(signed: SignedDeployment): Promise<SignedDeployment>;
  /**
   * Persist an indeterminate result with the same signed transaction. Leave the job
   * running for startup recovery. Use jobs.finish with a reason for manual attention.
   */
  markUnknown(): Promise<void>;
  /** Call after the feature adapter verifies the transaction, code and permissions. */
  confirm(): Promise<void>;
}

export interface PermanentWorker {
  /**
   * Runs with a session lock. For signed/unknown receipts the handler must reconcile the
   * stored transaction first. Only the feature adapter can prove that replay is safe.
   * A false result means another operation holds the lock.
   */
  withDeployment(jobId: string, run: (deployment: LockedDeployment) => Promise<void>): Promise<boolean>;
}
