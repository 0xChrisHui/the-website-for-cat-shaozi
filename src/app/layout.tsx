import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata = { title: "纪念站" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <nav aria-label="主导航" className="mx-auto flex max-w-3xl gap-6 border-b border-border p-5">
            <Link href="/">首页</Link>
            <Link href="/maintain">维护后台</Link>
          </nav>
          <main className="mx-auto max-w-3xl space-y-4 p-5">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
