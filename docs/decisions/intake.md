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
