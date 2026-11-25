import "server-only";

import { z } from "zod";
import { withWebsiteDb } from "@/lib/supabase/database";
import { ReviewConflict } from "./approve";
import { findSubmission, reviewScope } from "./store";

export async function withdrawSubmission(submissionId: string) {
  const scope = await reviewScope();
  if (!scope?.ready || !z.uuid().safeParse(submissionId).success) throw new ReviewConflict();
  await withWebsiteDb(async (db) => {
    if (!(await findSubmission(db, scope, submissionId, true))) throw new ReviewConflict();
    await db.query("update items set withdrawn_at = now() where submission_id = $1 and withdrawn_at is null", [submissionId]);
  });
}
