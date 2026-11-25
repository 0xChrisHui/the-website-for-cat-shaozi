import { expect, test } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import flag from "./delivered/memorial.json" with { type: "json" };

if (flag.delivered) {
  test("公开当前批准版本，撤下后消失", async ({ page, context, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "审核投稿" }).click();
    await page.getByRole("button", { name: "准备审核样本" }).click();
    await expect(page.getByRole("link", { name: /待审核/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: /待审核/ }).click();
    await page.getByRole("group", { name: /合成授权照片/ }).getByRole("checkbox", { name: "站内发布" }).check();
    await page.getByRole("button", { name: "确认审核" }).click();
    await expect(page.getByRole("status")).toHaveText("审核已确认。", { timeout: 15_000 });
    const publicLink = await page.getByRole("link", { name: "打开公开样本" }).getAttribute("href");
    expect(publicLink).toBeTruthy();
    const maintainer = (await context.cookies()).filter(({ name }) => name === "memorial_sample");
    await context.clearCookies({ name: "memorial_sample" });
    await page.goto(publicLink ?? "/");
    await page.waitForURL("**/timeline", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();
    await expect(page.getByRole("img", { name: "合成授权照片" })).toBeVisible();
    await assertPage(page, pageErrors, info);
    await context.addCookies(maintainer);
    await page.goto("/maintain/review");
    await page.getByRole("button", { name: "撤下" }).click();
    await expect(page.getByText("已撤下").first()).toBeVisible({ timeout: 15_000 });
    await context.clearCookies({ name: "memorial_sample" });
    await page.goto("/timeline");
    await expect(page.getByRole("img", { name: "合成授权照片" })).toHaveCount(0);
  });
}
