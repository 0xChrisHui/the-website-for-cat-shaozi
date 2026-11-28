import { connection } from "next/server";
import { PublicPhoto } from "@/features/public/photo";
import { readTimelineView, type samplePhotos } from "@/features/public/sample-content";
import { SamplePhoto } from "@/features/public/sample-photo";

type TimelineEntry = {
  id: string;
  localDate: string;
  kind: "photo" | "diary";
  title?: string;
  caption?: string;
  diaryText?: string;
  publicMediaRef?: string;
  samplePhoto?: keyof typeof samplePhotos;
};

export default async function TimelinePage() {
  await connection();
  const timeline = await readTimelineView().catch(() => null);
  const entries: TimelineEntry[] = timeline?.kind === "sample"
    ? timeline.items.map((item) => ({
      ...item, id: item.photo, kind: "photo", samplePhoto: item.photo,
      diaryText: "diaryText" in item ? item.diaryText : undefined,
    }))
    : timeline?.items.map((item) => ({ ...item, id: item.itemId })) ?? [];

  return (
    <section className="public-page pb-12">
      <header className="timeline-intro">
        <h1 className="public-title">时间线</h1>
        {timeline?.kind === "sample" && <p className="mt-3 text-muted-foreground">预览样片与虚构日记</p>}
      </header>
      {!timeline ? (
        <p role="status" className="rounded-lg bg-muted p-6 text-muted-foreground">时间线暂时无法加载，请稍后刷新。</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg bg-muted p-6 text-muted-foreground">暂无公开内容。</p>
      ) : (
        <ol className="space-y-10 sm:space-y-14">
          {Array.from(Map.groupBy(entries, (item) => item.localDate), ([date, items]) => (
            <li key={date} className="timeline-day border-t border-border pt-5">
              <h2 className="font-heading text-base font-semibold tabular-nums">
                <time dateTime={date}>{date}</time>
              </h2>
              <ol className="timeline-items">
                {items.map((item) => (
                  <li key={item.id} className={item.kind === "diary" ? "timeline-diary min-w-0 wrap-anywhere" : "min-w-0 wrap-anywhere"}>
                    {item.kind === "photo" ? (
                      <figure>
                        {item.samplePhoto ? <SamplePhoto photo={item.samplePhoto} />
                          : item.publicMediaRef ? <PublicPhoto src={item.publicMediaRef} alt={item.title || "猫咪照片"} />
                            : <p className="photo-frame p-4 text-center">暂无可展示照片</p>}
                        {(item.title || item.caption || item.diaryText) && (
                          <figcaption className="mt-3 space-y-1 text-muted-foreground">
                            {item.title && <p className="font-medium text-foreground">{item.title}</p>}
                            {item.caption && item.caption !== item.title && <p>{item.caption}</p>}
                            {item.diaryText && <p className="whitespace-pre-wrap">{item.diaryText}</p>}
                          </figcaption>
                        )}
                      </figure>
                    ) : (
                      <article className="space-y-3 border-l border-border pl-4 sm:pl-6">
                        <h3 className="font-heading text-xl font-semibold">{item.title || "日记"}</h3>
                        {item.caption && <p className="text-muted-foreground">{item.caption}</p>}
                        {item.diaryText && <p className="whitespace-pre-wrap leading-relaxed">{item.diaryText}</p>}
                      </article>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
