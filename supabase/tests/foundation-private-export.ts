import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { recoverWorkerJobs } from "../../src/features/foundation/permanent-store";
import { claimExport, cleanupExport, currentExport, failExport, publishExport, recheckExport, requestExport, withExportMutation } from "../../src/features/foundation/private-export";

const socket = process.argv[2];
assert(socket?.startsWith("/tmp/"));
const pool = new pg.Pool({ host: socket, user: process.env.PGUSER, database: "postgres", port: 5432 });
const real = null;
const sample = randomUUID();

async function transaction<T>(actor: "web" | "worker", run: (db: PoolClient) => Promise<T>, loseCommit = false) {
  const db = await pool.connect();
  try {
    await db.query("begin");
    await db.query(actor === "web" ? "set local role test_web" : "set local role test_worker");
    await db.query("set local search_path = memorial_test, pg_catalog");
    const result = await run(db);
    await db.query("commit");
    if (loseCommit) throw new Error("simulated lost commit response");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    db.release();
  }
}

function workerTransaction<T>(run: (db: PoolClient) => Promise<T>) {
  return transaction("worker", run);
}

async function seed() {
  return transaction("web", async (db) => {
    const submission = await db.query<{ id: string }>(
      "insert into submissions (event_id,sender_hash,received_at,source) values ($1,$2,now(),'stage0-grok') returning id",
      [randomUUID(), "1".repeat(64)],
    );
    assert(submission.rows[0]);
    const items = await db.query<{ id: string }>(
      "insert into items (submission_id,position,kind) values ($1,0,'diary') returning id", [submission.rows[0].id],
    );
    assert(items.rows[0]);
    const id = items.rows[0].id;
    const versions = await db.query<{ id: string }>(
      "insert into item_versions (item_id,version,diary_text) values ($1,1,'Synthetic') returning id", [id],
    );
    assert(versions.rows[0]);
    const version = versions.rows[0].id;
    await db.query("insert into item_usage_rights (item_id,private_export) values ($1,true)", [id]);
    await db.query("insert into approvals (item_id,version_id,source,private_export) values ($1,$2,'manual',true)", [id, version]);
    return { itemId: id, versionId: version };
  });
}

