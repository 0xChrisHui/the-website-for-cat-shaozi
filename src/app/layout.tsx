import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata = { title: "猫咪纪念站" };

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <header className="border-b border-border">
            <nav aria-label="主导航" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 px-5 py-1 sm:px-8">
              <Link href="/" aria-label="首页" className="inline-flex min-h-11 items-center font-heading font-semibold">
                猫咪纪念站
              </Link>
              <Link href="/maintain" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
                维护后台
              </Link>
            </nav>
          </header>
          <main className="site-main mx-auto w-full px-5 sm:px-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
