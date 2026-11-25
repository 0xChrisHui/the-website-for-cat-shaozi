import "server-only";

import { headers } from "next/headers";
import { requireMaintainer } from "@/lib/supabase/server";
import { withWebsiteDb } from "@/lib/supabase/database";
import type { ExportRequest } from "@/lib/contracts/exports";
import { readPublicSample, readSample, sameOrigin } from "./samples";
import { readSampleExportMedia } from "./sample-export-media";
import { claimExport, currentExport, failExport, publishExport, recheckExport, requestExport } from "./private-export";

async function authorizedScope() {
  const sample = await readSample();
  if (sample) return { sample: sample.runId };
  if (await readPublicSample() || !(await requireMaintainer())) return null;
  return { sample: null };
}

export async function requestPrivateExport(input: ExportRequest) {
  if (!sameOrigin(await headers())) return null;
  const scope = await authorizedScope();
  return scope && withWebsiteDb((db) => requestExport(db, scope.sample, input.requestId));
}

type Pointer = NonNullable<Awaited<ReturnType<typeof currentExport>>>;

// Invoke the signer inside this callback so revocation and signing are serialized.
export async function withCurrentPrivateExport<T>(read: (pointer: Pointer) => Promise<T>) {
  const scope = await authorizedScope();
  if (!scope) return null;
  return withWebsiteDb(async (db) => {
    const pointer = await currentExport(db, scope.sample);
    return pointer ? read(pointer) : null;
  });
}

type Candidates = NonNullable<Awaited<ReturnType<typeof recheckExport>>>;

// The transaction stores Mock bytes and the pointer together. The callback only receives
// that run's candidates and synthetic media, and performs no provider writes.
export async function generateSamplePrivateExport(
  generate: (candidates: Candidates, readMedia: typeof readSampleExportMedia) => Promise<Buffer>,
) {
  if (!sameOrigin(await headers())) return false;
  const sample = await readSample();
  if (!sample) return false;
  return withWebsiteDb(async (db) => {
    const claim = await claimExport(db, sample.runId);
    if (!claim) return false;
    const candidates = await recheckExport(db, sample.runId, claim);
    const bytes = candidates && await generate(candidates, readSampleExportMedia).catch(() => null);
    if (bytes && bytes.length > 0 && bytes.length <= 8 * 1024 ** 2 && sample.expires > Date.now() &&
        await publishExport(db, sample.runId, claim, bytes)) return true;
    await failExport(db, sample.runId, claim);
    return false;
  });
}
