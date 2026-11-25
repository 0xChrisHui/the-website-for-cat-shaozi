import { redirect } from "next/navigation";
import { SampleIntake, type SampleIntakeParams } from "./sample-intake";
import { readSample } from "@/features/foundation/samples";
import { readMaintainerQueue } from "@/features/intake/maintainer-queue";
import { normalizeIntakeDate } from "@/features/intake/normalize";

export const dynamic = "force-dynamic";

const intakeJobLabels = {
  queued: "排队",
  running: "处理中",
  needs_attention: "需处理",
  done: "待审核",
};

const receivedTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

export default async function IntakePage({ searchParams }: { searchParams: Promise<SampleIntakeParams> }) {
  const sample = await readSample();
  if (sample) {
    const { draft, date } = await searchParams;
    return <SampleIntake draft={draft} date={date} />;
  }

  const queue = await readMaintainerQueue();
  if (queue.state === "signed-out") redirect("/maintain/login");

  return <>
    <h1 className="font-heading text-2xl">投稿待办</h1>
    {queue.state === "unavailable" ? <p>暂无可查看的投稿数据。</p>
      : queue.rows.length === 0 ? <p>暂无待办投稿。</p>
      : <ul className="space-y-3">
        {queue.rows.map((row) => {
          const date = normalizeIntakeDate({ receivedAt: row.received_at.toISOString() });
          return <li key={row.id}>
            <p>收件时间：<time dateTime={row.received_at.toISOString()}>{receivedTime.format(row.received_at)}</time></p>
            <p>北京时间收件日：{date.status === "resolved" && date.localDate}</p>
            <p>原件处理状态：{intakeJobLabels[row.status]}</p>
            <p>已保存原图：{row.photo_count} 张</p>
            {row.original_bytes !== null && <p>已保存原图大小：{row.original_bytes} 字节</p>}
          </li>;
        })}
      </ul>}
  </>;
}
