"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <><h1>暂时无法打开页面</h1><Button onClick={reset}>重试</Button></>;
}
