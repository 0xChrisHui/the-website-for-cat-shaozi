import Link from "next/link";
import { readRealPreparation } from "@/features/review/mail-preparation";
import { inboxPlan } from "@/features/review/inbox-policy";
import { canPublish, inboxPageSize, readInboxSubmissions, readReviewItems, type ReviewScope } from "@/features/review/store";
import { withWebsiteDb } from "@/lib/supabase/database";
import { readAutoApproval } from "@/features/review/auto-settings";
import { confirmInbox, retryInbox, setAutoApproval, withdrawInbox } from "./actions";
import { InboxButton, InboxPreview, RefreshInbox } from "./inbox-controls";

const receivedTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
});
const messages: Record<string, string> = {
  confirmed: "已确认审核。",
  conflict: "操作未保存。请核对当前版本、投稿状态和预览后重试。",
  preparing: "已请求准备预览。",
  withdrawn: "投稿已撤下。",
};

export async function ReviewInbox({ scope, status, page = 1 }: { scope: ReviewScope; status?: string; page?: number }) {
  if (!scope.ready) return <p role="status">审核数据库暂不可用。</p>;
  const { entries, morePending, autoApproval } = await withWebsiteDb(async (db) => {
    const rows = await readInboxSubmissions(db, scope, page);
    const morePending = rows.filter(({ pending }) => pending).length > inboxPageSize;
    const visible = morePending ? rows.filter(({ pending }, index) => !pending || index < inboxPageSize) : rows;
    const entries = [];
    for (const row of visible) {
      const items = await readReviewItems(db, row.id);
      const setup = await readRealPreparation(db, row.id, row.received_at);
      entries.push({ row, items, setup, allowed: Boolean(scope.sender && row.sender_hash === scope.sender) });
    }
    return { entries, morePending, autoApproval: await readAutoApproval(db) };
  });
  const active = entries.some(({ setup, items }) => setup.active || items.some((item) => {
    const status = setup.job(item.id, item.version_id)?.status;
    return status === "queued" || status === "running";
  }));

  function card({ row, items, setup, allowed }: (typeof entries)[number], open = false) {
    const live = items.filter((item) => !item.withdrawn_at);
    const candidates = allowed && setup.found && !setup.active
      ? live.filter((item) => inboxPlan(item, setup.metadata(item.position))) : [];
    const photos = candidates.filter(({ kind, exclusion }) => kind === "photo" && exclusion === "none");
    const waiting = photos.some((item) => {
      const state = setup.job(item.id, item.version_id)?.status;
      return state === "queued" || state === "running";
    });
    const needsDisplay = photos.some((item) => {
      const rights = inboxPlan(item, setup.metadata(item.position));
      return (rights?.publicView || rights?.privateExport) && !setup.displayReady(item);
    });
    const canWithdraw = live.some((item) => item.approval);
    const photoCount = Math.max(setup.photoCount, items.filter(({ kind }) => kind === "photo").length);
    const label = row.pending
      ? setup.active || waiting ? "正在准备私有预览" : "待审核"
      : live.some((item) => item.approval) ? "已审核" : "已撤下";
    return <li key={row.id} className="rounded-lg border border-border bg-surface">
      <details open={open}>
        <summary className="min-h-11 cursor-pointer rounded-lg px-4 py-3 font-medium hover:bg-muted">
          <time dateTime={row.received_at.toISOString()}>{receivedTime.format(row.received_at)}</time>
          <span className="ml-3 text-sm text-muted-foreground">{photoCount} 张照片</span>{" "}
          <span className="review-status text-sm" data-tone={row.pending ? "pending" : label === "已审核" ? "complete" : undefined}>{label}</span>
        </summary>
        <div className="space-y-4 border-t border-border p-4 sm:p-5">
          {!allowed && <p>发件人未通过校验。</p>}
          {setup.active && <p role="status">正在接收原件并准备私有预览…</p>}
          {setup.status === "needs_attention" && <p role="status">部分原件或预览准备失败。已接收的条目如下。</p>}
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const photo = item.kind === "photo";
              const number = setup.photoNumber(item.position) ?? items.filter((other) =>
                other.kind === "photo" && other.position <= item.position).length;
              const metadata = setup.metadata(item.position);
              const { restrictions } = metadata;
              const rights = inboxPlan(item, metadata);
              const job = setup.job(item.id, item.version_id);
              const ready = allowed && !item.withdrawn_at && item.exclusion === "none" &&
                !restrictions.uncertain && setup.displayReady(item);
              const localDate = rights?.localDate ?? item.local_date;
              return <li key={item.id} className="min-w-0 space-y-2 py-4 first:pt-0">
                <h3 className="font-semibold">{photo ? "照片 " + number : "日记"}</h3>
                {item.withdrawn_at ? <p className="text-muted-foreground">已撤下</p>
                  : item.approval ? <p className="text-muted-foreground">
                    {item.approval.published && canPublish(item, false) ? "已发布" : "已审核 · 私有"}
                  </p> : item.historical_approval ? <p className="text-muted-foreground">有历史审核记录</p> : null}
                {allowed && item.approval?.source === "automatic" && !item.withdrawn_at && <p>自动批准</p>}
                {allowed && <>
                  <div className={photo ? "grid gap-3 sm:grid-cols-2 sm:gap-5" : undefined}>
                    {photo && (ready ? <InboxPreview key={item.version_id + "-" + (job?.updated_at ?? "intake")}
                      number={number} src={"/maintain/review/" + row.id + "/display?" + new URLSearchParams({
                        item: item.id, version: item.version_id,
                      })} /> : rights && !item.withdrawn_at && <p className="rounded-lg bg-muted p-4 text-muted-foreground" role="status">
                      {job?.status === "needs_attention" ? "私有预览准备失败"
                        : setup.active || job?.status === "queued" || job?.status === "running"
                          ? "正在准备私有预览…" : "私有预览待准备"}
                    </p>)}
                    <div className="min-w-0 space-y-2 wrap-anywhere">
                      {localDate && <p>条目日期：<time dateTime={localDate}>{localDate}</time></p>}
                      {!photo && !item.withdrawn_at && item.diary_text &&
                        <p className="whitespace-pre-wrap wrap-anywhere">{item.diary_text}</p>}
                      {item.exclusion !== "none" && <p>保留已有排除记录</p>}
                      {restrictions.uncertain && <p>邮件限制或照片范围不明确，需核对</p>}
                      {restrictions.site && <p>邮件限制：不公开</p>}
                      {restrictions.zip && <p>邮件限制：不纳入私有 ZIP</p>}
                      {restrictions.chain && <p>邮件限制：不上链（归档和 NFT）</p>}
                      {restrictions.nft && !restrictions.chain && <p>邮件限制：不铸造 NFT</p>}
                    </div>
                  </div>
                </>}
              </li>;
            })}
          </ul>
          {candidates.length > 0 && live.some((item) => setup.metadata(item.position).restrictions.uncertain) &&
            <p>本次只批准用途明确的条目。</p>}
          {candidates.length > 0 && !needsDisplay && <form action={confirmInbox.bind(null, row.id,
            live.map((item) => [item.id, item.version_id, inboxPlan(item, setup.metadata(item.position))?.snapshot ?? null]))}>
            <InboxButton label="批准投稿" pendingLabel="正在批准…" />
          </form>}
          {!waiting && photos.length > 0 && (needsDisplay
            ? <form action={retryInbox.bind(null, row.id, photos.map((item) => ({
              itemId: item.id, versionId: item.version_id,
            })), false)}>
              <InboxButton label={photos.some((item) => setup.job(item.id, item.version_id)?.status === "needs_attention")
                ? "重试准备私有预览" : "准备私有预览"} pendingLabel="正在请求…" />
            </form>
            : <details>
              <summary className="flex min-h-11 cursor-pointer items-center underline">预览准备</summary>
              <form className="mt-2" action={retryInbox.bind(null, row.id, photos.map((item) => ({
                itemId: item.id, versionId: item.version_id,
              })), true)}>
                <InboxButton variant="secondary" label="重试准备私有预览" pendingLabel="正在请求…" />
              </form>
            </details>)}
          {canWithdraw && <form action={withdrawInbox.bind(null, row.id)}>
            <InboxButton variant="secondary" label="撤下投稿" pendingLabel="正在撤下…" />
          </form>}
        </div>
      </details>
    </li>;
  }

  const pending = entries.filter(({ row }) => row.pending);
  const reviewed = entries.filter(({ row }) => !row.pending);
  return <>
    {(active || (autoApproval && pending.length > 0)) && <RefreshInbox />}
    {status && Object.hasOwn(messages, status) && <p role="status">{messages[status]}</p>}
    <section className="space-y-4" aria-labelledby="pending-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pending-heading" className="font-heading text-xl font-semibold">待审核投稿</h2>
        {pending.length > 0 && <span className="text-sm text-muted-foreground">本页 {pending.length} 封</span>}
      </div>
      {pending.length ? <ul className="space-y-3">{pending.map((entry, index) => card(entry, index === 0))}</ul> : <p className="rounded-lg bg-muted p-5 text-muted-foreground">暂无待审核投稿。</p>}
      {(page > 1 || morePending) && <nav aria-label="待审核投稿分页" className="flex flex-wrap gap-4">
        {page > 1 && <Link href={"/maintain?inboxPage=" + (page - 1)} className="underline">较新投稿</Link>}
        {morePending && <Link href={"/maintain?inboxPage=" + (page + 1)} className="underline">较早投稿</Link>}
      </nav>}
    </section>
    <section className="space-y-3" aria-labelledby="reviewed-heading">
      <h2 id="reviewed-heading" className="font-heading text-xl font-semibold">最近审核记录</h2>
      {reviewed.length ? <ul className="space-y-3">{reviewed.map((entry) => card(entry))}</ul> : <p className="text-muted-foreground">暂无审核记录。</p>}
    </section>
    <form action={setAutoApproval.bind(null, !autoApproval)} className="space-y-2 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <p className="font-semibold">自动批准 · {autoApproval ? "已开启" : "已关闭"}</p>
      <p className="text-sm">开启后，符合要求的积压和新投稿会自动批准，并按邮件中的限制发布。发件人地址可能被冒用。</p>
      {(autoApproval || scope.sender) && <InboxButton variant="secondary"
        label={autoApproval ? "关闭自动批准" : "开启自动批准"} pendingLabel="正在保存…" />}
    </form>
  </>;
}
