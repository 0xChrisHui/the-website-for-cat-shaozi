import { setTimeout as delay } from "node:timers/promises";
import { del } from "@vercel/blob";
import type { PoolClient } from "pg";
import { createBlobReader } from "@/lib/adapters/blob";
import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import { permanentDeploymentKind, type TestDeploymentReleaseSource } from "@/lib/contracts/permanent";
import { readWorkerEnv } from "@/lib/env";
import { assertDatabaseIdentity, queryRows, workerDatabase, type BusinessRow } from "@/lib/supabase/database";
import { displayJobKind, prepareReviewDisplay, reviewDisplayBlob } from "@/features/intake/review-display";
import { handleJob as intake } from "@/features/intake/jobs";
import { handleJob as review } from "@/features/review/jobs";
import * as permanentJobs from "@/features/permanent/jobs";
import { privateExportBlob } from "@/features/exports/blob";
import { handleJob as exports } from "@/features/exports/jobs";
import { checkThresholds, createNotifier } from "./alerts";
import { bindIntakeOriginals } from "./intake-originals";
import { enqueueTestDeployment, readTestDeploymentRelease } from "./permanent-release";
import {
  claimExport, cleanupExport, failExport, lockExportScope, privateExportKind, publishExport, recheckExport,
} from "./private-export";
import { createPermanentStore, DeploymentUnavailable, recoverWorkerJobs } from "./permanent-store";

import { photoKind } from "./photo-approval";
import { bindTestPhotoWorker, hasUnsettledPhotoMint, retryPhotoJobs, type TestPhotoAdapters } from "./photo-store";

const permanentModule: {
  handleJob: typeof permanentJobs.handleJob;
  createDeploymentReleaseSource?: () => TestDeploymentReleaseSource;
} = permanentJobs;
const permanent = permanentModule.handleJob;

const handlers = new Map([["intake", intake], ["review", review], ["permanent", permanent], ["exports", exports]]);

async function nextJob(db: PoolClient, photoEnabled: boolean, test: boolean): Promise<{ job: JobInput; claimedAt: string } | null> {
  const [row] = await queryRows<Pick<BusinessRow<"jobs">, "id" | "kind" | "schema_version" | "payload"> & { claimed_at: string }>(db, `
    update jobs set status = 'running', updated_at = case when kind=$2 then clock_timestamp() else now() end
    where id = (select id from jobs where sample_run_id is null and status = 'queued' and kind <> $3 and ($1 or kind<>$2)
      and ($4 or kind<>$5)
      order by created_at, id limit 1 for update skip locked)
    returning id, kind, schema_version, payload, updated_at::text as claimed_at
  `, [photoEnabled, photoKind, privateExportKind, test, displayJobKind]);
  return row ? {
    job: { jobId: row.id, kind: row.kind, schemaVersion: row.schema_version, payload: row.payload },
    claimedAt: row.claimed_at,
  } : null;
}

