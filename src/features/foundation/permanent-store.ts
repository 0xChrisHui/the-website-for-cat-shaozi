import { testSignerLock } from "./photo-store";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  permanentDeploymentKind, signedDeploymentSchema, testDeploymentReleaseSchema,
  type DeploymentReceipt, type PermanentWorker, type TestDeploymentRelease,
} from "@/lib/contracts/permanent";

const network = "op-sepolia";
const storedReceiptSchema = z.discriminatedUnion("stage", [
  z.object({ jobId: z.uuid(), stage: z.literal("reserved") }),
  z.object({ jobId: z.uuid(), stage: z.enum(["signed", "unknown", "confirmed"]), signed: signedDeploymentSchema }),
]);
type StoredReceipt = z.infer<typeof storedReceiptSchema>;

export class DeploymentUnavailable extends Error {}

function operationKey(release: TestDeploymentRelease) {
  return `test:11155420:${release.deploymentVersion}`;
}

function payloadHash(release: TestDeploymentRelease) {
  return createHash("sha256").update(JSON.stringify(release)).digest("hex");
}

// These operations own a session-affine worker connection and use autocommit.
export function createPermanentStore(
  db: Pick<PoolClient, "query">,
  scope: "test" | "prod",
  readAuthorizedRelease?: () => Promise<TestDeploymentRelease | null>,
  hasUnsettledMint?: () => Promise<boolean>,
) {
  if (scope !== "test") return undefined;

  async function findReceipt(key: string, hash: string) {
    const { rows: [row] } = await db.query<{ receipt: unknown; payload_hash: string }>(
      "select receipt, payload_hash from operation_receipts where operation_key=$1 and network=$2", [key, network],
    );
    if (!row) return null;
    const parsed = storedReceiptSchema.safeParse(row.receipt);
    if (row.payload_hash !== hash || !parsed.success) {
      throw new DeploymentUnavailable("Deployment release conflicts with existing operation");
    }
    return parsed.data;
  }

  let inUse = false;
  const store = {
    async enqueue(input: TestDeploymentRelease) {
      const release = testDeploymentReleaseSchema.parse(input);
      const key = operationKey(release);
      const hash = payloadHash(release);
      const { rows: [created] } = await db.query<{ job_id: string }>(`
        with queued as (
          insert into jobs (kind, payload)
          select $1, $2::jsonb where not exists (
            select 1 from operation_receipts where network=$4
              and operation_key like 'test:11155420:memorial-erc721-v%' and confirmed_at is null
          )
          on conflict do nothing
          returning id
        )
        insert into operation_receipts (operation_key, network, payload_hash, receipt)
        select $3, $4, $5, jsonb_build_object('jobId', id, 'stage', 'reserved') from queued
        returning receipt->>'jobId' as job_id
      `, [permanentDeploymentKind, release, key, network, hash]);
      return created?.job_id ?? (await findReceipt(key, hash))?.jobId ?? null;
    },

    async withDeployment(jobId, run) {
      if (inUse) return false;
      inUse = true;
      let locked = false;
      let active = false;
      const lockKey = testSignerLock;
      try {
        const { rows: [lock] } = await db.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [lockKey],
        );
        locked = lock?.locked === true;
        if (!locked) return false;

        const { rows: [job] } = await db.query<{ payload: unknown }>(`
          select payload from jobs where id=$1 and kind=$2 and schema_version=1
            and sample_run_id is null and status='running'
        `, [jobId, permanentDeploymentKind]);
        const parsed = testDeploymentReleaseSchema.safeParse(job?.payload);
        if (!parsed.success) throw new DeploymentUnavailable("Invalid deployment job");
        const release = parsed.data;
        const key = operationKey(release);
        const hash = payloadHash(release);
        const stored = await findReceipt(key, hash);
        if (stored?.jobId !== jobId) throw new DeploymentUnavailable("Deployment lacks a trusted reservation");

        async function assertAuthorized() {
          const authorized = await readAuthorizedRelease?.();
          if (!authorized || payloadHash(authorized) !== hash) {
            throw new DeploymentUnavailable("Deployment release is no longer authorized");
          }
        }

        let current = stored;
        if (current.stage === "reserved") {
          await assertAuthorized();
          if (await hasUnsettledMint?.()) throw new DeploymentUnavailable("Test signer has an unsettled mint");
        }
        async function persist(next: StoredReceipt) {
          if (!active) throw new Error("Deployment lock is no longer active");
          const result = await db.query(`
            update operation_receipts set receipt=$1::jsonb,
              confirmed_at=case when $1::jsonb->>'stage'='confirmed' then now() else null end
            where operation_key=$2 and network=$3 and payload_hash=$4 and receipt=$5::jsonb
          `, [next, key, network, hash, current]);
          if (result.rowCount !== 1) throw new Error("Deployment receipt changed");
          current = next;
        }

        active = true;
        const receipt: DeploymentReceipt = current.stage === "reserved" ? { stage: "reserved" }
          : { stage: current.stage, signed: structuredClone(current.signed) };
        await run({
          operationKey: key, release, receipt,
          async stageSigned(input) {
            const signed = signedDeploymentSchema.parse(input);
            if (!active || current.stage !== "reserved") throw new Error("Deployment already has a signed transaction or is unlocked");
            await assertAuthorized();
            if (current.stage !== "reserved") throw new Error("Deployment already has a signed transaction");
            await persist({ jobId, stage: "signed", signed });
            return structuredClone(signed);
          },
          async markUnknown() {
            if (!active || current.stage === "reserved" || current.stage === "confirmed") throw new Error("Deployment is not pending");
            if (current.stage !== "unknown") await persist({ ...current, stage: "unknown" });
          },
          async confirm() {
            if (!active || current.stage === "reserved") throw new Error("Deployment has no signed transaction or is unlocked");
            if (current.stage !== "confirmed") await persist({ ...current, stage: "confirmed" });
          },
        });
        return true;
      } finally {
        active = false;
        try {
          if (locked) await db.query("select pg_advisory_unlock(hashtextextended($1,0))", [lockKey]);
        } finally {
          inUse = false;
        }
      }
    },
  } satisfies PermanentWorker & { enqueue(release: TestDeploymentRelease): Promise<string | null> };

  return store;
}

export async function recoverWorkerJobs(db: Pick<PoolClient, "query">, scope: "test" | "prod") {
  await db.query(`
    update jobs set status='queued',updated_at=now() where status='running'
      and sample_run_id is null and kind='foundation.intake'
  `);
  if (scope === "test") {
    await db.query(`
      update jobs set status='queued', reason=null, updated_at=now()
        where status='running' and sample_run_id is null and kind=$1 and schema_version=1
        and id::text in (
          select receipt->>'jobId' from operation_receipts where network=$2
            and operation_key like 'test:11155420:memorial-erc721-v%'
        )
    `, [permanentDeploymentKind, network]);
  }
  await db.query(`
    update jobs set status='needs_attention',reason='重启后须人工核对',updated_at=now()
      where status='running' and sample_run_id is null
  `);
}
