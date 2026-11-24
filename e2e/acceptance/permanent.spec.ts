import { expect, test } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import flag from "./delivered/permanent.json" with { type: "json" };

if (flag.delivered) {
  test("重复运行只保留一份永久凭证", async ({ page, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "永久任务" }).click();
    await page.getByRole("button", { name: "运行样本" }).click();
    await expect(page.getByText("归档确认", { exact: true })).toHaveCount(1);
    await expect(page.getByText("NFT 已到账", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "重跑样本" }).click();
    await expect(page.getByText("归档确认", { exact: true })).toHaveCount(1);
    await expect(page.getByText("NFT 已到账", { exact: true })).toHaveCount(1);
    await assertPage(page, pageErrors, info);
  });
}
