import { expect, it, vi } from "vitest";
import { displayKey } from "@/features/public/media-key";
import { changeRealPreparation } from "./real-preparation";
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
