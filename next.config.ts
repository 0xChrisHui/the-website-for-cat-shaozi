import type { NextConfig } from "next";
import { readSiteEnv } from "./src/lib/env";

readSiteEnv();

export default {
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async headers() {
    return ["/maintain/:path*", "/debug/:path*", "/api/debug/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: "private, no-store" }],
    }));
  },
} satisfies NextConfig;
