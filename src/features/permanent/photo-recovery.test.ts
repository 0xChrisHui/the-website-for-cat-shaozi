import { expect, it, vi } from "vitest";
import { createPhotoFixture } from "./photo-fixture";
import { sha256 } from "./reconcile";

it("reconciles the original attempted archive after withdrawal with no new send or mint", async () => {
  let confirmed = false;
  const sign = vi.fn(async (bytes: Buffer, versionId: string, authorize: () => Promise<void>) => {
    await authorize();
    return { id: "a".repeat(43), raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
  });
  const send = vi.fn(async () => { throw new Error("Synthetic ambiguous upload"); });
  const verify = vi.fn(async () => confirmed);
  const fixture = createPhotoFixture({ address: "synthetic", sign, send, verify, beforeSend: async () => {} });

  await fixture.run();
  const persisted = fixture.journal().archive;
  expect(persisted?.state).toBe("attempted");

  fixture.state.missing = true;
  fixture.state.archiveEnabled = false;
  confirmed = true;
  fixture.restore(fixture.snapshot());
  await fixture.run();

  expect(fixture.journal().archive).toEqual({ ...persisted, state: "confirmed" });
  expect(verify).toHaveBeenLastCalledWith(persisted);
  expect(sign).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(fixture.state.signs).toBe(0);
});
