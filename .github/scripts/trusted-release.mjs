import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
const maintainer = process.env.MAINTAINER_GITHUB_LOGIN;
const fullSha = /^[a-f0-9]{40}$/;

function requireEvidence(condition, reason) {
  if (!condition) throw new Error(reason);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", timeout: 30000 }).trim();
}

function api(endpoint, paginate = false) {
  const args = ["api", "--method", "GET", "repos/" + repository + "/" + endpoint];
  if (paginate) args.push("--paginate", "--slurp");
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8", timeout: 30000 }));
}

function hasRunEvidence(run, name) {
  if (!run?.id) return false;
  return api("actions/runs/" + run.id + "/artifacts?per_page=100", true)
    .flatMap((page) => page.artifacts).some((artifact) => artifact.name === name);
}

function isMaintainer(login) {
  return typeof maintainer === "string" && maintainer.length > 0 && login === maintainer;
}

const approvedFoundationRepairs = new Map([
  [23, {
    branch: "ops/f2-public-sample-ticket",
    reviewedBase: "a9ad0f0fe5f391b2e9da590b8025cd81f8b198de",
    reviewedHead: "e639f0cc6c3d8eb2b86de4845e8ebc9e820ede7f",
    paths: [
      "src/app/api/debug/samples/public/route.ts",
      "src/features/foundation/samples.test.ts",
      "src/features/foundation/samples.ts",
      "src/proxy.ts",
    ],
  }],
  [24, {
    branch: "ops/f2-intake-original-persistence",
    reviewedBase: "a9ad0f0fe5f391b2e9da590b8025cd81f8b198de",
    reviewedHead: "2ab9de147dd4ea37ef6389b19abd03849c73f5d9",
    paths: [
      "src/features/foundation/intake-originals.test.ts",
      "src/features/foundation/intake-originals.ts",
      "src/features/foundation/originals.test.ts",
      "src/features/foundation/originals.ts",
      "src/features/foundation/worker.ts",
    ],
  }],
  [25, {
    branch: "ops/f2-intake-source-deduplication",
    reviewedBase: "1e8e02dd2010b1f3158c4a7b44f5a5986f294571",
    reviewedHead: "9f15d1c19c2553b33743a6214b73f48de2aa1366",
    paths: [
      "src/features/foundation/intake.ts",
      "src/lib/contracts/intake.test.ts",
      "src/lib/contracts/intake.ts",
    ],
  }],
  [33, {
    branch: "ops/f3-permanent-foundation",
    reviewedBase: "c4733a12fba953a8eececc954cc613a7d1b52462",
    reviewedHead: "713ae2b1e72eca7bac06175cbf5e92ce074d443c",
    paths: [
      "src/features/foundation/permanent-release.test.ts",
      "src/features/foundation/permanent-release.ts",
      "src/features/foundation/permanent-store.test.ts",
      "src/features/foundation/permanent-store.ts",
      "src/features/foundation/worker.ts",
      "src/lib/contracts/jobs.ts",
      "src/lib/contracts/permanent.ts",
      "src/lib/contracts/review.ts",
      "supabase/tests/foundation-test-deployment.mjs",
    ],
  }],
  [36, {
    branch: "ops/f3-intake-diary-persistence",
    reviewedBase: "c4733a12fba953a8eececc954cc613a7d1b52462",
    reviewedHead: "f7bb4fd17ff17d3103d5ba889338d99be3bff841",
    paths: [
      "src/features/foundation/intake.test.ts",
      "src/features/foundation/intake.ts",
    ],
  }],
  [44, {
    branch: "ops/f3-exports-delivery",
    reviewedBase: "457a94c3c6baa0c6d3b63d95efa19a8a0e28a20b",
    reviewedHead: "b6303bbf6e302f59dd62965a27fc956c51d9e9e5",
    paths: [
      "docs/decisions/exports.md",
      "e2e/features/exports/offline.spec.ts",
      "e2e/features/exports/preview.spec.ts",
      "src/app/api/exports/download/route.test.ts",
      "src/app/api/exports/download/route.ts",
      "src/app/api/exports/generate/route.ts",
      "src/app/maintain/exports/controls.tsx",
      "src/app/maintain/exports/page.tsx",
      "src/app/maintain/page.tsx",
      "src/app/maintain/review/page.tsx",
      "src/features/exports/access.ts",
      "src/features/exports/archive.ts",
      "src/features/exports/blob.test.ts",
      "src/features/exports/blob.ts",
      "src/features/exports/candidates.ts",
      "src/features/exports/content.ts",
      "src/features/exports/generate.test.ts",
      "src/features/exports/generate.ts",
      "src/features/exports/jobs.test.ts",
      "src/features/exports/jobs.ts",
      "src/features/exports/offline-fixture.ts",
      "src/features/exports/photo-reader.ts",
      "src/features/exports/reserved-items.ts",
      "src/features/exports/sample.ts",
      "src/features/foundation/private-export-access.test.ts",
      "src/features/foundation/private-export-access.ts",
      "src/features/foundation/private-export-handoff.md",
      "src/features/foundation/private-export.ts",
      "src/features/foundation/sample-export-media.ts",
      "src/features/foundation/worker.ts",
      "src/features/review/approve.test.ts",
      "src/features/review/approve.ts",
      "src/features/review/sample.ts",
      "src/features/review/withdraw.ts",
      "src/lib/contracts/jobs.ts",
      "supabase/tests/foundation-private-export.sh",
      "supabase/tests/foundation-private-export.ts",
    ],
  }],
  [46, {
    branch: "ops/f3-test-photo-delivery",
    reviewedBase: "2d060c151294f1abe8a806499e2b4e93c8eab6be",
    reviewedHead: "9e503220e00548b8142237a99fbb479a443b7ccc",
    paths: [
      "docs/decisions/foundation.md",
      "docs/decisions/permanent.md",
      "e2e/features/permanent/photo-job.spec.ts",
      "src/app/maintain/review/[submissionId]/page.tsx",
      "src/app/maintain/review/actions.ts",
      "src/features/foundation/originals.ts",
      "src/features/foundation/permanent-store.ts",
      "src/features/foundation/photo-approval.ts",
      "src/features/foundation/photo-store.ts",
      "src/features/foundation/worker.ts",
      "src/features/permanent/archive-photo.ts",
      "src/features/permanent/arlocal.ts",
      "src/features/permanent/deployment-io.ts",
      "src/features/permanent/deployment-release.ts",
      "src/features/permanent/execute.ts",
      "src/features/permanent/jobs.ts",
      "src/features/permanent/mint.ts",
      "src/features/permanent/photo-bootstrap.test.ts",
      "src/features/permanent/photo-bootstrap.ts",
      "src/features/permanent/photo-fixture.ts",
      "src/features/permanent/photo-job.test.ts",
      "src/features/permanent/photo-loopback-fixture.ts",
      "src/features/permanent/photo-recovery.test.ts",
      "src/features/permanent/reconcile.ts",
      "src/features/permanent/verify-deployment.test.ts",
      "src/features/permanent/verify-deployment.ts",
      "src/features/review/approve.test.ts",
      "src/features/review/approve.ts",
      "src/features/review/photo-decision.ts",
      "src/lib/contracts/jobs.ts",
      "supabase/tests/foundation-test-photo.mjs",
      "supabase/tests/foundation-test-photo.sql",
    ],
  }],
  [47, {
    branch: "ops/f3-f2-test-acceptance",
    reviewedBase: "7dd8101e4ff6f7908a215c38b4699b71417294d3",
    reviewedHead: "75875dbc52dbd3faa2bc3841cded4137900c3350",
    paths: [
      "e2e/acceptance/delivered/exports.json",
      "e2e/acceptance/delivered/intake.json",
      "e2e/acceptance/delivered/memorial.json",
      "e2e/acceptance/exports.spec.ts",
      "e2e/acceptance/memorial.spec.ts",
      "src/app/maintain/intake/[submissionId]/page.tsx",
      "src/app/maintain/review/[submissionId]/display/route.ts",
      "src/app/maintain/review/[submissionId]/page.tsx",
      "src/app/maintain/review/actions.ts",
      "src/features/foundation/worker.ts",
      "src/features/intake/review-display.test.ts",
      "src/features/intake/review-display.ts",
      "src/features/review/real-preparation.test.ts",
      "src/features/review/real-preparation.ts",
    ],
  }],
  [48, {
    branch: "ops/f3-flat-maintain",
    reviewedBase: "aa0eb7c381195e4fa895acdef5ea852ca78d889a",
    reviewedHead: "72f0f762136400f44f2b20cef151852b4d184d93",
    paths: [
      "docs/decisions/intake.md",
      "src/app/maintain/page.tsx",
      "src/app/maintain/review/[submissionId]/page.tsx",
      "src/app/maintain/review/actions.ts",
      "src/app/maintain/review/inbox-controls.tsx",
      "src/app/maintain/review/inbox.test.ts",
      "src/app/maintain/review/inbox.tsx",
      "src/features/foundation/intake.test.ts",
      "src/features/foundation/intake.ts",
      "src/features/foundation/worker.ts",
      "src/features/intake/mail-restrictions.test.ts",
      "src/features/intake/mail-restrictions.ts",
      "src/features/intake/review-display.test.ts",
      "src/features/intake/review-display.ts",
      "src/features/review/approve.test.ts",
      "src/features/review/approve.ts",
      "src/features/review/inbox-policy.ts",
      "src/features/review/mail-preparation.ts",
      "src/features/review/real-preparation.test.ts",
      "src/features/review/real-preparation.ts",
      "src/features/review/store.ts",
      "src/lib/contracts/intake.ts",
    ],
  }],
  [49, {
    branch: "ops/f3-visible-diary",
    reviewedBase: "fba81b5e7222cc6ad3a25042fc8edf8484856eb1",
    reviewedHead: "3f451f1bb723fb6c836ef2a378e8a2db26afe03f",
    paths: [
      "src/app/maintain/review/inbox.test.ts",
      "src/app/maintain/review/inbox.tsx",
    ],
  }],
  [51, {
    branch: "fix/memorial-2501",
    reviewedBase: "29a2902e00b72a6ea6309de2f4f887b7181d4ecb",
    reviewedHead: "affc3eb359745ced1e7bb2875ed364532144c207",
    paths: [
      "src/app/maintain/review/actions.ts",
      "src/app/maintain/review/inbox.test.ts",
      "src/app/maintain/review/inbox.tsx",
      "src/features/foundation/private-export.ts",
      "src/features/foundation/worker.ts",
      "src/features/review/approve.test.ts",
      "src/features/review/approve.ts",
      "src/features/review/auto-approve.ts",
      "src/features/review/auto-settings.ts",
      "src/features/review/inbox-write.ts",
      "src/features/review/mail-preparation.ts",
      "src/features/review/real-preparation.ts",
      "src/features/review/review-rows.ts",
      "src/features/review/store.ts",
      "supabase/migrations/20261125150000_memorial_auto_approval.sql",
    ],
  }],
]);

