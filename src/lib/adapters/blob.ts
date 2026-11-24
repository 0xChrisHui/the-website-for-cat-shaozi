import { get } from "@vercel/blob";
import type { BlobAdapter } from "./sandbox";

export function createBlobReader(config: { token?: string; storeHost?: string; mock: boolean; signal?: AbortSignal }): BlobAdapter {
  return { async read(key) {
    if (config.mock) return new Blob([key]).stream();
    if (!config.token || !config.storeHost || !/^[a-zA-Z0-9/_-]+$/.test(key)) throw new Error("Blob configuration");
    const result = await get("https://" + config.storeHost + "/" + key, {
      access: "private", token: config.token, useCache: false, abortSignal: config.signal ? AbortSignal.any([config.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!result || result.statusCode !== 200 || result.blob.pathname !== key) throw new Error("Blob unavailable");
    return result.stream;
  } };
}
