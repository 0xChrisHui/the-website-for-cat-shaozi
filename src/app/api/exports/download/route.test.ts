import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  exportAccess: vi.fn(), withCurrentPrivateExport: vi.fn(), sign: vi.fn(),
}));
vi.mock("@/features/exports/access", () => ({ exportAccess: mocks.exportAccess }));
vi.mock("@/features/foundation/private-export-access", () => ({ withCurrentPrivateExport: mocks.withCurrentPrivateExport }));
vi.mock("@/features/exports/blob", () => ({ privateExportBlob: () => ({ sign: mocks.sign }) }));
vi.mock("@/lib/env", () => ({
  readSiteEnv: () => ({ BLOB_READ_WRITE_TOKEN: "mock", BLOB_STORE_HOST: "mock.invalid" }),
}));

const jobId = "0312b8de-ace4-4d48-a44e-d344fce97e73";
const objectKey = `exports/private/${jobId}.zip`;
const request = () => new Request(`https://preview.invalid/api/exports/download?job=${jobId}`);
const privatePointer = { jobId, objectKey, mode: "private", mockBytes: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exportAccess.mockResolvedValue({ sample: null });
});

it("does not read pointers or sign for an anonymous caller", async () => {
  mocks.exportAccess.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(404);
  expect(mocks.withCurrentPrivateExport).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("denies a revoked or superseded application URL without signing", async () => {
  mocks.withCurrentPrivateExport.mockResolvedValueOnce(null);
  expect((await GET(request())).status).toBe(404);
  mocks.withCurrentPrivateExport.mockImplementation((read) =>
    read({ ...privatePointer, jobId: "0753eb82-d88c-4317-823e-4de83a511a75" }));
  expect((await GET(request())).status).toBe(404);
  expect(mocks.sign).not.toHaveBeenCalled();
});

it("redirects the current private package without caching", async () => {
  mocks.withCurrentPrivateExport.mockImplementation((read) => read(privatePointer));
  mocks.sign.mockResolvedValue("https://mock.invalid/zip?cache=0");
  const response = await GET(request());
  expect(response.status).toBe(302);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("location")).toBe("https://mock.invalid/zip?cache=0");
  expect(await response.text()).toBe("");
  expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(objectKey);
});

it("returns sample bytes as an attachment without contacting the provider", async () => {
  const mockBytes = Buffer.from("sample");
  mocks.withCurrentPrivateExport.mockImplementation((read) =>
    read({ ...privatePointer, mode: "mock", mockBytes }));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe("sample");
  expect(mocks.sign).not.toHaveBeenCalled();
});
