// Run from the repository root with PostgreSQL server binaries on PATH or F3_PG_BIN set.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import sharp from "sharp";
import { safeMigration } from "../../.github/scripts/migrate-schema.mjs";
import { enqueueApprovedPhoto, photoKind } from "../../src/features/foundation/photo-approval.ts";
import { bindTestPhotoWorker, hasUnsettledPhotoMint, retryPhotoJobs, testSignerLock } from "../../src/features/foundation/photo-store.ts";
import { createArLocal } from "../../src/features/permanent/arlocal.ts";
import { executePhotoJob } from "../../src/features/permanent/execute.ts";

const root = mkdtempSync(join(tmpdir(), "foundation-photo-"));
const data = join(root, "data");
const port = 5432;
const clients = [];
let started = false;
function run(name, args, input) {
  const bin = process.env.F3_PG_BIN;
  const log = openSync(join(root, "command.log"), "w");
  const stdin = input === undefined ? undefined : join(root, "command.sql");
  if (stdin) writeFileSync(stdin, input);
  const fd = stdin ? openSync(stdin, "r") : undefined;
  try {
    execFileSync(bin ? join(bin, name) : name, args, { stdio: [fd ?? "ignore", log, log] });
    return readFileSync(join(root, "command.log"), "utf8");
  } catch (error) {
    if (name === "pg_ctl" && !started) console.error(readFileSync(join(root, "server.log"), "utf8"));
    throw error;
  } finally {
    closeSync(log);
    if (fd !== undefined) closeSync(fd);
  }
}

async function connect(role, scope = "test") {
  const client = new Client({ host: root, port, user: "photo_check", database: "postgres", ssl: false });
  clients.push(client);
  await client.connect();
  if (role) await client.query("set role " + role + "; set search_path = memorial_" + scope + ", pg_catalog");
  return client;
}

const migrations = [
  "20261124120000_foundation_schema.sql", "20261124180700_memorial_public_rights.sql",
  "20261125030000_permanent_test_deployment.sql", "20261125120000_permanent_test_photo.sql",
];

function migration(scope, name) {
  return safeMigration(readFileSync(join("supabase/migrations", name), "utf8"), name, scope);
}

function verifyWithoutSocket() {
  const cmds = [readFileSync("supabase/tests/bootstrap-roles.sql", "utf8"),
    ...["test", "prod"].flatMap((scope) => [
      `set role ${scope}_migrator; set search_path = memorial_${scope}, pg_catalog;`,
      ...migrations.map((name) => migration(scope, name)),
      "reset role;",
    ]), readFileSync("supabase/tests/foundation-test-photo.sql", "utf8")];
  const output = run("postgres", ["--single", "-j", "-D", data, "postgres"],
    cmds.map((sql) => sql.trim().replace(/\n(?:[ \t]*\n)+/g, "\n")).join("\n\n") + "\n\n");
  assert.doesNotMatch(output, /\b(?:ERROR|FATAL|PANIC):/, output);
  assert.match(output, /photo SQL assertions passed/);
  console.log("Disposable PostgreSQL photo migration, constraints, grants and durability passed in single-user mode.");
}

