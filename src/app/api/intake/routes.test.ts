import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { senderHash } from "@/features/foundation/intake";
import { POST as prepare } from "./prepare/route";
import { POST as submit } from "./submit/route";

const { withWebsiteDb, queryRows, issueSignedToken } = vi.hoisted(() => ({
  withWebsiteDb: vi.fn(),
  queryRows: vi.fn(),
  issueSignedToken: vi.fn(),
}));
vi.mock("@/lib/supabase/database", () => ({ withWebsiteDb, queryRows }));
vi.mock("@vercel/blob", () => ({ issueSignedToken, presignUrl: vi.fn() }));

const origin = "https://intake-preview.example.invalid";
const token = "synthetic-preview-token-for-route-test";
const sender = "fixture@example.invalid";

function request(path: string, {
  base = origin, authorization = token, email = sender, metadata = {},
} = {}) {
  return new Request(base + "/api/intake/" + path, {
    method: "POST",
    headers: { authorization: "Bearer " + authorization, "content-type": "application/json" },
    body: JSON.stringify({ sender: email, ...metadata }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("CI", "false");
  vi.stubEnv("TEST_CALLBACK_ORIGIN", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.example.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-key");
  vi.stubEnv("SUPABASE_PROJECT_REF", "synthetic");
  vi.stubEnv("MAINTAINER_UID", "050ac57a-ec5e-492d-815a-277f70c99481");
  vi.stubEnv("EXPECTED_DATABASE_HOST", "database.example.invalid");
  vi.stubEnv("DATABASE_URL", "postgres://database.example.invalid/postgres");
  vi.stubEnv("SAMPLE_SESSION_SECRET", "synthetic-session-signing-key-for-test");
  vi.stubEnv("STAGE0_INTAKE_TOKEN", token);
  vi.stubEnv("GROK_SENDER_SHA256", senderHash(sender));
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "synthetic-blob-token");
  vi.stubEnv("BLOB_STORE_HOST", "blob.example.invalid");
});
afterEach(() => vi.unstubAllEnvs());

it.each([["prepare", prepare], ["submit", submit]] as const)("%s is restricted to the approved preview origin", async (path, post) => {
  expect((await post(request(path, { base: "https://other.example.invalid" }))).status).toBe(404);
  vi.stubEnv("VERCEL_ENV", "production");
  expect((await post(request(path))).status).toBe(404);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("TEST_CALLBACK_ORIGIN", undefined);
  expect((await post(request(path))).status).toBe(404);
  expect(withWebsiteDb).not.toHaveBeenCalled();
  expect(issueSignedToken).not.toHaveBeenCalled();
});

it.each([["prepare", prepare], ["submit", submit]] as const)("%s enforces token, allowlist and schema before side effects", async (path, post) => {
  expect((await post(request(path, { authorization: "other-token" }))).status).toBe(401);
  expect((await post(request(path, { email: "unlisted@example.invalid" }))).status).toBe(403);
  expect((await post(request(path))).status).toBe(400);
  expect(withWebsiteDb).not.toHaveBeenCalled();
  expect(issueSignedToken).not.toHaveBeenCalled();
});

it("submits and replays a large HEIC through the same source-scoped storage contract", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 1 });
  const runTransaction = (run: (db: { query: typeof query }) => unknown) => run({ query });
  withWebsiteDb.mockImplementationOnce(runTransaction).mockImplementationOnce(runTransaction);
  queryRows.mockResolvedValueOnce([]);

  const metadata = {
    eventId: "synthetic-preview-event",
    receivedAt: "2026-01-01T17:00:00Z",
    items: [{
      kind: "photo", position: 0,
      attachmentRef: {
        objectKey: "synthetic-stage",
        sizeBytes: 5 * 1024 ** 2,
        mediaType: "image/heic",
        sha256: "a".repeat(64),
      },
    }],
  };
  const accepted = await submit(request("submit", { metadata }));
  expect(accepted.status).toBe(202);
  const { submissionId, jobId } = await accepted.json();
  queryRows.mockResolvedValueOnce([{ id: submissionId, job_id: jobId, sender_hash: senderHash(sender) }]);

  const replay = await submit(request("submit", { metadata }));
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ submissionId, jobId, duplicate: true });
  expect(queryRows).toHaveBeenCalledTimes(2);
  expect(queryRows).toHaveBeenLastCalledWith(expect.anything(), expect.any(String),
    ["synthetic-preview-event", "stage0-grok"]);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith("insert into submissions"))).toHaveLength(1);
  expect(query.mock.calls.filter(([sql]) => sql.startsWith("insert into jobs"))).toHaveLength(1);
});
