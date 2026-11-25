import { setTimeout as delay } from "node:timers/promises";
import { del } from "@vercel/blob";
import type { PoolClient } from "pg";
import { createBlobReader } from "@/lib/adapters/blob";
import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import { permanentDeploymentKind, type TestDeploymentReleaseSource } from "@/lib/contracts/permanent";
import { readWorkerEnv } from "@/lib/env";
import { assertDatabaseIdentity, queryRows, workerDatabase, type BusinessRow } from "@/lib/supabase/database";
import { handleJob as intake } from "@/features/intake/jobs";
import { handleJob as review } from "@/features/review/jobs";
import * as permanentJobs from "@/features/permanent/jobs";
import { handleJob as exports } from "@/features/exports/jobs";
import { checkThresholds, createNotifier } from "./alerts";
import { bindIntakeOriginals } from "./intake-originals";
import { enqueueTestDeployment, readTestDeploymentRelease } from "./permanent-release";
import { createPermanentStore, DeploymentUnavailable, recoverWorkerJobs } from "./permanent-store";

const permanentModule: {
  handleJob: typeof permanentJobs.handleJob;
  createDeploymentReleaseSource?: () => TestDeploymentReleaseSource;
} = permanentJobs;
const permanent = permanentModule.handleJob;

const handlers = new Map([["intake", intake], ["review", review], ["permanent", permanent], ["exports", exports]]);

async function nextJob(db: PoolClient): Promise<JobInput | null> {
  const [row] = await queryRows<Pick<BusinessRow<"jobs">, "id" | "kind" | "schema_version" | "payload">>(db, `
    update jobs set status = 'running', updated_at = now()
    where id = (select id from jobs where sample_run_id is null and status = 'queued'
      order by created_at, id limit 1 for update skip locked)
    returning id, kind, schema_version, payload
  `);
  return row ? { jobId: row.id, kind: row.kind, schemaVersion: row.schema_version, payload: row.payload } : null;
}

export async function runWorker(injectedReleaseSource?: TestDeploymentReleaseSource) {
  const env = readWorkerEnv();
  if (!env.WORKER_FILE_ROOT || !env.WORKER_FILE_ROOT.startsWith("/")) throw new Error("WORKER_FILE_ROOT");
  const root = env.WORKER_FILE_ROOT;
  const { pool, role, schema } = workerDatabase();
  const connection = await pool.connect();
  let healthy = true;
  const stop = new AbortController();
  const lostConnection = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  process.once("SIGINT", () => stop.abort());
  connection.on("error", () => { healthy = false; lostConnection.abort(); stop.abort(); });
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
  try {
    await assertDatabaseIdentity(connection, role, schema);
    const lock = await connection.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1,0)) as locked", ["memorial-worker:" + schema],
    );
    if (!lock.rows[0]?.locked) throw new Error("Worker already running");
    const releaseSource = env.instance === "test"
      ? injectedReleaseSource ?? permanentModule.createDeploymentReleaseSource?.()
      : undefined;
    const deployment = createPermanentStore(connection, env.instance,
      releaseSource && (() => readTestDeploymentRelease(releaseSource)));
    await recoverWorkerJobs(connection, env.instance);
    let nextReleaseCheck = 0;
    let nextHealthCheck = 0;
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
      const job = await nextJob(connection);
      if (!job) {
        await delay(2000, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      if (job.schemaVersion !== 1) {
        await context.jobs.finish(job.jobId, "不支持的任务版本");
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
        if (job.kind === permanentDeploymentKind) {
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
