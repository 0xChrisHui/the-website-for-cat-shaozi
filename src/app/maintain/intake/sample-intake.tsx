import Link from "next/link";
import { Button } from "@/components/ui/button";
import { normalizeIntakeDate } from "@/features/intake/normalize";
import { previewIntakeEvent as event } from "@/features/intake/preview-fixture";

export type SampleIntakeParams = { draft?: string; date?: string };

const intakePath = "/maintain/intake";

export function SampleIntake({ draft, date }: SampleIntakeParams) {
  const open = draft === "open";
  const submitted = open || draft === "submitted";
  const correctedDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;

  return <>
    <h1 className="font-heading text-2xl">投稿待办</h1>
    <p>合成样本 · 仅含投稿元数据</p>
    <form action={intakePath} className="flex flex-wrap gap-2">
      <input type="hidden" name="draft" value="submitted" />
      <Button type="submit">投递样本</Button>
      <Button type="submit" disabled={!submitted}>重投同一事件</Button>
    </form>
    {submitted && <p><Link href={intakePath + "?draft=open"}>打开草稿</Link></p>}
    {open && <section aria-labelledby="sample-draft-title">
      <h2 id="sample-draft-title">投稿草稿</h2>
      <ul className="space-y-3">
        {event.items.map((item) => {
          const dateHint = item.position === 2 && correctedDate ? correctedDate : item.dateHint;
          const result = normalizeIntakeDate({ ...event, dateHint });
          return <li key={item.position}>
            <h3>{item.kind === "photo" ? `照片 ${item.position + 1}` : "日记"}</h3>
            {item.diaryText && <p>{item.diaryText}</p>}
            {result.status === "pending"
              ? <p>{result.reason}</p>
              : <time dateTime={result.localDate}>{result.localDate}</time>}
            {item.position === 2 && <form action={intakePath}>
              <input type="hidden" name="draft" value="open" />
              <label htmlFor="sample-date">照片 3 日期</label>{" "}
              <input id="sample-date" name="date" type="date" defaultValue={correctedDate} required />{" "}
              <Button type="submit">保存日期</Button>
            </form>}
          </li>;
        })}
      </ul>
    </section>}
  </>;
}
