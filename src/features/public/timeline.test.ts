import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPublishedTimeline } from "./timeline";

vi.mock("server-only", () => ({}));
const { withWebsiteDb, queryRows } = vi.hoisted(() => ({
  withWebsiteDb: vi.fn((run: (db: object) => unknown) => run({})),
  queryRows: vi.fn(),
}));
vi.mock("@/lib/supabase/database", () => ({ withWebsiteDb, queryRows }));

const approved = {
  item_id: "00000000-0000-4000-8000-000000000001",
  current_version_id: "00000000-0000-4000-8000-000000000002",
  approved_version_id: "00000000-0000-4000-8000-000000000002",
  kind: "photo",
  local_date: "2026-11-25",
  position: 0,
  published: true,
  withdrawn_at: null,
  exclusion: "none",
  approval_public_view: true,
  rights_public_view: true,
  title: "公开标题",
  caption: "公开说明",
  diary_text: "照片条目上的意外文本",
  processed_media_ref: "private/processed",
  file_ref: { objectKey: "private/original" },
  sender_hash: "internal-sender",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CI", "false");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgres://synthetic.invalid/postgres");
  vi.stubEnv("SUPABASE_PROJECT_REF", "synthetic");
  vi.stubEnv("EXPECTED_DATABASE_HOST", "synthetic.invalid");
});

afterEach(() => vi.unstubAllEnvs());

describe("public timeline", () => {
  it("projects approved display copy without internal references or sender fields", async () => {
    queryRows.mockResolvedValue([approved]);
    const items = await readPublishedTimeline();
    expect(items).toEqual([{
      itemId: approved.item_id,
      currentVersionId: approved.current_version_id,
      kind: "photo",
      localDate: approved.local_date,
      sortOrder: 0,
      title: approved.title,
      caption: approved.caption,
    }]);
    expect(JSON.stringify(items)).not.toMatch(/private\/|internal-sender|意外文本/);
  });

  it("allows the current diary text", async () => {
    queryRows.mockResolvedValue([{ ...approved, kind: "diary", diary_text: "公开日记" }]);
    expect(await readPublishedTimeline()).toMatchObject([{ diaryText: "公开日记" }]);
  });

  it.each([
    { approval_public_view: false },
    { approved_version_id: "00000000-0000-4000-8000-000000000003" },
    { approved_version_id: null },
    { rights_public_view: null },
    { rights_public_view: false },
    { published: false },
    { withdrawn_at: "2026-11-25T00:00:00Z" },
    { exclusion: "explicit" },
    { exclusion: "ambiguous" },
    { local_date: null },
  ])("omits rows with %o", async (change) => {
    queryRows.mockResolvedValue([{ ...approved, ...change }]);
    expect(await readPublishedTimeline()).toEqual([]);
  });

  it("requests a bounded stable order from the database and preserves it", async () => {
    const next = { ...approved, item_id: "00000000-0000-4000-8000-000000000003" };
    queryRows.mockResolvedValue([approved, next]);
    expect((await readPublishedTimeline()).map((item) => item.itemId)).toEqual([approved.item_id, next.item_id]);
    expect(queryRows).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/order by v\.local_date desc, i\.position asc, s\.received_at asc, i\.id asc\s+limit \$2/),
      ["stage0-grok", 100],
    );
  });

  it.each([
    ["CI", "true"],
    ["VERCEL_ENV", undefined],
    ["DATABASE_URL", undefined],
  ])("stays offline when %s is %s", async (key, value) => {
    vi.stubEnv(key, value);
    expect(await readPublishedTimeline()).toEqual([]);
    expect(withWebsiteDb).not.toHaveBeenCalled();
  });
});
