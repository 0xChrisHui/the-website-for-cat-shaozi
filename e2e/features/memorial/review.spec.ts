import { expect, test } from "../../support/fixture";
import { assertPage } from "../../support/assert-page";

test("匿名及无签名样本无法打开审核", async ({ page, context, baseURL }) => {
  await page.goto("/maintain/review");
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();

  await context.addCookies([{ name: "memorial_sample", value: "unsigned-sample", url: baseURL!, httpOnly: true }]);
  await page.goto("/maintain/review/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
});

// The default Playwright server has CI=true and intentionally lacks a business database.
if (process.env.BASE_URL) {
  test("审核样本发布当前版本并撤下旧媒体", async ({ page, context, api, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "审核投稿" }).click();
    await page.getByRole("button", { name: "准备审核样本" }).click();
    await page.getByRole("link", { name: /待审核/ }).click();
    await expect(page.getByRole("heading", { name: "投稿审核详情" })).toBeVisible();
    const detail = page.url();
    await page.getByRole("group", { name: /合成授权照片/ }).getByRole("checkbox").check();
    await page.getByRole("group", { name: /合成日记/ }).getByRole("checkbox").check();
    await expect(page.getByRole("group", { name: /合成私有照片/ }).getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("group", { name: /合成日记/ }).locator('input[name="item"]').evaluate((field: HTMLInputElement) => {
      field.value = field.value.split("/")[0] + "/00000000-0000-4000-8000-000000000001";
    });
    await page.getByRole("button", { name: "确认审核" }).click();
    await expect(page.getByRole("status")).toContainText("审核未保存");
    await expect(page.getByRole("link", { name: "打开公开样本" })).toHaveCount(0);
    await page.reload();
    await page.getByRole("group", { name: /合成授权照片/ }).getByRole("checkbox").check();
    await page.getByRole("group", { name: /合成日记/ }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认审核" }).click();
    await expect(page.getByRole("status")).toHaveText("审核已确认。");
    const ticket = await page.getByRole("link", { name: "打开公开样本" }).getAttribute("href");
    expect(ticket).toBeTruthy();
    const maintainer = (await context.cookies()).filter(({ name }) => name === "memorial_sample");
    await context.clearCookies({ name: "memorial_sample" });

    await page.goto("/timeline");
    await expect(page.getByRole("img", { name: "合成授权照片" })).toHaveCount(0);
    await page.goto(ticket!);
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();
    const photo = page.getByRole("img", { name: "合成授权照片" });
    await expect(photo).toBeVisible();
    await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByText("合成日记的当前修订。")).toBeVisible();
    await expect(page.getByText(/历史修订|合成私有照片|original\.example\.invalid/)).toHaveCount(0);
    expect(await page.content()).not.toContain("original.example.invalid");
    const media = await photo.getAttribute("src");
    expect(media).toMatch(/^\/api\/media\//);
    expect((await api.get(media!)).status()).toBe(200);
    await assertPage(page, pageErrors, info);

    await page.goto(detail);
    await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
    await context.addCookies(maintainer);
    await page.goto(detail);
    await page.getByRole("button", { name: "撤下" }).click();
    await expect(page.getByText("已撤下", { exact: true })).toHaveCount(3);
    await context.clearCookies({ name: "memorial_sample" });
    await page.goto("/timeline");
    await expect(photo).toHaveCount(0);
    await expect(page.getByText("合成日记的当前修订。")).toHaveCount(0);
    expect((await api.get(media!)).status()).toBe(404);
  });
}
