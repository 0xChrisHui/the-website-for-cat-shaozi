import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { diagnosticsEnabled } from "@/lib/env";

const assets = {
  nap: () => readFile(join(process.cwd(), "src/features/public/photos/nap.webp")),
  rest: () => readFile(join(process.cwd(), "src/features/public/photos/rest.webp")),
  sleep: () => readFile(join(process.cwd(), "src/features/public/photos/sleep.webp")),
};

export async function GET(_request: Request, { params }: { params: Promise<{ photo: string }> }) {
  const { photo } = await params;
  const headers = { "Cache-Control": "private, no-store" };
  if (!diagnosticsEnabled() || !Object.hasOwn(assets, photo)) {
    return new Response(null, { status: 404, headers });
  }

  const bytes = await assets[photo as keyof typeof assets]();
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp" } });
}
