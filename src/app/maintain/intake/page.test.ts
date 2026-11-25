import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IntakePage from "./page";

const { readSample, readPublicSample, requireMaintainer, withWebsiteDb, queryRows } = vi.hoisted(() => ({
  readSample: vi.fn(),
  readPublicSample: vi.fn(),
  requireMaintainer: vi.fn(),
  withWebsiteDb: vi.fn((run: (db: object) => unknown) => run({})),
  queryRows: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/foundation/samples", () => ({ readSample, readPublicSample }));
vi.mock("@/lib/supabase/server", () => ({ requireMaintainer }));
vi.mock("@/lib/supabase/database", () => ({ withWebsiteDb, queryRows }));

beforeEach(() => {
  vi.clearAllMocks();
  readSample.mockResolvedValue(null);
  readPublicSample.mockResolvedValue(null);
  requireMaintainer.mockResolvedValue({ id: "synthetic-maintainer" });
  queryRows.mockResolvedValue([]);
  vi.stubEnv("CI", "false");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/postgres");
});

afterEach(() => vi.unstubAllEnvs());

it("redirects unauthorized requests to the existing login before accessing the database", async () => {
  requireMaintainer.mockResolvedValue(null);
  await expect(IntakePage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining(";/maintain/login;") });
  expect(withWebsiteDb).not.toHaveBeenCalled();
});

it("isolates sample login from the real maintainer queue", async () => {
  readSample.mockResolvedValue({ runId: "synthetic-run" });
  expect(renderToStaticMarkup(await IntakePage({ searchParams: Promise.resolve({}) }))).toContain("投递样本");
  expect(requireMaintainer).not.toHaveBeenCalled();
  expect(withWebsiteDb).not.toHaveBeenCalled();
});

it("isolates public sample sessions even with a maintainer login", async () => {
  readPublicSample.mockResolvedValue({ runId: "synthetic-run" });
  expect(renderToStaticMarkup(await IntakePage({ searchParams: Promise.resolve({}) }))).toContain("暂无可查看的投稿数据");
  expect(requireMaintainer).not.toHaveBeenCalled();
  expect(withWebsiteDb).not.toHaveBeenCalled();
});

it("avoids database access in CI even if authorization is present", async () => {
  vi.stubEnv("CI", "true");
  vi.stubEnv("DATABASE_URL", undefined);
  expect(renderToStaticMarkup(await IntakePage({ searchParams: Promise.resolve({}) }))).toContain("暂无可查看的投稿数据");
  expect(withWebsiteDb).not.toHaveBeenCalled();
});

it("queries only after authorization succeeds", async () => {
  let finishAuthorization!: (user: object) => void;
  requireMaintainer.mockReturnValue(new Promise((resolve) => { finishAuthorization = resolve; }));
  const page = IntakePage({ searchParams: Promise.resolve({}) });
  await vi.waitFor(() => expect(requireMaintainer).toHaveBeenCalled());
  expect(withWebsiteDb).not.toHaveBeenCalled();
  finishAuthorization({ id: "synthetic-maintainer" });
  expect(renderToStaticMarkup(await page)).toContain("暂无待办投稿");
  expect(withWebsiteDb).toHaveBeenCalledTimes(1);
});

it("requests one summary per pending real submission with a stable bounded order", async () => {
  const received_at = new Date("2026-11-25T02:00:00Z");
  queryRows.mockResolvedValue([
    { id: "second", received_at, status: "needs_attention", photo_count: 2, original_bytes: "21474836" },
    { id: "completed", received_at, status: "done", photo_count: 3, original_bytes: "31474836" },
    { id: "first", received_at, status: "queued", photo_count: 0, original_bytes: null },
  ]);

  const html = renderToStaticMarkup(await IntakePage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("已保存原图大小：21474836 字节");
  expect(html.match(/已保存原图大小/g)).toHaveLength(2);
  expect(html).toContain("已保存原图：2 张");
  expect(html).toContain("已保存原图：0 张");
  expect(html).toContain("待审核");
  expect(html).toContain("已保存原图：3 张");
  expect(html.indexOf("需处理")).toBeLessThan(html.indexOf("排队"));

  expect(queryRows).toHaveBeenCalledWith(expect.anything(), expect.any(String), ["stage0-grok", 50]);
  const sql: string = queryRows.mock.lastCall?.[1] ?? "";
  expect(sql).toMatch(/j\.sample_run_id is null/);
  expect(sql).toMatch(/order by j\.created_at desc, j\.id desc\s+limit 1/);
  expect(sql).toMatch(/s\.source = \$1/);
  expect(sql).toMatch(/order by p\.received_at desc, p\.id desc\s+limit \$2/);
  expect(sql).toContain("p.status = 'done' and originals.reviewable_count > 0");
  expect(sql).toContain("i.withdrawn_at is null and i.exclusion = 'none'");
  expect(sql).toContain("not exists (select 1 from approvals");
  expect(sql).toMatch(/where i\.submission_id = p\.id and i\.kind = 'photo'/);
  expect(sql).toMatch(/v\.version = 1/);
  expect(sql).toMatch(/count\(\*\)::int as photo_count/);
  expect(sql).toMatch(/order by p\.received_at desc, p\.id desc/);
  expect(sql).not.toMatch(/sender_hash|event_id|diary_text/);
});
