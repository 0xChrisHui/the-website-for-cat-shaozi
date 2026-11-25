import { expect, test } from "../../support/fixture";
import { createPhotoFixture } from "../../../src/features/permanent/photo-fixture";
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
