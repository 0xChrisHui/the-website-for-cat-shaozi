import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import type { ExportStorage } from "./generate";

export function privateExportBlob(token: string, storeHost: string): ExportStorage & {
  sign(key: string): Promise<string>;
} {
  function objectUrl(key: string) {
    if (!/^exports\/private\/[a-f0-9-]{36}\.zip$/.test(key)) throw new Error("Invalid private export key");
    return `https://${storeHost}/${key}`;
  }

  async function read(key: string) {
    const result = await get(objectUrl(key), {
      token, access: "private", useCache: false, abortSignal: AbortSignal.timeout(15_000),
    });
    if (result) {
      if (result.statusCode !== 200 || result.blob.pathname !== key) throw new Error("Indeterminate export object");
      await result.stream.cancel();
    }
    return result;
  }

  return {
    async upload(key, body, size, signal) {
      const url = objectUrl(key);
      const result = await put(key, body, {
        token, access: "private", contentType: "application/zip", addRandomSuffix: false,
        allowOverwrite: false, multipart: true, cacheControlMaxAge: 60, abortSignal: signal,
      });
      if (result.pathname !== key || result.url !== url || (await read(key))?.blob.size !== size) {
        throw new Error("Export upload could not be confirmed");
      }
    },
    async removeAndConfirm(key) {
      await del(objectUrl(key), { token, abortSignal: AbortSignal.timeout(15_000) });
      if (await read(key)) throw new Error("Export deletion could not be confirmed");
    },
    async sign(key) {
      objectUrl(key);
      const validUntil = Date.now() + 60_000;
      const delegation = await issueSignedToken({
        token, pathname: key, operations: ["get"], validUntil,
        abortSignal: AbortSignal.timeout(10_000),
      });
      const { presignedUrl } = await presignUrl(delegation, {
        operation: "get", access: "private", pathname: key, validUntil, useCache: false,
      });
      if (new URL(presignedUrl).origin !== new URL(objectUrl(key)).origin) throw new Error("Export store mismatch");
      return presignedUrl;
    },
  };
}
