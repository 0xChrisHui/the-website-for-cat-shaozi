import { describe, expect, it } from "vitest";
import { evaluateContentPolicy, type ContentPolicyInput } from "./content";

const all = { publicView: true, privateExport: true, arweave: true, nft: true };
const none = { publicView: false, privateExport: false, arweave: false, nft: false };
const approved: ContentPolicyInput = {
  itemId: "photo", currentVersionId: "v1", approvedVersionId: "v1",
  published: true, withdrawn: false, exclusion: "none", usageRights: all,
};

describe("content policy", () => {
  it.each<[string, Partial<ContentPolicyInput>, typeof all]>([
    ["approved", {}, all],
    ["draft", { approvedVersionId: null }, none],
    ["old version", { approvedVersionId: "old" }, none],
    ["withdrawn", { withdrawn: true }, none],
    ["explicit exclusion", { exclusion: "explicit" }, { ...none, privateExport: true }],
    ["no private export", { usageRights: { ...all, privateExport: false } }, { ...all, privateExport: false }],
    ["ambiguous", { exclusion: "ambiguous" }, none],
    ["new version", { currentVersionId: "v2" }, none],
    ["same item, new approval, still excluded", { currentVersionId: "v2", approvedVersionId: "v2", exclusion: "explicit" }, { ...none, privateExport: true }],
  ])("%s", (_name, update, expected) => {
    expect(evaluateContentPolicy({ ...approved, ...update })).toEqual(expected);
  });
});
