import { connection } from "next/server";
import { readPublishedTimeline } from "@/features/public/timeline";

export default async function TimelinePage() {
  await connection();
  const items = await readPublishedTimeline();

  return (
    <section className="space-y-6">
      <h1 className="font-heading text-3xl font-semibold">时间线</h1>
      {items.length === 0 ? (
        <p>暂无公开内容。</p>
      ) : (
        <ol className="space-y-6">
          {items.map((item) => (
            <li key={item.itemId} className="space-y-2 break-words">
              <time dateTime={item.localDate}>{item.localDate}</time>
              <h2 className="text-xl font-semibold">{item.title || (item.kind === "photo" ? "照片" : "日记")}</h2>
              {item.caption && <p>{item.caption}</p>}
              {item.diaryText && <p className="whitespace-pre-wrap">{item.diaryText}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
