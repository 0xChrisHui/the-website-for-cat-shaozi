"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { JobSummary } from "@/lib/contracts/jobs";

export function ExportControls({ current, status, invalidated }: {
  current?: string;
  status?: JobSummary["status"];
  invalidated: boolean;
}) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [failed, setFailed] = useState(false);
  const active = status === "queued" || status === "running";
  const working = submitting || refreshing || active;

  useEffect(() => {
    if (!active || refreshing) return;
    const timer = window.setTimeout(() => startRefresh(() => router.refresh()), 1500);
    return () => window.clearTimeout(timer);
  }, [active, refreshing, router]);

  async function generate() {
    if (working) return;
    requestId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setFailed(false);
    try {
      const response = await fetch("/api/exports/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current }),
      });
      if (!response.ok) throw new Error("Export request failed");
      requestId.current = null;
      startRefresh(() => router.refresh());
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="space-y-3">
    <Button type="button" onClick={generate} disabled={working}>生成离线快照</Button>
    <p role="status">
      {working ? "正在生成…" : failed ? "生成请求未确认，请重试。" :
        current ? "离线快照已生成。" : invalidated || status === "done" ? "需重新生成。" :
          status === "needs_attention" ? "生成失败，请重试。" : "暂无离线快照。"}
    </p>
    {!working && !failed && current && <p><a className="font-semibold underline" href={`/api/exports/download?job=${current}`}>下载离线快照</a></p>}
  </div>;
}
