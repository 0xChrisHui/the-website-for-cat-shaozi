export interface ContentPolicyInput {
  itemId: string;
  currentVersionId: string;
  approvedVersionId?: string | null;
  published: boolean;
  withdrawn: boolean;
  exclusion: "none" | "explicit" | "ambiguous";
  usageRights: ContentPermissions;
}

export interface ContentPermissions {
  publicView: boolean;
  privateExport: boolean;
  arweave: boolean;
  nft: boolean;
}

export function evaluateContentPolicy(input: ContentPolicyInput): ContentPermissions {
  const approved = input.currentVersionId === input.approvedVersionId && !input.withdrawn && input.exclusion !== "ambiguous";
  const published = approved && input.published && input.exclusion === "none";
  return {
    publicView: published && input.usageRights.publicView,
    privateExport: approved && input.usageRights.privateExport,
    arweave: published && input.usageRights.arweave,
    nft: published && input.usageRights.nft && input.usageRights.arweave,
  };
}
