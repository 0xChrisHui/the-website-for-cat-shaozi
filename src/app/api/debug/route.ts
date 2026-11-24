import { diagnosticsEnabled } from "@/lib/env";
import { requireMaintainer } from "@/lib/supabase/server";
import { realJobSummaries } from "@/features/foundation/diagnostics";
import { hidden } from "@/features/foundation/samples";

export async function GET() {
  if (!diagnosticsEnabled() || !(await requireMaintainer())) return hidden();
  return Response.json(await realJobSummaries());
}
