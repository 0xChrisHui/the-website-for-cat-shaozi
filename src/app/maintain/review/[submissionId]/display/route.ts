import { readPrivateReviewDisplay } from "@/features/review/real-preparation";

export async function GET(request: Request, { params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const query = new URL(request.url).searchParams;
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const bytes = await readPrivateReviewDisplay(submissionId, {
    itemId: query.get("item"), versionId: query.get("version"),
  }, request.signal).catch(() => null);
  return bytes
    ? new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp" } })
    : new Response(null, { status: 404, headers });
}
