import type { RestrictionFlags } from "@/features/intake/mail-restrictions";
import type { ReviewItem } from "./store";

export function inboxRights(item: ReviewItem, restrictions: RestrictionFlags) {
  if (item.withdrawn_at || item.approval || item.historical_approval || item.exclusion === "ambiguous" ||
      restrictions.uncertain || (item.kind === "diary" && !item.diary_text?.trim())) return null;
  const { rights } = item;
  if (item.exclusion === "explicit") {
    return rights?.private_export && !restrictions.zip
      ? { publicView: false, privateExport: true, arweave: false, nft: false } : null;
  }
  if (item.version_number !== 1 && !rights) return null;
  const photo = item.kind === "photo";
  const publicView = !restrictions.site && (rights?.public_view ?? true);
  const privateExport = !restrictions.zip && (rights?.private_export ?? true);
  const arweave = photo && publicView && !restrictions.chain && (rights?.arweave ?? true);
  const nft = arweave && !restrictions.nft && (rights?.nft ?? true);
  return { publicView, privateExport, arweave, nft };
}

export type InboxBinding = [itemId: string, versionId: string, decision: string | null];

export function inboxPlan(item: ReviewItem, metadata: { date: string | null; restrictions: RestrictionFlags }) {
  const rights = inboxRights(item, metadata.restrictions);
  const localDate = item.local_date ?? metadata.date;
  if (!rights || !localDate) return null;
  const { publicView, privateExport, arweave, nft } = rights;
  const snapshot = localDate + "/" + [publicView, privateExport, arweave, nft].map(Number).join("");
  return { ...rights, localDate, snapshot };
}
