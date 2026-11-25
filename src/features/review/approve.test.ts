import { beforeEach, describe, expect, it, vi } from "vitest";
import { approveSubmission, ReviewConflict } from "./approve";
import { readReviewForm, testPhotoReview } from "./photo-decision";
import { withdrawSubmission } from "./withdraw";
import { displayKey } from "@/features/public/media-key";
import type { ReviewItem } from "./store";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
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
vi.mock("@/lib/env", () => ({
  readSiteEnv: () => ({
    environment: "development", DATABASE_URL: "synthetic", SUPABASE_PROJECT_REF: "synthetic",
    EXPECTED_DATABASE_HOST: "synthetic.invalid", GROK_SENDER_SHA256: "1".repeat(64),
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
  version_id: versionId, local_date: "2026-01-02", diary_text: null, title: "合成授权照片",
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
