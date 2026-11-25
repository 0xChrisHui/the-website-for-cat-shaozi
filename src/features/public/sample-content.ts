import "server-only";

import { diagnosticsEnabled } from "@/lib/env";
import { readPublishedTimeline } from "./timeline";

export const samplePhotos = {
  nap: { alt: "一只橘白猫闭眼小憩", width: 1100, height: 619 },
  rest: { alt: "一只猫趴着休息", width: 800, height: 600 },
  sleep: { alt: "一只花猫靠着墙打盹", width: 800, height: 600 },
} as const;

export const sampleTimeline = [
  {
    localDate: "2024-10-12",
    title: "午后小憩",
    photo: "nap",
    diaryText: "午后的阳光移到窗边，它换了个姿势，继续睡。",
  },
  {
    localDate: "2024-10-06",
    title: "安静的星期天",
    photo: "rest",
    diaryText: "我翻了几页书，它就趴在旁边，偶尔抬头看一眼。",
  },
  {
    localDate: "2024-09-28",
    title: "墙边打盹",
    photo: "sleep",
  },
] as const;

export async function readTimelineView() {
  const published = await readPublishedTimeline();
  if (published.length === 0 && diagnosticsEnabled()) {
    return { kind: "sample", items: sampleTimeline } as const;
  }
  return { kind: "published", items: published } as const;
}
