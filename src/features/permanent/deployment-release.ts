import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { encodeDeployData, keccak256, parseAbi, zeroAddress } from "viem";
import { z } from "zod";
import { testDeploymentReleaseSchema } from "@/lib/contracts/permanent";
import { readTestSandboxEnv, readWorkerEnv } from "@/lib/env";

export const chainId = 11155420;
export const signerSocket = "/run/memorial-test-signer/deploy.sock";
export const rawHex = z.templateLiteral(["0x", z.string().regex(/^(?:[0-9a-f]{2})+$/).max(262144)]);
const address = z.templateLiteral(["0x", z.string().regex(/^[0-9a-f]{40}$/)]).refine((value) => value !== zeroAddress);
const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const amount = z.string().regex(/^[1-9][0-9]{0,19}$/);
const configSchema = z.strictObject({
  version: z.uuid(),
  name: z.string().min(1).max(80),
  symbol: z.string().min(1).max(16),
  deployer: address,
  gasLimit: amount,
  maxFeePerGas: amount,
  maxPriorityFeePerGas: amount,
  maxTotalFee: amount,
  rpcUrlHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestSchema = z.strictObject({
  release: testDeploymentReleaseSchema.strict(),
  config: configSchema,
  configHash: z.string().regex(/^[a-f0-9]{64}$/),
});
const artifactSchema = z.object({
  abi: z.array(z.unknown()).min(1),
  creationBytecode: rawHex,
  creationBytecodeHash: rawHex,
  runtimeBytecode: rawHex,
  runtimeBytecodeHash: rawHex,
});
const constructorAbi = parseAbi(["constructor(string name_, string symbol_)"]);

export function bindDeploymentRelease(input: unknown, workerSha: string, artifactBytes: Uint8Array) {
  const { release, config, configHash } = manifestSchema.parse(input);
  const artifactHash = sha256(artifactBytes);
  if (release.reviewedSha !== workerSha || release.releaseSha !== workerSha ||
      release.migrationSha !== workerSha || release.acceptanceSha !== workerSha ||
      release.artifactHash !== artifactHash || release.constructorConfigVersion !== config.version ||
      sha256(JSON.stringify(config)) !== configHash) return null;

  const artifact = artifactSchema.parse(JSON.parse(Buffer.from(artifactBytes).toString("utf8")));
  if (keccak256(artifact.creationBytecode) !== artifact.creationBytecodeHash ||
      keccak256(artifact.runtimeBytecode) !== artifact.runtimeBytecodeHash) return null;

  return {
    release,
    configHash,
    rpcUrlHash: config.rpcUrlHash,
    deployer: config.deployer,
    data: encodeDeployData({ abi: constructorAbi, bytecode: artifact.creationBytecode, args: [config.name, config.symbol] }),
    runtimeHash: artifact.runtimeBytecodeHash,
    gasLimit: BigInt(config.gasLimit),
    maxFeePerGas: BigInt(config.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(config.maxPriorityFeePerGas),
    maxTotalFee: BigInt(config.maxTotalFee),
  };
}

export type BoundRelease = NonNullable<ReturnType<typeof bindDeploymentRelease>>;

function rootControlled(stat: { uid: number; mode: number }) {
  return stat.uid === 0 && (stat.mode & 0o022) === 0;
}

export async function trustedDirectory(path: string) {
  const stat = await lstat(path);
  return stat.isDirectory() && rootControlled(stat);
}

export async function signerAvailable(socket = signerSocket) {
  if (!await trustedDirectory("/run") || !await trustedDirectory("/run/memorial-test-signer")) return false;
  const stat = await lstat(socket);
  if (!stat.isSocket() || stat.uid !== 0 || (stat.mode & 0o002) !== 0) return false;
  await access(socket, constants.W_OK);
  return true;
}

async function readManifest() {
  if (!await trustedDirectory("/etc") || !await trustedDirectory("/etc/memorial-worker")) return null;
  const file = await open("/etc/memorial-worker/op-sepolia-release.json",
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !rootControlled(stat) || stat.size > 4096) return null;
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== stat.size) return null;
    return JSON.parse(buffer.toString("utf8", 0, bytesRead)) as unknown;
  } finally {
    await file.close();
  }
}

export async function readDeploymentConfig() {
  try {
    const env = readWorkerEnv();
    if (env.instance !== "test" || env.ci) return null;
    const { OP_SEPOLIA_RPC_URL: rpcUrl } = readTestSandboxEnv();
    if (!rpcUrl) return null;

    const active = await realpath("/srv/memorial-worker/test/current");
    const match = /^\/srv\/memorial-worker\/test\/releases\/([a-f0-9]{40})$/.exec(active);
    const workerSha = match?.[1];
    const releaseRoot = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
    if (!workerSha || active !== releaseRoot || active !== process.cwd()) return null;
    if (!await signerAvailable()) return null;
    const artifact = await readFile(new URL("../../../contracts/script/MemorialPhotos.json", import.meta.url));
    const bound = bindDeploymentRelease(await readManifest(), workerSha, artifact);
    return bound?.rpcUrlHash === sha256(rpcUrl) ? { bound, rpcUrl, workerSha } : null;
  } catch {
    return null;
  }
}
