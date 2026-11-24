import { createPublicSampleTicket, hidden, readSample, redeemPublicSample, sameOrigin, sampleSecret } from "@/features/foundation/samples";

const privateHeaders = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export async function POST(request: Request) {
  const secret = sampleSecret();
  if (!secret || !sameOrigin(request.headers)) return hidden();
  const sample = await readSample();
  if (!sample) return hidden();

  const params = new URLSearchParams({ ticket: createPublicSampleTicket(sample, secret) });
  return Response.json({ url: "/api/debug/samples/public?" + params }, { headers: privateHeaders });
}

export async function GET(request: Request) {
  const ticket = new URL(request.url).searchParams.get("ticket");
  if (!ticket || !(await redeemPublicSample(ticket))) return hidden();
  return new Response(null, { status: 303, headers: { ...privateHeaders, location: "/timeline" } });
}
