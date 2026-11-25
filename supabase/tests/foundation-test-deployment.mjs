// Run from the repository root with PostgreSQL server binaries on PATH or F3_PG_BIN set.
// Use node --import tsx with --server to exercise concurrent sessions and active RLS.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeMigration } from "../../.github/scripts/migrate-schema.mjs";

const cluster = mkdtempSync(join(tmpdir(), "foundation-deployment-"));
const data = join(cluster, "data");
const bin = process.env.F3_PG_BIN;
const migration = "20261125030000_permanent_test_deployment.sql";
const server = process.argv.includes("--server");
let started = false;
const foundation = "20261124120000_foundation_schema.sql";
const read = (name) => readFileSync(name, "utf8");
const key = "test:11155420:memorial-erc721-v1";
const fake = {
  environment: "test", branch: "integration", chainId: 11155420,
  deploymentVersion: "memorial-erc721-v1", releaseSha: "a".repeat(40),
  reviewedSha: "a".repeat(40), acceptanceSha: "a".repeat(40), migrationSha: "a".repeat(40),
  artifactHash: "b".repeat(64), constructorConfigVersion: "1e5086c5-327a-46c4-9d81-a80af616bc21",
};
const payload = JSON.stringify(fake);

function run(executable, args, input) {
  const inputFile = join(cluster, "input");
  const logFile = join(cluster, "log");
  writeFileSync(inputFile, input ?? "");
  const stdin = openSync(inputFile, "r");
  const log = openSync(logFile, "w");
  try {
    const result = spawnSync(bin ? join(bin, executable) : executable, args, { stdio: [stdin, log, log] });
    if (result.error) throw result.error;
    const output = readFileSync(logFile, "utf8");
    assert.equal(result.status, 0, output);
    assert.doesNotMatch(output, /\b(?:ERROR|FATAL|PANIC):/, output);
  } finally {
    closeSync(stdin);
    closeSync(log);
  }
}

