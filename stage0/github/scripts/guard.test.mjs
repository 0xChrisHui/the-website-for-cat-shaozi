import { expect, it } from "vitest";
import { checkChanges, parseFlag, validTimestamp } from "./guard.mjs";

const flags = new Map([["foundation.json", '{"delivered":true}'], ["intake.json", '{"delivered":false}']]);
const data = {
  protectedPaths: [/^src\/app\/page/, /^supabase\//],
  baseBranch: "integration", headBranch: "module/intake", delivered: true,
  modules: [{ id: "intake", writablePaths: ["src/features/intake/**", "e2e/features/intake/**"] }],
  baseFlags: flags, headFlags: flags, timestamps: new Set(),
};
const change = (path, status = "M", mode = "100644") => ({ path, status, mode });

it("requires valid singleton flags and real timestamps", () => {
  expect(() => parseFlag('{"delivered":true,"delivered":false}')).toThrow();
  expect(validTimestamp("20260230122400")).toBe(false);
  expect(validTimestamp("20260228122400")).toBe(true);
});

it("enforces ownership, immutable specs, migration additions and ordinary files", () => {
  for (const entry of [change("src/app/page.tsx"), change("src/features/review/a.ts"),
    change("e2e/features/intake/a.spec.ts", "D"), change("src/features/intake/a.ts", "A", "120000"),
    change("supabase/migrations/20260228122400_intake_a.sql")]) {
    expect(() => checkChanges({ ...data, changes: [entry] })).toThrow();
  }
  expect(() => checkChanges({ ...data, changes: [change("src/features/intake/feature.ts")] })).not.toThrow();
  expect(() => checkChanges({ ...data, headBranch: "fix/foundation-1", changes: [change("src/app/page.tsx")] })).toThrow();
  expect(() => checkChanges({ ...data, headBranch: "module/memorial", changes: [change("src/app/page.tsx")] })).not.toThrow();
});

it("restricts report branches", () => {
  const report = { ...data, headBranch: "report/2026-11-24" };
  expect(() => checkChanges({ ...report, changes: [change("docs/run-report.md")] })).not.toThrow();
  expect(() => checkChanges({ ...report, changes: [change("docs/run-report.md", "D")] })).toThrow();
});
