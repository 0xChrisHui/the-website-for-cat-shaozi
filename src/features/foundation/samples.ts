import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { diagnosticsEnabled, readSiteEnv } from "@/lib/env";

const sessionSchema = z.object({ runId: z.uuid(), expires: z.number().int(), saved: z.boolean() }).strict();
type Sample = z.infer<typeof sessionSchema>;
export const sampleCookieName = "memorial_sample";
const lifetime = 30 * 60;

export function sampleSecret() {
  const env = readSiteEnv();
  if (!diagnosticsEnabled() || env.environment === "production") return undefined;
  return env.SAMPLE_SESSION_SECRET;
}


export function verifySample(ticket: string | undefined, secret: string, now = Date.now()): Sample | null {
  const [payload, signature, rest] = (ticket ?? "").split(".");
  if (!payload || !signature || rest !== undefined || payload.length > 512) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = sessionSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return data.success && data.data.expires > now ? data.data : null;
  } catch {
    return null;
  }
}

export async function readSample() {
  const secret = sampleSecret();
  if (!secret) return null;
  return verifySample((await cookies()).get(sampleCookieName)?.value, secret);
}

export async function writeSample(session: Sample = { runId: randomUUID(), expires: Date.now() + lifetime * 1000, saved: false }) {
  const secret = sampleSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  const jar = await cookies();
  jar.set(sampleCookieName, payload + "." + signature, {
    httpOnly: true, sameSite: "lax", path: "/", expires: new Date(session.expires),
    secure: readSiteEnv().environment === "preview" || (await headers()).get("x-forwarded-proto") === "https",
  });
  return session;
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
