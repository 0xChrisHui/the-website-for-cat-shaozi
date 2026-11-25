import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getContractAddress, keccak256, type Address } from "viem";
import { z } from "zod";
import { readTestSandboxEnv } from "@/lib/env";
import { createDeploymentReadRpc } from "./deployment-io";
import { bindDeploymentRelease, chainId, type BoundRelease } from "./deployment-release";

const address = z.templateLiteral(["0x", z.string().regex(/^[a-f0-9]{40}$/)]);
const receiptSchema = z.strictObject({
  txHash: z.templateLiteral(["0x", z.string().regex(/^[a-f0-9]{64}$/)]),
  address, nonce: z.number().int().nonnegative(), owner: address, minter: address,
});
export const knownDeploymentSchema = z.strictObject({
  reviewedSha: z.string().regex(/^[a-f0-9]{40}$/), manifest: z.unknown(), receipt: receiptSchema,
});
type Rpc = ReturnType<typeof createDeploymentReadRpc>;
type Reader = {
  chainId: Rpc["chainId"];
  transaction(hash: z.infer<typeof receiptSchema>["txHash"]): Promise<Pick<Awaited<ReturnType<Rpc["transaction"]>>,
    "hash" | "from" | "to" | "nonce" | "input" | "value" | "blockNumber" | "blockHash">>;
  receipt(hash: z.infer<typeof receiptSchema>["txHash"]): Promise<Pick<Awaited<ReturnType<Rpc["receipt"]>>,
    "transactionHash" | "from" | "to" | "status" | "contractAddress" | "blockNumber" | "blockHash">>;
  code: Rpc["code"];
  permission: Rpc["permission"];
};
const network = "op-sepolia";
const failure = (reason: string) => ({ ok: false, network, reason });
const same = (a: Address | null | undefined, b: Address) => a?.toLowerCase() === b.toLowerCase();

export async function verifyDeployment(
  bound: Pick<BoundRelease, "deployer" | "data" | "runtimeHash">,
  expected: z.infer<typeof receiptSchema>,
  rpc: Reader,
) {
  try {
    if (await rpc.chainId() !== chainId) return failure("chain");
    if (!same(getContractAddress({ from: bound.deployer, nonce: BigInt(expected.nonce) }), expected.address)) {
      return failure("address");
    }
    const [tx, receipt] = await Promise.all([rpc.transaction(expected.txHash), rpc.receipt(expected.txHash)]);
    if (tx.hash !== expected.txHash || !same(tx.from, bound.deployer) || tx.to !== null ||
        tx.nonce !== expected.nonce || tx.value !== 0n || tx.input !== bound.data ||
        tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber) return failure("transaction");
    if (receipt.transactionHash !== expected.txHash || receipt.status !== "success" || receipt.to !== null ||
        !same(receipt.from, bound.deployer) || !same(receipt.contractAddress, expected.address)) return failure("receipt");
    const [deployedCode, currentCode, owner, minter] = await Promise.all([
      rpc.code(expected.address, receipt.blockNumber), rpc.code(expected.address),
      rpc.permission(expected.address, "owner"), rpc.permission(expected.address, "minter"),
    ]);
    if (!deployedCode || deployedCode === "0x" || keccak256(deployedCode) !== bound.runtimeHash ||
        !currentCode || keccak256(currentCode) !== bound.runtimeHash) return failure("runtime");
    if (!same(owner, expected.owner) || !same(minter, expected.minter)) return failure("permissions");
    return { ok: true, network };
  } catch {
    return failure("rpc");
  }
}

async function main(args: string[]) {
  const [networkFlag, selected, inputFlag, path] = args;
  if (args.length !== 4 || networkFlag !== "--network" || selected !== network || inputFlag !== "--input" || !path) {
    return failure("arguments");
  }
  try {
    const input = knownDeploymentSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const artifact = await readFile(new URL("../../../contracts/script/MemorialPhotos.json", import.meta.url));
    const bound = bindDeploymentRelease(input.manifest, input.reviewedSha, artifact);
    const { OP_SEPOLIA_RPC_URL: url } = readTestSandboxEnv();
    if (!bound || !url || createHash("sha256").update(url).digest("hex") !== bound.rpcUrlHash) return failure("configuration");
    return verifyDeployment(bound, input.receipt, createDeploymentReadRpc(url));
  } catch {
    return failure("configuration");
  }
}

if (import.meta.main) {
  const result = await main(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
