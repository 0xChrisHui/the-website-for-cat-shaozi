import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ReviewInbox } from "./inbox";

const ids = vi.hoisted(() => ({
  submission: "00000000-0000-4000-8000-000000000001",
  first: "00000000-0000-4000-8000-000000000002",
  second: "00000000-0000-4000-8000-000000000003",
  firstVersion: "00000000-0000-4000-8000-000000000004",
  secondVersion: "00000000-0000-4000-8000-000000000005",
}));

vi.mock("server-only", () => ({}));
vi.mock("./actions", () => ({
  confirmInbox: vi.fn(), retryInbox: vi.fn(), withdrawInbox: vi.fn(),
}));
vi.mock("@/features/review/store", () => ({
  inboxPageSize: 25,
  readInboxSubmissions: async () => [{
    id: ids.submission, received_at: new Date("2026-11-25T00:00:00Z"), sender_hash: "synthetic", pending: true,
  }],
  readReviewItems: async () => [[ids.first, ids.firstVersion], [ids.second, ids.secondVersion]].map(([id, version_id], position) => ({
    id, version_id, position, version_number: 1, kind: "photo", exclusion: "none", withdrawn_at: null, rights: null,
  })),
}));
vi.mock("@/lib/supabase/database", () => ({
  withWebsiteDb: (run: (db: object) => unknown) => run({
    query: async (sql: string) => ({ rows: sql.includes("as hints") ? [{
      positions: [{ position: 0 }, { position: 1 }], automatic_display: true, status: "done",
      hints: { items: [{ position: 1, exclusionQuote: "第 2 张不要上链" }] },
    }] : [] }),
  }),
}));

it("renders private version URLs and one approval action on the real inbox", async () => {
  const html = renderToStaticMarkup(await ReviewInbox({
    scope: { sample: null, ready: true, source: "stage0-grok", event: null, sender: "synthetic" },
  }));
  expect(html).toContain('dateTime="2026-11-25T00:00:00.000Z"');
  expect(html).toContain("2 张照片");
  expect(html).toContain("邮件限制：不上链");
  expect(html.match(/批准投稿<\/button>/g)).toHaveLength(1);
  expect(html).toContain("/maintain/review/" + ids.submission + "/display?item=" + ids.second + "&amp;version=" + ids.secondVersion);
  expect(html).not.toContain("/maintain/intake");
  expect(html).not.toContain("memorial/display");
});
