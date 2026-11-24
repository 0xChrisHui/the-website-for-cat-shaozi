import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { diagnosticsEnabled, readSiteEnv } from "@/lib/env";

const sessionSchema = z.object({ runId: z.uuid(), expires: z.number().int(), saved: z.boolean() }).strict();
const publicSessionSchema = z.object({ runId: z.uuid(), expires: z.number().int(), audience: z.literal("public-sample") }).strict();
type Sample = z.infer<typeof sessionSchema>;
export const sampleCookieName = "memorial_sample";
export const publicSampleCookieName = "memorial_public_sample";
const lifetime = 30 * 60;
const publicLifetimeMs = 5 * 60_000;

export function sampleSecret() {
  return diagnosticsEnabled() ? readSiteEnv().SAMPLE_SESSION_SECRET : undefined;
}

function signTicket(session: object, secret: string) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

function readTicket(ticket: string | undefined, secret: string): unknown {
  const [payload, signature, rest] = (ticket ?? "").split(".");
  if (!payload || !signature || rest !== undefined || payload.length > 512 || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as unknown;
  } catch {
    return null;
  }
}

export function verifySample(ticket: string | undefined, secret: string, now = Date.now()): Sample | null {
  const data = sessionSchema.safeParse(readTicket(ticket, secret));
  return data.success && data.data.expires > now ? data.data : null;
}

export function createPublicSampleTicket(sample: Pick<Sample, "runId" | "expires">, secret: string, now = Date.now()) {
  return signTicket({ runId: sample.runId, expires: Math.min(sample.expires, now + publicLifetimeMs), audience: "public-sample" }, secret);
}

export function verifyPublicSample(ticket: string | undefined, secret: string, now = Date.now()) {
  const data = publicSessionSchema.safeParse(readTicket(ticket, secret));
  if (!data.success || data.data.expires <= now) return null;
  return { runId: data.data.runId, expires: data.data.expires };
}

export async function readSample() {
  const secret = sampleSecret();
  if (!secret) return null;
  return verifySample((await cookies()).get(sampleCookieName)?.value, secret);
}

async function setSampleCookie(name: string, ticket: string, expires: number) {
  const jar = await cookies();
  jar.set(name, ticket, {
    httpOnly: true, sameSite: "lax", path: "/", expires: new Date(expires),
    secure: readSiteEnv().environment === "preview" || (await headers()).get("x-forwarded-proto") === "https",
  });
}

export async function writeSample(session: Sample = { runId: randomUUID(), expires: Date.now() + lifetime * 1000, saved: false }) {
  const secret = sampleSecret();
  if (!secret) return null;
  await setSampleCookie(sampleCookieName, signTicket(session, secret), session.expires);
  return session;
}

export async function readPublicSample() {
  const secret = sampleSecret();
  if (!secret) return null;
  return verifyPublicSample((await cookies()).get(publicSampleCookieName)?.value, secret);
}

export async function redeemPublicSample(ticket: string) {
  const secret = sampleSecret();
  if (!secret) return false;
  const sample = verifyPublicSample(ticket, secret);
  if (!sample) return false;
  await setSampleCookie(publicSampleCookieName, ticket, sample.expires);
  return true;
}

export async function clearSample() {
  (await cookies()).delete(sampleCookieName);
}

export function sameOrigin(headers: Headers) {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host) return false;
  const expectedScheme = readSiteEnv().environment === "development" && headers.get("x-forwarded-proto") !== "https" ? "http:" : "https:";
  try {
    const url = new URL(origin);
    const configured = readSiteEnv().APP_ORIGIN;
    return url.origin === origin && url.protocol === expectedScheme &&
      (url.host === host || (configured !== undefined && url.origin === new URL(configured).origin));
  } catch { return false; }
}

export function hidden() {
  return new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } });
}
