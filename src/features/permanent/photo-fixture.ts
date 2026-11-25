import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  decodeFunctionData, getContractAddress, keccak256, parseTransaction, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { ArchiveArtifact, ArLocal } from "./arlocal";
import type { CurrentPhoto, PhotoContext } from "./execute";
import { handleJob } from "./jobs";
import { createMint, mintAbi, type MintArtifact, type MintPolicy, type MintRpc } from "./mint";
import type { Operation, Stored } from "./reconcile";

type Journal = { archive: Stored<ArchiveArtifact> | null; mint: Stored<MintArtifact> | null };

export function createPhotoFixture(archive: ArLocal, save?: (snapshot: string) => Promise<void>) {
  const key = generatePrivateKey();
  const signer = privateKeyToAccount(key);
  const sender = signer.address;
  const recipient = "0x0000000000000000000000000000000000000001";
  const runtime = "0x6000";
  const deployment = {
    reviewedSha: "e".repeat(40),
    txHash: keccak256("0x01"),
    address: getContractAddress({ from: sender, nonce: 0n }),
    deployer: sender, nonce: 0, runtimeHash: keccak256(runtime),
  };
  const itemId = randomUUID();
  const versionId = randomUUID();
  const recipientVersion = randomUUID();
  const identity = randomUUID();
  const photo: CurrentPhoto = {
    kind: "photo", identity, objectKey: "synthetic/photo", revoked: false,
    approvedRecipientConfigVersion: recipientVersion, currentRecipientConfigVersion: recipientVersion,
    policy: { itemId, currentVersionId: versionId, approvedVersionId: versionId, published: true,
      withdrawn: false, exclusion: "none",
      usageRights: { arweave: true, nft: true, publicView: true, privateExport: true } },
  };
  const policy: MintPolicy = {
    deployment, sender, recipient, recipientVersion, gasLimit: 100_000n, maxFeePerGas: 20n,
    maxPriorityFeePerGas: 2n, maxTotalFee: 2_000_000n,
  };

  let journal: Journal = { archive: null, mint: null };
  let locked = false;
  let result: { hash: Hex; owner: Address; uri: string; id: bigint } | undefined;
  let source: Buffer;
  const state = {
    archiveEnabled: true, mintEnabled: true, missing: false, network: 11155420, balance: 2_000_000n,
    reserved: 0n, unknown: false, writes: 0, signs: 0, reads: 0, loseSend: false,
    unavailable: false, beforeFile: () => {}, beforeSign: () => {},
    reasons: [] as (string | undefined)[],
  };

  function receipt(txHash: Hex, to: Address | null, address: Address | null) {
    return {
      transactionHash: txHash, status: "success", from: sender, to,
      contractAddress: address, blockNumber: 1n,
    } as Awaited<ReturnType<MintRpc["receipt"]>>;
  }

  const rpc: MintRpc = {
    chainId: async () => state.network,
    async receipt(hash) {
      if (hash === deployment.txHash) return receipt(hash, null, deployment.address);
      if (state.unavailable) throw new Error("Synthetic RPC unavailable");
      return hash === result?.hash ? receipt(hash, deployment.address, null) : null;
    },
    code: async () => runtime,
    minter: async () => sender,
    token: async (_address, tokenId) => tokenId === result?.id ? { owner: result.owner, uri: result.uri } : null,
    nonce: async () => result ? 2 : 1,
    balance: async () => state.balance,
    fees: async () => ({ maxFeePerGas: 10n, maxPriorityFeePerGas: 1n }),
    async simulate() {
      state.beforeSign();
      return 50_000n;
    },
    extraFees: async () => 10n,
    async send(raw) {
      if (raw !== journal.mint?.raw || journal.mint.state !== "attempted") throw new Error("Missing durable attempt");
      state.writes++;
      const tx = parseTransaction(raw);
      const decoded = decodeFunctionData({ abi: mintAbi, data: tx.data! });
      if (decoded.functionName !== "mint") throw new Error("Unexpected job call");
      const [owner, id, uri] = decoded.args;
      result = { hash: keccak256(raw), owner, id, uri };
      if (state.loseSend) {
        state.unavailable = true;
        throw new Error("Synthetic RPC timed out after send");
      }
    },
  };

  function operation<T>(read: () => Stored<T> | null,
    update: (receipt: Stored<T>) => Journal): Operation<T> {
    async function commit(receipt: Stored<T>) {
      const next = update(receipt);
      await save?.(JSON.stringify(next));
      journal = next;
      return receipt;
    }
    return {
      receipt: read(),
      async stage(artifact) {
        if (read()) throw new Error("Receipt already staged");
        return commit({ ...artifact, state: "signed" });
      },
      async attempt() {
        const current = read();
        if (current?.state !== "signed") throw new Error("No signed receipt to attempt");
        await commit({ ...current, state: "attempted" });
      },
      async confirm() {
        const current = read();
        if (!current) throw new Error("No receipt to confirm");
        await commit({ ...current, state: "confirmed" });
      },
    };
  }

  function context(ar = archive): PhotoContext {
    return {
      files: {
        async read() {
          state.reads++;
          state.beforeFile();
          source ??= await sharp({
            create: { width: 40, height: 20, channels: 3, background: "#884422" },
          }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
          return new ReadableStream({ start(controller) { controller.enqueue(source); controller.close(); } });
        },
      },
      clock: () => new Date(),
      jobs: { async finish(_id, reason) { state.reasons.push(reason); } },
      permanentPhoto: {
        environment: "test",
        archive: {
          ...ar,
          async send(artifact) {
            if (journal.archive?.state !== "attempted" || journal.archive.raw !== artifact.raw) {
              throw new Error("Missing durable archive attempt");
            }
            await ar.send(artifact);
          },
        },
        mint: createMint(rpc, async (unsigned) => {
          state.signs++;
          return signer.signTransaction(parseTransaction(unsigned));
        }),
        readCurrent: async () => state.missing ? null : structuredClone(photo),
        archiveEnabled: async () => state.archiveEnabled,
        mintPolicy: async () => state.mintEnabled ? structuredClone(policy) : null,
        async withPhoto(_jobId, expectedItem, run) {
          if (locked || expectedItem !== itemId) return false;
          locked = true;
          try {
            await run({ identity,
              archive: operation(() => journal.archive, (value) => ({ ...journal, archive: value })),
              mint: operation(() => journal.mint, (value) => ({ ...journal, mint: value })),
              reservedFees: async () => ({ total: state.reserved, unknown: state.unknown }) });
            return true;
          } finally {
            locked = false;
          }
        },
      },
    };
  }

  return {
    photo, policy, state,
    run: (worker = context()) => handleJob({
      jobId: randomUUID(), kind: "permanent.archive-photo", schemaVersion: 1, payload: { itemId },
    }, worker),
    context,
    snapshot: () => JSON.stringify(journal),
    restore(snapshot: string) { journal = JSON.parse(snapshot) as Journal; },
    journal: () => structuredClone(journal),
  };
}
