import type { PoolClient } from "pg";
import { displayKey } from "@/features/public/media-key";
import type { inboxPlan } from "./inbox-policy";
import type { ReviewItem } from "./review-rows";

type Plan = NonNullable<ReturnType<typeof inboxPlan>>;

export async function writeInboxApproval(db: PoolClient, item: ReviewItem, plan: Plan,
  source: "manual" | "automatic",
) {
  const { publicView, privateExport, arweave, nft, localDate } = plan;
  if ((publicView || privateExport) && item.kind === "photo" && item.exclusion === "none") {
    await db.query(`
      insert into item_version_display (version_id,processed_media_ref) values ($1,$2)
      on conflict (version_id) do update set processed_media_ref=excluded.processed_media_ref
    `, [item.version_id, displayKey(item.id, item.version_id)]);
  }
  if (!item.local_date) await db.query("update item_versions set local_date=$2 where id=$1", [item.version_id, localDate]);
  await db.query(`
    insert into item_usage_rights (item_id,public_view,private_export,arweave,nft) values ($1,$2,$3,$4,$5)
    on conflict (item_id) do update set public_view=excluded.public_view, private_export=excluded.private_export,
      arweave=excluded.arweave, nft=excluded.nft
  `, [item.id, publicView, privateExport, arweave, nft]);
  // Chain execution requires the separate explicit decision and gate.
  const values = [item.id, item.version_id, publicView, privateExport];
  await db.query(`
    insert into approvals (item_id,version_id,source,published,public_view,private_export)
    values ($1,$2,$5,$3,$3,$4)
  `, [...values, source]);
}
