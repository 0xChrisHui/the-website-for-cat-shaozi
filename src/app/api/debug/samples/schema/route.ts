import { readSiteEnv } from "@/lib/env";
import { hidden, readSample, sameOrigin } from "@/features/foundation/samples";
import { withWebsiteDb } from "@/lib/supabase/database";

export async function POST(request: Request) {
  const env = readSiteEnv();
  const sample = await readSample();
  if (env.environment !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "integration" || !sample || !sameOrigin(request.headers)) {
    return hidden();
  }
  if (request.headers.get("content-length") !== "36" || (await request.text()) !== sample.runId) return hidden();
  await withWebsiteDb(async (db) => {
    await db.query("select set_config('memorial.sample_run_id', $1, true)", [sample.runId]);
    await db.query("insert into stage0_samples(run_id, value) values ($1, $2)", [sample.runId, "schema-probe"]);
    const result = await db.query("select value from stage0_samples where run_id = $1", [sample.runId]);
    if (result.rows[0]?.value !== "schema-probe") throw new Error("Schema probe read failed");
    const removed = await db.query("delete from stage0_samples where run_id = $1", [sample.runId]);
    if (removed.rowCount !== 1) throw new Error("Schema probe cleanup failed");
  });
  return Response.json({ runId: sample.runId, ok: true });
}
