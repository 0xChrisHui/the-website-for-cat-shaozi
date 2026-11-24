import { existsSync, readFileSync, readdirSync } from "node:fs";
import { matchesGlob } from "node:path";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const read = (file) => readFileSync(file, "utf8");
const example = parseEnv(read(".env.example"));
const production = new Set([
  "OP_MAINNET_RPC_URL", "OP_MAINNET_EXPLORER_API_KEY", "MAINNET_WALLET_FILE",
  "DIARY_ARCHIVE_PASSPHRASE", "ALLOW_MAINNET", "TURBO_PRODUCTION_URL", "PRODUCTION_ORIGIN",
  "ENABLE_PRODUCTION_READONLY", "SCHEMA_DATABASE_URL", "SUPABASE_ACCESS_TOKEN",
  "VERCEL_AUTOMATION_BYPASS_SECRET", "REVIEWED_MIGRATION_SHA",
  "TEST_MAINTAINER_EMAIL", "TEST_MAINTAINER_PASSWORD",
  "WORKER_REPOSITORY", "WORKER_GIT_DIR", "CONFIRM_D1_TEST_BLOB",
  "PROD_CALLBACK_ORIGIN",
]);

function assert(condition, reason) {
  if (!condition) throw new Error(reason);
}

try {
  if (process.argv[2] === "--env-file") {
    const text = read(process.argv[3]);
    const local = parseEnv(text);
    const blocked = Object.keys(local).filter((key) => production.has(key) || !Object.hasOwn(example, key));
    assert(!blocked.length, "Remove unavailable variables from the local file: " + blocked.join(", "));
    assert(local.VERCEL_ENV === "development", "Set VERCEL_ENV=development");
    assert(Object.keys(local).length && !/^[ \t]*(?:source|\.|eval)\b/m.test(text), "Use literal dotenv assignments");
    console.log("Local environment variable names and deployment scope verified");
  } else {
    const base = existsSync(".github/protected-paths.txt") ? ".github" : "stage0/github";
    const { parseFlag } = await import(pathToFileURL(process.cwd() + "/" + base + "/scripts/guard.mjs").href);
    const requiredWorkflows = ["ci", "guard", "e2e", "e2e-status", "migrate", "integration-merged", "migrate-integration", "db-advisors"];
    assert(requiredWorkflows.every((name) => existsSync(base + "/workflows/" + name + ".yml")), "Restore the required trusted workflows");
    assert(existsSync(base + "/workflows/prod-readonly.yml") || base === ".github", "Keep the G2 read-only workflow");
    const automatic = read(base + "/workflows/migrate-integration.yml");
    assert(!/prod-db-admin|SUPABASE_ACCESS_TOKEN|service_role/.test(automatic), "Keep automated migrations scoped to the limited test role");
    const guard = read(base + "/workflows/guard.yml");
    assert(guard.includes("pull_request_target:") && guard.includes("statuses: write") && guard.includes("contents: read"),
      "Use the target branch guard and separate publisher");
    const configured = read(base + "/protected-paths.txt").trim().split("\n");
    const proven = configured.map((line) => new RegExp(line));
    const manual = read("docs/workflow-manual.md");
    const template = manual.slice(manual.indexOf("^AGENTS"), manual.indexOf("^postcss\\.config\\.") + "^postcss\\.config\\.".length).split("\n");
    assert(template.every((line) => configured.includes(line)), "Restore each B.2 protected rule");
    for (const file of [".env.example", ".gitignore", "docs/modules.json", "src/lib/env.ts", "src/lib/adapters/select.ts",
      "src/lib/adapters/mainnet-gate.ts", "src/lib/policy/content.ts", "src/lib/contracts/jobs.ts",
      "src/features/foundation/test-network.ts", ".ai/bin/deploy-worker.sh", "stage0/github/workflows/ci.yml"]) {
      assert(proven.some((pattern) => pattern.test(file)), "Protect " + file);
    }
    assert(Object.values(example).every((value) => value === ""), "Remove values from .env.example");
    assert([...production].every((key) => Object.hasOwn(example, key)), "Document every restricted variable");
    const { modules } = JSON.parse(read("docs/modules.json"));
    const dir = "e2e/acceptance/delivered";
    assert(readdirSync(dir).sort().join(",") === modules.map(({ id }) => id + ".json").sort().join(","),
      "Use exactly the established delivery flags");
    for (const { id } of modules) {
      const enabled = parseFlag(read(dir + "/" + id + ".json"));
      if (base.startsWith("stage0")) assert(enabled === (id === "foundation"), "Stage 0 enables only foundation");
    }
    const contract = JSON.parse(read("package.json"));
    assert(/^pnpm@\d+\.\d+\.\d+$/.test(contract.packageManager), "Pin an exact pnpm release");
    assert(Object.values({ ...contract.dependencies, ...contract.devDependencies }).every((v) => /^\d+\.\d+\.\d+$/.test(v)),
      "Pin direct dependency versions");
    if (base.startsWith("stage0")) {
      const committed = execFileSync("git", ["diff", "--name-only", "origin/main...HEAD"], { encoding: "utf8" });
      const dirty = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
      const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
      const paths = new Set((committed + dirty + untracked).split("\n").filter(Boolean));
      const writable = modules.find(({ id }) => id === "foundation").writablePaths;
      for (const file of paths) assert(writable.some((pattern) => file === pattern || matchesGlob(file, pattern)), "Move the out-of-scope file: " + file);
    }
    console.log("Stage 0 scope, environment layers, guards, flags and dependencies verified");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
