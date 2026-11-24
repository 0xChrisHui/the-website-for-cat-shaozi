import { z } from "zod";

export const publishedTimelineItemSchema = z.object({
  itemId: z.uuid(), currentVersionId: z.uuid(), localDate: z.iso.date(),
  sortOrder: z.number().int(), kind: z.enum(["photo", "diary"]),
  title: z.string().optional(), caption: z.string().optional(), publicMediaRef: z.string().optional(),
  diaryText: z.string().optional(), focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  layoutRole: z.string().optional(),
}).strict();
export const sitePresentationSchema = z.object({
  heroMediaRef: z.string().optional(), heroCopy: z.string().optional(),
  anniversary: z.object({
    monthDay: z.string().regex(/^\d{2}-\d{2}$/).optional(), headline: z.string().optional(),
    copy: z.string().optional(), heroMediaRef: z.string().optional(),
  }).strict(),
}).strict();
export type PublishedTimelineItem = z.infer<typeof publishedTimelineItemSchema>;
export type SitePresentation = z.infer<typeof sitePresentationSchema>;
