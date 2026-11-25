import { connection } from "next/server";
import { readTimelineView } from "@/features/public/sample-content";
import { SamplePhoto } from "@/features/public/sample-photo";

const cards = "grid gap-4 sm:grid-cols-2";
const card = "min-w-0 overflow-hidden rounded-lg border border-border";
const copy = "space-y-2 p-4 wrap-anywhere";

export default async function TimelinePage() {
  await connection();
  const timeline = await readTimelineView();

  return (
    <section className="space-y-6 py-6">
      <h1 className="font-heading text-3xl font-semibold">时间线</h1>
      {timeline.kind === "sample" ? (
        <>
          <p className="text-muted-foreground">预览样片与虚构日记</p>
          <ol className={cards}>
            {timeline.items.map((item) => (
              <li key={item.localDate} className={card}>
                <SamplePhoto photo={item.photo} />
                <div className={copy}>
                  <time className="text-sm text-muted-foreground" dateTime={item.localDate}>{item.localDate}</time>
                  <h2 className="font-heading text-xl font-semibold">{item.title}</h2>
                  {"diaryText" in item && <p>{item.diaryText}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : timeline.items.length === 0 ? (
        <p>暂无公开内容。</p>
      ) : (
        <ol className={cards}>
          {timeline.items.map((item) => (
            <li key={item.itemId} className={card}>
              <div className={copy}>
                <time className="text-sm text-muted-foreground" dateTime={item.localDate}>{item.localDate}</time>
                <h2 className="font-heading text-xl font-semibold">{item.title || (item.kind === "photo" ? "照片" : "日记")}</h2>
                {item.caption && <p>{item.caption}</p>}
                {item.diaryText && <p className="whitespace-pre-wrap">{item.diaryText}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
