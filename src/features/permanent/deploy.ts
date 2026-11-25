import { setTimeout as delay } from "node:timers/promises";
import {
  getContractAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, size,
  type Hex,
} from "viem";
import { signedDeploymentSchema, type LockedDeployment, type SignedDeployment } from "@/lib/contracts/permanent";
import { chainId, type BoundRelease } from "./deployment-release";
import type { DeploymentRpc, DeploymentTransaction } from "./deployment-io";

class DeploymentCheck extends Error {}

function requireCheck(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new DeploymentCheck(reason);
}

const reason = {
  network: "测试部署 RPC 网络不符",
  nonce: "测试部署 nonce 或预测地址需要核对",
  fee: "测试部署费用超过限额",
  balance: "测试部署余额不足",
  signature: "测试部署签名与核准交易不符",
  release: "测试部署发布证据不可用或已变更",
  receipt: "测试部署回执、合约代码或权限不符",
  pending: "测试部署结果待核对",
};

export interface DeploymentDependencies {
  release: BoundRelease;
  rpc: DeploymentRpc;
  sign(unsigned: Hex): Promise<Hex>;
  authorized(): Promise<boolean>;
  wait(): Promise<unknown>;
}

function checkCaps(transaction: DeploymentTransaction, release: BoundRelease) {
  const { gas, maxFeePerGas, maxPriorityFeePerGas } = transaction;
  requireCheck(gas > 0n && gas <= release.gasLimit &&
    maxFeePerGas > 0n && maxFeePerGas <= release.maxFeePerGas &&
    maxPriorityFeePerGas >= 0n && maxPriorityFeePerGas <= maxFeePerGas &&
    maxPriorityFeePerGas <= release.maxPriorityFeePerGas, reason.fee);
}

async function checkFunds(transaction: DeploymentTransaction, { release, rpc }: DeploymentDependencies) {
  checkCaps(transaction, release);
  const [extra, balance] = await Promise.all([
    rpc.extraFees(size(serializeTransaction(transaction)), transaction.gas),
    rpc.balance(release.deployer),
  ]);
  const total = transaction.gas * transaction.maxFeePerGas + extra;
  requireCheck(extra >= 0n && total <= release.maxTotalFee, reason.fee);
  requireCheck(balance >= total, reason.balance);
}

async function readNonce({ release, rpc }: DeploymentDependencies) {
  const [latest, pending] = await Promise.all([
    rpc.nonce(release.deployer, "latest"), rpc.nonce(release.deployer, "pending"),
  ]);
  requireCheck(Number.isSafeInteger(latest) && latest >= 0 && latest === pending, reason.nonce);
  return latest;
}

async function decodeSigned(raw: Hex, release: BoundRelease) {
  const parsed = parseTransaction(raw);
  requireCheck(raw.startsWith("0x02") && parsed.type === "eip1559" && parsed.chainId === chainId &&
    parsed.to == null && (parsed.value ?? 0n) === 0n && !parsed.accessList?.length &&
    parsed.data === release.data && parsed.nonce !== undefined && Number.isSafeInteger(parsed.nonce) && parsed.nonce >= 0 &&
    parsed.gas !== undefined && parsed.maxFeePerGas !== undefined && parsed.maxPriorityFeePerGas !== undefined &&
    parsed.r && parsed.s && parsed.yParity !== undefined, reason.signature);
  const serialized = raw as `0x02${string}`;
  const deployer = (await recoverTransactionAddress({ serializedTransaction: serialized })).toLowerCase();
  requireCheck(deployer === release.deployer, reason.signature);
  const transaction: DeploymentTransaction = {
    type: "eip1559", chainId, data: release.data, nonce: parsed.nonce, gas: parsed.gas,
    maxFeePerGas: parsed.maxFeePerGas, maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
  };
  checkCaps(transaction, release);
  requireCheck(serializeTransaction(transaction, { r: parsed.r, s: parsed.s, yParity: parsed.yParity }) === raw, reason.signature);
  const signed = signedDeploymentSchema.parse({
    rawTransaction: raw, txHash: keccak256(raw), deployer, nonce: transaction.nonce,
    predictedAddress: getContractAddress({ from: release.deployer, nonce: BigInt(transaction.nonce) }).toLowerCase(),
  });
  return { signed, transaction, serialized };
}

