import { createPrivateKey } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { decodeFunctionData, parseTransaction, zeroAddress, type Hex } from "viem";
import { z } from "zod";
import { readTestSandboxEnv, readWorkerEnv } from "@/lib/env";
import type { TestPhotoAdapters } from "@/features/foundation/photo-store";
import { createArLocal } from "./arlocal";
import { createDeploymentReadRpc, createPhotoMintRpc } from "./deployment-io";
import { bindDeploymentRelease, chainId, rawHex, signerAvailable, trustedDirectory } from "./deployment-release";
import { createMint, mintAbi, photoRecipientVersion, type MintIntent, type MintPolicy } from "./mint";
import { check, sha256 } from "./reconcile";
import { knownDeploymentSchema, verifyDeployment } from "./verify-deployment";

const configDir = "/etc/memorial-worker";
const socket = "/run/memorial-test-signer/photo.sock";
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const amount = z.string().regex(/^[1-9][0-9]{0,19}$/).transform(BigInt);
const address = z.templateLiteral(["0x", z.string().regex(/^[a-f0-9]{40}$/)]).refine((a) => a !== zeroAddress);
const configSchema = z.strictObject({
  release: z.strictObject({
    environment: z.literal("test"), branch: z.literal("integration"), chainId: z.literal(chainId),
    releaseSha: sha, reviewedSha: sha, migrationSha: sha, acceptanceSha: sha, rpcUrlHash: digest,
  }),
  archive: z.strictObject({
    endpoint: z.url(), syntheticKeyHash: digest, rewardLimit: amount,
    syntheticOriginals: z.array(digest).min(1).max(100),
  }),
  mint: z.strictObject({
    recipientVersion: z.uuid(), recipient: address,
    gasLimit: amount, maxFeePerGas: amount, maxPriorityFeePerGas: amount, maxTotalFee: amount,
    deployment: knownDeploymentSchema,
  }).nullable(),
});

async function readProtectedFile(name: string, limit: number) {
  if (!await trustedDirectory("/etc") || !await trustedDirectory(configDir)) throw new Error("Photo config directory");
  const file = await open(configDir + "/" + name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) || stat.size > limit) throw new Error("Photo config file");
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size) throw new Error("Photo config changed");
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export function bindPhotoRelease(input: unknown, workerSha: string, rpcUrl: string, deployedArtifact?: Uint8Array) {
  const config = configSchema.parse(input);
  const { release, mint } = config;
  if ([release.releaseSha, release.reviewedSha, release.migrationSha, release.acceptanceSha].some((value) =>
    value !== workerSha) || release.rpcUrlHash !== sha256(rpcUrl)) return null;
  if (!mint) return { config, policy: null, bound: null };
  const known = mint.deployment;
  const bound = deployedArtifact && bindDeploymentRelease(known.manifest, known.reviewedSha, deployedArtifact);
  if (!bound || photoRecipientVersion(mint.recipient) !== mint.recipientVersion || mint.maxPriorityFeePerGas > mint.maxFeePerGas ||
      mint.gasLimit * mint.maxFeePerGas > mint.maxTotalFee ||
      known.receipt.minter === zeroAddress || known.receipt.owner === zeroAddress) return null;
  const policy: MintPolicy = {
    deployment: {
      reviewedSha: known.reviewedSha, txHash: known.receipt.txHash, address: known.receipt.address,
      nonce: known.receipt.nonce, deployer: bound.deployer, runtimeHash: bound.runtimeHash,
    },
    sender: known.receipt.minter, recipient: mint.recipient, recipientVersion: mint.recipientVersion,
    gasLimit: mint.gasLimit, maxFeePerGas: mint.maxFeePerGas,
    maxPriorityFeePerGas: mint.maxPriorityFeePerGas, maxTotalFee: mint.maxTotalFee,
  };
  return { config, policy, bound };
}