// Stand-alone PostgreSQL accepts a command at each blank line in -j mode.
// Each call restarts the database without using sockets, a URL or connection credentials.
function sql(...commands) {
  if (server) {
    run("psql", ["-X", "-h", cluster, "-p", "5432", "-U", "foundation_check", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1"], commands.join("\n") + "\n");
  } else {
    const statements = commands.map((command) => command.trim().replace(/\n(?:[ \t]*\n)+/g, "\n"));
    run("postgres", ["--single", "-j", "-D", data, "postgres"], statements.join("\n\n") + "\n\n");
  }
}

async function verifyWorkerSessions() {
  const { Client } = await import("pg");
  const { testDeploymentReleaseSchema } = await import("../../src/lib/contracts/permanent.ts");
  const { createPermanentStore, recoverWorkerJobs } = await import("../../src/features/foundation/permanent-store.ts");
  const release = testDeploymentReleaseSchema.parse(fake);
  const options = {
    host: cluster, port: 5432, user: "foundation_check", database: "postgres", ssl: false, password: "",
  };
  const writer = new Client(options);
  const observer = new Client(options);
  try {
    for (const client of [writer, observer]) {
      await client.connect();
      await client.query("set role test_worker; set search_path = memorial_test, pg_catalog");
    }
    const initial = createPermanentStore(writer, "test", async () => release);
    const restarted = createPermanentStore(observer, "test");
    const [jobId, duplicate] = await Promise.all([initial.enqueue(release), restarted.enqueue(release)]);
    assert.ok(jobId);
    assert.equal(duplicate, jobId);
    const jobs = await observer.query("select id from jobs where kind='permanent.deploy-contract'");
    assert.deepEqual(jobs.rows, [{ id: jobId }]);
    await writer.query("update jobs set status='running' where id=$1", [jobId]);

    const signed = {
      rawTransaction: "0xabab", txHash: "0x" + "a".repeat(64),
      deployer: "0x" + "b".repeat(40), predictedAddress: "0x" + "c".repeat(40), nonce: 2,
    };
    await initial.withDeployment(jobId, async (deployment) => {
      assert.equal(await restarted.withDeployment(jobId, async () => assert.fail("Contender acquired the lock")), false);
      assert.deepEqual(await deployment.stageSigned(signed), signed);
      const { rows } = await observer.query("select receipt from operation_receipts where operation_key=$1", [key]);
      assert.deepEqual(rows[0].receipt, { jobId, stage: "signed", signed });
      await deployment.markUnknown();
    });
    await recoverWorkerJobs(observer, "test");
    const result = await observer.query("update jobs set status='running' where id=$1 and status='queued'", [jobId]);
    assert.equal(result.rowCount, 1);
    assert.equal(await restarted.withDeployment(jobId, async (deployment) => {
      assert.equal(deployment.operationKey, key);
      assert.deepEqual(deployment.receipt, { stage: "unknown", signed });
      await deployment.confirm();
    }), true);
  } finally {
    await Promise.allSettled([writer.end(), observer.end()]);
  }
}

try {
  run("initdb", ["-D", data, "--no-locale", "--encoding=UTF8", "--auth=trust", "-U", "foundation_check"]);
  if (server) {
    run("pg_ctl", ["-D", data, "-l", join(cluster, "server.log"), "-w", "start", "-o", "-k " + cluster + " -c listen_addresses=''"]);
    started = true;
  }
  sql(read("supabase/tests/bootstrap-roles.sql"), ...["test", "prod"].flatMap((scope) => [
    `set role ${scope}_migrator; set search_path = memorial_${scope}, pg_catalog;`,
    ...[foundation, migration].map((name) => safeMigration(read("supabase/migrations/" + name), name, scope)),
    "reset role;",
  ]));
  if (server) sql(read("supabase/tests/permissions.sql"));
  sql(`do $$ begin
    if has_table_privilege('test_worker', 'memorial_test.jobs', 'INSERT')
      or not has_column_privilege('test_worker', 'memorial_test.jobs', 'kind', 'INSERT')
      or not has_column_privilege('test_worker', 'memorial_test.jobs', 'payload', 'INSERT')
      or has_column_privilege('test_worker', 'memorial_test.jobs', 'id', 'INSERT')
      or not exists (
        select 1 from pg_policies where schemaname='memorial_test' and tablename='jobs'
          and policyname='test_deployment_worker_insert' and permissive='RESTRICTIVE'
          and cmd='INSERT' and roles=array['test_worker']::name[]
      ) then raise exception 'deployment privileges or restriction are incorrect'; end if;
  end $$;`);
  sql(
    "set role test_worker; set search_path = memorial_test, pg_catalog;",
    `do $$
    declare deployment_id uuid;
    begin
      if exists (select 1 from jobs) then raise exception 'queue was not empty'; end if;
      ${server ? `begin
        insert into jobs (kind, payload) values ('exports.create','{}');
        raise exception 'worker inserted an unrelated job';
      exception when insufficient_privilege then null; end;
      begin
        insert into jobs (kind, payload) values ('permanent.deploy-contract','{}');
        raise exception 'worker inserted an invalid deployment';
      exception when insufficient_privilege then null; end;
      begin
        insert into jobs (id, kind, payload) values (gen_random_uuid(),'permanent.deploy-contract','${payload}');
        raise exception 'worker supplied a restricted column';
      exception when insufficient_privilege then null; end;` : ""}

      with queued as (
        insert into jobs (kind, payload) values ('permanent.deploy-contract','${payload}') returning id
      )
      insert into operation_receipts (operation_key, network, payload_hash, receipt)
        select '${key}', 'op-sepolia', repeat('c',64), jsonb_build_object('jobId',id,'stage','reserved') from queued;
      insert into jobs (kind, payload) values ('permanent.deploy-contract','${payload}') on conflict do nothing;
      if (select count(*) from jobs) <> 1 then raise exception 'deployment job duplicated'; end if;

      begin
        with queued as (
          insert into jobs (kind, payload) values ('permanent.deploy-contract',
            jsonb_set('${payload}', '{deploymentVersion}', '"memorial-erc721-v2"')) returning id
        )
        insert into operation_receipts (operation_key, network, payload_hash, receipt)
          select 'test:11155420:memorial-erc721-v2', 'op-sepolia', repeat('d',64),
            jsonb_build_object('jobId',id,'stage','reserved') from queued;
        raise exception 'new version bypassed a pending deployment';
      exception when unique_violation then null; end;
      select id into strict deployment_id from jobs;
      update jobs set status='running' where id=deployment_id;
      update operation_receipts set receipt = receipt || '{"stage":"unknown","signed":{"rawTransaction":"0xabab"}}'
        where operation_key='${key}';
    end $$;`,
    ...(server ? [
      "reset role; set role test_web;",
      `do $$ begin
        begin
          insert into jobs (kind, payload) values ('permanent.deploy-contract','${payload}');
          raise exception 'website inserted a worker-owned job';
        exception when insufficient_privilege then null; end;
        update jobs set status='done' where kind='permanent.deploy-contract';
        if found then raise exception 'website updated a worker-owned job'; end if;
      end $$;`,
      "reset role; set role prod_worker; set search_path = memorial_prod, pg_catalog;",
      `do $$ begin
      begin
        insert into jobs (kind, payload) values ('permanent.deploy-contract','${payload}');
        raise exception 'production worker inserted a deployment';
      exception when insufficient_privilege then null; end;
    end $$;`] : []),
  );
  sql(
    "set role test_worker; set search_path = memorial_test, pg_catalog;",
    `do $$ begin
      if not exists (
        select 1 from operation_receipts join jobs on id::text = receipt->>'jobId'
        where operation_key='${key}' and status='running' and receipt->>'stage'='unknown'
          and receipt->'signed'->>'rawTransaction'='0xabab'
      ) then raise exception 'signed receipt was not recovered from the database'; end if;
    end $$;`,
  );
  console.log("Disposable PostgreSQL: migration guard, grants, restrictive policy catalog, unique keys and restart durability passed.");
  if (server) {
    sql("set search_path = memorial_test, pg_catalog; delete from jobs; delete from operation_receipts;");
    await verifyWorkerSessions();
    console.log("Active worker RLS, existing permissions and concurrent worker sessions passed.");
  }
} finally {
  try {
    if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  } finally {
    rmSync(cluster, { recursive: true, force: true });
  }
}
