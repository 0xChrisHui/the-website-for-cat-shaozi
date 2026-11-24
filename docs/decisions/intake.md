# Intake acceptance boundary

The integration rehearsal verifies branch protection and the isolated intake runtime before feature development.

## Decision: intake development is shelved pending foundation contract changes (must_human)

Base SHA: `a9ad0f0fe5f391b2e9da590b8025cd81f8b198de`. Plan SHA: `389e2c9562952ec7fe83898fc9fb6de27b350f98`.

**Decision.** No intake feature code is written on `fix/intake-1`. `.ai/prompts/must-human.md` says missing shared contracts and database structure changes are "做不了" and must be shelved. No reversible test-only choice in `docs/plan.md` or `docs/questionnaire.md` covers the three gaps below. The first two are outside the intake writable paths, and the third needs a decision about existing schema.

**Gaps (each checked against the current tree).**

1. `src/lib/env.ts` reads only `STAGE0_INTAKE_TOKEN` and `TEST_CALLBACK_ORIGIN`. It does not read `GROK_INTAKE_TOKEN` or `PROD_CALLBACK_ORIGIN`, which plan.md (D1 and the secrets matrix) assigns to the production intake callback. This is a shared contract outside the intake paths.
2. `WorkerContext` in `src/lib/contracts/jobs.ts` offers only `files.read`, `jobs.finish` and `clock`. Intake needs original-file persistence, reference writes and staging cleanup. This is a shared contract outside the intake paths.
3. `submissions.event_id` is globally `unique` (migration `20261124120000_foundation_schema.sql`). The plan's dedupe key is `(environment, botSource, eventId)`. Changing it means dropping or replacing an existing constraint, which is a database structure change and may need a column addition. An intake-only `_intake_*.sql` migration is allowed by path, but must-human.md requires the maintainer to approve it. `submissions` and `stage0_uploads` also belong to the foundation schema.

**Reason.** Working around the gaps inside intake paths would either duplicate shared contracts, bypass the sample token with a fake production path, or silently change the dedupe semantics. The sample token must stay until intake switches over.

**Alternative considered.** Build only the parts that need no gap (UI, validation against synthetic fixtures). Rejected: the acceptance file `e2e/acceptance/delivered/intake.json` and the delivery switch cannot honestly be turned on without the callback, persistence and dedupe pieces. A half-built module would also leave tests that pass without covering the real path.

**Reversal.** Once foundation (or the maintainer) lands the contract changes and approves the migration approach, rerun the intake task from the then-current `integration` SHA. This file is the only change on this branch, so there is nothing to revert.

**Ask the maintainer.**

- Should foundation extend `src/lib/env.ts` with `GROK_INTAKE_TOKEN` and `PROD_CALLBACK_ORIGIN`, and extend `WorkerContext` with original-file persistence, reference writes and staging cleanup? If so, which exact signatures?
- For the dedupe key, may intake add an `_intake_*.sql` migration that replaces `unique(event_id)` with a unique key on `(environment, bot_source, event_id)`, adding the two columns? Or will foundation own that change? Is the existing `submissions` table empty in all environments, so the swap is non-destructive?

## Maintainer handoff — `needs-human`

**Evidence.** For Cezar run `190f7ccf-287b-4a0d-992d-0bac29086a76`, events 6 and 10 record successful scope and setup checks. The `decide` response records `must_human` (event 208). The workflow then selected `needs-human` (event 220), and event 222 started this writeup. At `c912da602cf1d25474dc017bf549a79bd60f9c28`, the only change from the rehearsal base is this decision file. The intake delivery flag is `false`, and the intake source tree contains only the existing worker socket. The blocker is the shared contract and schema decision recorded above.

**Recommendation.** Authorize a scoped foundation repair and assign foundation ownership of both the shared contract changes and the dedupe migration. Have the repair define the environment-specific callback configuration and the worker operations for durable original storage, reference writes and cleanup after the reference is saved. Have the same repair specify how existing rows get their environment and Bot source, whether existing metadata is sufficient, and how to validate the composite key before retiring the global uniqueness constraint. Agree on a data-preserving rollout with synthetic fixtures before any constraint replacement. Table contents across environments are unverified. Keep the production gate closed and retain the sample callback until the F2 cutover described in the plan.

**If approved.** Land the authorized foundation repair on `integration`, then dispatch intake from that updated commit. Use Mock or the test sandbox for callback isolation, concurrent replays, original-file persistence and private-draft acceptance. Require the intake unit and browser tests, acceptance spec and repository verification before treating intake as delivered.

**If declined or deferred.** Keep intake in `needs-human` with its flag disabled and preserve this branch as evidence. The current dependency graph lets `memorial` and `permanent` continue when their foundation and integration gates pass. `exports` can follow `memorial` once its dependency and integration gates pass. Close the batch with intake recorded as shelved if the other entries reach terminal states, and reopen intake when a maintainer authorizes a compatible foundation repair or approves a revised intake plan.

**Writeup checks.** The frozen-lockfile install and `corepack pnpm verify` passed (18 tests). The intake Playwright spec registers its test only when the delivery flag is enabled. With the flag still disabled, the targeted run returned `No tests found`; intake acceptance remains pending. `git diff --check` passed.
