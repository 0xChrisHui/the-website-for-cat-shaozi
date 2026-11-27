import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ReviewInbox } from "./inbox";

const scenario = vi.hoisted(() => ({ approved: false, auto: false }));
const diaryText = "今天的日记第一段。\n\n今天的日记第二段。";

const ids = vi.hoisted(() => ({
  submission: "00000000-0000-4000-8000-000000000001",
  first: "00000000-0000-4000-8000-000000000002",
  second: "00000000-0000-4000-8000-000000000003",
  firstVersion: "00000000-0000-4000-8000-000000000004",
  secondVersion: "00000000-0000-4000-8000-000000000005",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({
  confirmInbox: vi.fn(), retryInbox: vi.fn(), setAutoApproval: vi.fn(), withdrawInbox: vi.fn(),
}));
vi.mock("@/features/review/store", () => ({
  inboxPageSize: 25,
  readInboxSubmissions: async () => [{
    id: ids.submission, received_at: new Date("2026-11-25T00:00:00Z"), sender_hash: "synthetic", pending: !scenario.approved,
  }],
  canPublish: () => true,
  readReviewItems: async () => [
    ...[[ids.first, ids.firstVersion], [ids.second, ids.secondVersion]].map(([id, version_id], position) => ({
      id, version_id, position, version_number: 1, kind: "photo", exclusion: "none", withdrawn_at: null, rights: null,
      approval: scenario.approved ? { published: true } : null,
    })),
    { id: "synthetic-diary", version_id: "synthetic-diary-version", position: 2, version_number: 1,
      kind: "diary", exclusion: "none", withdrawn_at: null, rights: null, diary_text: diaryText,
      approval: scenario.approved ? { published: true } : null },
  ],
}));
vi.mock("@/lib/supabase/database", () => ({
  withWebsiteDb: (run: (db: object) => unknown) => run({
    query: async (sql: string) => ({ rows: sql.includes("from site_settings") && scenario.auto ? [{ version: 1,
      value: { sender: "a".repeat(64), confirmedAt: "2026-11-25T00:00:00Z" },
    }] : sql.includes("as hints") ? [{
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
  expect(html).toContain('<p class="whitespace-pre-wrap wrap-anywhere">' + diaryText + '</p>');
  expect(html).not.toContain("查看日记全文");
  expect(html.match(/批准投稿<\/button>/g)).toHaveLength(1);
  expect(html).toContain("/maintain/review/" + ids.submission + "/display?item=" + ids.second + "&amp;version=" + ids.secondVersion);
  expect(html).not.toContain("/maintain/intake");
  expect(html).not.toContain("memorial/display");
});

it("keeps the full diary and attachment restrictions visible after approval", async () => {
  scenario.approved = true;
  try {
    const html = renderToStaticMarkup(await ReviewInbox({
      scope: { sample: null, ready: true, source: "stage0-grok", event: null, sender: "synthetic" },
    }));
    expect(html).toContain("已发布");
    expect(html).toContain(diaryText);
    expect(html).toContain("邮件限制：不上链");
    expect(html).toContain("&amp;version=" + ids.secondVersion);
    expect(html).not.toContain(">批准投稿</button>");
  } finally { scenario.approved = false; }
});

it("keeps diary text and sender restrictions out of a different sender scope", async () => {
  const html = renderToStaticMarkup(await ReviewInbox({
    scope: { sample: null, ready: true, source: "stage0-grok", event: null, sender: "unmatched" },
  }));
  expect(html).not.toContain(diaryText);
  expect(html).not.toContain("邮件限制：不上链");
});

it("shows the off state by default and lets a maintainer turn an active setting off", async () => {
  const scope = { sample: null, ready: true, source: "stage0-grok", event: null, sender: "synthetic" };
  const before = renderToStaticMarkup(await ReviewInbox({ scope }));
  expect(before).toContain("自动批准 · 已关闭");
  expect(before).toContain(">开启自动批准</button>");
  scenario.auto = true;
  try {
    const after = renderToStaticMarkup(await ReviewInbox({ scope }));
    expect(after).toContain("自动批准 · 已开启");
    expect(after).toContain(">关闭自动批准</button>");
  } finally { scenario.auto = false; }
});

it("puts collapsible pending submissions before automatic approval settings", async () => {
  const html = renderToStaticMarkup(await ReviewInbox({
    scope: { sample: null, ready: true, source: "stage0-grok", event: null, sender: "synthetic" },
  }));
  expect(html.indexOf("待审核投稿</h2>")).toBeLessThan(html.indexOf("自动批准 · 已关闭"));
  expect(html).toMatch(/<details[^>]*><summary[^>]*>.*?2 张照片.*?待审核/);
});
