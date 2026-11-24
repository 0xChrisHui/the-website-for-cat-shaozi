import { expect, test } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import flag from "./delivered/intake.json" with { type: "json" };

if (flag.delivered) {
  test("投稿重投和待确认日期", async ({ page, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "投稿待办" }).click();
    await page.getByRole("button", { name: "投递样本" }).click();
    await page.getByRole("button", { name: "重投同一事件" }).click();
    const draft = page.getByRole("link", { name: "打开草稿" });
    await expect(draft).toHaveCount(1);
    await draft.click();
    await expect(page.getByText("日期待确认")).toBeVisible();
    await assertPage(page, pageErrors, info);
  });
}
