import { del, get, getDownloadUrl, issueSignedToken, presignUrl, put } from "@vercel/blob";
import type { ExportStorage } from "./generate";

export function privateExportBlob(token: string, storeHost: string): ExportStorage & {
  sign(key: string): Promise<string>;
  removeAndConfirm(key: string, signal?: AbortSignal): Promise<void>;
} {
  // @vercel/blob 2.9.0 resolves explicit read-write auth from the fourth token segment.
  const storeId = /^vercel_blob_rw_([A-Za-z0-9]{1,63})_[A-Za-z0-9_-]+$/.exec(token)?.[1];
  const boundHost = storeId && `${storeId.toLowerCase()}.private.blob.vercel-storage.com`;
  if (!boundHost || boundHost !== storeHost) throw new Error("Private export Blob store mismatch");

  function objectUrl(key: string) {
    if (!/^exports\/private\/[a-f0-9-]{36}\.zip$/.test(key)) throw new Error("Invalid private export key");
    return `https://${boundHost}/${key}`;
  }

  async function read(key: string) {
    const result = await get(objectUrl(key), {
      token, access: "private", useCache: false, abortSignal: AbortSignal.timeout(15_000),
    });
    if (result) {
      if (result.statusCode !== 200 || result.blob.pathname !== key) throw new Error("Indeterminate export object");
      const reader = result.stream.getReader();
      try {
        const first = await reader.read();
        if (first.done || !first.value.byteLength) throw new Error("Unreadable export object");
      } finally {
        await reader.cancel();
      }
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
      if (result.pathname !== key || result.url !== url) throw new Error("Export object mismatch");
      const verified = await read(key);
      if (verified?.blob.size !== size || verified.blob.contentType !== "application/zip") {
        throw new Error("Export upload could not be confirmed");
      }
    },
    async removeAndConfirm(key: string, signal: AbortSignal = AbortSignal.timeout(15_000)) {
      const url = objectUrl(key);
      await del(url, { token, abortSignal: signal });
      const remaining = await get(url, { token, access: "private", useCache: false, abortSignal: signal });
      if (remaining) {
        await remaining.stream?.cancel();
        throw new Error("Export deletion could not be confirmed");
      }
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
      const signed = new URL(presignedUrl);
      const expected = new URL(objectUrl(key));
      if (signed.origin !== expected.origin || signed.pathname !== expected.pathname ||
          signed.searchParams.get("cache") !== "0") throw new Error("Export URL mismatch");
      return getDownloadUrl(signed.href);
    },
  };
}
