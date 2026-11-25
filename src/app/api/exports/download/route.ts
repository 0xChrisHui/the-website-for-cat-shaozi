import { z } from "zod";
import { exportAccess } from "@/features/exports/access";
import { privateExportBlob } from "@/features/exports/blob";
import { withCurrentPrivateExport } from "@/features/foundation/private-export-access";
import { hidden, sameOrigin } from "@/features/foundation/samples";
import { readSiteEnv } from "@/lib/env";

export async function GET(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return hidden();
  if (request.headers.has("origin") && !sameOrigin(request.headers)) return hidden();
  const job = z.uuid().safeParse(new URL(request.url).searchParams.get("job"));
  if (!job.success || !(await exportAccess())) return hidden();
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  try {
    return await withCurrentPrivateExport(async (pointer) => {
      if (pointer.jobId !== job.data) return hidden();
      if (pointer.mode === "mock") {
        return new Response(new Uint8Array(pointer.mockBytes), { headers: {
          ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="snapshot.zip"',
          "X-Content-Type-Options": "nosniff",
        } });
      }
      const { BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = readSiteEnv();
      if (!token || !host) return new Response(null, { status: 503, headers });
      const location = await privateExportBlob(token, host).sign(pointer.objectKey);
      return new Response(null, { status: 302, headers: { ...headers, Location: location } });
    }) ?? hidden();
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
