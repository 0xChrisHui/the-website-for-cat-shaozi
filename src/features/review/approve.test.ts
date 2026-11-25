import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveInbox, approveSubmission, ReviewConflict } from "./approve";
import { readReviewForm, testPhotoReview } from "./photo-decision";
import { withdrawSubmission } from "./withdraw";
import { displayKey } from "@/features/public/media-key";
import type { ReviewItem } from "./store";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  display: vi.fn(),
  readSample: vi.fn(),
  readPublicSample: vi.fn(),
  requireMaintainer: vi.fn(),
  query: vi.fn(),
  queryRows: vi.fn(),
  withWebsiteDb: vi.fn(),
}));

vi.mock("@/features/foundation/samples", () => ({
  readSample: mocks.readSample,
  readPublicSample: mocks.readPublicSample,
}));
vi.mock("@/lib/supabase/server", () => ({ requireMaintainer: mocks.requireMaintainer }));
vi.mock("@/lib/supabase/database", () => ({
  withWebsiteDb: mocks.withWebsiteDb,
  queryRows: mocks.queryRows,
}));
vi.mock("@/features/intake/review-display", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/features/intake/review-display")>(),
  reviewDisplayBlob: () => ({ read: mocks.display }),
}));
vi.mock("@/lib/env", () => ({
  readSiteEnv: () => ({
    environment: "development", DATABASE_URL: "synthetic", SUPABASE_PROJECT_REF: "synthetic",
    EXPECTED_DATABASE_HOST: "synthetic.invalid", GROK_SENDER_SHA256: "1".repeat(64),
    BLOB_READ_WRITE_TOKEN: "synthetic", BLOB_STORE_HOST: "example.invalid",
  }),
}));

const submissionId = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const versionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const approvedAt = "2026-01-02T01:00:01.012Z";
const decision = { itemId, versionId, publicView: true, arweave: false, nft: false };
const input = { submissionId, requestId, decisions: [decision] };
const item: ReviewItem = {
  id: itemId, kind: "photo", position: 0, exclusion: "none", withdrawn_at: null,
  version_id: versionId, version_number: 1, historical_approval: false, local_date: "2026-01-02", diary_text: null, title: "合成授权照片",
  processed_media_ref: displayKey(itemId, versionId),
  rights: { public_view: true, private_export: false, arweave: false, nft: false },
  approval: null,
};
const previous = {
  item_id: itemId, version_id: versionId, approved_at: approvedAt, source: "manual",
  published: true, public_view: true, private_export: false, arweave: false, nft: false,
  recipient_config_version: null,
};

function current(row: ReviewItem) {
  mocks.queryRows.mockResolvedValueOnce([{ sender_hash: "1".repeat(64) }]).mockResolvedValueOnce([row]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readSample.mockResolvedValue(null);
  mocks.readPublicSample.mockResolvedValue(null);
  mocks.requireMaintainer.mockResolvedValue({ id: "synthetic" });
  mocks.withWebsiteDb.mockImplementation((run) => run({ query: mocks.query }));
  mocks.query.mockResolvedValue({ rows: [{ approved_at: new Date(approvedAt) }] });
});

