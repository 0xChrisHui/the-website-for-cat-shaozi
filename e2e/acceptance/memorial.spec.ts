import { expect, test } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import flag from "./delivered/memorial.json" with { type: "json" };

if (flag.delivered) {
  test("公开当前批准版本，撤下后消失", async ({ page, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "审核投稿" }).click();
    await page.getByRole("checkbox", { name: "站内发布" }).check();
    await page.getByRole("button", { name: "确认审核" }).click();
    const publicLink = await page.getByRole("link", { name: "打开公开样本" }).getAttribute("href");
    expect(publicLink).toBeTruthy();
    await page.goto(publicLink ?? "/");
    await page.getByRole("link", { name: "时间线" }).click();
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();
    await expect(page.getByRole("img", { name: "合成授权照片" })).toBeVisible();
    await assertPage(page, pageErrors, info);
    await page.goto("/maintain/review");
    await page.getByRole("button", { name: "撤下" }).click();
    await page.goto(publicLink ?? "/");
    await page.getByRole("link", { name: "时间线" }).click();
    await expect(page.getByRole("img", { name: "合成授权照片" })).toHaveCount(0);
  });
}