async function signPhoto(workerSha: string, policy: MintPolicy, intent: MintIntent, unsigned: Hex, signal: AbortSignal) {
  const tx = parseTransaction(unsigned as `0x02${string}`);
  check(tx.type === "eip1559" && tx.chainId === chainId && tx.to === policy.deployment.address &&
    (tx.value ?? 0n) === 0n && !tx.accessList?.length && !tx.r && !tx.s && tx.data &&
    tx.gas && tx.gas <= policy.gasLimit && tx.maxFeePerGas && tx.maxFeePerGas <= policy.maxFeePerGas &&
    (tx.maxPriorityFeePerGas ?? 0n) <= policy.maxPriorityFeePerGas &&
    tx.gas * tx.maxFeePerGas <= policy.maxTotalFee && intent.sender === policy.sender &&
    intent.recipientVersion === policy.recipientVersion, "测试签名交易不符");
  const call = decodeFunctionData({ abi: mintAbi, data: tx.data });
  check(call.functionName === "mint" && call.args[0].toLowerCase() === policy.recipient &&
    call.args[1].toString() === intent.tokenId && call.args[2] === intent.uri, "测试签名调用不符");
  if (!await signerAvailable(socket).catch(() => false)) throw new Error("Photo signer unavailable");
  signal.throwIfAborted();
  const body = JSON.stringify({ sha: workerSha, recipientVersion: policy.recipientVersion, unsignedTransaction: unsigned });
  return new Promise<Hex>((resolve, reject) => {
    const req = request({
      socketPath: socket, path: "/sign-op-sepolia-photo", method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      response.on("error", reject);
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error("Photo signer refused"));
        return;
      }
      let output = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 8192) req.destroy(new Error("Photo signature too large"));
      });
      response.on("end", () => {
        const parsed = rawHex.safeParse(output);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error("Invalid photo signature"));
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

const readManifest = () => readProtectedFile("op-sepolia-photo-release.json", 64_000);

export async function createTestPhotoAdapters(signal: AbortSignal): Promise<TestPhotoAdapters | undefined> {
  try {
    const env = readWorkerEnv();
    if (env.instance !== "test" || env.ci) return;
    const active = await realpath("/srv/memorial-worker/test/current");
    const workerSha = /^\/srv\/memorial-worker\/test\/releases\/([a-f0-9]{40})$/.exec(active)?.[1];
    const releaseRoot = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
    if (!workerSha || active !== releaseRoot || active !== process.cwd()) return;
    const { OP_SEPOLIA_RPC_URL: rpcUrl } = readTestSandboxEnv();
    if (!rpcUrl) return;

    const manifest = await readManifest();
    const input = configSchema.parse(JSON.parse(manifest.toString("utf8")));
    const artifact = input.mint ? await readProtectedFile("op-sepolia-photo-deployed-artifact.json", 1_000_000) : undefined;
    const release = bindPhotoRelease(JSON.parse(manifest.toString("utf8")), workerSha, rpcUrl, artifact);
    if (!release) throw new Error("Photo release proof mismatch");
    const { config, bound, policy } = release;
    const archiveKey = await readProtectedFile("arlocal-photo-synthetic.pem", 8192);
    if (sha256(archiveKey) !== config.archive.syntheticKeyHash) throw new Error("Photo archive key mismatch");
    const archive = createArLocal(config.archive.endpoint, createPrivateKey(archiveKey), config.archive.rewardLimit, signal);
    const readRpc = createDeploymentReadRpc(rpcUrl, signal);
    async function released() {
      signal.throwIfAborted();
      return (await readManifest().catch(() => null))?.equals(manifest) === true;
    }
    async function mintPolicy() {
      if (!bound || !policy || !config.mint || !await released()) return null;
      const proof = await verifyDeployment(bound, config.mint.deployment.receipt, readRpc);
      signal.throwIfAborted();
      return proof.ok && await released() ? policy : null;
    }
    return {
      archive,
      mint: createMint(createPhotoMintRpc(rpcUrl, signal), async (unsigned, intent) => {
        const allowed = await mintPolicy();
        if (!allowed) throw new Error("Photo mint release unavailable");
        return signPhoto(workerSha, allowed, intent, unsigned, signal);
      }),
      archiveEnabled: released,
      mintPolicy,
      syntheticOriginal: (hash) => config.archive.syntheticOriginals.includes(hash),
    };
  } catch {
    if (!signal.aborted) console.warn("测试照片工作器发布配置不可用");
  }
}
