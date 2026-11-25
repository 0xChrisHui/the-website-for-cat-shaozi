import type { PoolClient } from "pg";
import { exportRequestSchema } from "@/lib/contracts/exports";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import type { JobSummary } from "@/lib/contracts/jobs";
import { evaluateContentPolicy } from "@/lib/policy/content";
import { queryRows } from "@/lib/supabase/database";
import { sampleEvent, sampleSource } from "@/features/public/media-key";

export const privateExportKind = "exports.private-zip";
type SampleRun = string | null;
interface Version { itemId: string; versionId: string }
export interface ExportClaim {
  readonly jobId: string;
  readonly objectKey: string;
  readonly versions: readonly Version[];
}

const maxExportItems = 500;
const scopeMatch = "sample_run_id is not distinct from $1::uuid";
type ExportObject = {
  job_id: string;
  object_key: string;
  state: "reserved" | "current" | "cleanup";
  versions: Version[];
  mock_bytes: Buffer | null;
  upload_settled: boolean;
};

// Every operation takes this transaction lock. Writers take it before any item locks.
export async function lockExportScope(db: PoolClient, sample: SampleRun) {
  await db.query(
    "select pg_advisory_xact_lock(hashtextextended(current_schema() || ':private-export:' || coalesce($1::uuid::text, 'real'), 0))",
    [sample],
  );
  await db.query("select set_config('memorial.sample_run_id', coalesce($1::uuid::text, ''), true)", [sample]);
}

type Candidate = Version & {
  approved: string | null;
  exclusion: "none" | "explicit" | "ambiguous";
  allowed: boolean | null;
  kind: "photo" | "diary";
  submission_id: string;
  position: number;
  caption: string | null;
  processed_media_ref: string | null;
  file_ref: unknown;
  diary_text: string | null;
};

async function authorizedRows(db: PoolClient, sample: SampleRun, includeContent = false) {
  const rows = await queryRows<Candidate>(db, `
    with eligible as materialized (
      select i.id as "itemId", v.id as "versionId", a.version_id as approved, i.exclusion,
        a.private_export and r.private_export as allowed
        ${includeContent ? ", i.kind, i.submission_id, i.position" : ""}
      from submissions s join items i on i.submission_id=s.id
      join lateral (select id from item_versions where item_id=i.id order by version desc limit 1) v on true
      join approvals a on a.item_id=i.id and a.version_id=v.id
      join item_usage_rights r on r.item_id=i.id
      where s.source=$1 and ($2::text is null or s.event_id=$2) and i.withdrawn_at is null
        and i.exclusion in ('none', 'explicit') and a.private_export and r.private_export
      order by i.id
      limit $3
    )
    select e.*
      ${includeContent ? ", d.caption, d.processed_media_ref, v.file_ref, v.diary_text" : ""}
    from eligible e
    ${includeContent ? `
      left join item_versions v on v.id=e."versionId" and (select count(*) from eligible) < $3
      left join item_version_display d on d.version_id=v.id
    ` : ""}
    order by e."itemId"
  `, [sample ? sampleSource : stage0IntakeSource, sample ? sampleEvent(sample) : null, maxExportItems + 1]);
  return rows.filter((row) => evaluateContentPolicy({
    itemId: row.itemId, currentVersionId: row.versionId, approvedVersionId: row.approved,
    exclusion: row.exclusion, withdrawn: false, published: false,
    usageRights: { privateExport: row.allowed === true, publicView: false, nft: false, arweave: false },
  }).privateExport);
}

async function authorizedVersions(db: PoolClient, sample: SampleRun) {
  return (await authorizedRows(db, sample)).map(({ itemId, versionId }) => ({ itemId, versionId }));
}

function sameVersions(left: readonly Version[], right: readonly Version[]) {
  return left.length === right.length && left.every((version, index) =>
    version.itemId === right[index]?.itemId && version.versionId === right[index]?.versionId);
}

export async function invalidateExport(db: PoolClient, sample: SampleRun) {
  await lockExportScope(db, sample);
  if (sample === null) {
    // Also retire any pointer written before the reservation table existed.
    await db.query(`
      insert into private_export_objects (job_id, object_key, state, upload_settled)
      select job_id, object_key, 'cleanup', true from current_export where downloadable
      on conflict (job_id) do nothing
    `);
    await db.query("update current_export set downloadable=false where downloadable");
  }
  await db.query(`update private_export_objects set state='cleanup'
    where ${scopeMatch} and state in ('reserved', 'current')`, [sample]);
  if (sample !== null) {
    await db.query(`delete from private_export_objects where ${scopeMatch} and state='cleanup'`, [sample]);
  }
  await db.query(`update jobs set status='needs_attention', reason='导出已失效', updated_at=now()
    where ${scopeMatch} and kind=$2 and status in ('queued', 'running')`, [sample, privateExportKind]);
}

