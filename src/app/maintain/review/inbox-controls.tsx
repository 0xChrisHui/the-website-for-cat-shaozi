"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function InboxButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : label}</Button>;
}

export function RefreshInbox() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

export function InboxPreview({ src, number }: { src: string; number: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p role="status">预览暂不可用，可以重试准备。</p>;
  return <Image unoptimized width={320} height={240} alt={"照片 " + number + " 私有预览"}
    className="h-auto w-full max-w-xs rounded" src={src} onError={() => setFailed(true)} />;
}
