import { beforeEach, expect, it, vi } from "vitest";
import { generateSamplePrivateExport, requestPrivateExport, withCurrentPrivateExport } from "./private-export-access";

const mocks = vi.hoisted(() => ({
  readSample: vi.fn(), readPublicSample: vi.fn(), requireMaintainer: vi.fn(),
  withWebsiteDb: vi.fn(), sameOrigin: vi.fn(), headers: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("./samples", () => ({
  readSample: mocks.readSample, readPublicSample: mocks.readPublicSample, sameOrigin: mocks.sameOrigin,
}));
vi.mock("@/lib/supabase/server", () => ({ requireMaintainer: mocks.requireMaintainer }));
vi.mock("@/lib/supabase/database", () => ({ withWebsiteDb: mocks.withWebsiteDb }));

const requestId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.sameOrigin.mockReturnValue(true);
});

it.each([null, { runId: requestId }])("denies anonymous and public-only sample callers (%o)", async (publicSample) => {
  mocks.readPublicSample.mockResolvedValue(publicSample);
  const sign = vi.fn();
  const generate = vi.fn();
  expect(await requestPrivateExport({ requestId })).toBeNull();
  expect(await withCurrentPrivateExport(sign)).toBeNull();
  expect(await generateSamplePrivateExport(generate)).toBe(false);
  expect(mocks.withWebsiteDb).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it("denies cross-origin writes before using a verified sample", async () => {
  mocks.sameOrigin.mockReturnValue(false);
  mocks.readSample.mockResolvedValue({ runId: requestId });
  expect(await requestPrivateExport({ requestId })).toBeNull();
  expect(await generateSamplePrivateExport(vi.fn())).toBe(false);
  expect(mocks.readSample).not.toHaveBeenCalled();
});
