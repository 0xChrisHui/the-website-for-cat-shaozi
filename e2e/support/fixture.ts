import { test as base, expect } from "@playwright/test";

type SameOriginResponse = {
  status: () => number;
  ok: () => boolean;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};
type SameOriginApi = {
  get: (path: string) => Promise<SameOriginResponse>;
  post: (path: string, data?: string) => Promise<SameOriginResponse>;
};

export const test = base.extend<{ api: SameOriginApi; pageErrors: Error[]; boundary: void }>({
  boundary: [async ({ context, baseURL }, provide) => {
    if (!baseURL) throw new Error("BASE_URL missing");
    const secret = new URL(baseURL).protocol === "https:" ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET : undefined;
    let closing = false;
    await context.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin !== baseURL) return route.abort("blockedbyclient");
      try {
        if (secret) {
          // Keep the platform credential outside Playwright's API request traces.
          const request = route.request();
          const headers = new Headers(await request.allHeaders());
          headers.set("x-vercel-protection-bypass", secret);
          headers.delete("content-length");
          const bytes = request.postDataBuffer();
          const response = await fetch(request.url(), {
            method: request.method(), headers, body: bytes ? Uint8Array.from(bytes) : undefined,
            redirect: "manual", signal: AbortSignal.timeout(40_000),
          });
          const location = response.headers.get("location");
          if (location && new URL(location, request.url()).origin !== baseURL) {
            await response.body?.cancel();
            await route.abort("blockedbyclient");
            return;
          }
          const result = Object.fromEntries(response.headers);
          delete result["content-encoding"];
          delete result["content-length"];
          delete result["transfer-encoding"];
          const cookies = response.headers.getSetCookie();
          if (cookies.length) result["set-cookie"] = cookies.join("\n");
          const body = Buffer.from(await response.arrayBuffer());
          if (!closing) await route.fulfill({ status: response.status, headers: result, body });
          return;
        }
        const response = await route.fetch({ maxRedirects: 0, maxRetries: 1, timeout: 40_000 });
        const location = response.headers().location;
        if (location && new URL(location, route.request().url()).origin !== baseURL) {
          await route.abort("blockedbyclient");
          return;
        }
        if (!closing) await route.fulfill({ response });
      } catch (error) {
        if (closing || (error instanceof Error && /disposed|Target .*closed/.test(error.message))) return;
        await route.abort("failed").catch(() => undefined);
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      const url = new URL(socket.url());
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      if (url.origin === baseURL && new URL(baseURL).protocol === "http:") socket.connectToServer();
      else socket.close();
    });
    try { await provide(); } finally {
      closing = true;
      await context.unrouteAll({ behavior: "ignoreErrors" });
    }
  }, { auto: true }],
  pageErrors: [async ({ page }, provide) => {
    const errors: Error[] = [];
    const listener = (error: Error) => { errors.push(error); };
    page.on("pageerror", listener);
    try { await provide(errors); } finally { page.off("pageerror", listener); }
  }, { auto: true }],
  api: async ({ context, baseURL }, provide) => {
    if (!baseURL) throw new Error("BASE_URL missing");
    const secret = new URL(baseURL).protocol === "https:" ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET : undefined;
    const safe = (path: string) => {
      const url = new URL(path, baseURL);
      if (url.origin !== baseURL) throw new Error("Use the exact BASE_URL origin");
      return url.toString();
    };
    const call = async (method: "GET" | "POST", path: string, data?: string): Promise<SameOriginResponse> => {
      const url = safe(path);
      if (!secret) return context.request.fetch(url, { method, data, maxRedirects: 0, headers: { origin: baseURL } });
      const cookies = await context.cookies(url);
      const response = await fetch(url, {
        method, body: data, redirect: "manual", signal: AbortSignal.timeout(20_000),
        headers: {
          origin: baseURL, "x-vercel-protection-bypass": secret,
          cookie: cookies.map(({ name, value }) => name + "=" + value).join("; "),
        },
      });
      return { status: () => response.status, ok: () => response.ok, json: () => response.json(), text: () => response.text() };
    };
    await provide({ get: (path) => call("GET", path), post: (path, data) => call("POST", path, data) });
  },
});

export { expect };