export async function withExportMutation<T>(
  db: PoolClient, sample: SampleRun, mutate: () => Promise<{ value: T; exportChanged: boolean }>,
) {
  await lockExportScope(db, sample);
  const { value, exportChanged } = await mutate();
  if (exportChanged) await invalidateExport(db, sample);
  return value;
}

type Job = { id: string; status: JobSummary["status"]; created_at: Date; updated_at: Date; reason: string | null };
const jobFields = "id, status, created_at, updated_at, reason";

export async function requestExport(db: PoolClient, sample: SampleRun, requestId: string): Promise<JobSummary> {
  exportRequestSchema.parse({ requestId });
  await lockExportScope(db, sample);
  let [job] = await queryRows<Job & { seen?: boolean }>(db, `select ${jobFields}, payload->'requestIds' ? $3 as seen
    from jobs where ${scopeMatch} and kind=$2
      and (payload->'requestIds' ? $3 or status in ('queued', 'running'))
    order by seen desc nulls last limit 1`, [sample, privateExportKind, requestId]);
  if (!job) {
    await invalidateExport(db, sample);
    [job] = await queryRows<Job>(db, `
      insert into jobs (kind, sample_run_id, payload, status)
      values ($2,$1,jsonb_build_object('requestIds',jsonb_build_array($3::text)),'queued')
      returning ${jobFields}`, [sample, privateExportKind, requestId]);
  } else if (!job.seen) {
    // A coalesced request can also lose its response. Keep its idempotency key on the job.
    await db.query(`update jobs set payload=jsonb_set(payload, '{requestIds}',
      coalesce(payload->'requestIds','[]'::jsonb) || jsonb_build_array($2::text)) where id=$1`, [job.id, requestId]);
  }
  if (!job) throw new Error("Export request unavailable");
  return {
    jobId: job.id, status: job.status, createdAt: job.created_at.toISOString(),
    updatedAt: job.updated_at.toISOString(), reason: job.reason ?? undefined,
  };
}

export async function claimExport(db: PoolClient, sample: SampleRun): Promise<ExportClaim | null> {
  await lockExportScope(db, sample);
  const [job] = await queryRows<{ id: string }>(db, `update jobs set status='running', updated_at=now()
    where id=(select id from jobs where ${scopeMatch} and kind=$2 and schema_version=1 and status='queued')
    returning id`, [sample, privateExportKind]);
  if (!job) return null;

  const versions = await authorizedVersions(db, sample);
  if (versions.length > maxExportItems) {
    await db.query("update jobs set status='needs_attention', reason='导出条目超过上限', updated_at=now() where id=$1", [job.id]);
    return null;
  }
  const objectKey = sample
    ? `memorial/sample-export/${sample}/${job.id}`
    : `exports/private/${job.id}.zip`;
  await db.query(`insert into private_export_objects (sample_run_id, job_id, object_key, state, versions)
    values ($1,$2,$3,'reserved',$4::jsonb)`, [sample, job.id, objectKey, JSON.stringify(versions)]);
  return { jobId: job.id, objectKey, versions };
}

export async function currentExport(db: PoolClient, sample: SampleRun) {
  await lockExportScope(db, sample);
  const [row] = await queryRows<ExportObject>(db, `select job_id, object_key, versions, mock_bytes
    from private_export_objects where ${scopeMatch} and state='current'
      and ($1::uuid is not null or exists (select 1 from current_export c
        where c.job_id=private_export_objects.job_id and c.object_key=private_export_objects.object_key and c.downloadable))
  `, [sample]);
  if (!row || !sameVersions(row.versions, await authorizedVersions(db, sample))) return null;
  const pointer = { jobId: row.job_id, objectKey: row.object_key };
  if (sample === null) return { ...pointer, mode: "private" as const, mockBytes: null };
  return row.mock_bytes ? { ...pointer, mode: "mock" as const, mockBytes: row.mock_bytes } : null;
}

