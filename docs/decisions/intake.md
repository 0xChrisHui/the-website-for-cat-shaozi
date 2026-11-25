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

### Local evidence

The PostgreSQL probe passed on `83641c169908bd2f1d3e02d39b5b87caf051b9a2`. It applied all checked-in migrations to a disposable PostgreSQL 16 instance and executed the fixed `/api/intake/prepare` and `/api/intake/submit` handlers, original persistence, the maintainer list and detail readers, and the public timeline reader. SQL ran against PostgreSQL with the test web and worker roles. Auth and staging used synthetic adapters, with generated PNG bytes for original verification.

| Synthetic case | Observed result |
| --- | --- |
| Diary only | One 「待审核」 row with `photo_count=0` and no original byte total. The authenticated detail rendered the diary. |
| Mixed | One 「待审核」 row with `photo_count=1` and the original byte total. The authenticated detail rendered the diary and original byte count. The persisted PNG matched the fixture byte for byte. |
| Photo only | One 「待审核」 row with `photo_count=1` and the original byte total. The detail showed the photo and the persisted PNG matched the fixture byte for byte. |
| Withdrawn, approved-only, revised, explicitly excluded, blank diary, foreign source, corrupt original | Each was absent from the queue. The corrupt original failed verification. |
| Same-event replay | The first callback returned HTTP 202. Replay returned HTTP 200 with the original submission and job IDs. Each event still had one submission row and one intake job. |
| Publication and isolation | The public timeline returned zero rows with synthetic public-use rights but no published approval. Signed-out detail redirected to login and the foreign-source detail returned 404. Intake detail omitted staging keys, sender and source proof. |

The details display the first saved version for maintainer inspection. A later version makes the first version ineligible for the queue. The PostgreSQL probe runs separately from default Vitest because it requires a local server, migration bootstrap and test roles.

### CI evidence

PR #39 checks passed for the tested SHA `83641c169908bd2f1d3e02d39b5b87caf051b9a2`. [Verify](https://github.com/0xChrisHui/the-website-for-cat-shaozi/actions/runs/45535489293), [trusted guard](https://github.com/0xChrisHui/the-website-for-cat-shaozi/actions/runs/45535486685), [Preview E2E](https://github.com/0xChrisHui/the-website-for-cat-shaozi/actions/runs/45535519602). Refresh check and review evidence after the head changes.

### Open items for the maintainer

- The deployed fixed callbacks and the real Dot rows on the Preview SHA still need the manual F2/F3 confirmation described in `plan.md`.

## F2 mail restriction handoff

On the existing submit request, keep each photo's `position` in the original photo order. For a clearly identified attachment, send the shortest verbatim restriction clause in that item's existing `exclusionQuote`. For a submission-wide restriction, a numbered reference, or an unclear attachment target, send the shortest verbatim clause in the optional top-level `restrictionQuotes` array. Send separate entries for independent clauses. The array accepts up to 20 entries of up to 512 characters each. Never infer an attachment position from unclear wording or send the whole mail body.

For example, `["第 2 张不要上链"]` refers to the second photo in ascending `position` order, counting only photos. This keeps the photo eligible for site display and the private ZIP while excluding archive and NFT. `["Do not publish", "Do not include these in the ZIP"]` sets the separate site and ZIP restrictions for the submission. Unclear clauses stay pending for the affected scope. The site stores extracted flags from top-level quotes. Existing clients can omit the new array. This contract is ready for a later Dot integration.
