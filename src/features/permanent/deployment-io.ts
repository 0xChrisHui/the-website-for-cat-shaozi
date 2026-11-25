import { request } from "node:http";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi, TransactionNotFoundError, TransactionReceiptNotFoundError,
  type Address, type Hash, type Hex, type TransactionReceipt, type TransactionSerializableEIP1559,
} from "viem";
import { optimismSepolia } from "viem/chains";
import { mintAbi, type MintRpc } from "./mint";
import { rawHex, signerAvailable, signerSocket } from "./deployment-release";

const gasOracle = {
  address: optimismSepolia.contracts.gasPriceOracle.address,
  abi: parseAbi([
    "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
    "function getOperatorFee(uint256 gasUsed) view returns (uint256)",
  ]),
} as const;
const permissionsAbi = parseAbi(["function owner() view returns (address)", "function minter() view returns (address)"]);

export type DeploymentChainReceipt = Pick<TransactionReceipt,
  "transactionHash" | "from" | "to" | "status" | "contractAddress" | "blockNumber">;

function deploymentClient(url: string, signal?: AbortSignal) {
  return createPublicClient({
    chain: optimismSepolia, cacheTime: 0,
    transport: http(url, { retryCount: 0, timeout: 4000, fetchOptions: { redirect: "error", signal } }),
  });
}

export function createDeploymentReadRpc(url: string, signal?: AbortSignal) {
  const client = deploymentClient(url, signal);
  return {
    chainId: () => client.getChainId(),
    transaction: (hash: Hash) => client.getTransaction({ hash }),
    receipt: (hash: Hash) => client.getTransactionReceipt({ hash }),
    code: (address: Address, blockNumber?: bigint) => client.getCode({ address, blockNumber }),
    permission: (address: Address, functionName: "owner" | "minter", blockNumber?: bigint) =>
      client.readContract({ address, abi: permissionsAbi, functionName, blockNumber }),
  };
}

export function createDeploymentRpc(url: string, signal?: AbortSignal) {
  const client = deploymentClient(url, signal);
  return {
    chainId: () => client.getChainId(),
    nonce: (address: Address, blockTag: "latest" | "pending") => client.getTransactionCount({ address, blockTag }),
    balance: (address: Address) => client.getBalance({ address, blockTag: "pending" }),
    fees: () => client.estimateFeesPerGas(),
    estimateGas: (account: Address, data: Hex, nonce: number) => client.estimateGas({ account, data, nonce, blockTag: "pending" }),
    async extraFees(unsignedSize: number, gasLimit: bigint) {
      const [l1, operator] = await Promise.all([
        client.readContract({ ...gasOracle, functionName: "getL1FeeUpperBound", args: [BigInt(unsignedSize)] }),
        client.readContract({ ...gasOracle, functionName: "getOperatorFee", args: [gasLimit] }),
      ]);
      return l1 + operator;
    },
    async receipt(hash: Hash): Promise<DeploymentChainReceipt | null> {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async seen(hash: Hash) {
      try {
        await client.getTransaction({ hash });
        return true;
      } catch (error) {
        if (error instanceof TransactionNotFoundError) return false;
        throw error;
      }
    },
    code: (address: Address, blockNumber?: bigint) => client.getCode({ address, blockNumber }),
    permission: (address: Address, functionName: "owner" | "minter", blockNumber: bigint) =>
      client.readContract({ address, abi: permissionsAbi, functionName, blockNumber }),
    send: (serializedTransaction: `0x02${string}`) => client.sendRawTransaction({ serializedTransaction }),
  };
}

export function createPhotoMintRpc(url: string, signal: AbortSignal): MintRpc {
  const client = deploymentClient(url, signal);
  const common = createDeploymentRpc(url, signal);
  const tokenAbi = [...mintAbi, ...parseAbi(["error ERC721NonexistentToken(uint256 tokenId)"])] as const;
  return {
    ...common,
    async code(address, block) { return await common.code(address, block) ?? "0x"; },
    minter: (address) => client.readContract({ address, abi: permissionsAbi, functionName: "minter" }),
    async receipt(hash) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async token(address, id, blockNumber) {
      const query = { address, abi: tokenAbi, args: [id], blockNumber } as const;
      let owner;
      try {
        owner = await client.readContract({ ...query, functionName: "ownerOf" });
      } catch (error) {
        if (error instanceof BaseError && error.walk((cause) =>
          cause instanceof ContractFunctionRevertedError &&
          cause.data?.errorName === "ERC721NonexistentToken" && cause.data.args?.[0] === id
        ) instanceof ContractFunctionRevertedError) return null;
        throw error;
      }
      return { owner, uri: await client.readContract({ ...query, functionName: "tokenURI" }) };
    },
    async fees() {
      const { maxFeePerGas, maxPriorityFeePerGas } = await common.fees();
      return { maxFeePerGas, maxPriorityFeePerGas };
    },
    async simulate({ from: account, ...call }) {
      await client.call({ account, ...call, blockTag: "pending" });
      return client.estimateGas({ account, ...call, blockTag: "pending" });
    },
    send(raw) {
      signal.throwIfAborted();
      return client.sendRawTransaction({ serializedTransaction: raw });
    },
  };
}

export type DeploymentRpc = ReturnType<typeof createDeploymentRpc>;
export type DeploymentTransaction = TransactionSerializableEIP1559 & {
  type: "eip1559";
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  data: Hex;
};

export async function signDeployment(sha: string, unsignedTransaction: Hex) {
  if (!await signerAvailable()) throw new Error("Test signer unavailable");
  const body = JSON.stringify({ sha, unsignedTransaction });
  return new Promise<Hex>((resolve, reject) => {
    const req = request({
      socketPath: signerSocket, path: "/sign-op-sepolia-deployment", method: "POST",
      signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (response) => {
      response.on("error", reject);
      if (response.statusCode !== 200) {
        response.destroy();
        reject(new Error("Test signer refused deployment"));
        return;
      }
      let output = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 262146) req.destroy(new Error("Test signer response too large"));
      });
      response.on("end", () => {
        const parsed = rawHex.safeParse(output);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error("Invalid test signer response"));
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