async function newSignature(deps: DeploymentDependencies) {
  const { release, rpc } = deps;
  const nonce = await readNonce(deps);
  const address = getContractAddress({ from: release.deployer, nonce: BigInt(nonce) });
  const [gas, fees, code] = await Promise.all([
    rpc.estimateGas(release.deployer, release.data, nonce), rpc.fees(), rpc.code(address),
  ]);
  requireCheck(!code || code === "0x", reason.nonce);
  const transaction: DeploymentTransaction = { type: "eip1559", chainId, data: release.data, nonce, gas, ...fees };
  await checkFunds(transaction, deps);
  requireCheck(await readNonce(deps) === nonce, reason.nonce);
  requireCheck(await deps.authorized(), reason.release);
  const unsigned = serializeTransaction(transaction);
  const decoded = await decodeSigned(await deps.sign(unsigned), release);
  requireCheck(serializeTransaction(decoded.transaction) === unsigned, reason.signature);
  return decoded.signed;
}

async function verifyReceipt(deps: DeploymentDependencies, signed: SignedDeployment) {
  const { release, rpc } = deps;
  const hash = signed.txHash as Hex;
  const receipt = await rpc.receipt(hash);
  if (!receipt) return false;
  requireCheck(receipt.status === "success" && receipt.transactionHash === hash && receipt.to === null &&
    receipt.from.toLowerCase() === signed.deployer &&
    receipt.contractAddress?.toLowerCase() === signed.predictedAddress, reason.receipt);
  const address = receipt.contractAddress;
  const [code, owner, minter] = await Promise.all([
    rpc.code(address, receipt.blockNumber),
    rpc.permission(address, "owner", receipt.blockNumber),
    rpc.permission(address, "minter", receipt.blockNumber),
  ]);
  requireCheck(code && keccak256(code) === release.runtimeHash &&
    owner.toLowerCase() === signed.deployer && minter.toLowerCase() === signed.deployer, reason.receipt);
  return true;
}

export async function executeDeployment(deployment: LockedDeployment, deps: DeploymentDependencies) {
  const { release, rpc } = deps;
  const stage = deployment.receipt.stage;
  let uncertain = stage === "unknown";
  let signed = deployment.receipt.stage === "reserved" ? undefined : deployment.receipt.signed;
  try {
    requireCheck(JSON.stringify(deployment.release) === JSON.stringify(release.release), reason.release);
    requireCheck(await rpc.chainId() === chainId, reason.network);
    if (!signed) {
      const candidate = await newSignature(deps);
      // A failed or ambiguous persistence write must stop the worker. Startup reads the receipt.
      signed = await persist(() => deployment.stageSigned(candidate));
    }

    const decoded = await decodeSigned(signed.rawTransaction as Hex, release);
    requireCheck(decoded.signed.txHash === signed.txHash && decoded.signed.nonce === signed.nonce &&
      decoded.signed.deployer === signed.deployer && decoded.signed.predictedAddress === signed.predictedAddress, reason.signature);

    if (await verifyReceipt(deps, signed)) {
      await persist(() => deployment.confirm());
      return { done: true } as const;
    }
    const address = decoded.signed.predictedAddress as Hex;
    const [seen, code] = await Promise.all([rpc.seen(decoded.signed.txHash as Hex), rpc.code(address)]);
    if (seen && stage !== "confirmed") {
      await persist(() => deployment.markUnknown());
      return { done: false } as const;
    }
    requireCheck(!code || code === "0x", reason.nonce);
    requireCheck(await readNonce(deps) === signed.nonce, reason.nonce);
    if (stage === "confirmed") return { done: true, reason: reason.receipt } as const;
    if (stage === "unknown") return { done: false } as const;

    await checkFunds(decoded.transaction, deps);
    requireCheck(await rpc.chainId() === chainId && await readNonce(deps) === signed.nonce, reason.nonce);
    requireCheck(await deps.authorized(), reason.release);
    // Record the attempt before any send. Recovery of this stage is read-only, even when
    // the RPC cannot find the transaction or the process died before making the request.
    await persist(() => deployment.markUnknown());
    uncertain = true;
    requireCheck(await deps.authorized(), reason.release);
    // The send response is advisory. Poll only the hash derived from the stored bytes.
    await rpc.send(decoded.serialized).catch(() => undefined);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await verifyReceipt(deps, signed)) {
        await persist(() => deployment.confirm());
        return { done: true } as const;
      }
      if (attempt < 2) await deps.wait();
    }
    return { done: false } as const;
  } catch (error) {
    if (error instanceof PersistenceFailure) throw error.cause;
    if (signed && stage !== "confirmed" && !uncertain) await deployment.markUnknown();
    if (signed && !(error instanceof DeploymentCheck)) {
      return { done: false } as const;
    }
    return { done: true, reason: error instanceof DeploymentCheck ? error.message : reason.pending } as const;
  }
}

class PersistenceFailure extends Error {}

async function persist<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (cause) {
    throw new PersistenceFailure("Deployment persistence failed", { cause });
  }
}

export const waitForDeployment = () => delay(2000);
