import { test, expect } from "../support/fixture";
import { assertPage } from "../support/assert-page";
import foundation from "./delivered/foundation.json" with { type: "json" };

test("首页健康", async ({ page, pageErrors }, info) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
  await expect(page.getByRole("link", { name: "首页" })).toBeVisible();
  await expect(page.getByRole("link", { name: "维护后台" })).toBeVisible();
  await assertPage(page, pageErrors, info);
});

if (foundation.delivered) {
  test("样本登录、保存、刷新、隔离和退出", async ({ page, api, pageErrors }, info) => {
    expect((await api.get("/debug")).status()).toBe(404);
    expect((await api.get("/api/debug")).status()).toBe(404);
    expect((await api.post("/api/debug/samples/schema")).status()).toBe(404);
    await page.goto("/maintain");
    await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "查看样本" }).click();
    const runId = await page.getByRole("status").textContent();
    await page.getByRole("button", { name: "保存样本" }).click();
    await expect(page.getByText("样本已保存")).toBeVisible();
    await page.reload();
    await expect(page.getByText("样本已保存")).toBeVisible();
    expect(await page.getByRole("status").textContent()).toBe(runId);
    expect((await api.get("/api/debug")).status()).toBe(404);
    await assertPage(page, pageErrors, info);
    await page.goto("/maintain");
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "维护者登录" })).toBeVisible();
    expect((await api.get("/debug/samples")).status()).toBe(404);
    await page.getByRole("button", { name: "样本登录" }).click();
    await page.getByRole("link", { name: "查看样本" }).click();
    await expect(page.getByText("本轮暂无样本")).toBeVisible();
    expect(await page.getByRole("status").textContent()).not.toBe(runId);
  });
}
