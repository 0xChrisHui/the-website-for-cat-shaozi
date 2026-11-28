"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function LoginSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "正在登录…" : "登录"}
    </Button>
  );
}
