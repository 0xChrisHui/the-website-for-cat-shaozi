import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import type { PermanentApprovalState } from "@/lib/contracts/review";
import { evaluateContentPolicy } from "@/lib/policy/content";
import { archivePhoto } from "./archive-photo";
import type { ArchiveArtifact, ArLocal } from "./arlocal";
import { photoToken, type Mint, type MintArtifact, type MintIntent, type MintPolicy } from "./mint";
import { check, PermanentCheck, reconcile, type Operation } from "./reconcile";

export const photoJobKind = "permanent.archive-photo";
const payloadSchema = z.object({ itemId: z.uuid() }).strict();

export interface CurrentPhoto extends PermanentApprovalState {
  kind: "photo";
  objectKey: string;
  /** Stable across caption, date, compression and separately approved crops. */
  identity: string;
}

interface PhotoLock {
  identity: string;
  archive: Operation<ArchiveArtifact>;
  mint: Operation<MintArtifact>;
  /** Includes other unresolved operations for the same test signer, including deployments. */
  reservedFees(sender: string): Promise<{ total: bigint; unknown: boolean }>;
}

export interface PhotoWorker {
  environment: "test";
  archive: ArLocal;
  mint: Mint;
  readCurrent(itemId: string): Promise<CurrentPhoto | null>;
  archiveEnabled(): Promise<boolean>;
  /** Read the current execution gate, fixed recipient and independently verified deployment. */
  mintPolicy(): Promise<MintPolicy | null>;
  /** Hold stable identity and test signer locks through durable writes and external operations. */
  withPhoto(jobId: string, itemId: string, run: (locked: PhotoLock) => Promise<void>): Promise<boolean>;
}

export type PhotoContext = WorkerContext & { permanentPhoto?: PhotoWorker };

function eligible(photo: CurrentPhoto | null, itemId: string, action: "arweave" | "nft") {
  return photo?.kind === "photo" && photo.policy.itemId === itemId && !photo.revoked &&
    evaluateContentPolicy(photo.policy)[action];
}

function testUri(id: string) {
  return `data:application/json,${encodeURIComponent(JSON.stringify({
    name: "Memorial photo", image: `ar://${id}`,
  }))}`;
}

export async function executePhotoJob(job: JobInput, context: PhotoContext) {
  const injected = context.permanentPhoto;
  const payload = payloadSchema.safeParse(job.payload);
  if (job.schemaVersion !== 1 || !payload.success || injected?.environment !== "test") {
    await context.jobs.finish(job.jobId, "测试归档工作器接口或任务格式不可用");
    return;
  }
  const { itemId } = payload.data;
  const worker = injected;
  const locked = await worker.withPhoto(job.jobId, itemId, async ({ identity, archive, mint, reservedFees }) => {
    async function current(action: "arweave" | "nft") {
      const photo = await worker.readCurrent(itemId);
      check(identity && photo?.identity === identity &&
        eligible(photo, itemId, action), "当前照片未获准执行");
      return photo;
    }

    try {
      // Recover a previously attempted mint even if current approval or gates were withdrawn.
      if (mint.receipt && mint.receipt.state !== "signed") {
        if (await worker.mint.verify(mint.receipt)) {
          if (mint.receipt.state !== "confirmed") await mint.confirm();
          await context.jobs.finish(job.jobId);
        } else {
          check(mint.receipt.state !== "confirmed", "已确认铸造凭证无法复核");
        }
        return;
      }

      async function archiveAuthorization(versionId: string) {
        check(await worker.archiveEnabled(), "测试归档开关关闭");
        const photo = await current("arweave");
        check(photo.policy.currentVersionId === versionId, "照片版本已变化");
      }

      // Keep a queued approval resumable when execution is deliberately closed.
      if ((!archive.receipt || archive.receipt.state === "signed") && !await worker.archiveEnabled()) return;
      const archived = await reconcile(archive, {
        async sign() {
          const photo = await current("arweave");
          const version = photo.policy.currentVersionId;
          await archiveAuthorization(version);
          let bytes: Buffer;
          try {
            bytes = await archivePhoto(await context.files.read(photo.objectKey));
          } catch {
            throw new PermanentCheck("归档图片读取或派生失败");
          }
          return worker.archive.sign(bytes, version, () => archiveAuthorization(version));
        },
        verify: worker.archive.verify,
        beforeSend: worker.archive.beforeSend,
        authorize: (artifact) => archiveAuthorization(artifact.versionId),
        send: worker.archive.send,
      });
      if (!archived) return;

      async function mintAuthorization() {
        const policy = await worker.mintPolicy();
        const photo = await current("nft");
        check(policy && policy.recipientVersion &&
          photo.approvedRecipientConfigVersion === policy.recipientVersion &&
          photo.currentRecipientConfigVersion === policy.recipientVersion, "铸造开关或固定接收配置不符");
        return { policy, version: photo.policy.currentVersionId };
      }

      const afterArchive = await worker.readCurrent(itemId);
      if (!eligible(afterArchive, itemId, "nft") && !mint.receipt) {
        await context.jobs.finish(job.jobId);
        return;
      }

      if (afterArchive && (afterArchive.approvedRecipientConfigVersion !== afterArchive.currentRecipientConfigVersion)) {
        throw new PermanentCheck("铸造固定接收配置不符");
      }
      if (!await worker.mintPolicy()) return;
      const { policy, version } = await mintAuthorization();
      async function availableBudget() {
        const reserved = await reservedFees(policy.sender);
        check(!reserved.unknown, "同一签名账户存在待核对交易");
        return reserved.total;
      }
      const intent: MintIntent = {
        deployment: policy.deployment, sender: policy.sender, recipient: policy.recipient,
        recipientVersion: policy.recipientVersion, versionId: version,
        budget: { gas: policy.gasLimit.toString(), maxFeePerGas: policy.maxFeePerGas.toString(),
          priority: policy.maxPriorityFeePerGas.toString(), total: policy.maxTotalFee.toString() },
        tokenId: photoToken(identity).toString(),
        uri: testUri(archived.id),
      };
      async function authorize(artifactIntent: MintIntent) {
        const latest = await mintAuthorization();
        check(latest.version === version && isDeepStrictEqual(latest.policy, policy) &&
          isDeepStrictEqual(artifactIntent, intent), "照片版本或审核铸造配置已变化");
      }
      if (mint.receipt) await authorize(mint.receipt.intent);

      const minted = await reconcile(mint, {
        sign: async () => worker.mint.sign(intent, policy, await availableBudget(), () => authorize(intent)),
        verify: worker.mint.verify,
        beforeSend: async (artifact) => worker.mint.beforeSend(artifact, policy, await availableBudget()),
        authorize: (artifact) => authorize(artifact.intent),
        send: worker.mint.send,
      });
      if (minted) await context.jobs.finish(job.jobId);
    } catch (error) {
      if (!(error instanceof PermanentCheck)) throw error;
      await context.jobs.finish(job.jobId, error.message);
    }
  });
  if (!locked) throw new Error("Permanent photo lock unavailable");
}