try {
  const item = await seed();
  const requestId = randomUUID();
  const coalescedId = randomUUID();
  const requested = await Promise.all([requestId, coalescedId].map((id) =>
    transaction("web", (db) => requestExport(db, real, id))));
  assert.equal(requested[0]?.jobId, requested[1]?.jobId);
  const claims = (await Promise.all([1, 2].map(() => transaction("worker", (db) => claimExport(db, real)))))
    .filter((claim) => claim !== null);
  assert.equal(claims.length, 1);
  const [first] = claims;
  assert(first);
  assert.deepEqual(first.versions, [item]);
  assert.equal((await transaction("worker", (db) => recheckExport(db, real, first)))?.[0]?.diary_text, "Synthetic");

  const objects = new Set([first.objectKey]);
  const remove = async (key: string) => { objects.delete(key); };
  await assert.rejects(transaction("worker", (db) => publishExport(db, real, first), true), /lost commit response/);
  await transaction("worker", (db) => failExport(db, real, first));
  assert.equal(await cleanupExport(workerTransaction, remove), false);
  assert.equal((await transaction("web", (db) => currentExport(db, real)))?.objectKey, first.objectKey);
  assert.equal(await transaction("worker", (db) => publishExport(db, real, first)), true);
  assert(objects.has(first.objectKey));
  assert.equal((await transaction("web", (db) => requestExport(db, real, coalescedId))).jobId, first.jobId);

  async function withdraw(db: PoolClient, itemId: string) {
    await withExportMutation(db, real, async () => {
      const updated = await db.query("update items set withdrawn_at=now() where id=$1", [itemId]);
      return { value: undefined, exportChanged: updated.rowCount === 1 };
    });
  }

  await assert.rejects(transaction("web", async (db) => {
    await withdraw(db, item.itemId);
    throw new Error("synthetic mutation rollback");
  }), /mutation rollback/);
  assert.equal((await transaction("web", (db) => currentExport(db, real)))?.objectKey, first.objectKey);
  await transaction("web", (db) => withdraw(db, item.itemId));
  assert.equal(await transaction("web", (db) => currentExport(db, real)), null);
  assert(objects.has(first.objectKey));

  const nextItem = await seed();
  await transaction("web", (db) => requestExport(db, real, randomUUID()));
  const second = await transaction("worker", (db) => claimExport(db, real));
  assert(second);
  objects.add(second.objectKey);
  assert.equal(await transaction("worker", (db) => publishExport(db, real, {
    ...second, versions: [item],
  })), false);
  await transaction("web", (db) => withdraw(db, nextItem.itemId));
  assert.equal(await transaction("worker", (db) => publishExport(db, real, second)), false);
  await transaction("worker", (db) => failExport(db, real, second, true));
  assert.equal(await transaction("worker", (db) => publishExport(db, real, first)), false);
  assert.equal(await transaction("web", (db) => currentExport(db, real)), null);
  assert.equal(objects.size, 2);
  await assert.rejects(cleanupExport(workerTransaction, async () => {
    throw new Error("synthetic storage outage");
  }), /storage outage/);
  assert.equal(await cleanupExport(workerTransaction, remove), true);
  await workerTransaction((db) => db.query("update private_export_objects set cleanup_after=now() where state='cleanup'"));
  assert.equal(await cleanupExport(workerTransaction, remove), true);
  assert.equal(await cleanupExport(workerTransaction, remove), false);
  assert.equal(objects.size, 0);

  await transaction("web", (db) => requestExport(db, real, randomUUID()));
  const abandoned = await transaction("worker", (db) => claimExport(db, real));
  assert(abandoned);
  await transaction("worker", (db) => recoverWorkerJobs(db, "test"));
  assert.equal(await cleanupExport(workerTransaction, remove), true);
  assert.equal(objects.size, 0);
  objects.add(abandoned.objectKey);
  await workerTransaction((db) => db.query("update private_export_objects set cleanup_after=now() where job_id=$1", [abandoned.jobId]));
  assert.equal(await cleanupExport(workerTransaction, remove), true);
  assert.equal(objects.size, 0);

  const realOnly = await seed();
  await transaction("web", async (db) => {
    await requestExport(db, sample, randomUUID());
    const claim = await claimExport(db, sample);
    assert(claim);
    assert.deepEqual(claim.versions, []);
    assert.equal(await publishExport(db, sample, claim, Buffer.from("synthetic ZIP")), true);
  });
  assert.equal(await transaction("web", (db) => currentExport(db, real)), null);
  assert.equal(await transaction("web", (db) => currentExport(db, randomUUID())), null);
  assert.equal((await transaction("web", (db) => currentExport(db, sample)))?.mockBytes?.toString(), "synthetic ZIP");
  await assert.rejects(transaction("worker", (db) => requestExport(db, sample, randomUUID())));
  await transaction("web", (db) => requestExport(db, real, randomUUID()));
  const latest = await transaction("worker", (db) => claimExport(db, real));
  assert(latest);
  assert.deepEqual(latest.versions, [realOnly]);
  assert.equal(await transaction("worker", (db) => publishExport(db, real, latest)), true);
  assert.equal(await transaction("web", async (db) => {
    const count = await db.query<{ count: number }>("select count(*)::int as count from current_export where downloadable");
    return count.rows[0]?.count;
  }), 1);
  // The shared writer boundary also protects approval-preserving exclusion changes.
  await transaction("web", (db) => withExportMutation(db, real, async () => {
    await db.query("update items set exclusion='explicit' where id=$1", [realOnly.itemId]);
    return { value: undefined, exportChanged: true };
  }));
  assert.equal(await transaction("web", (db) => currentExport(db, real)), null);
  await transaction("web", (db) => requestExport(db, real, randomUUID()));
  const excluded = await transaction("worker", (db) => claimExport(db, real));
  assert(excluded);
  assert.deepEqual(excluded.versions, [realOnly]);
  await transaction("web", (db) => withExportMutation(db, real, async () => {
    await db.query("update item_usage_rights set private_export=false where item_id=$1", [realOnly.itemId]);
    await db.query("insert into item_versions (item_id,version,diary_text) values ($1,2,'Synthetic revision')", [realOnly.itemId]);
    return { value: undefined, exportChanged: true };
  }));
  assert.equal(await transaction("worker", (db) => recheckExport(db, real, excluded)), null);
  assert.equal(await transaction("worker", (db) => publishExport(db, real, excluded)), false);
  assert.equal((await transaction("web", (db) => currentExport(db, sample)))?.mode, "mock");
  console.log("Private export PostgreSQL checks passed");
} finally {
  await pool.end();
}
