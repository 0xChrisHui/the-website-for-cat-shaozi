import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const testResult = z.object({
  projectName: z.string(),
  status: z.string(),
  expectedStatus: z.string(),
  results: z.array(z.object({
    status: z.string(),
    attachments: z.array(z.object({ name: z.string(), path: z.string().optional() })).default([]),
  })),
});
interface Suite { file: string; specs?: { tests: z.infer<typeof testResult>[] }[]; suites?: Suite[] }
const specs = z.array(z.object({ tests: z.array(testResult) }));
const suites: z.ZodType<Suite[]> = z.array(z.object({
  file: z.string(), specs: specs.optional(), suites: z.lazy(() => suites).optional(),
}));

export function checkReport(input: unknown, enabled: string[], sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Provide the full deployment SHA");
  const report = z.object({ suites }).parse(input);
  function entries(list: Suite[]): { file: string; test: z.infer<typeof testResult> }[] {
    return list.flatMap((suite) => [
      ...(suite.specs?.flatMap((spec) => spec.tests.map((test) => ({ file: suite.file, test }))) ?? []),
      ...entries(suite.suites ?? []),
    ]);
  }
  const all = entries(report.suites);
  for (const id of ["home", ...enabled.filter((id) => id !== "foundation")]) {
    const minimum = id === "home" && enabled.includes("foundation") ? 2 : 1;
    for (const project of ["desktop", "mobile"]) {
      const tests = all.filter((row) => row.file.endsWith("acceptance/" + id + ".spec.ts") && row.test.projectName === project);
      const passed = tests.filter(({ test }) => ["expected", "flaky"].includes(test.status) && test.expectedStatus === "passed" &&
        test.results.at(-1)?.status === "passed");
      const skipped = tests.filter(({ test }) => test.status === "skipped" || test.expectedStatus !== "passed");
      if (passed.length < minimum || skipped.length || tests.length !== passed.length) {
        throw new Error(sha + " " + id + " " + project + " requires passing tests and zero skips");
      }
      for (const { test } of passed) {
        for (const name of ["axe", "page"]) {
          const attachment = test.results.at(-1)?.attachments.find((file) => file.name === name);
          if (!attachment?.path || !existsSync(attachment.path)) throw new Error("Supply the " + name + " report attachment");
        }
      }
      console.log(sha, id, project, "passed=" + passed.length, "skipped=" + skipped.length, "page+axe");
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = "e2e/acceptance/delivered";
  const enabled = readdirSync(dir).filter((file) => z.object({ delivered: z.boolean() }).strict()
    .parse(JSON.parse(readFileSync(dir + "/" + file, "utf8"))).delivered)
    .map((file) => file.replace(/\.json$/, ""));
  const sha = process.env.DEPLOYMENT_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  checkReport(JSON.parse(readFileSync("test-results/report.json", "utf8")), enabled, sha);
}
