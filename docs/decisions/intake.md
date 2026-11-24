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
