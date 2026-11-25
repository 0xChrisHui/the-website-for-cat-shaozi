import Link from "next/link";
import { connection } from "next/server";
import { readTimelineView } from "@/features/public/sample-content";
import { SamplePhoto } from "@/features/public/sample-photo";
import { diagnosticsEnabled } from "@/lib/env";

export default async function Home() {
  await connection();
  const showSample = diagnosticsEnabled() && (await readTimelineView()).kind === "sample";

  return (
    <section className="space-y-6 py-6">
      <div className="space-y-3">
        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">首页</h1>
        <p className="text-lg text-muted-foreground">猫咪纪念站</p>
      </div>
      {showSample && (
        <figure className="overflow-hidden rounded-lg border border-border">
          <SamplePhoto photo="nap" eager />
          <figcaption className="bg-muted px-4 py-2 text-sm text-muted-foreground">预览样片</figcaption>
        </figure>
      )}
      <Link href="/timeline" className="inline-block rounded bg-primary px-4 py-2 text-primary-foreground">
        时间线
      </Link>
    </section>
  );
}
