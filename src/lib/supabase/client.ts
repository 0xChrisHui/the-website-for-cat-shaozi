import { createBrowserClient } from "@supabase/ssr";

export function createAuthBrowserClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
