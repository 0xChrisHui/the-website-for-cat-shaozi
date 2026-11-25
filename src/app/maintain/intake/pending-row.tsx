import Link from "next/link";
import type { ReactNode } from "react";

const receivedTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

export function PendingRow({ receivedAt, status, photoCount, href, children }: {
  receivedAt: Date;
  status: string;
  photoCount: number;
  href: string;
  children?: ReactNode;
}) {
  return <li className="space-y-2 rounded border border-border px-4 py-3">
    <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
      <p>收件时间：<time dateTime={receivedAt.toISOString()}>{receivedTime.format(receivedAt)}</time></p>
      <p className="rounded bg-muted px-2 py-1 text-muted-foreground">{status}</p>
      <p>已保存原图：{photoCount} 张</p>
      <Link className="underline sm:ml-auto" href={href}>打开草稿</Link>
    </div>
    {children && <div className="text-sm text-muted-foreground">{children}</div>}
  </li>;
}
