import { expect, test } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import flag from "./delivered/exports.json" with { type: "json" };

if (flag.delivered) {
  test("只保留当前离线快照，撤下后禁止下载", async ({ page, pageErrors }, info) => {
    await page.goto("/maintain/login");
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "离线快照" }).click();
    await page.getByRole("button", { name: "生成离线快照" }).click();
    const download = page.getByRole("link", { name: "下载离线快照" });
    await expect(download).toBeVisible();
    const previous = await download.getAttribute("href");
    await page.getByRole("button", { name: "生成离线快照" }).click();
    await expect(download).toHaveCount(1);
    await expect(download).not.toHaveAttribute("href", previous ?? "");
    await assertPage(page, pageErrors, info);
    await page.goto("/maintain/review");
    await page.getByRole("button", { name: "撤下" }).click();
    await page.goto("/maintain/exports");
    await expect(download).toHaveCount(0);
  });
}
