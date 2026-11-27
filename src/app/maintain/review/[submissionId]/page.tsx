import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { createPublicSampleTicket, sampleSecret } from "@/features/foundation/samples";
import { readPhotoSettings } from "@/features/foundation/photo-approval";
import { readRealPreparation } from "@/features/review/mail-preparation";
import { realPreparationEnabled } from "@/features/review/real-preparation";
import { testPhotoReview } from "@/features/review/photo-decision";
import { readSiteEnv } from "@/lib/env";
import { canPublish, findSubmission, readReviewItems, reviewScope } from "@/features/review/store";
import { withWebsiteDb } from "@/lib/supabase/database";
import { confirmReview, prepareRealItem, saveRealItem, withdrawReview } from "../actions";
import { InboxPreview } from "../inbox-controls";

export default async function ReviewDetail({ params, searchParams }: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const scope = await reviewScope();
  if (!scope) redirect("/maintain/login");
  const { submissionId } = await params;
  if (!scope.ready || !z.uuid().safeParse(submissionId).success) notFound();

  const testPhoto = testPhotoReview(readSiteEnv().environment, scope.sample);
  const detail = await withWebsiteDb(async (db) => {
    const submission = await findSubmission(db, scope, submissionId);
    if (!submission) return null;
    const items = await readReviewItems(db, submissionId);
    const archival = testPhoto && submission.sender_hash === scope.sender &&
      items.some((item) => !item.approval && item.kind === "photo" && item.rights?.arweave && canPublish(item, false));
    const recipientVersion = archival ? (await readPhotoSettings(db))?.recipientVersion : null;
    const setup = realPreparationEnabled(scope, submission.sender_hash)
      ? await readRealPreparation(db, submissionId, submission.received_at) : null;
    return { submission, items, recipientVersion, setup };
  });
  if (!detail) notFound();

  const { status } = await searchParams;
  const { submission, items, recipientVersion, setup } = detail;
  const senderAllowed = Boolean(scope.sender && submission.sender_hash === scope.sender);
  const pending = senderAllowed && items.some((item) => !item.approval && !item.withdrawn_at);
  const secret = sampleSecret();
  const publicLink = scope.sample && secret && items.some((item) =>
    item.approval?.published && canPublish(item, true))
    ? "/api/debug/samples/public?" + new URLSearchParams({ ticket: createPublicSampleTicket(scope.sample, secret) })
    : null;

  return <section className="review-workspace space-y-6 py-6">
    <p><Link className="inline-flex min-h-11 items-center underline underline-offset-4" href="/maintain/review">返回审核投稿</Link></p>
    <h1 className="font-heading text-3xl font-semibold">投稿审核详情</h1>
    {status === "confirmed" && <p role="status">审核已确认。</p>}
    {status === "conflict" && <p role="status">审核未保存。请核对当前版本和授权后重试。</p>}
    {status === "setup-saved" && <p role="status">已保存日期和用途授权。请另行确认审核。</p>}
    {status === "setup-conflict" && <p role="status">准备未保存。请核对当前版本、授权和展示副本。</p>}
    {status === "preparing" && <p role="status">已请求准备展示副本。请刷新查看进度。</p>}
    {!senderAllowed && <p>发件人未通过校验。</p>}
    {setup && <section aria-label="测试投稿准备" className="space-y-4">
      {items.filter((item) => !item.approval && !item.withdrawn_at).map((item) => {
        const metadata = setup.metadata(item.position);
        const job = setup.job(item.id, item.version_id);
        const photo = item.kind === "photo";
        const ready = setup.displayReady(item);
        const active = job?.status === "queued" || job?.status === "running";
        return <fieldset key={item.id} className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
          <legend>{photo ? "照片" : "日记"} · {item.position + 1} · 测试投稿准备</legend>
          {!setup.found || metadata.restrictions.uncertain || item.exclusion !== "none" ? <p>投稿有排除标记或缺少来源记录，保持私有。</p>
            : <div className={photo ? "grid gap-4 sm:grid-cols-2 sm:gap-6" : undefined}>
            {photo && <div className="min-w-0 space-y-3">
              {ready && <InboxPreview key={item.version_id + "-" + (job?.updated_at ?? "intake")}
                number={item.position + 1} alt="供人工审核的测试展示图"
                src={`/maintain/review/${submissionId}/display?` + new URLSearchParams({ item: item.id, version: item.version_id })} />}
              {active ? <p role="status">正在准备私有展示副本。请刷新查看进度。</p>
                : <form className="space-y-2" action={prepareRealItem.bind(null, submissionId, item.id, item.version_id)}>
                  {!ready && <p className="text-muted-foreground" role="status">{job?.status === "needs_attention" ? "私有预览准备失败" : "私有预览待准备"}</p>}
                  <Button type="submit">{job ? "重试准备展示副本" : "准备展示副本"}</Button>
                </form>}
            </div>}
            <form className="space-y-3" action={saveRealItem.bind(null, submissionId, item.id, item.version_id)}>
              <label className="flex flex-wrap items-center gap-3">条目日期 <input className="min-h-11 rounded border border-border px-2" type="date" name="date" required defaultValue={item.local_date ?? metadata.date ?? ""} /></label>
              <p>只勾选投稿者已明确许可的用途。</p>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="site" disabled={metadata.restrictions.site || (photo && !ready)} defaultChecked={!metadata.restrictions.site && item.rights?.public_view} /> 允许站内发布</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="zip" disabled={metadata.restrictions.zip || (photo && !ready)} defaultChecked={!metadata.restrictions.zip && item.rights?.private_export} /> 允许纳入私有 ZIP</label>
              {photo && ready && !metadata.restrictions.chain && <>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="archive" defaultChecked={item.rights?.arweave} /> 允许测试归档</label>
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="mint" disabled={metadata.restrictions.nft} defaultChecked={!metadata.restrictions.nft && item.rights?.nft} /> 允许测试铸造</label>
              </>}
              <Button type="submit">保存日期和用途授权</Button>
            </form>
          </div>}
        </fieldset>;
      })}
    </section>}
    <form className="space-y-4" action={confirmReview.bind(null, submissionId, randomUUID())}>
      {pending && <p>{setup ? "先选择本次审核的条目，再选择是否站内发布。其余条目继续待审核。" : "逐项选择是否站内发布。未勾选的条目将保持私有。"}</p>}
      {items.map((item) => {
        const restrictions = setup?.metadata(item.position).restrictions;
        const editable = senderAllowed && !item.approval && !item.withdrawn_at && !item.historical_approval && !restrictions?.uncertain;
        const publishable = canPublish(item, Boolean(scope.sample));
        return <fieldset className="min-w-0 space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5" key={item.id}>
          <legend>{item.title || (item.kind === "photo" ? "照片" : "日记")} · {item.position + 1}</legend>
          {item.local_date && <time dateTime={item.local_date}>{item.local_date}</time>}
          {item.kind === "diary" && <p className="whitespace-pre-wrap wrap-anywhere">{item.diary_text}</p>}
          {item.withdrawn_at ? <p>已撤下</p>
            : item.approval ? <p>{item.approval.published && publishable ? "已发布" : "私有"}</p>
            : editable && <>
              {setup ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="item" value={item.id + "/" + item.version_id} /> 本次确认此条目</label>
                : <input type="hidden" name="item" value={item.id + "/" + item.version_id} />}
              {publishable && !restrictions?.site ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name={"public-" + item.id} /> 站内发布</label>
                : <p>当前条目缺少发布授权、日期或展示内容。</p>}
              {testPhoto && publishable && !restrictions?.chain && !restrictions?.site && item.kind === "photo" && item.rights?.arweave && <label className="block">
                测试永久操作（须勾选站内发布）{" "}
                <select className="rounded border bg-background p-1" name={"test-photo-" + item.id}>
                  <option value="">无</option>
                  <option value="archive">仅测试归档</option>
                  {item.rights.nft && !restrictions?.nft && recipientVersion &&
                    <option value={recipientVersion}>测试归档并铸造到已批准的固定接收方</option>}
                </select>
              </label>}
            </>}
        </fieldset>;
      })}
      {pending && <Button type="submit">确认审核</Button>}
    </form>
    {publicLink && <p><Link prefetch={false} className="underline" href={publicLink}>打开公开样本</Link></p>}
    {items.some((item) => item.approval?.published && !item.withdrawn_at) && <form action={withdrawReview.bind(null, submissionId)}>
      <Button type="submit" variant="secondary">撤下</Button>
    </form>}
  </section>;
}
