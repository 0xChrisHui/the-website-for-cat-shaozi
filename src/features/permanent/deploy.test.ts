import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { keccak256, parseTransaction, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { permanentDeploymentKind, type DeploymentReceipt, type LockedDeployment, type SignedDeployment } from "@/lib/contracts/permanent";
import { executeDeployment, type DeploymentDependencies } from "./deploy";
import { bindDeploymentRelease, chainId, rawHex } from "./deployment-release";
import type { DeploymentChainReceipt } from "./deployment-io";
import { createDeploymentReleaseSource, handleJob } from "./jobs";

const bytes = readFileSync(new URL("../../../contracts/script/MemorialPhotos.json", import.meta.url));
const runtime = rawHex.parse(JSON.parse(bytes.toString()).runtimeBytecode);
const account = privateKeyToAccount(generatePrivateKey());
const otherAccount = privateKeyToAccount(generatePrivateKey());
const sha = "a".repeat(40);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const config = {
  version: "42980d14-e391-4df5-a7a0-ab0a907780f4",
  name: "Test Photos", symbol: "TEST", deployer: account.address.toLowerCase(),
  gasLimit: "3000000", maxFeePerGas: "1000", maxPriorityFeePerGas: "100",
  maxTotalFee: "3000000000", rpcUrlHash: "b".repeat(64),
};
const release = {
  environment: "test", branch: "integration", chainId, deploymentVersion: "memorial-erc721-v1",
  reviewedSha: sha, releaseSha: sha, migrationSha: sha, acceptanceSha: sha,
  artifactHash: hash(bytes), constructorConfigVersion: config.version,
};

const manifest = { release, config, configHash: hash(JSON.stringify(config)) };

function fixture() {
  const bound = bindDeploymentRelease(manifest, sha, bytes);
  if (!bound) throw new Error("Invalid test fixture");
  let stored: DeploymentReceipt = { stage: "reserved" };
  let confirmed = false;
  const trace: string[] = [];
  function makeReceipt(): DeploymentChainReceipt {
    if (stored.stage === "reserved") throw new Error("Missing stored transaction");
    return {
      transactionHash: stored.signed.txHash as Hex, from: account.address, to: null,
      status: "success", contractAddress: stored.signed.predictedAddress as Hex, blockNumber: 123n,
    };
  }
  function receiptOrNull() {
    return confirmed ? makeReceipt() : null;
  }
  const deps = {
    release: bound,
    rpc: {
      chainId: vi.fn(async () => chainId),
      nonce: vi.fn(async () => 1),
      fees: vi.fn(async () => ({ maxFeePerGas: 30n, maxPriorityFeePerGas: 2n })),
      balance: vi.fn(async () => 3000000000n),
      estimateGas: vi.fn(async () => 1200000n),
      extraFees: vi.fn(async () => 1100n),
      receipt: vi.fn(async () => receiptOrNull()),
      seen: vi.fn(async () => false),
      code: vi.fn(async (_address: Hex, block?: bigint) => block === 123n ? runtime : undefined),
      permission: vi.fn(async () => account.address),
      send: vi.fn(async (raw: Hex) => {
        expect(stored.stage).toBe("unknown");
        if (stored.stage === "reserved") throw new Error("Missing persisted bytes");
        expect(raw).toBe(stored.signed.rawTransaction);
        trace.push("send");
        return keccak256(raw);
      }),
    },
    async signWith(unsigned: Hex, signer = account) {
      const transaction = parseTransaction(unsigned);
      return signer.signTransaction(transaction);
    },
    sign: vi.fn(async (unsigned: Hex) => {
      trace.push("sign");
      return account.signTransaction(parseTransaction(unsigned));
    }),
    authorized: vi.fn(async () => true),
    wait: async () => undefined,
  } satisfies DeploymentDependencies & { signWith(unsigned: Hex, signer?: typeof account): Promise<Hex> };
  const context = {
    operationKey: "test:11155420:memorial-erc721-v1",
    release: bound.release,
    get receipt() { return stored; },
    stageSigned: vi.fn(async (signed: SignedDeployment) => {
      trace.push("persist");
      stored = { stage: "signed", signed };
      return { ...signed };
    }),
    markUnknown: vi.fn(async () => {
      if (stored.stage === "reserved") throw new Error("Missing signature");
      trace.push("unknown");
      stored = { ...stored, stage: "unknown" };
    }),
    confirm: vi.fn(async () => {
      if (stored.stage === "reserved") throw new Error("Missing signature");
      trace.push("confirm");
      stored = { ...stored, stage: "confirmed" };
    }),
  } satisfies LockedDeployment;
  return {
    deps, context, trace, makeReceipt,
    run: () => executeDeployment(context, deps),
    showReceipt: () => { confirmed = true; },
  };
}

describe("OP Sepolia release binding", () => {
  it("binds exact worker, review, migration, acceptance, artifact and config", () => {
    expect(bindDeploymentRelease(manifest, sha, bytes)).not.toBeNull();
    for (const key of ["reviewedSha", "releaseSha", "migrationSha", "acceptanceSha"]) {
      expect(bindDeploymentRelease({ ...manifest, release: { ...release, [key]: "c".repeat(40) } }, sha, bytes)).toBeNull();
    }
    expect(bindDeploymentRelease(manifest, "c".repeat(40), bytes)).toBeNull();
    expect(bindDeploymentRelease(manifest, sha, Buffer.concat([bytes, Buffer.from(" ")]))).toBeNull();
    expect(bindDeploymentRelease({ ...manifest, config: { ...config, name: "Changed" } }, sha, bytes)).toBeNull();
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(bytes.toString()), runtimeBytecode: "0x00" }));
    expect(bindDeploymentRelease({ ...manifest, release: { ...release, artifactHash: hash(changed) } }, sha, changed)).toBeNull();
  });

  it("cannot authorize from job input or a development checkout", async () => {
    const raw = { WORKER_INSTANCE: "test", OP_SEPOLIA_RPC_URL: "https://sandbox.invalid", WORKER_SHA: sha, CI: "true" };
    for (const [key, value] of Object.entries(raw)) vi.stubEnv(key, value);
    try {
      const source = createDeploymentReleaseSource();
      expect(await source.readVerifiedRelease()).toBeNull();
      vi.stubEnv("CI", "false");
      vi.stubEnv("VERCEL_ENV", "development");
      expect(await source.readVerifiedRelease()).toBeNull();
      const withDeployment = vi.fn();
      const finish = vi.fn();
      await handleJob({ jobId: "fixture", kind: permanentDeploymentKind, schemaVersion: 1, payload: release },
        { permanent: { withDeployment }, jobs: { finish }, files: { read: vi.fn() }, clock: () => new Date() });
      expect(withDeployment).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledWith("fixture", expect.any(String));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("OP Sepolia deployment", () => {
  it("rejects wrong network, insufficient funds, excessive gas/fees and external nonce before signing", async () => {
    for (const scenario of [
      (f: ReturnType<typeof fixture>) => f.deps.rpc.chainId.mockResolvedValue(10),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.balance.mockResolvedValue(1n),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.estimateGas.mockResolvedValue(3000001n),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.fees.mockResolvedValue({ maxFeePerGas: 1001n, maxPriorityFeePerGas: 1n }),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.extraFees.mockResolvedValue(3000000000n),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.nonce.mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      (f: ReturnType<typeof fixture>) => f.deps.authorized.mockResolvedValue(false),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.code.mockResolvedValue("0x01"),
    ]) {
      const f = fixture();
      scenario(f);
      expect(await f.run()).toEqual({ done: true, reason: expect.any(String) });
      expect(f.trace).toEqual([]);
    }
  });

  it("rejects a signer with a different address or transaction fees", async () => {
    const f = fixture();
    f.deps.sign.mockImplementationOnce((unsigned) => f.deps.signWith(unsigned, otherAccount));
    expect(await f.run()).toEqual({ done: true, reason: expect.any(String) });
    f.deps.sign.mockImplementationOnce((unsigned) => account.signTransaction({
      ...parseTransaction(unsigned), gas: 1200001n,
    }));
    expect(await f.run()).toEqual({ done: true, reason: expect.any(String) });
    expect(f.trace).toEqual([]);
  });

  it("recovers after persisting the signature and before recording the send attempt", async () => {
    const f = fixture();
    f.context.markUnknown.mockRejectedValueOnce(new Error("connection lost before commit"));
    await expect(f.run()).rejects.toThrow("connection lost before commit");
    expect(f.context.receipt.stage).toBe("signed");
    expect(f.deps.rpc.send).not.toHaveBeenCalled();
    expect(await f.run()).toEqual({ done: false });
    expect(f.trace).toEqual(["sign", "persist", "unknown", "send"]);
  });

  it("recovers a committed attempt marker without broadcasting after an ambiguous write", async () => {
    const f = fixture();
    const mark = f.context.markUnknown.getMockImplementation()!;
    f.context.markUnknown.mockImplementationOnce(async () => {
      await mark();
      throw new Error("connection lost after commit");
    });
    await expect(f.run()).rejects.toThrow("connection lost after commit");
    expect(await f.run()).toEqual({ done: false });
    expect(f.trace).toEqual(["sign", "persist", "unknown"]);
  });

  it("uses only persisted bytes, holds an unknown attempt, then verifies the original receipt", async () => {
    const f = fixture();
    f.deps.rpc.send.mockRejectedValueOnce(new Error("timed out after accepting the transaction"));
    expect(await f.run()).toEqual({ done: false });
    expect(await f.run()).toEqual({ done: false });
    f.deps.rpc.seen.mockResolvedValue(true);
    expect(await f.run()).toEqual({ done: false });
    f.showReceipt();
    expect(await f.run()).toEqual({ done: true });
    expect(await f.run()).toEqual({ done: true });
    expect(f.deps.rpc.send).toHaveBeenCalledTimes(1);
    expect(f.deps.sign).toHaveBeenCalledTimes(1);
    expect(f.deps.rpc.code).toHaveBeenCalledWith(f.makeReceipt().contractAddress, 123n);
    expect(f.deps.rpc.permission).toHaveBeenCalledWith(f.makeReceipt().contractAddress, "owner", 123n);
    expect(f.deps.rpc.permission).toHaveBeenCalledWith(f.makeReceipt().contractAddress, "minter", 123n);
    expect(f.context.receipt.stage).toBe("confirmed");
  });

  it("keeps a consumed nonce or mismatched receipt, code and permissions unconfirmed", async () => {
    for (const scenario of [
      (f: ReturnType<typeof fixture>) => f.deps.rpc.nonce.mockResolvedValue(2),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.receipt.mockResolvedValue({ ...f.makeReceipt(), status: "reverted" }),
      (f: ReturnType<typeof fixture>) => f.deps.rpc.receipt.mockResolvedValue({ ...f.makeReceipt(), contractAddress: otherAccount.address }),
      (f: ReturnType<typeof fixture>) => {
        f.showReceipt();
        f.deps.rpc.code.mockResolvedValue("0x00");
      },
      (f: ReturnType<typeof fixture>) => {
        f.showReceipt();
        f.deps.rpc.permission.mockResolvedValueOnce(account.address).mockResolvedValueOnce(otherAccount.address);
      },
    ]) {
      const f = fixture();
      await f.run();
      scenario(f);
      expect(await f.run()).toEqual({ done: true, reason: expect.any(String) });
      expect(f.context.confirm).not.toHaveBeenCalled();
      expect(f.deps.rpc.send).toHaveBeenCalledTimes(1);
    }
  });
});
