import { generateKeyPairSync, type KeyObject } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createArLocal } from "./arlocal";
import { createPhotoFixture } from "./photo-fixture";
import { photoToken } from "./mint";
import { startPhotoLoopback } from "./photo-loopback-fixture";

let key: KeyObject;
let endpoint: string;
let loopback: Awaited<ReturnType<typeof startPhotoLoopback>>;

beforeAll(() => {
  key = generateKeyPairSync("rsa", { modulusLength: 4096 }).privateKey;
}, 15_000);

beforeEach(async () => {
  loopback = await startPhotoLoopback();
  endpoint = loopback.endpoint;
});

afterEach(async () => {
  await loopback.close();
});

function fixture() {
  return createPhotoFixture(createArLocal(endpoint, key, 1000n));
}

describe("3.2 permanent photo job", () => {
  it("persists exact bytes, confirms by read-back and recovers one mint across restart and duplicates", async () => {
    const f = fixture();
    const concurrent = await Promise.allSettled([f.run(), f.run()]);
    expect(concurrent.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(loopback.state.sends).toHaveLength(1);
    expect(f.journal().archive?.raw).toBe(loopback.state.sends[0]);
    const metadata = await sharp(loopback.state.gateway).metadata();
    expect([metadata.width, metadata.height, metadata.orientation, metadata.exif, metadata.icc])
      .toEqual([20, 40, undefined, undefined, undefined]);
    expect(loopback.state.gateway.length).toBeLessThanOrEqual(100_000);
    loopback.state.confirms = 2;
    await f.run();
    expect(f.state.signs).toBe(0);
    loopback.state.confirms = 3;
    loopback.state.bad = true;
    await f.run();
    expect(f.state.reasons.at(-1)).toBe("归档回读哈希不符");
    expect(f.state.signs).toBe(0);

    loopback.state.bad = false;
    f.state.loseSend = true;
    await expect(f.run()).rejects.toThrow("Synthetic RPC unavailable");
    expect(f.journal().mint?.state).toBe("attempted");
    expect(f.journal().mint?.intent.tokenId).toBe(photoToken(f.photo.identity).toString());
    f.restore(f.snapshot());
    f.state.unavailable = false;
    f.state.missing = true;
    f.state.archiveEnabled = false;
    f.state.mintEnabled = false;
    await f.run(f.context(createArLocal(endpoint, key, 1000n)));
    await f.run();
    expect(f.journal().mint?.state).toBe("confirmed");
    expect([f.state.signs, f.state.writes, f.state.reads, loopback.state.sends.length]).toEqual([1, 1, 1, 1]);
  });

  it("does not read private or excluded originals and checks withdrawal again before signing", async () => {
    const f = fixture();
    f.photo.policy.published = false;
    await f.run();
    f.photo.policy.published = true;
    f.photo.policy.exclusion = "explicit";
    await f.run();
    expect(f.state.reads).toBe(0);
    f.photo.policy.exclusion = "none";
    f.state.beforeFile = () => { f.photo.policy.withdrawn = true; };
    await f.run();
    expect(f.state.reads).toBe(1);
    expect(f.journal().archive).toBeNull();
    expect(loopback.state.sends).toHaveLength(0);
  });

  it("blocks stale recipient, wrong chain, outstanding signer results, budget and withdrawal before mint signing", async () => {
    const f = fixture();
    await f.run();
    loopback.state.confirms = 3;
    f.photo.currentRecipientConfigVersion = "changed";
    await f.run();
    expect(f.state.reasons.at(-1)).toMatch(/接收配置/);
    f.photo.currentRecipientConfigVersion = f.policy.recipientVersion;
    f.state.network = 10;
    await f.run();
    expect(f.state.reasons.at(-1)).toMatch(/网络/);
    f.state.network = 11155420;
    f.state.unknown = true;
    await f.run();
    expect(f.state.reasons.at(-1)).toMatch(/待核对/);
    f.state.unknown = false;
    f.state.reserved = 1_900_000n;
    await f.run();
    expect(f.state.reasons.at(-1)).toMatch(/预算/);
    f.state.reserved = 0n;
    f.state.beforeSign = () => { f.photo.policy.withdrawn = true; };
    await f.run();
    expect(f.state.reasons.at(-1)).toMatch(/未获准/);
    expect([f.state.signs, f.state.writes, loopback.state.sends.length]).toEqual([0, 0, 1]);
  });
});
