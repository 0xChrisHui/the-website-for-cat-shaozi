import { expect, it } from "vitest";
import { getContractAddress, keccak256, type Address, type Hash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyDeployment } from "./verify-deployment";

it("checks the known transaction and both permissions, returning only a verdict", async () => {
  const from: Address = privateKeyToAccount(generatePrivateKey()).address;
  const hash = keccak256("0x01");
  const address = getContractAddress({ from, nonce: 0n });
  const bound = { deployer: from, data: "0x6000", runtimeHash: keccak256("0x6001") } as const;
  const expected = { txHash: hash, address, nonce: 0, owner: from, minter: from };
  let input = bound.data as string;
  let chain = 11155420;
  let code: Hash = "0x6001";
  let minter: Address = from;
  const rpc = {
    chainId: async () => chain,
    transaction: async () => ({ hash, from, to: null, nonce: 0, input: input as Hash, value: 0n, blockNumber: 1n, blockHash: hash }),
    receipt: async () => ({ transactionHash: hash, from, to: null, status: "success" as const, contractAddress: address, blockNumber: 1n, blockHash: hash }),
    code: async () => code,
    permission: async (_address: Address, name: "owner" | "minter") => name === "owner" ? from : minter,
  };
  await expect(verifyDeployment(bound, expected, rpc)).resolves.toEqual({ ok: true, network: "op-sepolia" });
  chain = 10;
  await expect(verifyDeployment(bound, expected, rpc)).resolves.toMatchObject({ ok: false, reason: "chain" });
  chain = 11155420;
  code = "0x6002";
  await expect(verifyDeployment(bound, expected, rpc)).resolves.toMatchObject({ ok: false, reason: "runtime" });
  code = "0x6001";
  input = "0x6002";
  await expect(verifyDeployment(bound, expected, rpc)).resolves.toMatchObject({ ok: false, reason: "transaction" });
  input = bound.data;
  minter = address.toLowerCase() as Address;
  await expect(verifyDeployment(bound, expected, rpc)).resolves.toMatchObject({ ok: false, reason: "permissions" });
});
