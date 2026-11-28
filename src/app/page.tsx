import Link from "next/link";
import { connection } from "next/server";
import { PublicPhoto } from "@/features/public/photo";
import { readTimelineView } from "@/features/public/sample-content";
import { SamplePhoto } from "@/features/public/sample-photo";
import { readSiteEnv } from "@/lib/env";

export default async function Home() {
  await connection();
  const timeline = await readTimelineView().catch(() => null);
  const photos = timeline?.kind === "published"
    ? timeline.items.filter((item) => item.kind === "photo" && item.publicMediaRef)
    : [];
  const preferredCover = photos.length > 0 ? readSiteEnv().SITE_COVER_ITEM_ID : undefined;
  const cover = photos.find((photo) => photo.itemId === preferredCover) ?? photos[0];

  return (
    <section className="public-page pb-10">
      <div className="photo-home-intro text-center">
        <h1 className="public-title">猫咪纪念站<span className="sr-only"> 首页</span></h1>
        <Link href="/timeline" className="inline-flex min-h-11 items-center rounded-full bg-primary px-6 py-2.5 font-medium text-primary-foreground">
          时间线 <span aria-hidden="true" className="ml-2">→</span>
        </Link>
      </div>
      {timeline?.kind === "sample" && (
        <figure>
          <SamplePhoto photo="nap" eager />
          <figcaption className="mt-2 text-sm text-muted-foreground">预览样片</figcaption>
        </figure>
      )}
      {!timeline && <p className="photo-frame photo-frame-cover p-4 text-center" role="status">照片暂时无法显示</p>}
      {cover?.publicMediaRef && (
        <PublicPhoto key={cover.currentVersionId} src={cover.publicMediaRef} alt={cover.title || "纪念站封面"} cover />
      )}
    </section>
  );
}
