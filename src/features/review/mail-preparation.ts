import type { PoolClient } from "pg";
import { z } from "zod";
import { mailRestrictions, restrictionFlags } from "@/features/intake/mail-restrictions";
import { normalizeIntakeDate } from "@/features/intake/normalize";
import { displayJobKind, reviewDisplayBlob } from "@/features/intake/review-display";
import { displayKey } from "@/features/public/media-key";
import { readSiteEnv } from "@/lib/env";
import type { ReviewItem } from "./review-rows";

const hintsSchema = z.object({
  commonDateHint: z.string().optional(),
  items: z.array(z.object({ position: z.number(), dateHint: z.string().optional(), exclusionQuote: z.string().optional() })),
});
const positionSchema = z.array(z.object({ position: z.number().int().min(0).max(99) }));
const restrictionsSchema = z.array(z.object({ position: z.number(), flags: restrictionFlags }));
type JobStatus = z.infer<typeof import("@/lib/contracts/jobs").jobStatus>;

type IntakePreparationRow = {
  submission_id: string;
  hints: unknown;
  positions: unknown;
  restrictions: unknown;
  automatic_display: boolean;
  status: JobStatus;
};

type DisplayPreparationRow = {
  submission_id: string;
  id: string;
  status: JobStatus;
  updated_at: string;
  item_id: string;
  version_id: string;
};

function buildPreparation(receivedAt: string | Date, intake: IntakePreparationRow | undefined, jobs: DisplayPreparationRow[]) {
  const hints = hintsSchema.safeParse(intake?.hints ?? { items: [] });
  const stored = restrictionsSchema.safeParse(intake?.restrictions ?? []);
  const positions = positionSchema.safeParse(intake?.positions ?? []);
  const photoPositions = positions.data?.map(({ position }) => position).sort((a, b) => a - b) ?? [];
  const attachmentRestrictions = mailRestrictions(photoPositions, hints.data?.items.flatMap(({ position, exclusionQuote }) =>
    exclusionQuote === undefined ? [] : [{ position, quote: exclusionQuote }]) ?? []);
  const received = new Date(receivedAt).toISOString();
  const job = (itemId: string, versionId: string) => jobs.find((entry) => entry.item_id === itemId && entry.version_id === versionId);
  return {
    found: Boolean(intake),
    active: intake?.status === "queued" || intake?.status === "running",
    status: intake?.status,
    photoCount: photoPositions.length,
    photoNumber: (position: number) => photoPositions.indexOf(position) + 1 || undefined,
    job,
    displayReady(item: ReviewItem) {
      const display = job(item.id, item.version_id);
      if (display) return display.status === "done";
      return (item.version_number === 1 && intake?.automatic_display && intake.status === "done" &&
        photoPositions.includes(item.position)) || item.processed_media_ref === displayKey(item.id, item.version_id);
    },
    metadata(position: number) {
      const entry = hints.data?.items.find((item) => item.position === position);
      const mail = stored.data?.find((item) => item.position === position)?.flags;
      const attachment = attachmentRestrictions(position);
      const date = normalizeIntakeDate({ receivedAt: received, commonDateHint: hints.data?.commonDateHint,
        dateHint: entry?.dateHint });
      const common = normalizeIntakeDate({ receivedAt: received, commonDateHint: hints.data?.commonDateHint });
      const fallback = common.status === "resolved" ? common : normalizeIntakeDate({ receivedAt: received });
      return {
        restrictions: {
          site: attachment.site || Boolean(mail?.site),
          zip: attachment.zip || Boolean(mail?.zip),
          chain: attachment.chain || Boolean(mail?.chain),
          nft: Boolean(attachment.nft || mail?.nft),
          uncertain: !hints.success || !stored.success || !positions.success || attachment.uncertain || Boolean(mail?.uncertain),
        },
        date: date.status === "resolved" ? date.localDate : fallback.status === "resolved" ? fallback.localDate : null,
      };
    },
  };
}

const intakeFields = `
  payload->'hints' as hints, payload->'items' as positions, payload->'restrictions' as restrictions,
  payload->'prepareDisplay' = 'true'::jsonb as automatic_display, status
`;

const intakeSources = `
  from jobs
  where kind='foundation.intake' and schema_version=1 and sample_run_id is null
`;

const displayFields = `
  j.id, j.status, j.updated_at::text, i.id as item_id, v.id as version_id
`;

const displaySources = `
  from items i join lateral (select id from item_versions where item_id=i.id order by version desc limit 1) v on true
  join jobs j on j.payload=jsonb_build_object('itemId', i.id::text, 'versionId', v.id::text)
  where j.kind=$2 and j.schema_version=1 and j.sample_run_id is null
`;

export async function readRealPreparation(db: PoolClient, submissionId: string, receivedAt: string | Date) {
  const { rows: [intake] } = await db.query<IntakePreparationRow>(`
    select ${intakeFields}
    ${intakeSources} and payload->>'submissionId'=$1
    order by created_at desc, id desc limit 1
  `, [submissionId]);
  const { rows: jobs } = await db.query<DisplayPreparationRow>(`
    select distinct on (i.id, v.id) ${displayFields}
    ${displaySources} and i.submission_id=$1
    order by i.id, v.id, j.created_at desc, j.id desc
  `, [submissionId, displayJobKind]);
  return buildPreparation(receivedAt, intake, jobs);
}

export async function readRealPreparations(db: PoolClient, submissions: { id: string; received_at: string | Date }[]) {
  if (submissions.length === 0) return new Map<string, ReturnType<typeof buildPreparation>>();
  const ids = submissions.map(({ id }) => id);
  const intake = await db.query<IntakePreparationRow>(`
    select distinct on (payload->>'submissionId') payload->>'submissionId' as submission_id, ${intakeFields}
    ${intakeSources} and payload->>'submissionId'=any($1::text[])
    order by payload->>'submissionId', created_at desc, id desc
  `, [ids]);
  const display = await db.query<DisplayPreparationRow>(`
    select distinct on (i.id, v.id) i.submission_id, ${displayFields}
    ${displaySources} and i.submission_id=any($1::uuid[])
    order by i.id, v.id, j.created_at desc, j.id desc
  `, [ids, displayJobKind]);
  const intakeBySubmission = new Map(intake.rows.map((row) => [row.submission_id, row]));
  const jobsBySubmission = Map.groupBy(display.rows, (job) => job.submission_id);
  return new Map(submissions.map(({ id, received_at: receivedAt }) => [
    id, buildPreparation(receivedAt, intakeBySubmission.get(id), jobsBySubmission.get(id) ?? []),
  ]));
}

export async function readReviewBlob(key: string, signal?: AbortSignal) {
  const { BLOB_READ_WRITE_TOKEN: token, BLOB_STORE_HOST: host } = readSiteEnv();
  if (!token || !host) throw new Error("Review Blob unavailable");
  return reviewDisplayBlob(token, host).read(key, signal);
}