export async function runWorker(
  injectedReleaseSource?: TestDeploymentReleaseSource,
  photoAdapters?: (outboundSignal: AbortSignal) => TestPhotoAdapters,
) {
  const env = readWorkerEnv();
  if (!env.WORKER_FILE_ROOT || !env.WORKER_FILE_ROOT.startsWith("/")) throw new Error("WORKER_FILE_ROOT");
  const root = env.WORKER_FILE_ROOT;
  const { pool, role, schema } = workerDatabase();
  const connection = await pool.connect();
  let healthy = true;
  const stop = new AbortController();
  const lostConnection = new AbortController();
  const photoSignal = AbortSignal.any([lostConnection.signal, stop.signal]);
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  function abortConnection() {
    healthy = false;
    lostConnection.abort();
    stop.abort();
  }
  connection.on("error", abortConnection);
  connection.on("end", abortConnection);
  const notify = createNotifier(env);
  const blob = createBlobReader({ token: env.BLOB_READ_WRITE_TOKEN, storeHost: env.BLOB_STORE_HOST, mock: false, signal: lostConnection.signal });
  const context: WorkerContext = {
    files: { async read(key) {
      if (!healthy) throw new Error("Worker connection lost");
      await connection.query("select 1");
      return blob.read(key);
    } },
    jobs: { async finish(id, reason) {
      if (!healthy) throw new Error("Worker connection lost");
      await connection.query("update jobs set status=$2, reason=$3, updated_at=now() where id=$1 and sample_run_id is null",
        [id, reason ? "needs_attention" : "done", reason ?? null]);
    } },
    clock: () => new Date(),
  };
  async function transaction<T>(run: (db: PoolClient) => Promise<T>) {
    if (!healthy) throw new Error("Worker connection lost");
    await connection.query("begin");
    try {
      const result = await run(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback").catch(() => undefined);
      throw error;
    }
  }

  const { BLOB_READ_WRITE_TOKEN: exportToken, BLOB_STORE_HOST: exportHost } = env;
  async function removeExport(key: string) {
    if (!exportToken || !exportHost) throw new Error("Export cleanup configuration");
    const signal = AbortSignal.any([lostConnection.signal, AbortSignal.timeout(10_000)]);
    await privateExportBlob(exportToken, exportHost).removeAndConfirm(key, signal);
  }

  try {
    await assertDatabaseIdentity(connection, role, schema);
    const workerKey = "memorial-worker:" + schema;
    const lock = await connection.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1,0)) as locked", [workerKey],
    );
    if (!lock.rows[0]?.locked) throw new Error("Worker already running");
    const releaseSource = env.instance === "test"
      ? injectedReleaseSource ?? permanentModule.createDeploymentReleaseSource?.()
      : undefined;
    const adapters = env.instance === "test"
      ? await (photoAdapters ?? (await import("@/features/permanent/photo-bootstrap")).createTestPhotoAdapters)(photoSignal)
      : undefined;
    const photo = adapters && bindTestPhotoWorker(connection, root, adapters, lostConnection.signal,
      { workerKey, abort: abortConnection }, stop.signal);
    const deployment = createPermanentStore(connection, env.instance,
      releaseSource && (() => readTestDeploymentRelease(releaseSource)),
      env.instance === "test" ? () => hasUnsettledPhotoMint(connection) : undefined);
    await transaction(async (db) => {
      await lockExportScope(db, null);
      if (env.instance === "test") {
        await retryPhotoJobs(db, true);
        await db.query(`update jobs set status='queued', reason=null, updated_at=now()
          where kind=$1 and schema_version=1 and sample_run_id is null and status='running'`, [displayJobKind]);
      }
      await recoverWorkerJobs(db, env.instance);
    });
    let nextReleaseCheck = 0;
    let nextHealthCheck = 0;
    let nextExportCleanup = 0;
    while (!stop.signal.aborted) {
      if (Date.now() >= nextHealthCheck) {
        nextHealthCheck = Date.now() + 15 * 60 * 1000;
        await checkThresholds(env, notify).catch(() => console.warn("工作器巡检失败"));
      }
      if (deployment && releaseSource && Date.now() >= nextReleaseCheck) {
        nextReleaseCheck = Date.now() + 60_000;
        await enqueueTestDeployment(env.instance, releaseSource, deployment.enqueue)
          .catch(() => console.warn("测试部署发布核对失败"));
      }
      if (stop.signal.aborted) break;
      if (Date.now() >= nextExportCleanup) {
        try {
          const removed = await cleanupExport(transaction, removeExport);
          nextExportCleanup = Date.now() + (removed ? 0 : 2000);
        } catch {
          if (!healthy) throw new Error("Worker connection lost");
          nextExportCleanup = Date.now() + 2000;
          console.warn("导出对象清理待重试");
        }
      }
      const claim = await transaction((db) => claimExport(db, null));
      if (claim) {
        let uploadSettled = false;
        try {
          await exports({ jobId: claim.jobId, kind: privateExportKind, schemaVersion: 1, payload: {} }, {
            ...context,
            jobs: { finish: async () => transaction((db) => failExport(db, null, claim)) },
            privateExport: {
              claim,
              signal: lostConnection.signal,
              recheck: () => transaction((db) => recheckExport(db, null, claim)),
              publish: () => transaction((db) => publishExport(db, null, claim)),
            },
          });
          uploadSettled = true;
        } catch {
          console.warn("导出生成待核对");
        }
        // A committed publish survives even when the handler did not receive its response.
        await transaction((db) => failExport(db, null, claim, uploadSettled));
      }
      if (photo) await retryPhotoJobs(connection);
      if (stop.signal.aborted) break;
      const claimed = await nextJob(connection, Boolean(photo), env.instance === "test");
      if (!claimed) {
        await delay(2000, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      const { job, claimedAt } = claimed;
      if (job.schemaVersion !== 1) {
        await context.jobs.finish(job.jobId, "不支持的任务版本");
      } else if (job.kind === displayJobKind) {
        const { BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = env;
        let reason: string | undefined;
        try {
          if (env.instance !== "test" || !token || !host) throw new Error("Review Blob unavailable");
          await prepareReviewDisplay(connection, job.payload, root, reviewDisplayBlob(token, host), photoSignal);
        } catch {
          reason = "展示副本准备失败，可在审核页重试";
        }
        if (!stop.signal.aborted) await context.jobs.finish(job.jobId, reason);
      } else if (job.kind === "foundation.intake") {
        const { BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = env;
        if (env.instance !== "test" || !token || !host) {
          await context.jobs.finish(job.jobId, "样板工作器配置缺失");
          continue;
        }
        const originals = bindIntakeOriginals(connection, job.payload, root, {
          read: (key) => context.files.read(key),
          async remove(key) {
            await del("https://" + host + "/" + key, {
              token, abortSignal: AbortSignal.any([lostConnection.signal, AbortSignal.timeout(10_000)]),
            });
          },
        });
        if (!originals) {
          await context.jobs.finish(job.jobId, "原件任务参数无效");
          continue;
        }
        const results = await originals.persistPhotos();
        const failed = results.some(({ status }) => status === "source_failed" || status === "conflict");
        await context.jobs.finish(job.jobId, failed ? "一项或多项原件校验失败" : undefined);
      } else {
        const handler = handlers.get(job.kind.split(".")[0] ?? "");
        if (job.kind === photoKind && photo) {
          try {
            await permanent(job, {
              ...context,
              permanentPhoto: {
                ...photo.worker,
                withPhoto: (id, item, run) => photo.worker.withPhoto(id, item, run, claimedAt),
              },
              files: { read: photo.read },
              jobs: { async finish(id, reason) {
                if (!healthy) throw new Error("Worker connection lost");
                await connection.query(`
                  update jobs set status=$2, reason=$3, updated_at=now()
                  where id=$1 and status='running' and updated_at=$4::timestamptz and sample_run_id is null
                `, [id, reason ? "needs_attention" : "done", reason ?? null, claimedAt]);
              } },
            });
          } catch (error) {
            if (!healthy || !stop.signal.aborted) throw error;
          }
        } else if (job.kind === permanentDeploymentKind) {
          if (deployment) {
            try {
              await permanent(job, { ...context, permanent: { withDeployment: deployment.withDeployment } });
            } catch (error) {
              if (!(error instanceof DeploymentUnavailable)) throw error;
              await context.jobs.finish(job.jobId, "部署发布证据或持久凭证不可用");
            }
          } else {
            await context.jobs.finish(job.jobId, "测试部署任务仅支持测试环境");
          }
        } else if (handler) await handler(job, context);
        else await context.jobs.finish(job.jobId, "不支持的任务类型");
      }
    }
    if (!healthy) throw new Error("Worker connection lost");
  } finally {
    connection.release(true);
    await pool.end();
  }
}

if (import.meta.main) runWorker().catch(() => {
  console.error("工作器已停止，请检查连接、配置和在途任务");
  process.exitCode = 1;
});
