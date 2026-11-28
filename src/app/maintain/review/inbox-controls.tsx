"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function InboxButton({ label, pendingLabel, variant }: { label: string; pendingLabel: string; variant?: "secondary" }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>{pending ? pendingLabel : label}</Button>;
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

export function InboxPreview({ src, number, alt }: { src: string; number: number; alt?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-muted">
      {failed ? (
        <div className="space-y-1 p-4 text-muted-foreground">
          <p role="status">预览暂不可用。</p>
          <button type="button" className="min-h-11 cursor-pointer rounded underline"
            onClick={() => { setAttempt((value) => value + 1); setFailed(false); }}>
            重新加载预览
          </button>
        </div>
      ) : (
        <Image key={attempt} unoptimized width={640} height={480} alt={alt ?? `照片 ${number} 私有预览`}
          className="aspect-4/3 w-full object-contain" src={src} onError={() => setFailed(true)} />
      )}
    </div>
  );
}