describe("manual confirmation", () => {
  it.each([null, { runId: submissionId }])("denies anonymous/public-only sessions (%o)", async (ticket) => {
    mocks.readPublicSample.mockResolvedValue(ticket);
    mocks.requireMaintainer.mockResolvedValue(null);
    await expect(approveSubmission(input)).rejects.toBeInstanceOf(ReviewConflict);
    await expect(withdrawSubmission(submissionId)).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.withWebsiteDb).not.toHaveBeenCalled();
  });

  it("writes a manual snapshot once and returns the same snapshot on retry", async () => {
    current(item);
    current({ ...item, approval: previous });
    const first = await approveSubmission(input);
    expect(first).toEqual([{ ...decision, source: "manual", approvedAt }]);
    expect(await approveSubmission(input)).toEqual(first);
    const inserts = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into approvals"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toEqual([itemId, versionId, true, false]);
  });

  it("invalidates the same scope when a new approval grants private export", async () => {
    current({ ...item, rights: { ...item.rights!, private_export: true } });
    await approveSubmission(input);
    const statements = mocks.query.mock.calls.map(([statement]) => statement);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements).toContainEqual(expect.stringContaining("update current_export set downloadable=false"));
    expect(statements).toContainEqual(expect.stringContaining("update private_export_objects"));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into approvals"),
      [itemId, versionId, true, true]);
  });

  it("writes the outbox binding and exact queue payload with the eligible manual approval", async () => {
    current({ ...item, rights: { ...item.rights!, arweave: true } });
    mocks.query.mockImplementation(async (sql: string) => sql.includes("insert into approvals")
      ? { rows: [{ approved_at: new Date(approvedAt) }] }
      : { rowCount: 1, rows: [] });
    await approveSubmission({ ...input, decisions: [{ ...decision, arweave: true }] });
    const inserts = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into"));
    expect(inserts.map(([sql]) => /insert into (\w+)/.exec(sql)?.[1]))
      .toEqual(["approvals", "test_photo_jobs", "jobs"]);
    const [jobId] = inserts[1]?.[1] ?? [];
    expect(inserts[1]?.[1]).toEqual([jobId, itemId, versionId]);
    expect(inserts[2]?.[1]).toEqual([jobId, "permanent.archive-photo", { itemId }]);
    expect(mocks.withWebsiteDb).toHaveBeenCalledOnce();
  });

  it("submits an explicit fixed recipient through the review form and binds its manual job", async () => {
    const form = new FormData();
    form.set("item", itemId + "/" + versionId);
    form.set("public-" + itemId, "on");
    const choice = "test-photo-" + itemId;
    expect(readReviewForm(form)).toEqual([decision]);
    const eligible = { ...item, rights: { ...item.rights!, arweave: true, nft: true } };
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from site_settings")) return { rows: [{ value: {
        archive: false, mint: false, recipientVersion: requestId,
      } }] };
      if (sql.includes("insert into approvals")) return { rows: [{ approved_at: new Date(approvedAt) }] };
      return { rowCount: 1, rows: [] };
    });

    form.set(choice, submissionId);
    current(eligible);
    await expect(approveSubmission({ ...input, decisions: readReviewForm(form) })).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into approvals"))).toBe(false);

    form.set(choice, requestId);
    current(eligible);
    await expect(approveSubmission({ ...input, decisions: readReviewForm(form) })).resolves.toMatchObject([{
      source: "manual", arweave: true, nft: true, recipientConfigVersion: requestId,
    }]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into approvals"),
      [itemId, versionId, true, false, true, requestId]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("insert into jobs"),
      [expect.any(String), "permanent.archive-photo", { itemId }]);
    expect(testPhotoReview("production", null)).toBe(false);
    expect(testPhotoReview("preview", { runId: requestId })).toBe(false);
    form.append(choice, "archive");
    expect(() => readReviewForm(form)).toThrow();
  });

  it.each([
    { version_id: requestId },
    { rights: { ...item.rights!, public_view: false } },
    { rights: null },
    { exclusion: "explicit" },
    { withdrawn_at: approvedAt },
    { processed_media_ref: "https://original.example.invalid/private" },
    { approval: { ...previous, published: false, public_view: false } },
  ])("rejects stale or ineligible state %o before inserting", async (change) => {
    current({ ...item, ...change });
    await expect(approveSubmission(input)).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into approvals"))).toBe(false);
  });

  it("does not approve an unknown sender or request any permanent work", async () => {
    mocks.queryRows.mockResolvedValueOnce([{ sender_hash: "2".repeat(64) }]);
    await expect(approveSubmission(input)).rejects.toBeInstanceOf(ReviewConflict);
    current(item);
    await expect(approveSubmission({ ...input, decisions: [{ ...decision, arweave: true }] }))
      .rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => /insert into (jobs|approvals)/.test(sql))).toBe(false);
  });

  it("scopes signed sample review to that run and marks withdrawal without deleting receipts", async () => {
    mocks.readSample.mockResolvedValue({ runId: requestId });
    mocks.queryRows.mockResolvedValueOnce([{ sender_hash: "1".repeat(64) }]);
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [] });
    await withdrawSubmission(submissionId);
    expect(mocks.queryRows).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("for update"),
      ["memorial-review-sample", "memorial-review-sample:" + requestId, submissionId]);
    const statements = mocks.query.mock.calls.map(([statement]) => statement);
    expect(statements.some((statement) => /operation_receipts/i.test(statement))).toBe(false);
    expect(statements.filter((statement) => /^delete/i.test(statement.trim()))).toEqual([
      expect.stringContaining("delete from private_export_objects"),
    ]);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements).toContainEqual(expect.stringContaining("update private_export_objects"));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("set withdrawn_at = now()"), [submissionId]);
  });
});

