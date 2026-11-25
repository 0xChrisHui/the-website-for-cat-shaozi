import {
  encodeFunctionData, getContractAddress, isAddress, keccak256, parseAbi, parseTransaction,
  recoverTransactionAddress, serializeTransaction, size, zeroAddress,
  type Address, type Hex, type TransactionReceipt, type TransactionSerializableEIP1559,
} from "viem";
import { chainId } from "./deployment-release";
import { check, sha256, type Artifact } from "./reconcile";

export const mintAbi = parseAbi([
  "function mint(address to, uint256 tokenId, string tokenUri)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
export const photoToken = (identity: string) => BigInt(`0x${sha256(identity)}`);

export interface ReviewedDeployment {
  reviewedSha: string;
  txHash: Hex;
  address: Address;
  deployer: Address;
  nonce: number;
  runtimeHash: Hex;
}

export interface MintPolicy {
  deployment: ReviewedDeployment;
  sender: Address;
  recipient: Address;
  recipientVersion: string;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxTotalFee: bigint;
}

export interface MintIntent {
  deployment: ReviewedDeployment;
  sender: Address;
  recipient: Address;
  recipientVersion: string;
  versionId: string;
  budget: { gas: string; maxFeePerGas: string; priority: string; total: string };
  tokenId: string;
  uri: string;
}

export type MintArtifact = Artifact & { intent: MintIntent; nonce: number };
type Call = { from: Address; to: Address; data: Hex; value: 0n };
type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
export interface MintRpc {
  chainId(): Promise<number>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  code(address: Address, block?: bigint): Promise<Hex>;
  minter(address: Address): Promise<Address>;
  token(address: Address, id: bigint, block?: bigint): Promise<{ owner: Address; uri: string } | null>;
  nonce(address: Address, block: "latest" | "pending"): Promise<number>;
  balance(address: Address): Promise<bigint>;
  fees(): Promise<Fees>;
  /** Simulates the exact call and returns the gas estimate. */
  simulate(call: Call): Promise<bigint>;
  /** Upper bound for L1 data and operator fees under the reviewed test policy. */
  extraFees(bytes: number, gas: bigint): Promise<bigint>;
  send(raw: Hex): Promise<unknown>;
}

const normalize = (address: Address) => address.toLowerCase() as Address;
const sameAddress = (left: Address | null | undefined, right: Address) =>
  left?.toLowerCase() === right.toLowerCase();

export function createMint(rpc: MintRpc, sign: (unsigned: Hex, intent: MintIntent) => Promise<Hex>) {
  const network = async () => check(await rpc.chainId() === chainId, "铸造 RPC 网络不符");

  async function deployment(intent: MintIntent) {
    await network();
    const expected = intent.deployment;
    check(/^[a-f0-9]{40}$/.test(expected.reviewedSha) && Number.isSafeInteger(expected.nonce) &&
      expected.nonce >= 0 && sameAddress(getContractAddress({
        from: expected.deployer, nonce: BigInt(expected.nonce),
      }), expected.address), "审核部署身份不符");
    const receipt = await rpc.receipt(expected.txHash);
    check(receipt?.status === "success" && receipt.transactionHash === expected.txHash &&
      receipt.to === null && sameAddress(receipt.from, expected.deployer) &&
      sameAddress(receipt.contractAddress, expected.address), "审核部署回执不符");
    const code = await rpc.code(expected.address, receipt.blockNumber);
    check(code !== "0x" && keccak256(code) === expected.runtimeHash, "审核部署代码不符");
  }

  function call(intent: MintIntent): Call {
    check(isAddress(intent.sender) && isAddress(intent.recipient) &&
      !sameAddress(intent.sender, zeroAddress) && !sameAddress(intent.recipient, zeroAddress),
    "铸造账户或接收地址不符");
    return {
      from: normalize(intent.sender), to: normalize(intent.deployment.address), value: 0n,
      data: encodeFunctionData({ abi: mintAbi, functionName: "mint",
        args: [normalize(intent.recipient), BigInt(intent.tokenId), intent.uri] }),
    };
  }

  async function nonce(sender: Address) {
    const [latest, pending] = await Promise.all([rpc.nonce(sender, "latest"), rpc.nonce(sender, "pending")]);
    check(Number.isSafeInteger(latest) && latest >= 0 && latest === pending, "铸造 nonce 需要核对");
    return latest;
  }

  async function funds(tx: Transaction, policy: MintPolicy, reserved: bigint, bytes: number) {
    const { gas, maxFeePerGas, maxPriorityFeePerGas } = tx;
    check(gas > 0n && gas <= policy.gasLimit && maxFeePerGas > 0n &&
      maxFeePerGas <= policy.maxFeePerGas && maxPriorityFeePerGas >= 0n &&
      maxPriorityFeePerGas <= policy.maxPriorityFeePerGas && maxPriorityFeePerGas <= maxFeePerGas,
    "铸造交易费用超过限额");
    const [extra, balance] = await Promise.all([rpc.extraFees(bytes, gas), rpc.balance(policy.sender)]);
    const total = gas * maxFeePerGas + extra + reserved;
    check(extra >= 0n && reserved >= 0n && total <= policy.maxTotalFee && total <= balance,
      "铸造预算或余额不足");
  }

  async function decode(artifact: MintArtifact) {
    const raw = artifact.raw as `0x02${string}`;
    check(/^0x02(?:[0-9a-f]{2})+$/.test(raw) && raw.length <= 8192 &&
      keccak256(raw) === artifact.id, "铸造签名哈希不符");
    const parsed = parseTransaction(raw);
    const expected = call(artifact.intent);
    check(parsed.type === "eip1559" && parsed.chainId === chainId && !parsed.accessList?.length &&
      (parsed.value ?? 0n) === 0n && parsed.to === expected.to && parsed.data === expected.data &&
      parsed.nonce === artifact.nonce && Number.isSafeInteger(artifact.nonce) && artifact.nonce >= 0 &&
      parsed.gas !== undefined && parsed.maxFeePerGas !== undefined &&
      parsed.r && parsed.s && parsed.yParity !== undefined &&
      sameAddress(await recoverTransactionAddress({ serializedTransaction: raw }), expected.from),
    "铸造签名与核准交易不符");
    const tx: Transaction = { type: "eip1559", chainId, to: expected.to, data: expected.data,
      value: 0n, nonce: artifact.nonce, gas: parsed.gas, maxFeePerGas: parsed.maxFeePerGas,
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? 0n };
    check(serializeTransaction(tx, { r: parsed.r, s: parsed.s, yParity: parsed.yParity }) === raw,
      "铸造签名编码不符");
    return tx;
  }

  async function unused(intent: MintIntent) {
    const address = intent.deployment.address;
    const [code, minter, existing] = await Promise.all([
      rpc.code(address), rpc.minter(address), rpc.token(address, BigInt(intent.tokenId)),
    ]);
    check(code !== "0x" && keccak256(code) === intent.deployment.runtimeHash &&
      sameAddress(minter, intent.sender), "铸造者或合约代码已变化");
    check(!existing, "代币已存在，需要核对原交易");
  }

  return {
    async sign(intent: MintIntent, policy: MintPolicy, reserved: bigint, authorize: () => Promise<void>) {
      await deployment(intent);
      await unused(intent);
      const currentNonce = await nonce(intent.sender);
      const request = call(intent);
      const [gas, fees] = await Promise.all([rpc.simulate(request), rpc.fees()]);
      const tx: Transaction = { type: "eip1559", chainId, to: request.to, data: request.data,
        value: 0n, nonce: currentNonce, gas, ...fees };
      const unsigned = serializeTransaction(tx);
      // Allow for the two signature scalars, parity and RLP length changes before signing.
      await funds(tx, policy, reserved, size(unsigned) + 72);
      check(await nonce(intent.sender) === currentNonce, "铸造 nonce 已变化");
      await network();
      await authorize();
      const raw = await sign(unsigned, intent);
      const artifact = { id: keccak256(raw), raw, intent, nonce: currentNonce };
      check(serializeTransaction(await decode(artifact)) === unsigned, "铸造签名参数已变化");
      return artifact;
    },
    async verify(artifact: MintArtifact) {
      await decode(artifact);
      await deployment(artifact.intent);
      const receipt = await rpc.receipt(artifact.id as Hex);
      if (!receipt) return false;
      const intent = artifact.intent;
      check(receipt.status === "success" && receipt.transactionHash === artifact.id &&
        sameAddress(receipt.from, intent.sender) && sameAddress(receipt.to, intent.deployment.address),
      "铸造交易回执不符");
      const token = await rpc.token(intent.deployment.address, BigInt(intent.tokenId), receipt.blockNumber);
      check(token && sameAddress(token.owner, intent.recipient) && token.uri === intent.uri,
        "铸造所有权或 URI 不符");
      return true;
    },
    async beforeSend(artifact: MintArtifact, policy: MintPolicy, reserved: bigint) {
      await deployment(artifact.intent);
      await unused(artifact.intent);
      await funds(await decode(artifact), policy, reserved, size(artifact.raw as Hex));
      await network();
      check(await nonce(artifact.intent.sender) === artifact.nonce, "铸造 nonce 已变化");
    },
    send: (artifact: MintArtifact) => rpc.send(artifact.raw as Hex),
  };
}

type Transaction = TransactionSerializableEIP1559 & {
  gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint;
};
export type Mint = ReturnType<typeof createMint>;
