import { expect, it, vi } from "vitest";
import { displayKey } from "@/features/public/media-key";
import { changeRealPreparation, readPrivateReviewDisplay, retryInboxDisplays } from "./real-preparation";
import { ReviewConflict } from "./approve";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), items: vi.fn() }));
const submissionId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const sender = "a".repeat(64);

vi.mock("@/lib/env", () => ({
  readSiteEnv: () => ({ environment: "preview", BLOB_READ_WRITE_TOKEN: "synthetic", BLOB_STORE_HOST: "example.invalid" }),
}));
vi.mock("@/lib/supabase/database", () => ({ withWebsiteDb: vi.fn((run) => run({ query: mocks.query })) }));
vi.mock("./store", () => ({
  reviewScope: vi.fn(async () => ({ ready: true, sample: null, sender })),
  findSubmission: vi.fn(async () => ({ sender_hash: sender, received_at: "2026-11-25T00:00:00Z" })),
  readReviewItems: mocks.items,
}));
vi.mock("@/features/intake/review-display", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/intake/review-display")>(),
  reviewDisplayBlob: () => ({ read: mocks.read }),
}));

it("registers only a verified display for an ordinary photo allowed in private ZIP but never on the site", async () => {
  mocks.items.mockResolvedValue([{ id: itemId, version_id: versionId, kind: "photo", position: 0,
    withdrawn_at: null, approval: null, exclusion: "none" }]);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("as hints")) return { rows: [{ hints: { items: [] } }] };
    if (sql.includes("j.status")) return { rows: [{ item_id: itemId, version_id: versionId, status: "done" }] };
    return { rows: [] };
  });
  const change = { kind: "save", date: "2026-11-25", publicView: false, privateExport: true, arweave: false, nft: false } as const;
  const binding = { itemId, versionId };
  mocks.read.mockResolvedValueOnce(null);
  await expect(changeRealPreparation(submissionId, binding, change)).rejects.toBeInstanceOf(ReviewConflict);
  expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("insert into item_usage_rights"), expect.anything());

  mocks.read.mockResolvedValueOnce(Buffer.from("verified synthetic derivative"));
  await expect(changeRealPreparation(submissionId, binding, change)).resolves.toBeUndefined();
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into item_version_display"),
    [versionId, displayKey(itemId, versionId)]);
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into item_usage_rights"),
    [itemId, false, true, false, false]);
});

it("serves only the authenticated current derivative and denies withdrawn or stale bindings", async () => {
  const { reviewScope } = await import("./store");
  const photo = { id: itemId, version_id: versionId, version_number: 1, kind: "photo", position: 0,
    withdrawn_at: null, approval: null, exclusion: "none" };
  mocks.items.mockResolvedValue([photo]);
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("as hints") ? [{
      hints: { items: [] }, positions: [{ position: 0 }], automatic_display: true, status: "done",
    }] : [],
  }));
  mocks.read.mockClear();
  mocks.read.mockResolvedValue(Buffer.from("verified synthetic derivative"));
  const binding = { itemId, versionId };
  const signal = new AbortController().signal;
  await expect(readPrivateReviewDisplay(submissionId, binding, signal)).resolves.toBeInstanceOf(Buffer);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(displayKey(itemId, versionId), signal);

  vi.mocked(reviewScope).mockResolvedValueOnce(null);
  await expect(readPrivateReviewDisplay(submissionId, binding, signal)).resolves.toBeNull();
  await expect(readPrivateReviewDisplay(submissionId, { ...binding, versionId: submissionId }, signal)).resolves.toBeNull();
  mocks.items.mockResolvedValue([{ ...photo, withdrawn_at: "2026-11-25T00:00:00Z" }]);
  await expect(readPrivateReviewDisplay(submissionId, binding, signal)).resolves.toBeNull();
  expect(mocks.read).toHaveBeenCalledOnce();
});

it("serves prepared private photos from an unmatched sender while approval remains blocked", async () => {
  const { reviewScope } = await import("./store");
  const scope = { ready: true, sample: null, source: "stage0-grok", event: null, sender: undefined } as const;
  mocks.read.mockResolvedValue(Buffer.from("verified synthetic derivative"));
  const binding = { itemId, versionId };
  const signal = new AbortController().signal;
  mocks.items.mockResolvedValue([{ id: itemId, version_id: versionId, kind: "photo",
    position: 0, withdrawn_at: null, approval: null, exclusion: "explicit" }]);
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("as hints") ? [{
      positions: [{ position: 0 }], automatic_display: true, status: "done",
      restrictions: [{ position: 0, flags: { site: true, zip: true, chain: true, uncertain: true } }],
    }] : [],
  }));
  vi.mocked(reviewScope).mockResolvedValueOnce(scope);
  await expect(readPrivateReviewDisplay(submissionId, binding, signal)).resolves.toBeInstanceOf(Buffer);

  vi.mocked(reviewScope).mockResolvedValueOnce(scope);
  await expect(changeRealPreparation(submissionId, binding, {
    kind: "save", date: "2026-11-25", publicView: true, privateExport: true, arweave: false, nft: false,
  })).rejects.toBeInstanceOf(ReviewConflict);

  mocks.query.mockClear();
  vi.mocked(reviewScope).mockResolvedValueOnce(scope);
  await expect(retryInboxDisplays(submissionId, [binding], true)).resolves.toBeUndefined();
  expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into jobs"),
    ["intake.review-display", binding]);
  expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("insert into item_usage_rights"), expect.anything());
});