const secondId = "00000000-0000-4000-8000-000000000005";
const secondVersion = "00000000-0000-4000-8000-000000000006";
const firstPhoto = { ...item, version_number: 1, rights: null, local_date: null, processed_media_ref: null };
const secondPhoto = { ...firstPhoto, id: secondId, version_id: secondVersion, position: 3 };
function inboxBinding(first: string | null = "2026-01-02/1111", second: string | null = "2026-01-02/1111") {
  return [[itemId, versionId, first], [secondId, secondVersion, second]];
}
const received = new Date("2026-01-01T17:00:00Z");

function inbox(items: ReviewItem[], hints: { position: number; exclusionQuote: string }[] = [], sender = "1".repeat(64)) {
  mocks.queryRows.mockResolvedValueOnce([{ sender_hash: sender, received_at: received }]).mockResolvedValueOnce(items);
  mocks.query.mockImplementation(async (sql: string) => ({
    rowCount: 1,
    rows: sql.includes("as hints") ? [{
      hints: { commonDateHint: "invalid", items: hints },
      positions: [{ position: 0 }, { position: 3 }],
      automatic_display: true, status: "done",
    }] : [],
  }));
  mocks.display.mockResolvedValue(Buffer.from("synthetic validated derivative"));
}

describe("one-click inbox approval", () => {
  it("approves both exact previews, records no-chain rights only on the second, and replays without writes", async () => {
    const hints = [{ position: 3, exclusionQuote: "第 2 张不要上链" }];
    inbox([firstPhoto, secondPhoto], hints);
    await approveInbox(submissionId, inboxBinding("2026-01-02/1111", "2026-01-02/1100"));
    expect(mocks.display.mock.calls.map(([key]) => key)).toEqual([
      displayKey(itemId, versionId), displayKey(secondId, secondVersion),
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("set local_date"), [versionId, "2026-01-02"]);
    const writes = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into item_usage_rights"));
    expect(writes.map(([, params]) => params)).toEqual([
      [itemId, true, true, true, true], [secondId, true, true, false, false],
    ]);
    const approvals = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into approvals"));
    expect(approvals.map(([, params]) => params)).toEqual([
      [itemId, versionId, true, true], [secondId, secondVersion, true, true],
    ]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("update current_export"));
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into jobs") || sql.includes("test_photo_jobs"))).toBe(false);

    mocks.query.mockClear();
    inbox([
      { ...firstPhoto, approval: previous },
      { ...secondPhoto, approval: { ...previous, item_id: secondId, version_id: secondVersion } },
    ], hints);
    await approveInbox(submissionId, inboxBinding("2026-01-02/1111", "2026-01-02/1100"));
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into") || sql.includes("update current_export"))).toBe(false);
  });

  it("honors separate site and ZIP restrictions and intersects saved overrides", async () => {
    inbox([
      { ...firstPhoto, rights: { public_view: true, private_export: true, arweave: false, nft: false } },
      secondPhoto,
    ], [{ position: 0, exclusionQuote: "不要公开" }, { position: 3, exclusionQuote: "Do not include this in the ZIP." }]);
    await approveInbox(submissionId, inboxBinding("2026-01-02/0100", "2026-01-02/1011"));
    const writes = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into item_usage_rights"));
    expect(writes.map(([, params]) => params)).toEqual([
      [itemId, false, true, false, false], [secondId, true, false, true, true],
    ]);
  });

  it("leaves ambiguous, historically approved, and previously approved items untouched", async () => {
    inbox([{ ...firstPhoto, historical_approval: true }, secondPhoto], [{ position: 3, exclusionQuote: "请先别用" }]);
    await expect(approveInbox(submissionId, inboxBinding(null, null))).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into"))).toBe(false);
  });

  it.each([
    { label: "withdrawn", row: { ...secondPhoto, withdrawn_at: "2026-01-03T00:00:00Z" } },
    { label: "stale", row: { ...secondPhoto, version_id: requestId } },
  ])("rejects a $label binding before any writes", async ({ row }) => {
    inbox([firstPhoto, row]);
    await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.display).not.toHaveBeenCalled();
  });

  it("rejects unauthorized sessions and a mismatching sender", async () => {
    mocks.requireMaintainer.mockResolvedValueOnce(null);
    await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.withWebsiteDb).not.toHaveBeenCalled();
    inbox([firstPhoto, secondPhoto], [], "2".repeat(64));
    await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.display).not.toHaveBeenCalled();
  });

  it("rejects approval if the exact derivative cannot be read", async () => {
    inbox([firstPhoto, secondPhoto]);
    mocks.display.mockResolvedValue(null);
    await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into"))).toBe(false);
  });

  it("prevents the legacy form from opting a no-chain item into permanent work", async () => {
    const eligible = { ...item, rights: { ...item.rights!, arweave: true, nft: true } };
    inbox([eligible], [{ position: 0, exclusionQuote: "Don't put this on-chain." }]);
    await expect(approveSubmission({ ...input, decisions: [{ ...decision, arweave: true }] }))
      .rejects.toBeInstanceOf(ReviewConflict);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into"))).toBe(false);
  });
});