function isApprovedFoundationRepair(pr, parent, merged) {
  const reviewed = approvedFoundationRepairs.get(pr.number);
  if (!reviewed || pr.head.ref !== reviewed.branch || pr.head.sha !== reviewed.reviewedHead ||
      !isMaintainer(pr.merged_by?.login ?? api("pulls/" + pr.number).merged_by?.login)) return false;
  // These approvals cover only the reviewed patches. The normal module guard does not own those paths.
  const { reviewedBase, reviewedHead, paths } = reviewed;
  return git("merge-base", parent, reviewedHead) === reviewedBase &&
    git("diff", "--name-only", "--no-renames", parent, merged) === paths.join("\n") &&
    git("ls-tree", merged, "--", ...paths) === git("ls-tree", reviewedHead, "--", ...paths);
}

function readReviews(pr, head) {
  return api("pulls/" + pr.number + "/reviews?per_page=100", true).flat()
    .filter((review) => review.commit_id === head && isMaintainer(review.user?.login)).at(-1)?.state === "APPROVED";
}

function hasTrustedSchemaStatus(sha) {
  const incoming = api("commits/" + sha + "/statuses?per_page=100", true).flat()
    .find((status) => status.context === "integration-schema" && status.creator?.login === "github-actions[bot]");
  const prefix = "https://github.com/" + repository + "/actions/runs/";
  const id = incoming?.target_url?.startsWith(prefix) ? incoming.target_url.slice(prefix.length) : undefined;
  if (incoming?.state !== "success" || !/^\d+$/.test(id ?? "")) return false;
  const run = api("actions/runs/" + id);
  return run.repository?.full_name === repository && run.head_branch === "main" && run.event === "workflow_run" &&
    run.path?.split("@")[0] === ".github/workflows/migrate-integration.yml" && run.conclusion === "success";
}

