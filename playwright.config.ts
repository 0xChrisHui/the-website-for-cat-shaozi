import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const local = "http://127.0.0.1:3100";
const value = process.env.BASE_URL;
const parsed = new URL(value ?? local);
if (parsed.origin !== (value ?? local) || (value && parsed.protocol !== "https:" && parsed.origin !== local)) {
  throw new Error("BASE_URL must be an exact HTTPS deployment origin or the local test origin");
}

export default defineConfig({
  testDir: "./e2e",
  workers: process.env.BASE_URL ? 2 : 1,
  timeout: 90_000,
  retries: process.env.CI === "true" ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/report.json" }]],
  use: { baseURL: parsed.origin, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: !value ? {
    command: "corepack pnpm dev --hostname 127.0.0.1 --port 3100",
    url: local, timeout: 90_000, reuseExistingServer: false,
    env: { VERCEL_ENV: "development", APP_ORIGIN: local, CI: "true", SAMPLE_SESSION_SECRET: randomBytes(32).toString("hex") },
  } : undefined,
});
