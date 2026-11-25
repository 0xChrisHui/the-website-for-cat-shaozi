import { z } from "zod";

export const restrictionFlags = z.strictObject({
  site: z.boolean(), zip: z.boolean(), chain: z.boolean(), nft: z.boolean().optional(), uncertain: z.boolean(),
});
export type RestrictionFlags = z.infer<typeof restrictionFlags>;
type Quote = { quote: string; position?: number };
type Destination = "site" | "zip" | "chain" | "nft";

const clear: RestrictionFlags = { site: false, zip: false, chain: false, nft: false, uncertain: false };
const destinations: [Destination, RegExp[]][] = [
  ["site", [
    /^(?:公开(?:发布)?|发布(?:到(?:网站|站内))?|放(?:到|在)?(?:网站|站内)上?|上传到网站)$/,
    /^publish(?: (?:it|them|this|these|the photos?|the submission))?(?: (?:on|to) (?:the )?(?:website|site))?$/,
    /^(?:post|show|display)(?: (?:it|them|this|these|the photos?))? (?:on|to) (?:the )?(?:website|site)$/,
    /^(?:make (?:it|them|this|these|the photos?) public|public(?: display| posting)?|(?:website|site)(?: (?:use|publication))?)$/,
  ]],
  ["zip", [
    /^(?:导出(?:到)?(?:私有)?\s*zip|(?:放|加入|打包)(?:到|进)?(?:私有)?\s*zip|(?:私有)?\s*zip\s*(?:导出|打包)|导出)$/,
    /^(?:include|put|add)(?: (?:it|them|this|these|the photos?|the submission))? (?:in|to) (?:the )?(?:private )?zip(?: export)?$/,
    /^export(?: (?:it|them|this|these|the photos?))?(?: (?:to|in) (?:the )?(?:private )?zip)?$/,
    /^zip$/,
  ]],
  ["chain", [
    /^(?:上链|(?:永久)?(?:归档|存档)|(?:写入|上传到)\s*arweave)$/,
    /^(?:put|send|upload)(?: (?:it|them|this|these|the photos?))? (?:on[- ]chain|(?:on|to) (?:the )?(?:blockchain|arweave))$/,
    /^archive(?: (?:it|them|this|these|the photos?))?$/,
    /^(?:on[- ]chain|chain(?: use)?|blockchain(?: use)?|arweave)$/,
  ]],
  ["nft", [
    /^(?:铸造(?:\s*nft)?|做成\s*nft|nfts?)$/,
    /^mint(?: (?:it|them|this|these|an? nft|nfts?|the photos?))?$/,
  ]],
];

export function mailRestrictions(photoPositions: number[], quotes: Quote[]) {
  const photos = [...photoPositions].sort((a, b) => a - b);
  const scoped: { position?: number; photosOnly?: boolean; flag: keyof RestrictionFlags }[] = [];
  for (const { quote, position } of quotes) {
    let clause = quote.normalize("NFKC").trim().toLowerCase()
      .replace(/[。.!！]+$/, "").replace(/^(?:请|please)\s*/, "");
    const target = /^(?:第\s*(\d+|[一二三四五六七八九十])\s*张(?:照片|图)?|(?:the )?(?:photo|picture|image)\s*#?(\d+)|(?:the )?(first|second|third) (?:photo|picture|image))\s*/.exec(clause);
    const ordinalText = target?.[1] ?? target?.[2];
    const chineseOrdinal = ordinalText ? "一二三四五六七八九十".indexOf(ordinalText) + 1 : 0;
    const ordinal = Number(ordinalText) || chineseOrdinal || ["first", "second", "third"].indexOf(target?.[3] ?? "") + 1;
    const named = ordinal ? photos[ordinal - 1] : undefined;
    if (target && (named === undefined || (position !== undefined && position !== named))) {
      scoped.push({ photosOnly: true, flag: "uncertain" });
      continue;
    }
    if (target) clause = clause.slice(target[0].length).replace(/^[:：,，—-]\s*/, "");
    const group = /^(?:所有(?:的)?照片|这些照片|全部照片|所有图片|这封邮件(?:的内容)?|整封(?:邮件|投稿)|(?:all|these) (?:photos|pictures|images)|(?:this|the) (?:email|submission))\s*/.exec(clause);
    const photosOnly = Boolean(group && /照片|图片|photos|pictures|images/.test(group[0]));
    if (group && position !== undefined) {
      scoped.push({ photosOnly, flag: "uncertain" });
      continue;
    }
    if (group) clause = clause.slice(group[0].length);
    const singularPhoto = /^(?:这张(?:照片|图)?|这个(?:照片|图片|图)|该(?:照片|图片)|this (?:photo|picture|image))\s*/.exec(clause);
    let bound = named ?? position;
    if (singularPhoto && bound === undefined && photos.length === 1) bound = photos[0];
    if (singularPhoto && bound !== undefined) clause = clause.slice(singularPhoto[0].length);
    const instruction = /^(?:请\s*)?(?:不要|不得|不能|禁止|不许|别|不|do not\b|don't\b|must not\b|should not\b|never\b|no\b|not\b)\s*/.exec(clause);
    const use = instruction ? clause.slice(instruction[0].length) : "";
    const unresolvedReference = position === undefined && !target && !group &&
      /\b(?:it|this(?! email| submission)|(?:the|one) (?:photo|picture|image)\b)\b/.test(use);
    const flag = !unresolvedReference && destinations.find(([, patterns]) =>
      patterns.some((pattern) => pattern.test(use)))?.[0];
    if (target && !flag && (position === undefined || /第\s*[\d一二三四五六七八九十]+\s*张|(?:photos?|pictures?|images?)\s*#?\d+/.test(clause))) {
      scoped.push({ photosOnly: true, flag: "uncertain" });
      continue;
    }
    scoped.push({ position: bound, photosOnly, flag: flag || "uncertain" });
  }
  return (position: number): RestrictionFlags => {
    const result = { ...clear };
    for (const entry of scoped) {
      if ((entry.position === undefined || entry.position === position) && (!entry.photosOnly || photos.includes(position))) {
        result[entry.flag] = true;
      }
    }
    return result;
  };
}