function releasesThrough(target, requireChecks = true) {
  requireEvidence(fullSha.test(target), "Provide a full integration SHA");
  const chain = git("rev-list", "--first-parent", "origin/integration").split("\n");
  requireEvidence(chain.includes(target), "SHA must be on the integration first-parent chain");
  const ordered = chain.slice(chain.indexOf(target)).reverse();
  const releases = [];
  for (const sha of ordered) {
    const prs = api("commits/" + sha + "/pulls?per_page=100", true).flat();
    const pr = prs.find((candidate) => candidate.merged_at && candidate.merge_commit_sha === sha);
    if (!releases.length) {
      if (!pr || pr.base.ref !== "main" || pr.head.ref !== "stage-0") continue;
      requireEvidence(pr.head.repo?.full_name === repository && isMaintainer(pr.merged_by?.login ?? api("pulls/" + pr.number).merged_by?.login),
        "The maintainer must merge the bootstrap stage-0 PR");
      releases.push({ sha, owner: "foundation", reviewedSha: pr.head.sha });
      continue;
    }
    const fields = git("rev-list", "--parents", "-n", "1", sha).split(" ");
    if (!pr && fields.length === 2) {
      const paths = git("diff", "--name-only", fields[1], sha).split("\n");
      const trustedFiles = new Set([".github/workflows/guard.yml", ".github/scripts/trusted-release.mjs"]);
      // Recognize the maintainer's protected-main guard update mirrored to integration.
      if (paths.length && paths.every((path) => trustedFiles.has(path)) &&
          git("rev-list", "--first-parent", "origin/main").split("\n").includes(sha)) {
        releases.push({ sha, owner: "none" });
        continue;
      }
    }
    requireEvidence(fields.length === 2 && pr?.base.ref === "integration" && pr.head.repo?.full_name === repository,
      "Expected a single squash-merged pull request for " + sha);
    const branch = pr.head.ref;
    const owner = /^(?:module\/|fix\/)(intake|memorial|permanent|exports)(?:-[1-9][0-9]*)?$/.exec(branch)?.[1];
    const auxiliary = /^(?:report\/\d{4}-\d{2}-\d{2}|skin\/[\w-]+)$/.test(branch);
    const typeSync = /^fix\/foundation-[1-9][0-9]*$/.test(branch) &&
      isMaintainer(pr.merged_by?.login ?? api("pulls/" + pr.number).merged_by?.login) &&
      git("diff", "--name-status", fields[1], sha) === "M\tsrc/lib/database.types.ts";
    const foundationRepair = isApprovedFoundationRepair(pr, fields[1], sha);
    requireEvidence(owner || auxiliary || typeSync || foundationRepair, "Unrecognised integration merge " + sha);
    if (requireChecks && !typeSync && !hasTrustedSchemaStatus(sha)) {
      const head = pr.head.sha;
      requireEvidence(fullSha.test(head), "Missing reviewed pull request head");
      // GitHub requires these named checks on the reviewed head. The target guard
      // also stamps the head with its trusted workflow run URL.
      const statuses = api("commits/" + head + "/statuses?per_page=100", true).flat();
      const checkRuns = api("commits/" + head + "/check-runs?filter=latest&per_page=100", true).flatMap((page) => page.check_runs);
      const guard = statuses.find((status) => status.context === "guard");
      const trustedUrl = new RegExp("^https://github\\.com/" + repository.replaceAll(".", "\\.") + "/actions/runs/(\\d+)$");
      const guardRunId = trustedUrl.exec(guard?.target_url ?? "")?.[1];
      const guardRun = guardRunId && api("actions/runs/" + guardRunId);
      const trustedGuard = guard?.state === "success" && guard.creator?.login === "github-actions[bot]" &&
        guardRun?.path?.split("@")[0] === ".github/workflows/guard.yml" &&
        guardRun.event === "pull_request_target" && guardRun.conclusion === "success" &&
        guardRun.repository?.full_name === repository && hasRunEvidence(guardRun, "guard-" + head);
      requireEvidence((foundationRepair || trustedGuard) &&
        checkRuns.some((run) => run.name === "verify" && run.head_sha === head &&
          run.app?.slug === "github-actions" && run.conclusion === "success"),
      "Missing trusted guard and verify on " + head);
      const e2e = statuses.find((status) => status.context === "e2e");
      const e2eRunId = trustedUrl.exec(e2e?.target_url ?? "")?.[1];
      const e2eRun = e2eRunId && api("actions/runs/" + e2eRunId);
      requireEvidence(e2e?.state === "success" && e2e.creator?.login === "github-actions[bot]" &&
        e2eRun?.path?.split("@")[0] === ".github/workflows/e2e-status.yml" &&
        e2eRun.event === "workflow_run" && e2eRun.conclusion === "success" && hasRunEvidence(e2eRun, "e2e-" + head) &&
        statuses.find((status) => status.context === "Vercel" && status.creator?.login === "vercel[bot]")?.state === "success",
      "Missing trusted E2E or Vercel result on " + head);
    }
    releases.push({ sha, owner: owner ?? "none", typeSync });
  }
  requireEvidence(releases.length && releases.at(-1).sha === target, "Cannot identify reviewed integration baseline");
  return releases;
}

