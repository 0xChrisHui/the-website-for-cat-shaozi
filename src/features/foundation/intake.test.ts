import { beforeEach, expect, it, vi } from "vitest";
import { readSiteEnv } from "@/lib/env";
import { bindIntakeOriginals } from "./intake-originals";
import { sampleIntake, senderHash } from "./intake";

const { query, transaction } = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ readSiteEnv: vi.fn() }));
vi.mock("@/lib/supabase/database", () => ({
  withWebsiteDb: transaction,
  queryRows: async (db: { query: typeof query }, sql: string, params: unknown[]) =>
    (await db.query(sql, params)).rows,
}));

const origin = "https://intake.example.invalid";
const sender = "allowed@example.invalid";
const token = "synthetic-intake-token";
const diary = {
  kind: "diary",
  position: 2,
  diaryText: "  测试正文\r\n\nSecond line.  ",
  dateHint: " 昨晚 ",
};
const photo = {
  kind: "photo",
  position: 5,
  attachmentRef: {
    objectKey: "stage0/test/050ac57a-ec5e-492d-815a-277f70c99481",
    sizeBytes: 5 * 1024 ** 2,
    mediaType: "image/heic",
    sha256: "a".repeat(64),
  },
  exclusionQuote: " 这张请先别用 ",
};
const commonDateHint = " 大概周六 ";

function submit(items: unknown[], email = sender) {
  return sampleIntake(new Request(origin + "/api/intake/submit", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({
      eventId: "synthetic-email",
      receivedAt: "2026-01-01T17:00:00Z",
      sender: email,
      commonDateHint,
      items,
    }),
  }), "submit");
}

function statements(prefix: string) {
  return query.mock.calls.filter(([sql]) => sql.trimStart().startsWith(prefix));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readSiteEnv).mockReturnValue({
    environment: "preview",
    ci: false,
    TEST_CALLBACK_ORIGIN: origin,
    STAGE0_INTAKE_TOKEN: token,
    GROK_SENDER_SHA256: senderHash(sender),
    BLOB_READ_WRITE_TOKEN: "synthetic-blob-token",
    BLOB_STORE_HOST: "blob.example.invalid",
    INTAKE_MAX_ITEMS: 10,
    INTAKE_MAX_EVENT_BYTES: 20 * 1024 ** 2,
  } as ReturnType<typeof readSiteEnv>);
  transaction.mockImplementation((run) => run({ query }));
  query.mockResolvedValue({ rows: [], rowCount: 1 });
});

it("queues only original photos and stores verbatim diary text and hints with the same submission", async () => {
  const response = await submit([diary, photo]);
  expect(response.status).toBe(202);
  const { submissionId, jobId } = await response.json();
  expect(statements("insert into submissions")).toEqual([
    [expect.any(String), [submissionId, "synthetic-email", senderHash(sender), "2026-01-01T17:00:00Z", "stage0-grok"]],
  ]);
  expect(statements("update stage0_uploads")).toEqual([[expect.any(String), [
    photo.attachmentRef.objectKey, "synthetic-email", senderHash(sender), 5,
    "image/heic", photo.attachmentRef.sizeBytes, photo.attachmentRef.sha256,
  ]]]);
  const itemWrites = statements("insert into items");
  expect(itemWrites).toHaveLength(1);
  const itemParams = itemWrites[0]?.[1];
  const itemId = itemParams?.[0];
  expect(itemParams).toEqual([expect.any(String), submissionId, 2]);
  expect(statements("insert into item_versions")).toEqual([[expect.any(String), [itemId, diary.diaryText]]]);
  const jobWrites = statements("insert into jobs");
  expect(jobWrites).toHaveLength(1);
  const jobParams = jobWrites[0]?.[1];
  expect(jobParams).toEqual([jobId, {
    submissionId,
    items: [{ kind: "photo", position: 5, attachmentRef: photo.attachmentRef }],
    hints: { commonDateHint, items: [
      { position: 2, dateHint: diary.dateHint },
      { position: 5, exclusionQuote: photo.exclusionQuote },
    ] },
  }, "queued"]);
  expect(bindIntakeOriginals({ query }, jobParams[1], "/unused", {
    read: vi.fn(), remove: vi.fn(),
  })).not.toBeNull();
  expect(statements("insert into approvals")).toHaveLength(0);
});

it("records diary-only submissions as done without claiming an upload", async () => {
  const response = await submit([diary]);
  expect(response.status).toBe(202);
  const { submissionId, jobId } = await response.json();
  expect(statements("update stage0_uploads")).toHaveLength(0);
  expect(statements("insert into item_versions")).toHaveLength(1);
  expect(statements("insert into jobs")).toEqual([[expect.any(String), [jobId, {
    submissionId, items: [],
    hints: { commonDateHint, items: [{ position: 2, dateHint: diary.dateHint }] },
  }, "done"]]]);
  expect(transaction).toHaveBeenCalledTimes(1);
});

it.each([
  { name: "diary-only", items: [diary] },
  { name: "mixed", items: [diary, photo] },
])("replays a $name submission with its original IDs", async ({ items }) => {
  const accepted = await submit(items);
  expect(accepted.status).toBe(202);
  const { submissionId, jobId } = await accepted.json();
  query.mockImplementation((sql: string) => ({
    rowCount: 1,
    rows: sql.includes("select s.id") ? [{ id: submissionId, job_id: jobId, sender_hash: senderHash(sender) }] : [],
  }));
  const replay = await submit(items);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ submissionId, jobId, duplicate: true });
  expect(statements("insert into submissions")).toHaveLength(1);
  expect(statements("insert into item_versions")).toHaveLength(1);
  expect(statements("insert into jobs")).toHaveLength(1);
  expect(statements("update stage0_uploads")).toHaveLength(items.length - 1);
});

it("aborts the transaction when a second photo grant cannot be claimed", async () => {
  query.mockImplementation((sql: string, params: unknown[]) => ({
    rows: [],
    rowCount: sql.includes("update stage0_uploads") && params[3] === 6 ? 0 : 1,
  }));
  const response = await submit([diary, photo, { ...photo, position: 6 }]);
  expect(response.status).toBe(400);
  expect(statements("update stage0_uploads")).toHaveLength(2);
  await expect(transaction.mock.results[0]?.value).rejects.toThrow("Sample intake rejected");
  expect(statements("insert into submissions")).toHaveLength(0);
  expect(statements("insert into item_versions")).toHaveLength(0);
  expect(statements("insert into jobs")).toHaveLength(0);
});

it("rejects a position shared between a photo and diary before writing", async () => {
  expect((await submit([diary, { ...photo, position: diary.position }])).status).toBe(400);
  expect(transaction).not.toHaveBeenCalled();
});

it("rejects diary submissions from an unauthorized sender before writing", async () => {
  expect((await submit([diary], "unlisted@example.invalid")).status).toBe(403);
  expect(transaction).not.toHaveBeenCalled();
});

it.each([
  { ...diary, diaryText: undefined },
  { ...diary, attachmentRef: photo.attachmentRef },
  { ...photo, attachmentRef: undefined },
  { ...photo, diaryText: diary.diaryText },
  { ...diary, unexpected: true },
])("rejects unsupported item fields or missing content", async (item) => {
  expect((await submit([item])).status).toBe(400);
  expect(transaction).not.toHaveBeenCalled();
});
