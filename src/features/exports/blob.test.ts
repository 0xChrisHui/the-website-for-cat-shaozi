import { Readable } from "node:stream";
import type { ReadStream } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { privateExportBlob } from "./blob";

const sdk = vi.hoisted(() => ({
  del: vi.fn(), get: vi.fn(), put: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn(),
}));
vi.mock("@vercel/blob", async (original) => ({
  ...await original<typeof import("@vercel/blob")>(), ...sdk,
}));

const key = "exports/private/0312b8de-ace4-4d48-a44e-d344fce97e73.zip";
const host = "store.private.blob.vercel-storage.com";
const token = ["vercel", "blob", "rw", "Store", "synthetic"].join("_");
const url = `https://${host}/${key}`;

beforeEach(() => vi.resetAllMocks());

it("requires a readable uncached private object with matching upload metadata", async () => {
  const storage = privateExportBlob(token, host);
  const bytes = Uint8Array.of(1, 2, 3);
  const signal = new AbortController().signal;
  sdk.put.mockResolvedValue({ pathname: key, url });
  sdk.get.mockResolvedValueOnce({
    statusCode: 200, blob: { pathname: key, size: 3, contentType: "application/zip" },
    stream: new Blob([bytes]).stream(),
  });
  await storage.upload(key, Readable.from([bytes]) as ReadStream, 3, signal);
  expect(sdk.put).toHaveBeenCalledWith(key, expect.any(Readable), expect.objectContaining({
    access: "private", allowOverwrite: false, addRandomSuffix: false, abortSignal: signal,
  }));
  expect(sdk.get).toHaveBeenCalledWith(url, expect.objectContaining({ access: "private", useCache: false }));
  sdk.get.mockResolvedValueOnce({
    statusCode: 200, blob: { pathname: key, size: 3, contentType: "application/zip" },
    stream: new Blob().stream(),
  });
  await expect(storage.upload(key, Readable.from([bytes]) as ReadStream, 3, signal)).rejects.toThrow("Unreadable");
});

it("signs only the exact private key for GET and caps the bypassed URL at 60 seconds", async () => {
  const storage = privateExportBlob(token, host);
  sdk.issueSignedToken.mockResolvedValue("mock");
  sdk.presignUrl.mockResolvedValue({ presignedUrl: url + "?cache=0" });
  const before = Date.now();
  const signed = new URL(await storage.sign(key));
  const issued = sdk.issueSignedToken.mock.calls[0]?.[0];
  expect(issued).toMatchObject({ pathname: key, operations: ["get"] });
  expect(issued?.validUntil).toBeGreaterThanOrEqual(before + 60_000);
  expect(issued?.validUntil).toBeLessThanOrEqual(Date.now() + 60_000);
  expect(sdk.presignUrl).toHaveBeenCalledWith("mock", {
    pathname: key, operation: "get", access: "private", useCache: false, validUntil: issued?.validUntil,
  });
  expect(signed.searchParams.get("cache")).toBe("0");
  expect(signed.searchParams.get("download")).toBe("1");
  sdk.presignUrl.mockResolvedValueOnce({ presignedUrl: url + ".other?cache=0" });
  await expect(storage.sign(key)).rejects.toThrow("Export URL mismatch");
});

it.each(["other.private.blob.vercel-storage.com", "store.public.blob.vercel-storage.com"])(
  "rejects an unbound host before any SDK call (%s)", (wrongHost) => {
    expect(() => privateExportBlob(token, wrongHost)).toThrow("Private export Blob store mismatch");
    for (const call of Object.values(sdk)) expect(call).not.toHaveBeenCalled();
  },
);

it("rejects an unsupported token format and uses the bound URL for cleanup", async () => {
  expect(() => privateExportBlob("mock", host)).toThrow("Private export Blob store mismatch");
  sdk.get.mockResolvedValue(null);
  await privateExportBlob(token, host).removeAndConfirm(key);
  expect(sdk.del).toHaveBeenCalledWith(url, expect.objectContaining({ token }));
  expect(sdk.get).toHaveBeenCalledWith(url, expect.objectContaining({ token, access: "private", useCache: false }));
});
