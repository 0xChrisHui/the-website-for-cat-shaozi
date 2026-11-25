import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { intakeJobLabels, readMaintainerDraft } from "@/features/intake/maintainer-queue";

export const dynamic = "force-dynamic";

export default async function IntakeDraftPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  const result = await readMaintainerDraft(submissionId);
  if (result.state === "signed-out") redirect("/maintain/login");
  if (result.state !== "ready") notFound();

  return <>
    <Link className="underline" href="/maintain/intake">返回投稿待办</Link>
    <h1 className="font-heading text-2xl">投稿草稿</h1>
    <p>{intakeJobLabels[result.status]}</p>
    {result.draft.items.length === 0 ? <p>暂无已保存条目。</p> : <ul className="space-y-3">
      {result.draft.items.map((item) => <li key={item.itemId} className="rounded border border-border px-4 py-3">
        <h2 className="font-heading">{item.kind === "photo" ? "照片" : "日记"}</h2>
        {item.disposition === "excluded" && <p>已排除</p>}
        {item.file && <p>已保存原图 · {item.file.sizeBytes} 字节</p>}
        {item.diaryText && <p className="whitespace-pre-wrap wrap-anywhere">{item.diaryText}</p>}
      </li>)}
    </ul>}
  </>;
}
