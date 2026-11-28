import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import Home from "./page";

const { readTimelineView, readSiteEnv } = vi.hoisted(() => ({ readTimelineView: vi.fn(), readSiteEnv: vi.fn(() => ({})) }));

vi.mock("@/lib/env", () => ({ readSiteEnv }));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/features/public/sample-content", () => ({
  readTimelineView,
  samplePhotos: { nap: { alt: "猫咪样片", width: 1100, height: 619 } },
}));

it("uses the first available published photo for the cover", async () => {
  readTimelineView.mockResolvedValue({ kind: "published", items: [
    { kind: "diary" },
    { kind: "photo", title: "午后小憩", publicMediaRef: "/api/media/cover" },
    { kind: "photo", title: "第二张", publicMediaRef: "/api/media/second" },
  ] });
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain('src="/api/media/cover"');
  expect(html).not.toContain("/api/media/second");
});

it("keeps the timeline entry on a home without public photos", async () => {
  readTimelineView.mockResolvedValue({ kind: "published", items: [{ kind: "diary" }] });
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain('href="/timeline"');
  expect(html).not.toContain("<img");
});

it("keeps the home usable when the published view is unavailable", async () => {
  readTimelineView.mockRejectedValue(new Error("temporarily unavailable"));
  const html = renderToStaticMarkup(await Home());
  expect(html).toContain('href="/timeline"');
  expect(html).toContain("照片暂时无法显示");
});

it("uses the selected cover only if that photo is currently public", async () => {
  readSiteEnv.mockReturnValue({ SITE_COVER_ITEM_ID: "chosen" });
  try {
    readTimelineView.mockResolvedValue({ kind: "published", items: [
      { itemId: "new", kind: "photo", publicMediaRef: "/api/media/new" },
      { itemId: "chosen", kind: "photo", publicMediaRef: "/api/media/chosen" },
    ] });
    expect(renderToStaticMarkup(await Home())).toContain('src="/api/media/chosen"');
    readTimelineView.mockResolvedValue({ kind: "published", items: [
      { itemId: "new", kind: "photo", publicMediaRef: "/api/media/new" },
    ] });
    expect(renderToStaticMarkup(await Home())).toContain('src="/api/media/new"');
  } finally {
    readSiteEnv.mockReturnValue({});
  }
});
