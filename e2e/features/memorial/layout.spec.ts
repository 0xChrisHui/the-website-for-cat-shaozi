import { expect, test } from "../../support/fixture";
import { assertPage } from "../../support/assert-page";

test("首页与匿名时间线", async ({ page, pageErrors, api }, info) => {
  expect((await page.goto("/"))?.status()).toBe(200);
  const hero = page.getByRole("img", { name: "一只橘白猫闭眼小憩" });
  const showsFallback = await hero.count() > 0;
  if (!process.env.BASE_URL) expect(showsFallback).toBe(true);
  await assertPage(page, pageErrors, info);
  await page.getByRole("link", { name: "时间线", exact: true }).click();
  await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();

  if (showsFallback) {
    await expect(page.getByText("预览样片与虚构日记")).toBeVisible();
    await expect(page.getByRole("main").getByRole("img")).toHaveCount(3);
    for (const image of await page.getByRole("main").getByRole("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(page.locator("time")).toHaveText(["2024-10-12", "2024-10-06", "2024-09-28"]);
  } else {
    await expect(page.getByText("预览样片与虚构日记")).toHaveCount(0);
  }

  expect((await api.get("/timeline/sample-photo/unknown")).status()).toBe(404);
  await assertPage(page, pageErrors, info);
});

test("Preview 样本登录、投稿待办和退出", async ({ page, pageErrors }, info) => {
  await page.goto("/maintain");
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
  await page.getByRole("button", { name: "样本登录" }).click();
  await expect(page.getByRole("heading", { name: "维护后台" })).toBeVisible();
  await assertPage(page, pageErrors, info);
  await page.getByRole("link", { name: "投稿待办" }).click();
  await expect(page.getByRole("heading", { name: "投稿待办" })).toBeVisible();
  await page.getByRole("button", { name: "投递样本" }).click();
  await page.getByRole("link", { name: "打开草稿" }).click();
  await expect(page.getByRole("heading", { name: "投稿草稿" })).toBeVisible();
  await assertPage(page, pageErrors, info);

  await page.goto("/timeline");
  await expect(page.getByRole("heading", { name: "投稿草稿" })).toHaveCount(0);
  await page.getByRole("link", { name: "维护后台" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
});
