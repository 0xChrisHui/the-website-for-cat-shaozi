import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { del } from "@vercel/blob";
import type { PoolClient } from "pg";
import { z } from "zod";
import { createBlobReader } from "@/lib/adapters/blob";
import { fileRefSchema } from "@/lib/contracts/intake";
import type { JobInput, WorkerContext } from "@/lib/contracts/jobs";
import { readWorkerEnv } from "@/lib/env";
import { assertDatabaseIdentity, queryRows, workerDatabase, type BusinessRow } from "@/lib/supabase/database";
import { handleJob as intake } from "@/features/intake/jobs";
import { handleJob as review } from "@/features/review/jobs";
import { handleJob as permanent } from "@/features/permanent/jobs";
import { handleJob as exports } from "@/features/exports/jobs";
import { checkThresholds, createNotifier } from "./alerts";
import { saveOriginal } from "./originals";

const handlers = new Map([["intake", intake], ["review", review], ["permanent", permanent], ["exports", exports]]);
const payloadSchema = z.object({
  submissionId: z.uuid(),
  items: z.array(z.object({ position: z.number().int().nonnegative(), attachmentRef: fileRefSchema })),
});

async function nextJob(db: PoolClient): Promise<JobInput | null> {
  const [row] = await queryRows<Pick<BusinessRow<"jobs">, "id" | "kind" | "schema_version" | "payload">>(db, `
    update jobs set status = 'running', updated_at = now()
    where id = (select id from jobs where sample_run_id is null and status = 'queued'
      order by created_at, id limit 1 for update skip locked)
    returning id, kind, schema_version, payload
  `);
  return row ? { jobId: row.id, kind: row.kind, schemaVersion: row.schema_version, payload: row.payload } : null;
}

async function processIntake(
  db: PoolClient, job: JobInput, context: WorkerContext, root: string,
  blob: { token: string; host: string; signal: AbortSignal },
) {
  const payload = payloadSchema.parse(job.payload);
  let failed = false;
  for (const { position, attachmentRef: file } of payload.items) {
    const name = String(position);
    const [stored] = await queryRows<{ sha: string }>(db, `
      select v.file_ref->>'sha256' as sha from items i join item_versions v on v.item_id=i.id
      where i.submission_id=$1 and i.position=$2 and v.version=1
    `, [payload.submissionId, position]);
    if (stored?.sha !== file.sha256) {
      try {
        await saveOriginal(join(root, payload.submissionId), name, await context.files.read(file.objectKey), file);
      } catch {
        failed = true;
        continue;
      }
      await db.query("begin");
      try {
        const row = await db.query<Pick<BusinessRow<"items">, "id">>(
          "insert into items(submission_id,position,kind) values($1,$2,'photo') returning id", [payload.submissionId, position],
        );
        await db.query("insert into item_versions(item_id,version,file_ref) values($1,1,$2)",
          [row.rows[0]?.id, { ...file, objectKey: payload.submissionId + "/" + name }]);
        await db.query("commit");
      } catch (error) {
        await db.query("rollback").catch(() => undefined);
        throw error;
      }
    }
    await db.query("select 1");
    await del("https://" + blob.host + "/" + file.objectKey, { token: blob.token, abortSignal: AbortSignal.any([blob.signal, AbortSignal.timeout(10_000)]) }).catch(() => {
      console.warn("暂存清理失败，等待对象到期");
    });
  }
  await context.jobs.finish(job.jobId, failed ? "一项或多项原件校验失败" : undefined);
}

async function worker() {
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
    await connection.query(`
      update jobs set status='queued',updated_at=now() where status='running'
        and sample_run_id is null and kind='foundation.intake'
    `);
    await connection.query(`
      update jobs set status='needs_attention',reason='重启后须人工核对',updated_at=now()
        where status='running' and sample_run_id is null
    `);
    let nextHealthCheck = 0;
    while (!stop.signal.aborted) {
      if (Date.now() >= nextHealthCheck) {
        nextHealthCheck = Date.now() + 15 * 60 * 1000;
        await checkThresholds(env, notify).catch(() => console.warn("工作器巡检失败"));
      }
      const job = await nextJob(connection);
      if (!job) {
        await delay(2000, undefined, { signal: stop.signal }).catch(() => undefined);
        continue;
      }
      if (job.schemaVersion !== 1) {
        await context.jobs.finish(job.jobId, "不支持的任务版本");
      } else if (job.kind === "foundation.intake") {
        if (env.instance !== "test" || !env.BLOB_READ_WRITE_TOKEN || !env.BLOB_STORE_HOST) {
          await context.jobs.finish(job.jobId, "样板工作器配置缺失");
        } else {
          await processIntake(connection, job, context, root, { token: env.BLOB_READ_WRITE_TOKEN, host: env.BLOB_STORE_HOST, signal: lostConnection.signal });
        }
      } else {
        const handler = handlers.get(job.kind.split(".")[0] ?? "");
        if (handler) await handler(job, context);
        else await context.jobs.finish(job.jobId, "不支持的任务类型");
      }
    }
    if (!healthy) throw new Error("Worker connection lost");
  } finally {
    connection.release(true);
    await pool.end();
  }
}

worker().catch(() => {
  console.error("工作器已停止，请检查连接、配置和在途任务");
  process.exitCode = 1;
});
