import { expect, it, vi } from "vitest";
import { handleJob } from "./jobs";
import { privateExportKind } from "@/features/foundation/private-export";
import type { WorkerContext } from "@/lib/contracts/jobs";

const upload = vi.hoisted(() => vi.fn());
vi.mock("./blob", () => ({ privateExportBlob: () => ({ upload }) }));
vi.mock("@/lib/env", () => ({
  readWorkerEnv: () => ({ WORKER_FILE_ROOT: "/tmp", BLOB_READ_WRITE_TOKEN: "mock", BLOB_STORE_HOST: "mock.invalid" }),
}));

it("rechecks the reservation immediately before upload and publishes after confirmation", async () => {
  const jobId = "2f74ca46-c272-42b0-93c4-e1b9cb8cd689";
  const objectKey = `exports/private/${jobId}.zip`;
  const events: string[] = [];
  const recheck = vi.fn<NonNullable<WorkerContext["privateExport"]>["recheck"]>(async () => { events.push("recheck"); return []; });
  const publish = vi.fn(async () => { events.push("publish"); return true; });
  upload.mockImplementation(async (key, body, size) => {
    expect(key).toBe(objectKey);
    let bytes = 0;
    for await (const chunk of body) bytes += chunk.length;
    expect(bytes).toBe(size);
    events.push("confirmed");
  });
  const context: WorkerContext = {
    files: { read: vi.fn() }, jobs: { finish: vi.fn() }, clock: () => new Date(),
    privateExport: {
      claim: { jobId, objectKey, versions: [] }, signal: new AbortController().signal, recheck, publish,
    },
  };
  const job = { jobId, kind: privateExportKind, schemaVersion: 1, payload: {} };
  await handleJob(job, context);
  expect(events).toEqual(["recheck", "recheck", "confirmed", "publish"]);
  events.length = 0;
  recheck.mockResolvedValueOnce([]).mockResolvedValueOnce(null);
  await handleJob(job, context);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
});
