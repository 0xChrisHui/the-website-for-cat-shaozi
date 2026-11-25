import "server-only";

import { withExportMutation } from "@/features/foundation/private-export";
import { z } from "zod";
import { withWebsiteDb } from "@/lib/supabase/database";
import { ReviewConflict } from "./approve";
import { findSubmission, reviewScope } from "./store";

export async function withdrawSubmission(submissionId: string) {
  const scope = await reviewScope();
  if (!scope?.ready || !z.uuid().safeParse(submissionId).success) throw new ReviewConflict();
  await withWebsiteDb((db) => withExportMutation(db, scope.sample?.runId ?? null, async () => {
    if (!(await findSubmission(db, scope, submissionId, true))) throw new ReviewConflict();
    const result = await db.query("update items set withdrawn_at = now() where submission_id = $1 and withdrawn_at is null", [submissionId]);
    return { value: undefined, exportChanged: Boolean(result.rowCount) };
  }));
}
