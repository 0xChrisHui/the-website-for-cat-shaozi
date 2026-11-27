import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { readReviewItems, readSubmissions, reviewScope } from "@/features/review/store";
import { withWebsiteDb } from "@/lib/supabase/database";
import { prepareSample, withdrawReview } from "./actions";

const receivedTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai",
});

export default async function ReviewPage() {
  const scope = await reviewScope();
  if (!scope) redirect("/maintain/login");
  const rows = scope.ready ? await withWebsiteDb((db) => readSubmissions(db, scope)) : [];

  const sampleSubmission = scope.sample ? rows[0]?.id : undefined;
  const canWithdraw = sampleSubmission && await withWebsiteDb(async (db) =>
    (await readReviewItems(db, sampleSubmission)).some((item) => item.approval?.published && !item.withdrawn_at));

  return <section className="review-workspace space-y-6 py-6">
    <h1 className="font-heading text-3xl font-semibold">审核投稿</h1>
    {!scope.ready ? <p>审核数据库暂不可用。</p> : rows.length === 0 && <p>暂无投稿。</p>}
    {scope.ready && scope.sample && rows.length === 0 && <form action={prepareSample}>
      <Button type="submit">准备审核样本</Button>
    </form>}
    {sampleSubmission && canWithdraw && <form action={withdrawReview.bind(null, sampleSubmission)}>
      <Button type="submit">撤下</Button>
    </form>}
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface empty:hidden">
      {rows.map(({ id, received_at, pending }) => <li key={id}>
        <Link className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 px-4 py-3 underline-offset-4 hover:bg-muted hover:underline" href={"/maintain/review/" + id}>
          <span className="font-semibold">{pending ? "待审核" : "查看审核记录"}</span><time className="text-muted-foreground" dateTime={received_at.toISOString()}>{receivedTime.format(received_at)}</time>
        </Link>
      </li>)}
    </ul>
  </section>;
}
