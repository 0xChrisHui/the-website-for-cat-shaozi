import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { testDeploymentReleaseSchema, type SignedDeployment } from "@/lib/contracts/permanent";
import { createPermanentStore, recoverWorkerJobs } from "./permanent-store";

const sha = "a".repeat(40);
const release = testDeploymentReleaseSchema.parse({
  environment: "test", branch: "integration", chainId: 11155420,
  reviewedSha: sha, releaseSha: sha, migrationSha: sha, acceptanceSha: sha,
  artifactHash: "b".repeat(64), constructorConfigVersion: "1e5086c5-327a-46c4-9d81-a80af616bc21",
  deploymentVersion: "memorial-erc721-v1",
});
const signed: SignedDeployment = {
  rawTransaction: "0xabab", txHash: "0x" + "a".repeat(64),
  deployer: "0x" + "b".repeat(40), predictedAddress: "0x" + "c".repeat(40), nonce: 2,
};
const jobId = "3dcfa876-3ec1-4a6f-868a-53ec6802c5a4";
const hash = createHash("sha256").update(JSON.stringify(release)).digest("hex");

function fakeWorkerDb(reservationJobId = jobId) {
  let pendingWrite: (() => void) | undefined;
  let stored: unknown = { jobId: reservationJobId, stage: "reserved" };
  let locked = false;
  const connect = () => {
    const query = vi.fn(async (sql: string, args: unknown[]) => {
      if (sql.includes("pg_try_advisory_lock")) {
        if (locked) return { rows: [{ locked: false }] };
        locked = true;
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("pg_advisory_unlock")) {
        locked = false;
        return { rows: [] };
      }
      if (sql.includes("select payload from jobs")) return { rows: [{ payload: release }] };
      if (sql.includes("select receipt, payload_hash")) return { rows: [{ receipt: stored, payload_hash: hash }] };
      if (sql.includes("update operation_receipts")) {
        return new Promise((resolve) => {
          pendingWrite = () => {
            stored = structuredClone(args[0]);
            resolve({ rowCount: 1 });
          };
        });
      }
      throw new Error("Unexpected SQL");
    });
    return { query: query as unknown as PoolClient["query"] };
  };
  return { connect, staged: () => pendingWrite !== undefined, read: () => stored, commit() {
    const write = pendingWrite;
    pendingWrite = undefined;
    if (!write) throw new Error("No pending write");
    write();
  } };
}

describe("durable deployment work", () => {
  it("returns signed bytes only after persistence and reconciles the same signed receipt after restart", async () => {
    const db = fakeWorkerDb();
    const worker = createPermanentStore(db.connect(), "test", async () => release)!;
    const broadcast = vi.fn();
    const original = worker.withDeployment(jobId, async (deployment) => {
      expect(deployment.receipt).toEqual({ stage: "reserved" });
      broadcast(await deployment.stageSigned(signed));
      await deployment.markUnknown();
      throw new Error("Simulated restart");
    });
    const interrupted = expect(original).rejects.toThrow("Simulated restart");
    await vi.waitFor(() => expect(db.staged()).toBe(true));
    expect(db.read()).toEqual({ jobId, stage: "reserved" });
    expect(broadcast).not.toHaveBeenCalled();

    const contender = createPermanentStore(db.connect(), "test")!;
    const competing = vi.fn();
    await expect(contender.withDeployment(jobId, competing)).resolves.toBe(false);
    expect(competing).not.toHaveBeenCalled();
    db.commit();

    await vi.waitFor(() => expect(db.staged()).toBe(true));
    expect(broadcast).toHaveBeenCalledExactlyOnceWith(signed);
    db.commit();
    await interrupted;

    const restarted = createPermanentStore(db.connect(), "test")!;
    await expect(restarted.withDeployment(jobId, async (deployment) => {
      expect(deployment.operationKey).toBe("test:11155420:memorial-erc721-v1");
      expect(deployment.receipt).toEqual({ stage: "unknown", signed });
      await expect(deployment.stageSigned({ ...signed, rawTransaction: "0xcd" })).rejects.toThrow();
    })).resolves.toBe(true);
    expect(db.read()).toEqual({ jobId, stage: "unknown", signed });
  });

  it("rejects a queued payload without a matching worker reservation", async () => {
    const db = fakeWorkerDb("3a9eda01-b754-4599-b7ad-360425f4851a");
    const worker = createPermanentStore(db.connect(), "test", async () => release)!;
    const handle = vi.fn();
    await expect(worker.withDeployment(jobId, handle)).rejects.toThrow("lacks a trusted reservation");
    expect(handle).not.toHaveBeenCalled();
  });

  it("requires current trusted authorization for a new signed receipt", async () => {
    const db = fakeWorkerDb();
    const worker = createPermanentStore(db.connect(), "test", async () => null)!;
    const handle = vi.fn();
    await expect(worker.withDeployment(jobId, handle)).rejects.toThrow("no longer authorized");
    expect(handle).not.toHaveBeenCalled();
    expect(db.staged()).toBe(false);
    expect(createPermanentStore(db.connect(), "prod")).toBeUndefined();
  });
});

describe("worker startup recovery", () => {
  it.each(["test", "prod"] as const)("retains existing recovery behavior in %s", async (scope) => {
    const query = vi.fn(async () => undefined);
    await recoverWorkerJobs({ query: query as unknown as PoolClient["query"] }, scope);
    expect(query).toHaveBeenCalledTimes(scope === "test" ? 3 : 2);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("kind='foundation.intake'"));
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("status='needs_attention'"));
    if (scope === "test") {
      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("from operation_receipts"),
        ["permanent.deploy-contract", "op-sepolia"]);
    }
  });
});
