import { expect, test } from "../../support/fixture";
import { createPhotoFixture } from "../../../src/features/permanent/photo-fixture";
import { readReviewForm } from "../../../src/features/review/photo-decision";
import { sha256 } from "../../../src/features/permanent/reconcile";

test("permanent worker gates sends and reuses a confirmed archive for reapproved versions", async () => {
  let confirms = false;
  let sends = 0;
  const fixture = createPhotoFixture({
    address: "synthetic",
    async sign(bytes, versionId, authorize) {
      await authorize();
      return { id: "synthetic-archive", raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
    },
    verify: async () => confirms,
    beforeSend: async () => {},
    async send() { sends++; },
  });

  fixture.state.archiveEnabled = false;
  await fixture.run();
  expect(sends).toBe(0);
  expect(fixture.state.reads).toBe(0);
  expect(fixture.state.reasons).toEqual([]);

  fixture.state.archiveEnabled = true;
  await fixture.run();
  confirms = true;
  fixture.state.mintEnabled = false;
  await fixture.run();
  expect(fixture.journal().archive?.state).toBe("confirmed");
  expect(fixture.state.writes).toBe(0);

  fixture.state.mintEnabled = true;
  fixture.photo.policy.currentVersionId = "reapproved-crop";
  await fixture.run();
  expect(fixture.state.writes).toBe(0);
  fixture.photo.policy.approvedVersionId = fixture.photo.policy.currentVersionId;
  await fixture.run();
  await fixture.run();
  expect(fixture.journal().mint?.state).toBe("confirmed");
  expect(fixture.state.writes).toBe(1);
  expect(sends).toBe(1);
  expect(fixture.state.reads).toBe(1);
});

test("explicit reviewer choice reaches the fixed recipient and an unknown send reconciles after withdrawal", async () => {
  let archived: { raw: string; digest: string } | undefined;
  const fixture = createPhotoFixture({
    address: "synthetic",
    async sign(bytes, versionId, authorize) {
      await authorize();
      return { id: "a".repeat(43), raw: bytes.toString("base64"), digest: sha256(bytes), versionId };
    },
    async verify(artifact) {
      return archived?.digest === artifact.digest && sha256(Buffer.from(archived.raw, "base64")) === artifact.digest;
    },
    beforeSend: async () => {},
    async send(artifact) { archived = artifact; },
  });

  const { itemId, currentVersionId } = fixture.photo.policy;
  const form = new FormData();
  form.set("item", itemId + "/" + currentVersionId);
  form.set("public-" + itemId, "on");
  expect(readReviewForm(form)[0]).toMatchObject({ publicView: true, arweave: false, nft: false });
  form.set("test-photo-" + itemId, fixture.policy.recipientVersion);
  const [decision] = readReviewForm(form);
  expect(decision).toMatchObject({ arweave: true, nft: true, recipientConfigVersion: fixture.policy.recipientVersion });
  fixture.photo.approvedRecipientConfigVersion = decision!.recipientConfigVersion ?? null;

  fixture.state.loseSend = true;
  await expect(fixture.run()).rejects.toThrow("Synthetic RPC unavailable");
  const saved = fixture.snapshot();
  const attempted = fixture.journal().mint;
  expect(attempted).toMatchObject({
    state: "attempted",
    intent: { recipient: fixture.policy.recipient, recipientVersion: fixture.policy.recipientVersion },
  });
  fixture.photo.policy.withdrawn = true;
  fixture.state.mintEnabled = false;
  fixture.restore(saved);
  await expect(fixture.run()).rejects.toThrow("Synthetic RPC unavailable");
  expect(fixture.journal().mint).toEqual(attempted);
  fixture.state.unavailable = false;
  await fixture.run();

  expect(fixture.journal().mint).toEqual({ ...attempted, state: "confirmed" });
  expect(fixture.state.writes).toBe(1);
  expect(fixture.state.signs).toBe(1);
});
