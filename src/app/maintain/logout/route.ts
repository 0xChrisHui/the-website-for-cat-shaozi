import { authForRequest } from "@/lib/supabase/server";
import { clearSample, sameOrigin } from "@/features/foundation/samples";

export async function POST(request: Request) {
  if (!sameOrigin(request.headers)) return new Response(null, { status: 403 });
  const auth = await authForRequest(true);
  const result = await auth?.auth.signOut({ scope: "local" });
  if (result?.error && result.error.name !== "AuthSessionMissingError") {
    return new Response("暂时无法撤销会话，请重试。", { status: 503 });
  }
  await clearSample();
  return new Response(null, { status: 303, headers: { location: "/maintain/login" } });
}
