import { writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "./fixture";

export async function assertPage(page: Page, pageErrors: Error[], info: TestInfo) {
  expect(pageErrors.map((error) => error.message)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const axePath = info.outputPath("axe.json");
  const imagePath = info.outputPath("page.png");
  await page.screenshot({ fullPage: true, path: imagePath });
  await writeFile(axePath, JSON.stringify(audit.violations));
  await info.attach("axe", { path: axePath, contentType: "application/json" });
  await info.attach("page", { path: imagePath, contentType: "image/png" });
  expect(audit.violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
}