it("uses eligible diary destinations and preserves already granted private ZIP on a legacy excluded photo", async () => {
  inbox([
    { ...firstPhoto, kind: "diary", diary_text: "合成日记", local_date: "2026-01-01" },
    { ...secondPhoto, exclusion: "explicit", rights: { public_view: true, private_export: true, arweave: true, nft: true } },
  ]);
  await approveInbox(submissionId, inboxBinding("2026-01-01/1100", "2026-01-02/0100"));
  const writes = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into item_usage_rights"));
  expect(writes.map(([, params]) => params)).toEqual([
    [itemId, true, true, false, false], [secondId, false, true, false, false],
  ]);
  expect(mocks.display).not.toHaveBeenCalled();
});

it("rejects a stale action after an in-place rights or date change", async () => {
  inbox([firstPhoto, { ...secondPhoto, local_date: "2026-01-03" }]);
  await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
  inbox([firstPhoto, { ...secondPhoto, rights: {
    public_view: false, private_export: true, arweave: false, nft: false,
  } }]);
  await expect(approveInbox(submissionId, inboxBinding())).rejects.toBeInstanceOf(ReviewConflict);
  expect(mocks.query.mock.calls.some(([sql]) => sql.includes("insert into"))).toBe(false);
});

it("approves an unaffected attachment while leaving a scoped ambiguity pending", async () => {
  inbox([firstPhoto, secondPhoto], [{ position: 3, exclusionQuote: "请先别用" }]);
  await approveInbox(submissionId, inboxBinding("2026-01-02/1111", null));
  const approvals = mocks.query.mock.calls.filter(([sql]) => sql.includes("insert into approvals"));
  expect(approvals.map(([, params]) => params)).toEqual([[itemId, versionId, true, true]]);
});
