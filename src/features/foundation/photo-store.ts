import type { PoolClient } from "pg";
import { fileRefSchema } from "@/lib/contracts/intake";
import { evaluateContentPolicy } from "@/lib/policy/content";
import type { ArchiveArtifact } from "@/features/permanent/arlocal";
import type { CurrentPhoto, PhotoWorker } from "@/features/permanent/execute";
import { matchesMintPolicy, photoRecipientVersion, type MintArtifact } from "@/features/permanent/mint";
import type { Artifact, Operation, Stored } from "@/features/permanent/reconcile";
import { readCheckedOriginal } from "./originals";
import { parsePhotoSettings, photoKind, photoSettingsKey, readPhotoSettings } from "./photo-approval";

type Db = Pick<PoolClient, "query">;
const network = "op-sepolia";
const replayReason = "原签名铸造交易已安排一次重播";
export const testSignerLock = "memorial-permanent:memorial_test:op-sepolia";
export type TestPhotoAdapters = Pick<PhotoWorker, "archive" | "mint" | "archiveEnabled" | "mintPolicy"> & {
  syntheticOriginal?(sha256: string): boolean;
};
type CurrentRow = {
  version_id: string;
  approved_version_id: string | null;
  published: boolean;
  public_view: boolean;
  private_export: boolean;
  arweave: boolean;
  nft: boolean;
  exclusion: CurrentPhoto["policy"]["exclusion"];
  recipient_config_version: string | null;
  settings: unknown;
  file_ref: unknown;
};