function verifySignal(event, workflowName, filename, trigger) {
  const run = event.workflow_run;
  const workflow = api("actions/workflows/" + workflowName);
  requireEvidence(run && event.repository?.full_name === repository &&
    run.repository?.full_name === repository && run.head_repository?.full_name === repository &&
    run.workflow_id === workflow.id && run.path?.split("@")[0] === ".github/workflows/" + filename &&
    run.event === trigger && fullSha.test(run.head_sha), "Reject untrusted workflow signal");
  return run;
}

function manual(event) {
  const { mode, ref, pull_request: value } = event.inputs ?? {};
  requireEvidence(process.env.GITHUB_REF === "refs/heads/main" && isMaintainer(process.env.GITHUB_ACTOR) &&
    isMaintainer(process.env.GITHUB_TRIGGERING_ACTOR), "Start manual migrations from protected main as the maintainer");
  requireEvidence(fullSha.test(ref) && /^[1-9]\d*$/.test(value), "Enter the reviewed full SHA and PR number");
  const pr = api("pulls/" + value);
  requireEvidence(pr.base.ref === "main" && pr.head.repo?.full_name === repository,
    "Select the in-repository pull request targeting main");
  if (mode === "bootstrap-test") {
    requireEvidence(pr.head.ref === "stage-0" && pr.head.sha === ref && pr.state === "open", "Select the exact stage-0 PR head");
    requireEvidence(process.env.REVIEWED_SHA === ref, "The maintainer must independently confirm this exact SHA");
    return [{ sha: ref, owner: "foundation", reviewedBootstrap: true }];
  }
  requireEvidence(mode === "production" && pr.head.ref === "integration" && pr.head.sha === ref &&
    (readReviews(pr, ref) || process.env.REVIEWED_SHA === ref), "Use the maintainer-reviewed integration release SHA");
  const statuses = api("commits/" + ref + "/statuses?per_page=100", true).flat();
  requireEvidence(hasTrustedSchemaStatus(ref), "Test schema must already be green on this SHA");
  const checks = statuses.find((status) => status.context === "e2e");
  requireEvidence(checks?.state === "success" && checks.creator?.login === "github-actions[bot]", "E2E must already be green on this SHA");
  return releasesThrough(ref);
}

try {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const mode = process.argv[2];
  let releases;
  if (mode === "manual") releases = manual(event);
  else if (mode === "integration") {
    const run = verifySignal(event, "integration-merged.yml", "integration-merged.yml", "push");
    requireEvidence(run.head_branch === "integration" && run.conclusion === "success", "Integration signal must be a successful integration push");
    const newest = git("rev-parse", "origin/integration");
    // Reconcile queued signals against current first-parent history. Concurrency queues
    // can collapse pending signals, so a single run publishes evidence for all seen SHAs.
    releases = releasesThrough(newest);
    requireEvidence(releases.some(({ sha }) => sha === run.head_sha), "Signal SHA is not in the accepted merge chain");
  } else throw new Error("Select an explicit release verification mode");
  writeFileSync("verified-releases.json", JSON.stringify(releases, null, 2) + "\n");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
