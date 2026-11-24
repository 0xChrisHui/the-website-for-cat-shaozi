import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrationName, validTimestamp } from "./guard.mjs";
import { collectBatches, migrate } from "./migrate-schema.mjs";

const directory = "supabase/migrations/";
const foundation = directory + "20261124120000_foundation_schema.sql";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", timeout: 20_000 }).trimEnd();
function changes(before, after) {
  const tokens = git("diff", "--no-renames", "--name-status", "-z", before, after, "--", directory).split("\0").filter(Boolean);
  const results = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const [status, path] = [tokens[i], tokens[i + 1]];
    if (status !== "A" || !git("ls-tree", after, "--", path).startsWith("100644 blob ")) throw new Error("Only append ordinary migration files");
    results.push(path);
  }
  return results;
}

try {
  const [base, head, branch] = process.argv.slice(2);
  if (![base, head].every((sha) => /^[a-f0-9]{40}$/.test(sha))) throw new Error("Require the exact base and head SHA");
  if (branch === "stage-0") {
    await migrate({
      target: "local", batches: collectBatches([{ sha: head, owner: "foundation" }]),
      seed: readFileSync("supabase/seed.sql", "utf8"), expected: readFileSync("src/lib/database.types.ts", "utf8"),
    });
  } else {
    const sequence = git("rev-list", "--first-parent", base).split("\n").reverse();
    const releases = [];
    let previous;
    for (const sha of sequence) {
      const names = previous ? changes(previous, sha) : git("ls-tree", "-r", "--name-only", sha, "--", directory).split("\n").filter(Boolean);
      if (releases.length || names.includes(foundation)) {
        const owners = new Set(names.map((path) => migrationName.exec(path.slice(directory.length))?.[2]));
        if (owners.size > 1 || owners.has(undefined)) throw new Error("Unexpected integration migration owner");
        releases.push({ sha, owner: [...owners][0] ?? "none" });
      }
      previous = sha;
    }
    const branchId = /^(?:module\/|fix\/)(intake|memorial|permanent|exports)(?:-\d+)?$/.exec(branch)?.[1];
    const batches = collectBatches(releases);
    if (!batches.length) throw new Error("Missing the initial foundation migration");
    const from = git("merge-base", base, head);
    const used = new Set(batches.flatMap(({ files }) => files.map(({ name }) => name.slice(0, 14))));
    const files = changes(from, head).map((path) => {
      const name = path.slice(directory.length);
      const match = migrationName.exec(name);
      if (!match || !branchId || match[2] !== branchId || !validTimestamp(match[1]) || used.has(match[1])) {
        throw new Error("Use a unique UTC migration timestamp and the current module name");
      }
      used.add(match[1]);
      // Preserve the complete blob including its final newline.
      const source = execFileSync("git", ["show", head + ":" + path], { encoding: "utf8", timeout: 20_000 });
      return { name, source, digest: createHash("sha256").update(source).digest("hex") };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (files.length) batches.push({ sha: head, files });
    await migrate({ target: "local", batches, seed: readFileSync("supabase/seed.sql", "utf8") });
  }
  console.log("Local PostgreSQL schema replay passed");
} catch (error) {
  console.error(error.code ? "Schema replay failed. SQLSTATE " + error.code : error.message);
  process.exitCode = 1;
}
