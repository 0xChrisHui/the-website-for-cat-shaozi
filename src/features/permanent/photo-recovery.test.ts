import { expect, it, vi } from "vitest";
import { createPhotoFixture } from "./photo-fixture";
import { check, sha256 } from "./reconcile";

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

it("keeps the signed archive retryable when preflight cannot send", async () => {
  let closed = true;
  let uploaded = false;
  const sign = vi.fn(async (bytes: Buffer, versionId: string, authorize: () => Promise<void>) => {
    await authorize();
    return { id: "a".repeat(43), raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
  });
  const send = vi.fn(async () => { uploaded = true; });
  const fixture = createPhotoFixture({
    address: "synthetic", sign, send, verify: async () => uploaded,
    async beforeSend() { check(!closed, "Synthetic preflight blocked"); },
  });
  fixture.state.mintEnabled = false;
  await fixture.run();
  const persisted = fixture.journal().archive;
  expect(persisted?.state).toBe("signed");
  expect(fixture.state.reasons).toEqual([]);
  expect(send).not.toHaveBeenCalled();

  fixture.restore(fixture.snapshot());
  closed = false;
  await fixture.run();
  expect(sign).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledExactlyOnceWith(persisted);
  expect(fixture.journal().archive).toEqual({ ...persisted, state: "confirmed" });
});

it("rejects a newly approved photo version during processing of the older bound job", async () => {
  const sign = vi.fn(async (bytes: Buffer, versionId: string, authorize: () => Promise<void>) => {
    await authorize();
    return { id: "a".repeat(43), raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
  });
  const send = vi.fn(async () => {});
  const fixture = createPhotoFixture({
    address: "synthetic", sign, send, verify: async () => false, beforeSend: async () => {},
  });
  fixture.state.beforeCurrent = () => {
    fixture.photo.policy.approvedVersionId = "new-version";
    fixture.photo.policy.currentVersionId = "new-version";
  };
  await fixture.run();
  expect(fixture.journal().archive).toBeNull();
  expect(sign).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  expect(fixture.state.reasons).toEqual(["照片版本已变化"]);
});

it("replays an unseen mint once using the original bytes and never signs again", async () => {
  let archived = false;
  const fixture = createPhotoFixture({
    address: "synthetic",
    async sign(bytes, versionId, authorize) {
      await authorize();
      return { id: "a".repeat(43), raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
    },
    verify: async () => archived,
    beforeSend: async () => {},
    async send() { archived = true; },
  });
  const context = fixture.context();
  const worker = context.permanentPhoto!;
  const withPhoto = worker.withPhoto;
  let replayed = false;
  worker.withPhoto = (id, item, run) => withPhoto(id, item, (lock) => run({
    ...lock,
    mint: { ...lock.mint, async replay() {
      if (replayed) return false;
      replayed = true;
      return true;
    } },
  }));

  fixture.state.dropSend = true;
  await fixture.run(context);
  const attempted = fixture.journal().mint;
  expect(attempted?.state).toBe("attempted");
  fixture.restore(fixture.snapshot());
  await fixture.run(context);
  expect(fixture.state.writes).toBe(2);
  await fixture.run(context);
  expect([fixture.state.signs, fixture.state.writes]).toEqual([1, 2]);
  expect(fixture.journal().mint).toEqual(attempted);
});
