import { hidden, readSample, sameOrigin, writeSample } from "@/features/foundation/samples";

export async function POST(request: Request) {
  const sample = await readSample();
  if (!sample || !sameOrigin(request.headers)) return hidden();
  await writeSample({ ...sample, saved: true });
  return new Response(null, { status: 303, headers: { location: "/debug/samples" } });
}
