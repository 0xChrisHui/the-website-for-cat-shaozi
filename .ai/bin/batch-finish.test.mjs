import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { finishBatch } from './batch-finish.mjs';

const now = '2026-11-24T17:00:00.000Z';
const branch = 'report/2026-11-25';
const key = 'Cezar batch sample/second final report';
const legacyReason = 'The report branch or task already exists';
const previousPr = {
  number: 18, state: 'OPEN', isDraft: true, isCrossRepository: false,
  baseRefName: 'integration', headRefName: branch,
};
const previousRun = {
  id: 'previous', workflow: 'final-report', branch, status: 'review',
  task: 'Cezar batch sample/first final report\nTask branch: ' + branch,
};

function setup(t, { report, prs = [previousPr], runs = [previousRun] } = {}) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'batch-finish-'));
  const summaryPath = join(dir, 'second-summary.md');
  const summary = '# Durable summary for the second batch\n';
  fs.writeFileSync(summaryPath, summary);
  t.after(() => {
    fs.unlinkSync(summaryPath);
    fs.rmdirSync(dir);
  });

  const ledger = {
    project: 'sample', batch: 'second', startedAt: '2026-11-24T16:30:00.000Z',
    deadlineAt: '2026-11-25T04:30:00.000Z', closedAt: now,
    modules: [], repairs: [], notices: { complete: { status: 'sent', at: now } },
    ...(report && { report: { key, expectedBranch: branch, runId: null, prNumber: null, ...report } }),
  };
  const saved = [];
  const submissions = [];
  const services = {
    now, summaryPath,
    save(data) { saved.push(structuredClone(data)); },
    notify() { assert.fail('The completion notice was already sent'); },
    cezar: {
      async listRuns() { return runs; },
      async submit(workflow, task) {
        submissions.push({ workflow, task });
        return { id: 'current' };
      },
    },
    forge: {
      listOpenPrs(expectedBranch) {
        assert.equal(expectedBranch, branch);
        return prs;
      },
    },
  };
  return { ledger, services, saved, submissions, summary };
}

for (const [name, report] of [
  ['a fresh report', undefined],
  ['an unsubmitted report held by the old collision check', { status: 'reconcile', reconcileReason: legacyReason }],
]) {
  test('an earlier Shanghai-date draft terminates ' + name, async t => {
    const { ledger, services, saved, submissions, summary } = setup(t, { report });
    assert.equal(await finishBatch(ledger, services), true);
    assert.equal(saved.at(-1).completedAt, now);
    assert.equal(saved.at(-1).report.status, 'failed');
    assert.match(saved.at(-1).report.reason, /open draft PR #18/);
    assert.equal(saved.at(-1).report.reconcileReason, undefined);
    assert.equal(saved.at(-1).report.submittedAt, undefined);
    assert.equal(saved.at(-1).report.prNumber, null);
    assert.deepEqual(submissions, []);
    assert.equal(fs.readFileSync(services.summaryPath, 'utf8'), summary);
  });
}

test('a clear report branch still submits and verifies the current batch report', async t => {
  const runs = [previousRun];
  const { ledger, services, saved, submissions } = setup(t, { prs: [], runs });
  assert.equal(await finishBatch(ledger, services), false);
  assert.equal(saved[0].report.status, 'submitting');
  assert.equal(saved[0].report.submittedAt, now);
  assert.equal(ledger.report.status, 'running');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].workflow, 'final-report');
  assert.deepEqual(submissions[0].task.split('\n').slice(0, 3),
    [key, 'Task branch: ' + branch, 'Read this completed batch summary: ' + services.summaryPath]);

  runs.push({ id: 'current', workflow: 'final-report', task: key, branch, status: 'review', prRef: { number: 19 } });
  services.forge.readPr = number => {
    assert.equal(number, 19);
    return { ...previousPr, number };
  };
  assert.equal(await finishBatch(ledger, services), true);
  assert.equal(ledger.report.status, 'done');
  assert.equal(ledger.report.prNumber, 19);
  assert.equal(submissions.length, 1);
});

for (const [name, options] of [
  ['a submission might have been accepted', { report: { status: 'reconcile', reconcileReason: legacyReason, submittedAt: now } }],
  ['the ledger already records a run ID', { report: { status: 'reconcile', reconcileReason: legacyReason, runId: 'current' } }],
  ['the ledger already records a PR', { report: { status: 'reconcile', reconcileReason: legacyReason, prNumber: 19 } }],
  ['the open branch has two pull requests', { prs: [previousPr, { ...previousPr, number: 19 }] }],
  ['the PR identity differs', { prs: [{ ...previousPr, isCrossRepository: true }] }],
  ['a report run has no identifiable task', { runs: [{ ...previousRun, task: undefined }] }],
  ['an old reconciliation has an unrelated reason', { report: { status: 'reconcile', reconcileReason: 'Manual reconciliation' } }],
  ['the old collision PR has disappeared', { report: { status: 'reconcile', reconcileReason: legacyReason }, prs: [] }],
]) {
  test('the report remains in reconciliation when ' + name, async t => {
    const { ledger, services, submissions } = setup(t, options);
    assert.equal(await finishBatch(ledger, services), false);
    assert.equal(ledger.report.status, 'reconcile');
    assert.equal(ledger.completedAt, undefined);
    assert.deepEqual(submissions, []);
  });
}

test('an observed exact report key remains in reconciliation if its run later disappears', async t => {
  const runs = [{ ...previousRun, task: key }];
  const { ledger, services, submissions } = setup(t, { runs });
  assert.equal(await finishBatch(ledger, services), false);
  assert.equal(ledger.report.status, 'reconcile');
  assert.match(ledger.report.reconcileReason, /report task already exists/);

  runs.length = 0;
  assert.equal(await finishBatch(ledger, services), false);
  assert.equal(ledger.report.status, 'reconcile');
  assert.equal(ledger.completedAt, undefined);
  assert.deepEqual(submissions, []);
});

test('a failed lookup leaves the batch open without submitting a report', async t => {
  const { ledger, services, submissions } = setup(t);
  services.forge.listOpenPrs = () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(finishBatch(ledger, services), /GitHub unavailable/);
  assert.equal(ledger.completedAt, undefined);
  assert.deepEqual(submissions, []);
});
