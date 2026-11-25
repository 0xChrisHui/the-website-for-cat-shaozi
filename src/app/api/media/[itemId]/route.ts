import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createBlobReader } from "@/lib/adapters/blob";
import { readSiteEnv } from "@/lib/env";
import { displayKey } from "@/features/public/media-key";
import { readPublishedView } from "@/features/public/timeline";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const missing = () => new Response(null, { status: 404, headers });
  if (!z.uuid().safeParse(itemId).success) return missing();
  const { items: [item], sample } = await readPublishedView(itemId);
  if (!item?.publicMediaRef) return missing();
  try {
    const env = readSiteEnv();
    const reader = createBlobReader({
      mock: false, token: env.BLOB_READ_WRITE_TOKEN, storeHost: env.BLOB_STORE_HOST, signal: request.signal,
    });
    const body = sample
      ? new Uint8Array(await readFile(join(process.cwd(), "src/features/public/photos/nap.webp")))
      : await reader.read(displayKey(item.itemId, item.currentVersionId));
    return new Response(body, { headers: { ...headers, "Content-Type": "image/webp" } });
  } catch {
    return missing();
  }
}
