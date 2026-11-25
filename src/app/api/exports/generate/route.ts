import { setTimeout as delay } from "node:timers/promises";
import { requestPrivateExport } from "@/features/foundation/private-export-access";
import { hidden, sameOrigin } from "@/features/foundation/samples";
import { exportAccess } from "@/features/exports/access";
import { generateSampleSnapshot } from "@/features/exports/sample";
import { prepareReviewSample } from "@/features/review/sample";
import { exportRequestSchema } from "@/lib/contracts/exports";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!sameOrigin(request.headers)) return hidden();
  const access = await exportAccess();
  if (!access) return hidden();
  const input = exportRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ schemaVersion: 1 }, { status: 400, headers });
  try {
    if (access.sample) await prepareReviewSample(true);
    const job = await requestPrivateExport(input.data);
    if (!job) return hidden();
    if (access.sample && (job.status === "queued" || job.status === "running")) {
      await delay(450);
      await generateSampleSnapshot();
    }
    return Response.json({ schemaVersion: 1 }, { status: 202, headers });
  } catch {
    return Response.json({ schemaVersion: 1 }, { status: 503, headers });
  }
}
