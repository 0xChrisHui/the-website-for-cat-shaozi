import { expect, it } from "vitest";
import { mailRestrictions } from "./mail-restrictions";

it("counts only photos in attachment order and restricts chain uses independently", () => {
  const read = mailRestrictions([2, 7], [{ quote: "第 2 张不要上链" }]);
  expect(read(2)).toEqual({ site: false, zip: false, chain: false, nft: false, uncertain: false });
  expect(read(7)).toEqual({ site: false, zip: false, chain: true, nft: false, uncertain: false });
});

it("combines whole-mail and exact attachment restrictions", () => {
  const read = mailRestrictions([0, 3], [
    { quote: "Please do not include these in the ZIP." },
    { position: 3, quote: "这张不要公开" },
  ]);
  expect(read(0)).toMatchObject({ site: false, zip: true, uncertain: false });
  expect(read(3)).toMatchObject({ site: true, zip: true, uncertain: false });
});

it.each(["那张不要上链", "第 3 张不要上链", "one photo should not be published", "Do not publish it."])(
  "blocks unresolved targets without guessing a picture (%s)", (quote) => {
    const read = mailRestrictions([1, 5], [{ quote }]);
    expect(read(1).uncertain).toBe(true);
    expect(read(5).uncertain).toBe(true);
  },
);

it("keeps unsupported legacy quotes scoped to the bound attachment", () => {
  const read = mailRestrictions([1, 5], [{ position: 5, quote: "这张请先别用" }]);
  expect(read(1).uncertain).toBe(false);
  expect(read(5).uncertain).toBe(true);
});

it("handles a Chinese ordinal and a separate English minting restriction", () => {
  const read = mailRestrictions([2, 7], [
    { quote: "第二张不要上链" }, { position: 2, quote: "No NFTs" },
  ]);
  expect(read(2)).toMatchObject({ chain: false, nft: true, uncertain: false });
  expect(read(7)).toMatchObject({ chain: true, nft: false, uncertain: false });
});

it("holds all photos for a combined numbered restriction it cannot interpret", () => {
  const read = mailRestrictions([0, 3, 7], [{ quote: "第2张和第3张不要上链" }]);
  expect([0, 3, 7].every((position) => read(position).uncertain)).toBe(true);
});

it("recognizes the sender's single-photo no-chain wording without suppressing display", () => {
  const quote = "这个照片不要上链";
  expect(mailRestrictions([0], [{ quote }])(0))
    .toEqual({ site: false, zip: false, chain: true, nft: false, uncertain: false });
  const bound = mailRestrictions([0, 1], [{ position: 1, quote }]);
  expect(bound(0).chain).toBe(false);
  expect(bound(1).chain).toBe(true);
  expect(mailRestrictions([0, 1], [{ quote }])(0).uncertain).toBe(true);
});

it.each(["第二张图片不要上链", "对了，第二张图片不要上链", "对了，第二张照片不要上链"])(
  "applies the sender's explicit restriction to the second photo only (%s)", (quote) => {
    const read = mailRestrictions([0, 1], [{ quote }]);
    expect([read(0), read(1), read(2)].map(({ chain, uncertain }) => [chain, uncertain]))
      .toEqual([[false, false], [true, false], [false, false]]);
  },
);
