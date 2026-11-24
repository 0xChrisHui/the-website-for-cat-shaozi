"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { authForRequest } from "@/lib/supabase/server";
import { readSiteEnv } from "@/lib/env";
import { clearSample, sameOrigin, writeSample } from "@/features/foundation/samples";

export async function login(form: FormData) {
  if (!sameOrigin(await headers())) redirect("/maintain/login?failed=1");
  const input = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  const auth = await authForRequest(true);
  if (!input.success || !auth) redirect("/maintain/login?failed=1");
  const { data, error } = await auth.auth.signInWithPassword(input.data);
  if (error || data.user?.id !== readSiteEnv().MAINTAINER_UID) {
    if (data.user) await auth.auth.signOut({ scope: "local" });
    redirect("/maintain/login?failed=1");
  }
  await clearSample();
  redirect("/maintain");
}

export async function sampleLogin() {
  if (!sameOrigin(await headers()) || !(await writeSample())) redirect("/maintain/login?failed=1");
  redirect("/maintain");
}