// Supplies content only while the exact reserved generation is still authorized.
export async function recheckExport(db: PoolClient, sample: SampleRun, claim: ExportClaim) {
  await lockExportScope(db, sample);
  const [row] = await queryRows<ExportObject>(db, `select versions from private_export_objects
    where ${scopeMatch} and job_id=$2 and object_key=$3 and state='reserved'
    and exists (select 1 from jobs where id=$2 and kind=$4 and status='running')
  `, [sample, claim.jobId, claim.objectKey, privateExportKind]);
  if (!row || row.versions.length > maxExportItems || !sameVersions(row.versions, claim.versions)) return null;
  const candidates = await authorizedRows(db, sample, true);
  return sameVersions(row.versions, candidates) ? candidates : null;
}

export async function publishExport(db: PoolClient, sample: SampleRun, claim: ExportClaim, mockBytes?: Buffer) {
  if ((sample !== null) !== (mockBytes !== undefined)) throw new Error("Export storage scope mismatch");
  await lockExportScope(db, sample);
  const [row] = await queryRows<ExportObject>(db, `select state, versions from private_export_objects
    where ${scopeMatch} and job_id=$2 and object_key=$3`, [sample, claim.jobId, claim.objectKey]);
  if (!row || row.state === "cleanup" || !sameVersions(row.versions, claim.versions)) return false;
  if (row.state === "current") {
    return (await currentExport(db, sample))?.jobId === claim.jobId;
  }
  if (!sameVersions(row.versions, await authorizedVersions(db, sample))) return false;
  const job = await db.query(`update jobs set status='done', updated_at=now()
    where ${scopeMatch} and id=$2 and kind=$3 and schema_version=1 and status='running'`, [sample, claim.jobId, privateExportKind]);
  if (job.rowCount !== 1) return false;

  if (sample === null) {
    await db.query(`
      insert into current_export (job_id, object_key, downloadable) values ($1,$2,true)
      on conflict (singleton) do update set job_id=excluded.job_id, object_key=excluded.object_key, downloadable=true
    `, [claim.jobId, claim.objectKey]);
    await db.query("update private_export_objects set state='current', upload_settled=true where job_id=$1", [claim.jobId]);
  } else {
    await db.query("update private_export_objects set state='current', mock_bytes=$2 where job_id=$1", [claim.jobId, mockBytes]);
  }
  return true;
}

export async function failExport(db: PoolClient, sample: SampleRun, claim: ExportClaim, uploadSettled = false) {
  await lockExportScope(db, sample);
  const retired = await (sample === null
    ? db.query(`update private_export_objects set state='cleanup', upload_settled=upload_settled or $4
        where ${scopeMatch} and job_id=$2 and object_key=$3 and state in ('reserved','cleanup')`,
      [sample, claim.jobId, claim.objectKey, uploadSettled])
    : db.query(`delete from private_export_objects
        where ${scopeMatch} and job_id=$2 and object_key=$3 and state='reserved'`, [sample, claim.jobId, claim.objectKey]));

  if (!retired.rowCount) return;
  await db.query(`update jobs set status='needs_attention', reason='导出未完成', updated_at=now()
    where ${scopeMatch} and id=$2 and kind=$3 and status='running'`, [sample, claim.jobId, privateExportKind]);
}

type ExportTransaction = <T>(run: (db: PoolClient) => Promise<T>) => Promise<T>;

// Call under the existing worker session lock after all uploads have settled.
export async function cleanupExport(transaction: ExportTransaction, remove: (objectKey: string) => Promise<void>) {
  const row = await transaction(async (db) => {
    await lockExportScope(db, null);
    const [candidate] = await queryRows<ExportObject>(db, `
      update private_export_objects set state='cleanup', cleanup_after=now() + interval '30 seconds' where job_id=(
        select o.job_id from private_export_objects o
        where o.sample_run_id is null and o.cleanup_after <= now() and (o.state='cleanup' or (o.state='reserved' and exists
          (select 1 from jobs where id=o.job_id and status='needs_attention')))
          and not exists (select 1 from current_export where downloadable and object_key=o.object_key)
        order by o.cleanup_after, o.job_id limit 1
      ) returning job_id, object_key, upload_settled
    `);
    return candidate;
  });
  if (!row) return false;
  // State 'cleanup' cannot become 'current'. Do not hold the scope lock during Blob I/O.
  await remove(row.object_key);
  await transaction(async (db) => {
    await lockExportScope(db, null);
    if (row.upload_settled) {
      await db.query("delete from private_export_objects where job_id=$1 and state='cleanup'", [row.job_id]);
    } else {
      // A restarted worker may observe absence before an interrupted upload materializes.
      await db.query(`update private_export_objects set cleanup_after=now() + interval '1 hour'
        where job_id=$1 and state='cleanup'`, [row.job_id]);
    }
  });
  return true;
}
