# Intake acceptance boundary

The integration rehearsal verifies branch protection and the isolated intake runtime before feature development.

## F2 Preview recovery · 2026-11-25

Baseline `8d02e08080b09f4a8cfe82b2e20f713e340da137`, branch `fix/intake-4`.

- The fixed `/api/intake/prepare` and `/api/intake/submit` callbacks delegate to the same test gate and transaction as the E3 debug callbacks. Existing Preview origin and sender configuration determine availability. Dot can continue the existing manual E3 flow.
- The authenticated queue lists a completed submission as 「待审核」 when it has a first-version original that matches the latest real intake job by position, reference metadata and durable-key convention, with no later version, approval, withdrawal or exclusion. Pending and failed jobs retain their existing status. The page shows a photo count, aggregate byte size and Beijing receipt date without exposing private file references, source evidence or identity.
- With a signed sample login, open `/maintain/intake` directly. The shared navigation link is controlled by the delivery flag. The sample exercises one synthetic draft represented by the current URL, replay, per-item and common date hints, an ambiguous hint and explicit date correction. It has no attachment bytes and makes no real intake or database calls. Date corrections survive refresh of the corrected sample URL.

### Needs foundation changes

The authorized intake adapter and worker exchange photo positions and attachment references. The adapter rejects per-photo date hints, diaries and exclusion quotes, and the worker stores first-version file references. The shared boundary needs a durable, versioned draft write/read contract for submission evidence, item date hints and resolutions, diary text, exclusion candidates, per-item failure and original linkage. It also needs transactional supplement and content deduplication rules, including persistent exclusion inheritance and rechecking pending authorization after allowlist removal. The test sample session needs an isolated durable draft contract to model persisted writes, replay across independent navigation, and private attachments. Protected shared paths are required for these changes.

Still open for full acceptance are signed grant reuse and concurrent limit enforcement, repeat-content and supplement cases, item-level repair after a bad original, HEIC-to-JPEG derivation and authorized private media, ambiguous exclusion with public suppression, allowlist removal, and cleanup and retention rules. The test sender and original files remain under the existing manual procedure. The deployed fixed callbacks and the current Dot rows require manual confirmation on the tested Preview SHA. The intake delivery flag stays false.

### Local evidence

Frozen install, `pnpm verify` (71 tests), and the focused Vitest suite (32 tests) passed. A disposable PostgreSQL probe exercised the actual queue SQL with a completed large HEIC reference, a failed job, and approved, withdrawn, excluded, revised, mismatched, missing and sample rows. Browser feature checks passed on desktop and mobile, including refresh and login enforcement for the sample draft URL. The unchanged locked intake spec passed on desktop and mobile with the flag enabled only in a disposable local copy. In the branch configuration the locked spec discovers zero tests.

## F3 Diary-only intake queue and mixed end-to-end · 2026-11-25

Branch `fix/intake-6`, integration ancestor `1f9e71de9c70767e716e75960444d4c47a570ad4`, draft PR #39.

- **Decision:** Extend the existing queue SQL's `reviewable_count` with one diary branch (first-version `diary_text` is non-blank, no `file_ref`) beside the existing verified-original photo branch. Both branches share the same exclusions: not withdrawn, not excluded, no approval and no later version. A diary-only submission therefore shows as 「待审核」 with a photo count of 0, a mixed one keeps its verified originals, and photo-only behavior is unchanged. A diary item cannot revive a withdrawn, approved or ineligible submission. Fixed-callback, same-event replay and pre-approval public-timeline checks run as test-only evidence against a disposable local PostgreSQL carrying the current migrations and synthetic fixtures.
- **Reason:** `plan.md` and `questionnaire.md` (Q05, Q08) state that photo-only, diary-only and mixed submissions are all valid private drafts. They also state that nothing is public before approval. One SQL path with the same approved and version rules avoids a second eligibility definition. A disposable database needs no schema change, shared test schema, protected path or real data.
- **Alternative:** Run the same checks against the shared Preview or test schema. This was not chosen: it needs the maintainer's Preview rows, and synthetic rows would be mixed into shared state. A separate diary-only SQL query was also rejected because it would let the two eligibility rules drift apart.
- **Reversal:** Remove the diary `or` branch from `reviewable_count` in `src/features/intake/maintainer-queue.ts` and the matching cases in `src/app/maintain/intake/page.test.ts`. The queue then returns to the F2 photo-only rule. No migration, data or flag has to be undone, and the intake delivery flag stays false.

### Open items for the maintainer

- CI on `6112e1a`. The second `verify` attempt passed, including `forge test`, after the first attempt failed to download Foundry. The trusted `guard` also passed on its second attempt after a GitHub fetch timeout on the first attempt. Collect fresh evidence if the PR head changes.
- The deployed fixed callbacks and the real Dot rows on the Preview SHA still need the manual F2/F3 confirmation described in `plan.md`.
