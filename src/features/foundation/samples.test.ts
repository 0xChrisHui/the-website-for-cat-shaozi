import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/debug/samples/public/route";
import { proxy } from "@/proxy";
import {
  createPublicSampleTicket, publicSampleCookieName, readPublicSample, readSample, sampleCookieName,
  verifyPublicSample, verifySample, writeSample,
} from "./samples";

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/supabase/server", () => ({ siteAuth: () => undefined }));

const secret = "synthetic-public-sample-secret-for-tests";
const now = Date.UTC(2026, 10, 25);
const sample = { runId: "374326f1-b2d3-4b25-8d4a-271f2de85503", expires: now + 60_000, saved: true };
const endpoint = "http://localhost/api/debug/samples/public";
const request = (origin = "http://localhost") => new Request(endpoint, {
  method: "POST", headers: { host: "localhost", origin },
});

beforeEach(() => {
  jar.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("CI", "true");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("SAMPLE_SESSION_SECRET", secret);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("public sample tickets", () => {
  it("keeps the read-only ticket separate, short-lived and signed", async () => {
    await writeSample(sample);
    const maintenanceTicket = jar.get(sampleCookieName);
    const ticket = createPublicSampleTicket(sample, secret, now);
    expect(verifySample(maintenanceTicket, secret, now)).toEqual(sample);
    expect(verifyPublicSample(maintenanceTicket, secret, now)).toBeNull();
    expect(verifySample(ticket, secret, now)).toBeNull();
    expect(verifyPublicSample(ticket, secret, now)).toEqual({ runId: sample.runId, expires: sample.expires });
    expect(verifyPublicSample(ticket, secret, sample.expires)).toBeNull();
    expect(verifyPublicSample(ticket + "x", secret, now)).toBeNull();

    const longer = createPublicSampleTicket({ ...sample, expires: now + 30 * 60_000 }, secret, now);
    expect(verifyPublicSample(longer, secret, now)).toEqual({ runId: sample.runId, expires: now + 5 * 60_000 });
  });

  it("issues only to the same-origin sample session and redeems only public access", async () => {
    expect((await POST(request())).status).toBe(404);
    await writeSample(sample);
    expect((await POST(request("http://outside.invalid"))).status).toBe(404);
    const issued = await POST(request());
    expect(issued.status).toBe(200);
    expect(issued.headers.get("cache-control")).toBe("private, no-store");
    const { url } = await issued.json() as { url: string };
    expect(url).toMatch(/^\/api\/debug\/samples\/public\?ticket=/);

    jar.clear();
    const redeemed = await GET(new Request(new URL(url, endpoint)));
    expect(redeemed.status).toBe(303);
    expect(redeemed.headers.get("location")).toBe("/timeline");
    expect(redeemed.headers.get("referrer-policy")).toBe("no-referrer");
    expect(jar.has(publicSampleCookieName)).toBe(true);
    expect(await readPublicSample()).toEqual({ runId: sample.runId, expires: sample.expires });
    expect(await readSample()).toBeNull();
    expect((await POST(request())).status).toBe(404);
  });

  it("hides signing, redemption and cookie scope in production", async () => {
    await writeSample(sample);
    const issued = await POST(request());
    const { url } = await issued.json() as { url: string };
    expect((await GET(new Request(new URL(url, endpoint)))).status).toBe(303);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    expect((await GET(new Request(new URL(url, endpoint)))).status).toBe(404);
    expect(await readPublicSample()).toBeNull();
  });

  it("lets only the public GET reach ticket validation without a session", async () => {
    expect((await proxy(new NextRequest(endpoint))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(new NextRequest(endpoint, { method: "POST" }))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await proxy(new NextRequest(endpoint))).status).toBe(404);
  });
});