export function bindTestPhotoWorker(db: Db, root: string, adapters: TestPhotoAdapters, signal: AbortSignal, lockMonitor?: {
  workerKey: string;
  abort(): void;
}, stop?: AbortSignal) {
  const outbound = stop ? AbortSignal.any([signal, stop]) : signal;
  let busy = false;
  let activeItem: string | undefined;
  let lease: symbol | undefined;
  let claim: { jobId: string; versionId: string; claimedAt: string } | undefined;
  const permits = new Map<"archive" | "mint", { artifact: Artifact; replay: boolean }>();

  async function ready(guard = outbound) {
    guard.throwIfAborted();
    const keys = lockMonitor ? [testSignerLock, lockMonitor.workerKey] : [testSignerLock];
    try {
      const { rows: [row] } = await db.query<{ held: boolean }>(`
        select not exists (
          select 1 from unnest($1::text[]) as keys(name)
          cross join lateral (select hashtextextended(keys.name,0) as key) k
          where not exists (
            select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and granted
              and mode='ExclusiveLock' and objsubid=1 and database=(select oid from pg_database where datname=current_database())
              and classid=((k.key >> 32) & 4294967295)::oid and objid=(k.key & 4294967295)::oid
          )
        ) as held
      `, [keys]);
      if (!row?.held) throw new Error("Photo database lock lost");
    } catch (error) {
      lockMonitor?.abort();
      throw error;
    }
    guard.throwIfAborted();
  }

  const currentSql = `
      select v.id as version_id, a.version_id as approved_version_id, coalesce(a.published,false) as published,
        coalesce(a.public_view and r.public_view,false) as public_view,
        coalesce(a.private_export and r.private_export,false) as private_export,
        coalesce(a.arweave and r.arweave,false) as arweave, coalesce(a.nft and r.nft,false) as nft,
        i.exclusion, a.recipient_config_version, settings.value as settings,
        original.file_ref
      from test_photo_jobs binding join jobs job on job.id=binding.archive_job_id
      join items i on i.id=binding.bound_item_id join submissions s on s.id=i.submission_id
      join item_versions original on original.item_id=i.id and original.version=1
      join lateral (select * from item_versions where item_id=i.id order by version desc limit 1) v on true
      join item_usage_rights r on r.item_id=i.id
      join item_version_display d on d.version_id=v.id
        and d.processed_media_ref='memorial/display/' || i.id::text || '/' || v.id::text
      left join approvals a on a.item_id=i.id and a.version_id=v.id and a.source='manual'
      left join site_settings settings on settings.key=$2
      where job.id=$3 and job.status='running' and job.updated_at=$4::timestamptz
        and binding.approved_version_id=v.id and binding.original_ref=original.file_ref
        and i.id=$1 and i.kind='photo' and s.source='stage0-grok' and i.withdrawn_at is null
        and v.file_ref=original.file_ref
        and original.file_ref->>'objectKey'=s.id::text || '/' || i.position::text
        and not exists (select 1 from test_photo_jobs b where b.bound_item_id=i.id
          and b.original_ref is distinct from original.file_ref)
  `;

  async function current(itemId: string) {
    if (activeItem !== itemId || !claim) return null;
    outbound.throwIfAborted();
    const { rows: [row] } = await db.query<CurrentRow>(currentSql,
      [itemId, photoSettingsKey, claim.jobId, claim.claimedAt]);
    outbound.throwIfAborted();
    const file = fileRefSchema.safeParse(row?.file_ref);
    if (!row || !file.success || adapters.syntheticOriginal?.(file.data.sha256) === false) return null;
    const settings = parsePhotoSettings(row.settings);
    const photo: CurrentPhoto = {
      kind: "photo", identity: itemId, objectKey: file.data.objectKey,
      policy: { itemId, currentVersionId: row.version_id, approvedVersionId: row.approved_version_id,
        published: row.published, withdrawn: false, exclusion: row.exclusion,
        usageRights: { publicView: row.public_view, privateExport: row.private_export, arweave: row.arweave, nft: row.nft } },
      revoked: !row.approved_version_id,
      approvedRecipientConfigVersion: row.recipient_config_version,
      currentRecipientConfigVersion: settings?.recipientVersion ?? null,
    };
    return { photo, file: file.data, settings };
  }

  async function operation<T extends Artifact>(
    itemId: string, action: "archive" | "mint",
    fields: (artifact: T) => { version: string; sender?: string; fee?: string },
  ): Promise<Operation<T>> {
    const { rows: [row] } = await db.query<{ state: Stored<Artifact>["state"]; artifact: T }>(
      "select state, artifact from test_photo_receipts where item_id=$1 and action=$2", [itemId, action],
    );
    const lockLease = lease;
    let receipt: Stored<T> | null = row ? { ...row.artifact, state: row.state } : null;
    function present() {
      return receipt && structuredClone(receipt);
    }
    return {
      get receipt() { return present(); },
      async stage(artifact) {
        await ready();
        if (lease !== lockLease || receipt || !claim) throw new Error("Photo receipt unavailable");
        const { version, sender, fee } = fields(artifact);
        const latest = await current(itemId);
        const intent = action === "mint" ? (artifact as unknown as MintArtifact).intent : undefined;
        if (!latest?.settings?.[action] || (action === "mint" && (!intent ||
            photoRecipientVersion(intent.recipient) !== intent.recipientVersion ||
            latest.settings.recipientVersion !== intent.recipientVersion)) ||
            claim.versionId !== version || latest.photo.policy.currentVersionId !== version ||
            !evaluateContentPolicy(latest.photo.policy)[action === "archive" ? "arweave" : "nft"]) {
          throw new Error("Photo eligibility changed");
        }
        const { rows: [saved] } = await db.query<{ artifact: T }>(`
          with current_photo as (${currentSql} for update of job)
          insert into test_photo_receipts (item_id,action,version_id,artifact,sender,reserved_fee)
          select $1,$5,$6,$7,$8,$9 from current_photo
          where version_id=$6 and approved_version_id=$6 and published and exclusion='none'
            and arweave and ($5='archive' or nft)
            and file_ref=$10::jsonb and settings @> $11::jsonb
            and ($5='archive' or recipient_config_version::text=$12)
          returning artifact
        `, [itemId, photoSettingsKey, claim.jobId, claim.claimedAt, action, version, artifact, sender ?? null,
          fee ?? null, latest.file, { [action]: true, ...(intent && { recipientVersion: intent.recipientVersion }) },
          intent?.recipientVersion ?? null]);
        if (!saved) throw new Error("Photo receipt was not stored");
        receipt = { ...saved.artifact, state: "signed" };
        return structuredClone(receipt);
      },
      async attempt() {
        await ready();
        if (lease !== lockLease || receipt?.state !== "signed") throw new Error("Invalid photo transition");
        permits.set(action, { artifact: receipt, replay: false });
      },
      ...(action === "mint" && { async replay() {
        await ready();
        if (lease !== lockLease || receipt?.state !== "attempted" || !claim) return false;
        const { rows: [job] } = await db.query<{ reason: string | null }>(
          "select reason from jobs where id=$1 and updated_at=$2::timestamptz and status='running'",
          [claim.jobId, claim.claimedAt],
        );
        if (job?.reason !== null) return false;
        permits.set(action, { artifact: receipt, replay: true });
        return true;
      } }),
      async confirm() {
        await ready(signal);
        if (lease !== lockLease || !receipt || receipt.state === "confirmed") throw new Error("Invalid photo transition");
        const { rowCount } = await db.query(`
          update test_photo_receipts set state='confirmed', confirmed_at=now()
          where item_id=$1 and action=$2 and state in ('signed','attempted') and artifact->>'id'=$3
        `, [itemId, action, receipt.id]);
        if (rowCount !== 1) throw new Error("Photo transition conflict");
        receipt.state = "confirmed";
      },
    };
  }

  async function send<T extends Artifact, R>(
    action: "archive" | "mint", version: string, artifact: T, submit: (artifact: T) => Promise<R>,
  ) {
    const itemId = activeItem;
    const permit = permits.get(action);
    if (!itemId || !claim || permit?.artifact.id !== artifact.id || permit.artifact.raw !== artifact.raw) {
      throw new Error("Photo send authorization unavailable");
    }
    permits.delete(action);
    outbound.throwIfAborted();
    const intent = action === "mint" ? (artifact as unknown as MintArtifact).intent : undefined;
    const policy = intent ? await adapters.mintPolicy() : null;
    if (intent ? !policy || !matchesMintPolicy(intent, policy) ||
        photoRecipientVersion(policy.recipient) !== policy.recipientVersion : !await adapters.archiveEnabled()) {
      throw new Error("Photo release authorization changed");
    }
    await ready();
    const latest = await current(itemId);
    const settings = latest?.settings;
    if (!latest || !settings?.[action] || claim.versionId !== version ||
        !evaluateContentPolicy(latest.photo.policy)[action === "archive" ? "arweave" : "nft"] ||
        (intent && (settings.recipientVersion !== intent.recipientVersion ||
          settings.recipientVersion !== latest.photo.approvedRecipientConfigVersion))) {
      throw new Error("Photo send authorization changed");
    }

    // Commit the attempt only after the final authorization checks. The write
    // also compares the claim, approval, gate and exact artifact in one snapshot.
    const authorized = `
      with current_photo as (${currentSql}${permit.replay ? '' : ' for update of job'}), authorized as (
        select r.item_id, r.action from current_photo p join test_photo_receipts r
          on r.item_id=$1 and r.action=$5 and r.version_id=p.version_id
        where p.version_id=$6 and p.approved_version_id=$6 and p.published and p.exclusion='none'
          and p.arweave and ($5='archive' or p.nft) and p.file_ref=$7::jsonb and p.settings=$8::jsonb
          and ($5='archive' or p.recipient_config_version::text=$9)
          and r.artifact=$10::jsonb and r.state=$11
      )
    `;
    const params = [itemId, photoSettingsKey, claim.jobId, claim.claimedAt, action, version, latest.file, settings,
      intent?.recipientVersion ?? null, Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "state")),
      permit.replay ? "attempted" : "signed"];
    outbound.throwIfAborted();
    const result = permit.replay
      ? await db.query(authorized + `
        update jobs set reason=$12 where id=$3 and updated_at=$4::timestamptz and status='running'
          and reason is null and exists (select 1 from authorized)
      `, [...params, replayReason])
      : await db.query(authorized + `
        update test_photo_receipts r set state='attempted' from authorized a
        where r.item_id=a.item_id and r.action=a.action and r.state='signed'
      `, params);
    if (result.rowCount !== 1) throw new Error("Photo send authorization changed or replay already used");
    if (outbound.aborted && !signal.aborted && !permit.replay) {
      // Graceful stop after committing the attempt but before calling the adapter.
      await ready(signal);
      const reset = await db.query(`
        update test_photo_receipts set state='signed'
        where item_id=$1 and action=$2 and state='attempted' and artifact->>'id'=$3
      `, [itemId, action, artifact.id]);
      if (reset.rowCount !== 1) throw new Error("Photo attempt reset conflict");
    }
    outbound.throwIfAborted();
    return submit(artifact);
  }

  const worker: PhotoWorker = {
    environment: "test",
    archive: { ...adapters.archive,
      send: (artifact) => send("archive", artifact.versionId, artifact, adapters.archive.send),
    },
    mint: { ...adapters.mint,
      send: (artifact) => send("mint", artifact.intent.versionId, artifact, adapters.mint.send),
    },
    async readCurrent(itemId) {
      await ready();
      return (await current(itemId))?.photo ?? null;
    },
    async archiveEnabled() {
      return Boolean((await readPhotoSettings(db))?.archive && await adapters.archiveEnabled());
    },
    async mintPolicy() {
      const settings = await readPhotoSettings(db);
      const policy = settings?.mint ? await adapters.mintPolicy() : null;
      return policy && settings?.recipientVersion === policy.recipientVersion &&
        photoRecipientVersion(policy.recipient) === policy.recipientVersion ? policy : null;
    },
    async withPhoto(jobId, itemId, run, expectedClaim) {
      if (busy || outbound.aborted) return false;
      busy = true;
      let locked = false;
      try {
        const { rows: [lock] } = await db.query<{ locked: boolean }>(
          "select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [testSignerLock],
        );
        locked = lock?.locked === true;
        if (!locked) return false;
        const { rows: [binding] } = await db.query<{ version_id: string; claimed_at: string }>(`
          select b.approved_version_id as version_id, j.updated_at::text as claimed_at
          from test_photo_jobs b join jobs j on j.id=b.archive_job_id
          where j.id=$1 and b.bound_item_id=$2 and j.kind=$3 and j.status='running'
            and j.schema_version=1 and j.sample_run_id is null and j.payload=jsonb_build_object('itemId',$2::text)
            and ($4::timestamptz is null or j.updated_at=$4::timestamptz)
        `, [jobId, itemId, photoKind, expectedClaim ?? null]);
        if (!binding) throw new Error("Photo job binding unavailable");
        claim = { jobId, versionId: binding.version_id, claimedAt: binding.claimed_at };
        activeItem = itemId;
        lease = Symbol();
        await run({
          identity: itemId, versionId: binding.version_id,
          archive: await operation<ArchiveArtifact>(itemId, "archive", (value) => ({ version: value.versionId })),
          mint: await operation<MintArtifact>(itemId, "mint", ({ intent }) => ({
            version: intent.versionId, sender: intent.sender.toLowerCase(), fee: intent.budget.total,
          })),
          async reservedFees(sender) {
            await ready();
            if (activeItem !== itemId) throw new Error("Photo lock unavailable");
            const { rows: [reserved] } = await db.query<{ total: string; outstanding: boolean; deployment: boolean }>(`
              select coalesce(sum(reserved_fee),0)::text as total, count(*)>0 as outstanding,
                exists (select 1 from operation_receipts where network=$3 and confirmed_at is null
                  and operation_key like 'test:11155420:memorial-erc721-v%'
                  and receipt->>'stage' in ('signed','unknown')
                  and lower(receipt->'signed'->>'deployer')=$1) as deployment
              from test_photo_receipts where sender=$1 and item_id<>$2 and state<>'confirmed'
            `, [sender.toLowerCase(), itemId, network]);
            // Other signed operations may already own this sender's nonce.
            return { total: BigInt(reserved?.total ?? "0"), unknown: !reserved || reserved.outstanding || reserved.deployment };
          },
        });
        return true;
      } finally {
        activeItem = undefined;
        lease = undefined;
        claim = undefined;
        permits.clear();
        try {
          if (locked && !signal.aborted) {
            const { rows: [row] } = await db.query<{ unlocked: boolean }>(
              "select pg_advisory_unlock(hashtextextended($1,0)) as unlocked", [testSignerLock],
            );
            if (!row?.unlocked) throw new Error("Photo database lock lost");
          }
        } catch (error) {
          lockMonitor?.abort();
          throw error;
        } finally {
          busy = false;
        }
      }
    },
  };
  return {
    worker,
    async read(objectKey: string) {
      const latest = activeItem && await current(activeItem);
      if (!latest || latest.file.objectKey !== objectKey || !evaluateContentPolicy(latest.photo.policy).arweave) {
        throw new Error("Original is not authorized");
      }
      return readCheckedOriginal(root, latest.file);
    },
  };
}

/** Preserve the existing deployment lock and prevent a new nonce while a photo mint is unresolved. */
export async function hasUnsettledPhotoMint(db: Db) {
  const { rows: [row] } = await db.query<{ outstanding: boolean }>(
    "select exists (select 1 from test_photo_receipts where action='mint' and state<>'confirmed') as outstanding",
  );
  return row?.outstanding !== false;
}

export async function retryPhotoJobs(db: Db, restart = false) {
  await db.query(`
    update jobs set status='queued', updated_at=now() where kind=$1
      and status='running' and schema_version=1 and sample_run_id is null
      and ($2 or updated_at <= now() - interval '30 seconds')
      and exists (select 1 from test_photo_jobs where archive_job_id=jobs.id)
  `, [photoKind, restart]);
}