try {
  run("initdb", ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust", "-U", "photo_check"]);
  if (process.argv.includes("--single")) {
    verifyWithoutSocket();
  } else {
    run("pg_ctl", ["-D", data, "-l", join(root, "server.log"), "-o", "-h '' -k " + root, "-w", "start"]);
    started = true;
    const admin = await connect();
    await admin.query(readFileSync("supabase/tests/bootstrap-roles.sql", "utf8"));
    for (const scope of ["test", "prod"]) {
      const migrator = await connect(scope + "_migrator", scope);
      for (const name of migrations) {
        await migrator.query(migration(scope, name));
      }
    }

    const web = await connect("test_web");
    const worker = await connect("test_worker");
    const contender = await connect("test_worker");
    const prod = await connect("prod_web", "prod");
    const prodWorker = await connect("prod_worker", "prod");
    const itemId = randomUUID();
    const item2 = randomUUID();
    const version = randomUUID();
    const version2 = randomUUID();
    const submission = randomUUID();
    const recipientVersion = randomUUID();
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#663322" } }).jpeg().toBuffer();
    const file = { objectKey: submission + "/0", mediaType: "image/jpeg", sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") };
    mkdirSync(join(root, submission));
    writeFileSync(join(root, file.objectKey), bytes);
    await web.query("insert into submissions values ($1,'synthetic',repeat('a',64),now(),'stage0-grok')", [submission]);
    await web.query("insert into items (id,submission_id,position,kind) values ($1,$2,0,'photo'),($3,$2,1,'photo')", [itemId, submission, item2]);
    await web.query("insert into item_versions (id,item_id,version,file_ref) values ($1,$2,1,$3),($4,$5,1,$6)",
      [version, itemId, file, version2, item2, { ...file, objectKey: submission + "/1" }]);
    await web.query("insert into item_usage_rights (item_id,public_view,arweave,nft) values ($1,true,true,true),($2,true,true,true)", [itemId, item2]);
    await web.query("insert into item_version_display (version_id,processed_media_ref) values ($1,$2),($3,$4)",
      [version, "memorial/display/" + itemId + "/" + version, version2, "memorial/display/" + item2 + "/" + version2]);
    await web.query("insert into site_settings values ('test.photo-permanent',1,$1)", [{ archive: true, mint: true, recipientVersion }]);
    await assert.rejects(web.query("insert into jobs(kind,payload) values($1,$2)", [photoKind, { itemId }]), { code: "42501" });
    await assert.rejects(worker.query("insert into jobs(kind,payload) values($1,$2)", [photoKind, { itemId }]), { code: "42501" });
    await assert.rejects(prod.query("insert into jobs(kind,payload) values($1,$2)", [photoKind, { itemId }]), { code: "42501" });
    await assert.rejects(enqueueApprovedPhoto(web, itemId, version), { code: "42501" });

    await web.query("begin");
    await web.query("insert into approvals (item_id,version_id,source,published,arweave,nft,recipient_config_version) values ($1,$2,'manual',true,true,true,$5),($3,$4,'manual',true,true,true,$5)",
      [itemId, version, item2, version2, recipientVersion]);
    await enqueueApprovedPhoto(web, itemId, version);
    await enqueueApprovedPhoto(web, itemId, version);
    await enqueueApprovedPhoto(web, item2, version2);
    assert.equal((await worker.query("select id from jobs")).rowCount, 0);
    await web.query("commit");
    const { rows } = await worker.query("select id,payload from jobs");
    assert.equal(rows.length, 2);
    const jobId = rows.find((row) => row.payload.itemId === itemId).id;
    const secondJobId = rows.find((row) => row.payload.itemId === item2).id;
    assert.equal((await web.query("update jobs set status='done' where id=$1", [jobId])).rowCount, 0);
    assert.equal((await prodWorker.query("select * from test_photo_jobs")).rowCount, 0);
    await worker.query("update jobs set status='running'");
    const job = { jobId, kind: photoKind, schemaVersion: 1, payload: { itemId } };
    const signer = "0x" + "11".repeat(20);
    const policy = { sender: signer, recipient: signer, recipientVersion, deployment: {},
      gasLimit: 2n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, maxTotalFee: 9n };
    let archiveSends = 0;
    let mintSends = 0;
    let mintSigns = 0;
    let visible = false;
    let observed = "";
    const arlocalEndpoint = process.argv.find((arg) => arg.startsWith("--arlocal="))?.slice("--arlocal=".length);
    const arlocal = arlocalEndpoint && createArLocal(arlocalEndpoint,
      generateKeyPairSync("rsa", { modulusLength: 4096 }).privateKey, 100_000_000n);
    async function arlocalCommand(path) {
      const response = await fetch(new URL(path, arlocalEndpoint), {
        redirect: "error", signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.ok, true);
      await response.text();
    }
    if (arlocal) await arlocalCommand("/mint/" + arlocal.address + "/1000000000");

    const archive = arlocal || {
      async sign(_bytes, versionId, authorize) {
        await authorize();
        return { id: "a".repeat(43), raw: "synthetic archive", digest: file.sha256, versionId };
      },
      verify: async () => archiveSends > 0,
      beforeSend: async () => {},
      async send() {},
    };
    async function verifyAttempt(action, raw) {
      const { rows: [stored] } = await contender.query(
        "select state, artifact->>'raw' as raw from test_photo_receipts where item_id=$1 and action=$2", [itemId, action]);
      assert.deepEqual(stored, { state: "attempted", raw });
    }
    const adapters = {
      archiveEnabled: async () => true,
      mintPolicy: async () => policy,
      syntheticOriginal: (digest) => digest === file.sha256,
      archive: {
        ...archive,
        async send(artifact) {
          await verifyAttempt("archive", artifact.raw);
          await archive.send(artifact);
          archiveSends++;
          if (arlocal) await arlocalCommand("/mine/3");
        },
      },
      mint: {
        async sign(intent, _policy, reserved, authorize) {
          assert.equal(reserved, 0n);
          await authorize();
          mintSigns++;
          return { id: "0x" + "b".repeat(64), raw: "synthetic mint", nonce: 1, intent };
        },
        async verify(receipt) { observed = receipt.raw; return visible; },
        beforeSend: async () => {},
        async send(artifact) {
          await verifyAttempt("mint", artifact.raw);
          mintSends++;
          throw new Error("Synthetic ambiguous result");
        },
      },
    };

    const signal = new AbortController().signal;
    let bound = bindTestPhotoWorker(worker, root, adapters, signal);
    let finished = false;
    const context = () => ({ permanentPhoto: bound.worker, files: { read: bound.read },
      clock: () => new Date(), jobs: { async finish(_id, reason) { assert.equal(reason, undefined); finished = true; } } });
    const lock = await contender.query("select pg_try_advisory_lock(hashtextextended($1,0)) as acquired", [testSignerLock]);
    assert.equal(lock.rows[0].acquired, true);
    assert.equal(await bound.worker.withPhoto(jobId, itemId, async () => assert.fail("Shared lock bypassed")), false);
    await contender.query("select pg_advisory_unlock(hashtextextended($1,0))", [testSignerLock]);
    await assert.rejects(bound.worker.withPhoto(jobId, item2, async () => assert.fail("Wrong immutable binding")));
    await bound.worker.withPhoto(jobId, itemId, async () => {
      writeFileSync(join(root, file.objectKey), Buffer.alloc(bytes.length));
      await assert.rejects(bound.read(file.objectKey), /integrity/);
      writeFileSync(join(root, file.objectKey), bytes);
    });
    await executePhotoJob(job, context());
    assert.deepEqual([archiveSends, mintSends, mintSigns, finished], [1, 1, 1, false]);
    await assert.rejects(worker.query("update test_photo_receipts set artifact='{}'"), { code: "42501" });
    await assert.rejects(web.query("select * from test_photo_receipts"), { code: "42501" });
    assert.equal(await hasUnsettledPhotoMint(worker), true);
    await bound.worker.withPhoto(secondJobId, item2, async ({ reservedFees }) => {
      assert.deepEqual(await reservedFees(signer), { total: 9n, unknown: true });
    });

    await web.query("update items set withdrawn_at=now() where id=$1", [itemId]);
    await retryPhotoJobs(contender, true);
    assert.equal((await contender.query("select status from jobs where id=$1", [jobId])).rows[0].status, "queued");
    await contender.query("update jobs set status='running' where id=$1", [jobId]);
    bound = bindTestPhotoWorker(contender, root, adapters, signal);
    await bound.worker.withPhoto(jobId, itemId, async ({ mint }) => {
      assert.equal(await bound.worker.readCurrent(itemId), null);
      assert.equal(mint.receipt.state, "attempted");
      await assert.rejects(mint.attempt(), /transition/);
      await assert.rejects(bound.worker.mint.send(mint.receipt), /authorization/);
    });
    visible = true;
    await executePhotoJob(job, context());
    assert.deepEqual([archiveSends, mintSends, mintSigns, observed, finished], [1, 1, 1, "synthetic mint", true]);
    assert.equal(await hasUnsettledPhotoMint(contender), false);
    // Recovery reset both jobs; the lock-loss exercise needs a newly claimed job.
    const reclaimed = await contender.query("update jobs set status='running' where id=$1 and status='queued'", [secondJobId]);
    assert.equal(reclaimed.rowCount, 1);
    const controller = new AbortController();
    const workerKey = "memorial-worker:memorial_test";
    await contender.query("select pg_advisory_lock(hashtextextended($1,0))", [workerKey]);
    const monitored = bindTestPhotoWorker(contender, root, adapters, controller.signal,
      { workerKey, abort: () => controller.abort() });
    await assert.rejects(monitored.worker.withPhoto(secondJobId, item2, async () => {
      await contender.query("select pg_advisory_unlock(hashtextextended($1,0))", [testSignerLock]);
      await monitored.worker.readCurrent(item2);
    }), /database lock lost/);
    assert.equal(controller.signal.aborted, true);
    console.log("Disposable PostgreSQL photo approvals, roles, receipt recovery and external mock boundaries passed.");
  }
} finally {
  await Promise.allSettled(clients.map((client) => client.end()));
  try {
    if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
