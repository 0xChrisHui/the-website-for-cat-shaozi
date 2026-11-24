import { NextResponse, type NextRequest } from "next/server";
import { diagnosticsEnabled, readSiteEnv } from "@/lib/env";
import { siteAuth } from "@/lib/supabase/server";
import { hidden, sampleCookieName, sampleSecret, verifySample } from "@/features/foundation/samples";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const diagnostic = path.startsWith("/debug") || path.startsWith("/api/debug");
  if (diagnostic && !diagnosticsEnabled()) return hidden();
  if (diagnostic && ["/api/debug/samples/session", "/api/debug/intake/prepare", "/api/debug/intake/submit"].includes(path)) {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const secret = sampleSecret();
  const sample = secret && verifySample(request.cookies.get(sampleCookieName)?.value, secret);
  const samplePath = path === "/debug/samples" || path.startsWith("/api/debug/samples/");
  if (diagnostic && sample) return samplePath ? response : hidden();

  const auth = siteAuth({
    getAll: () => request.cookies.getAll(),
    setAll: (entries) => {
      for (const { name, value } of entries) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of entries) response.cookies.set(name, value, options);
    },
  }, request.nextUrl.protocol === "https:" || readSiteEnv().environment !== "development");
  const result = auth ? await auth.auth.getUser() : undefined;
  if (diagnostic && (!result?.data.user || result.error || result.data.user.id !== readSiteEnv().MAINTAINER_UID)) {
    return hidden();
  }
  return response;
}

export const config = { matcher: ["/maintain/:path*", "/debug/:path*", "/api/debug/:path*"] };
