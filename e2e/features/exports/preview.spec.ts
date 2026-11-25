import { expect, test } from "../../support/fixture";
import { assertPage } from "../../support/assert-page";
import { inspectSampleZip } from "../../../src/features/exports/offline-fixture";

test("sample ZIP is scoped, replaceable, and revoked at its application URL", async ({ page, api, pageErrors }, info) => {
  await page.goto("/maintain/login");
  await page.getByRole("button", { name: "样本登录" }).click();
  await page.getByRole("link", { name: "离线快照" }).click();
  const generate = page.getByRole("button", { name: "生成离线快照" });
  const download = page.getByRole("link", { name: "下载离线快照" });
  await expect(page.getByRole("status")).toHaveText("暂无离线快照。");
  await generate.click();
  await expect(page.getByRole("status")).toHaveText("正在生成…");
  await expect(download).toBeVisible({ timeout: 45_000 });
  const oldPath = await download.getAttribute("href");
  if (!oldPath) throw new Error("Missing first download");

  const received = page.waitForEvent("download");
  await download.click();
  const file = await (await received).path();
  const { html, items } = await inspectSampleZip(file);
  expect(items.filter(({ path }) => path.endsWith(".webp"))).toHaveLength(2);
  for (const { path, versionId, sha256, digest } of items) {
    expect(versionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(digest).toBe(sha256);
    if (path.endsWith(".webp")) expect(html).toContain(`src="${path}"`);
  }
  expect(html).toContain("合成日记的当前修订。");
  expect(html).toContain("合成授权照片");
  expect(html).toContain("合成私有照片");
  expect(html).not.toContain("历史修订");
  await page.context().setOffline(true);
  await page.setContent(html);
  await expect(page.getByText("合成日记的当前修订。")).toBeVisible();
  await page.context().setOffline(false);

  await page.goto("/maintain/exports");
  await generate.click();
  await expect(download).toBeVisible({ timeout: 45_000 });
  await expect(download).not.toHaveAttribute("href", oldPath, { timeout: 45_000 });
  const currentPath = await download.getAttribute("href");
  if (!currentPath) throw new Error("Missing replacement download");
  expect((await api.get(oldPath)).status()).toBe(404);
  await assertPage(page, pageErrors, info);

  await page.goto("/maintain/review");
  await page.getByRole("button", { name: "撤下", exact: true }).click();
  await expect(page.getByText("已撤下").first()).toBeVisible();
  expect((await api.get(currentPath)).status()).toBe(404);
  await page.goto("/maintain/exports");
  await expect(download).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("需重新生成。");

  await page.goto("/maintain");
  await page.getByRole("button", { name: "退出登录" }).click();
  expect((await api.get(currentPath)).status()).toBe(404);
});
