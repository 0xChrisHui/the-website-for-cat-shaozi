import { assertPage } from "../../support/assert-page";
import { expect, test } from "../../support/fixture";

test("isolated intake sample shows one draft with per-item, common and unresolved dates", async ({ context, page, pageErrors }, info) => {
  await page.goto("/maintain/intake");
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
  await page.getByRole("button", { name: "样本登录" }).click();
  await expect(page.getByRole("heading", { name: "维护后台" })).toBeVisible();
  await page.goto("/maintain/intake");
  await page.getByRole("button", { name: "投递样本" }).click();
  await page.getByRole("button", { name: "重投同一事件" }).click();
  const draft = page.getByRole("link", { name: "打开草稿" });
  await expect(draft).toHaveCount(1);
  const pending = page.getByRole("listitem").filter({ has: draft });
  await expect(pending).toContainText("待审核");
  await expect(pending).toContainText("已保存原图：3 张");
  await expect(pending.locator("time")).toContainText("01:00");
  await assertPage(page, pageErrors, info);
  await draft.click();
  const items = page.getByRole("region", { name: "投稿草稿" }).getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText("2025-12-31");
  await expect(items.nth(1)).toContainText("2025-12-30");
  await expect(items.nth(2)).toContainText("日期待确认");
  await expect(items.nth(3)).toContainText("合成日记样本");
  await page.getByLabel("照片 3 日期").fill("2026-01-02");
  await page.getByRole("button", { name: "保存日期" }).click();
  await expect(items.nth(2)).toContainText("2026-01-02");
  const correctedDraftUrl = page.url();
  await page.reload();
  await expect(items.nth(2)).toContainText("2026-01-02");
  await assertPage(page, pageErrors, info);

  await context.clearCookies({ name: "memorial_sample" });
  await page.goto(correctedDraftUrl);
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
});
