import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { createPublicSampleTicket, sampleSecret } from "@/features/foundation/samples";
import { canPublish, findSubmission, readReviewItems, reviewScope } from "@/features/review/store";
import { withWebsiteDb } from "@/lib/supabase/database";
import { confirmReview, withdrawReview } from "../actions";

export default async function ReviewDetail({ params, searchParams }: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const scope = await reviewScope();
  if (!scope) redirect("/maintain/login");
  const { submissionId } = await params;
  if (!scope.ready || !z.uuid().safeParse(submissionId).success) notFound();

  const detail = await withWebsiteDb(async (db) => {
    const submission = await findSubmission(db, scope, submissionId);
    return submission && { submission, items: await readReviewItems(db, submissionId) };
  });
  if (!detail) notFound();

  const { status } = await searchParams;
  const { submission, items } = detail;
  const senderAllowed = Boolean(scope.sender && submission.sender_hash === scope.sender);
  const pending = senderAllowed && items.some((item) => !item.approval && !item.withdrawn_at);
  const secret = sampleSecret();
  const publicLink = scope.sample && secret && items.some((item) =>
    item.approval?.published && canPublish(item, true))
    ? "/api/debug/samples/public?" + new URLSearchParams({ ticket: createPublicSampleTicket(scope.sample, secret) })
    : null;

  return <section className="space-y-4 py-6">
    <p><Link className="underline" href="/maintain/review">返回审核投稿</Link></p>
    <h1 className="font-heading text-3xl font-semibold">投稿审核详情</h1>
    {status === "confirmed" && <p role="status">审核已确认。</p>}
    {status === "conflict" && <p role="status">审核未保存。请核对当前版本和授权后重试。</p>}
    {!senderAllowed && <p>发件人未通过校验。</p>}
    <form className="space-y-4" action={confirmReview.bind(null, submissionId, randomUUID())}>
      {pending && <p>逐项选择是否站内发布。未勾选的条目将保持私有。</p>}
      {items.map((item) => {
        const editable = senderAllowed && !item.approval && !item.withdrawn_at;
        const publishable = canPublish(item, Boolean(scope.sample));
        return <fieldset className="space-y-2 rounded border p-4" key={item.id}>
          <legend>{item.title || (item.kind === "photo" ? "照片" : "日记")} · {item.position + 1}</legend>
          {item.local_date && <time dateTime={item.local_date}>{item.local_date}</time>}
          {item.kind === "diary" && <p className="whitespace-pre-wrap wrap-anywhere">{item.diary_text}</p>}
          {item.withdrawn_at ? <p>已撤下</p>
            : item.approval ? <p>{item.approval.published && publishable ? "已发布" : "私有"}</p>
            : editable && <>
              <input type="hidden" name="item" value={item.id + "/" + item.version_id} />
              {publishable ? <label><input type="checkbox" name={"public-" + item.id} /> 站内发布</label>
                : <p>当前条目缺少发布授权、日期或展示内容。</p>}
            </>}
        </fieldset>;
      })}
      {pending && <Button type="submit">确认审核</Button>}
    </form>
    {publicLink && <p><Link prefetch={false} className="underline" href={publicLink}>打开公开样本</Link></p>}
    {items.some((item) => item.approval?.published && !item.withdrawn_at) && <form action={withdrawReview.bind(null, submissionId)}>
      <Button type="submit">撤下</Button>
    </form>}
  </section>;
}
