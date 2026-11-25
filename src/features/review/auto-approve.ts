import type { PoolClient } from "pg";
import { withExportMutation } from "@/features/foundation/private-export";
import { prepareReviewDisplay, type reviewDisplayBlob } from "@/features/intake/review-display";
import { displayKey } from "@/features/public/media-key";
import { stage0IntakeSource } from "@/lib/contracts/intake";
import { readAutoApproval } from "./auto-settings";
import { inboxPlan } from "./inbox-policy";
import { writeInboxApproval } from "./inbox-write";
import { readRealPreparation } from "./mail-preparation";
import { readReviewItems } from "./review-rows";

type Transaction = <T>(run: (db: PoolClient) => Promise<T>) => Promise<T>;
type Options = { root: string; blob: ReturnType<typeof reviewDisplayBlob>; signal: AbortSignal };
type Submission = { id: string; received_at: Date };

export function createAutoApprover(transaction: Transaction, options: Options) {
  let cursor: string | null = null;
  let version: number | null = null;

  return async (db: PoolClient) => {
    const setting = await readAutoApproval(db);
    if (version !== (setting?.version ?? null)) cursor = null;
    version = setting?.version ?? null;
    if (!setting) return;
    const { rows } = await db.query<Submission>(`
      select s.id, s.received_at from submissions s
      join lateral (
        select status from jobs where kind='foundation.intake' and schema_version=1 and sample_run_id is null
          and payload->>'submissionId'=s.id::text order by created_at desc, id desc limit 1
      ) intake on intake.status not in ('queued','running')
      where s.source=$1 and s.sender_hash=$2 and ($3::uuid is null or s.id>$3)
        and exists (
          select 1 from items i
          join lateral (select id from item_versions where item_id=i.id order by version desc limit 1) v on true
          where i.submission_id=s.id and i.withdrawn_at is null and i.exclusion<>'ambiguous'
            and not exists (select 1 from approvals a where a.item_id=i.id and a.version_id=v.id)
        )
      order by s.id limit 10
    `, [stage0IntakeSource, setting.sender, cursor]);
    for (const row of rows) {
      if (options.signal.aborted) return;
      try {
        const ready = await prepareDisplays(db, row, options);
        await transaction((client) => withExportMutation(client, null, async () => {
          const current = await readAutoApproval(client);
          if (current?.version !== setting.version || current.sender !== setting.sender) {
            return { value: undefined, exportChanged: false };
          }
          const exportChanged = await approveReadyItems(client, row, ready, options.signal);
          return { value: undefined, exportChanged };
        }));
      } catch {
        if (!options.signal.aborted) console.warn("自动审批待重试");
      }
      cursor = row.id;
    }
    if (rows.length < 10) cursor = null;
  };
}

async function readCandidates(db: PoolClient, submission: Submission) {
  const setup = await readRealPreparation(db, submission.id, submission.received_at);
  if (!setup.found || setup.active) return [];
  const items = await readReviewItems(db, submission.id);
  return items.flatMap((item) => {
    const plan = inboxPlan(item, setup.metadata(item.position));
    if (!plan) return [];
    const needsDisplay = (plan.publicView || plan.privateExport) && item.kind === "photo" && item.exclusion === "none";
    const status = setup.job(item.id, item.version_id)?.status;
    if (needsDisplay && status && status !== "done") return [];
    return [{ item, plan, needsDisplay, displayReady: setup.displayReady(item) }];
  });
}

async function prepareDisplays(db: PoolClient, submission: Submission, { root, blob, signal }: Options) {
  const ready = new Set<string>();
  for (const { item, needsDisplay, displayReady } of await readCandidates(db, submission)) {
    if (!needsDisplay) continue;
    signal.throwIfAborted();
    try {
      const key = displayKey(item.id, item.version_id);
      if (!displayReady || !(await blob.read(key, signal))) {
        await prepareReviewDisplay(db, { itemId: item.id, versionId: item.version_id }, root, blob, signal);
      }
      ready.add(item.version_id);
    } catch {
      signal.throwIfAborted();
      // Leave the item pending for retry without blocking the rest of the submission.
    }
  }
  return ready;
}

async function approveReadyItems(db: PoolClient, submission: Submission, ready: Set<string>, signal: AbortSignal) {
  let exportChanged = false;
  for (const { item, plan, needsDisplay } of await readCandidates(db, submission)) {
    if (needsDisplay && !ready.has(item.version_id)) continue;
    signal.throwIfAborted();
    await writeInboxApproval(db, item, plan, "automatic");
    exportChanged ||= plan.privateExport;
  }
  return exportChanged;
}
