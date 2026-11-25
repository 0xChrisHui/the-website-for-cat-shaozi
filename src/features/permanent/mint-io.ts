import {
  BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi,
  TransactionReceiptNotFoundError, type Address,
} from "viem";
import { optimismSepolia } from "viem/chains";
import { mintAbi, type MintRpc } from "./mint";
import { check } from "./reconcile";

const abi = [
  ...mintAbi,
  ...parseAbi(["error ERC721NonexistentToken(uint256 tokenId)", "function minter() view returns (address)"]),
] as const;
const oracle = {
  address: optimismSepolia.contracts.gasPriceOracle.address,
  abi: parseAbi([
    "function getL1FeeUpperBound(uint256 unsignedTxSize) view returns (uint256)",
    "function getOperatorFee(uint256 gasUsed) view returns (uint256)",
  ]),
} as const;

/** Disposable RPC only. The worker must separately provide its verified test policy and signer. */
export function createLoopbackMintRpc(endpoint: string): MintRpc {
  const url = new URL(endpoint);
  check(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port &&
    url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash,
  "铸造沙箱必须使用显式 IPv4 回环端口");
  const client = createPublicClient({
    chain: optimismSepolia, cacheTime: 0,
    transport: http(url.href, { retryCount: 0, timeout: 4000, fetchOptions: { redirect: "error" } }),
  });

  return {
    chainId: () => client.getChainId(),
    async receipt(hash) {
      try {
        return await client.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    async code(address, blockNumber) {
      return await client.getCode({ address, blockNumber }) ?? "0x";
    },
    minter: (address) => client.readContract({ address, abi, functionName: "minter" }),
    async token(address: Address, tokenId, blockNumber) {
      const input = { address, abi, args: [tokenId] as const, blockNumber };
      let owner: Address;
      try {
        owner = await client.readContract({ ...input, functionName: "ownerOf" });
      } catch (error) {
        const reverted = error instanceof BaseError &&
          error.walk((cause) => cause instanceof ContractFunctionRevertedError);
        if (reverted instanceof ContractFunctionRevertedError &&
          reverted.data?.errorName === "ERC721NonexistentToken" && reverted.data.args?.[0] === tokenId) return null;
        throw error;
      }
      return { owner, uri: await client.readContract({ ...input, functionName: "tokenURI" }) };
    },
    nonce: (address, blockTag) => client.getTransactionCount({ address, blockTag }),
    balance: (address) => client.getBalance({ address, blockTag: "pending" }),
    fees: () => client.estimateFeesPerGas(),
    async simulate({ from, ...call }) {
      await client.call({ ...call, account: from, blockTag: "pending" });
      return client.estimateGas({ ...call, account: from, blockTag: "pending" });
    },
    async extraFees(bytes, gas) {
      const [l1, operator] = await Promise.all([
        client.readContract({ ...oracle, functionName: "getL1FeeUpperBound", args: [BigInt(bytes)] }),
        client.readContract({ ...oracle, functionName: "getOperatorFee", args: [gas] }),
      ]);
      return l1 + operator;
    },
    send: (serializedTransaction) => client.sendRawTransaction({ serializedTransaction }),
  };
}
