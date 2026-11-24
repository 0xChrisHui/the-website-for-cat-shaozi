import { hidden, readSample, sameOrigin, writeSample } from "@/features/foundation/samples";

export async function POST(request: Request) {
  if (!sameOrigin(request.headers)) return hidden();
  const sample = await writeSample();
  return sample ? Response.json({ runId: sample.runId }) : hidden();
}

export async function GET() {
  const sample = await readSample();
  return sample ? Response.json({ runId: sample.runId }) : hidden();
}
