import "server-only";

import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSiteEnv } from "../env";

export function siteAuth(cookieMethods: CookieMethodsServer, secure: boolean) {
  const env = readSiteEnv();
  if (!env.environment || env.ci || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.MAINTAINER_UID) return null;
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== env.SUPABASE_PROJECT_REF + ".supabase.co") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_PROJECT_REF");
  }
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: cookieMethods,
    cookieOptions: { httpOnly: true, secure, sameSite: "lax", path: "/" },
  });
}

export async function authForRequest(write = false) {
  const jar = await cookies();
  const env = readSiteEnv();
  return siteAuth({
    getAll: () => jar.getAll(),
    setAll: (entries) => {
      if (write) for (const { name, value, options } of entries) jar.set(name, value, options);
    },
  }, env.environment !== "development" || env.APP_ORIGIN?.startsWith("https:") === true);
}

export async function requireMaintainer() {
  const auth = await authForRequest();
  if (!auth) return null;
  const { data, error } = await auth.auth.getUser();
  return !error && data.user?.id === readSiteEnv().MAINTAINER_UID ? data.user : null;
}
