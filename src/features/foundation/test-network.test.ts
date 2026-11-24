import http from "node:http";
import https from "node:https";
import net from "node:net";
import { expect, it } from "vitest";
import { adapterMode } from "@/lib/adapters/select";
import { assertMainnetAllowed } from "@/lib/adapters/mainnet-gate";
import { assertTestEnvironment, diagnosticsEnabled, readSiteEnv } from "@/lib/env";

it("blocks public fetch, sockets, HTTP and HTTPS", async () => {
  await expect(fetch("https://example.invalid")).rejects.toThrow("Test network");
  expect(() => net.connect(443, "example.invalid")).toThrow("Test network");
  expect(() => http.get("http://example.invalid")).toThrow("Test network");
  expect(() => https.get("https://example.invalid")).toThrow("Test network");
});

it("permits explicit loopback", async () => {
  const server = http.createServer((_request, response) => response.end("local"));
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback port");
    expect(await fetch("http://127.0.0.1:" + address.port).then((response) => response.text())).toBe("local");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("forces Mock and denies production configuration", () => {
  expect(adapterMode("sandbox", undefined, { CI: "true", VERCEL_ENV: "preview" })).toBe("mock");
  expect(adapterMode("sandbox", "sample", { VERCEL_ENV: "preview" })).toBe("mock");
  expect(readSiteEnv({ CI: "true", VERCEL_ENV: "preview", DATABASE_URL: "ignored" }).DATABASE_URL).toBeUndefined();
  expect(() => assertTestEnvironment({ ALLOW_MAINNET: "true" })).toThrow("ALLOW_MAINNET");
  expect(() => assertMainnetAllowed({ instance: "test", allowMainnet: "true", executionRole: "signer", ci: false })).toThrow("ALLOW_MAINNET");
  expect(diagnosticsEnabled({})).toBe(false);
  expect(diagnosticsEnabled({ VERCEL_ENV: "production" })).toBe(false);
});
