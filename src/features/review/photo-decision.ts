import { z } from "zod";

const itemVersion = z.tuple([z.uuid(), z.uuid()]);

export function readReviewForm(form: FormData) {
  return form.getAll("item").map((value) => {
    const [itemId, versionId] = itemVersion.parse(typeof value === "string" ? value.split("/") : null);
    const publicView = form.get("public-" + itemId) === "on";
    const choice = z.tuple([]).or(z.tuple([z.union([z.literal(""), z.literal("archive"), z.uuid()])]))
      .parse(form.getAll("test-photo-" + itemId))[0];
    const nft = Boolean(choice && choice !== "archive");
    return { itemId, versionId, publicView, arweave: Boolean(choice), nft,
      ...(nft ? { recipientConfigVersion: choice } : {}) };
  });
}

export function testPhotoReview(environment: string | undefined, sample: unknown) {
  return !sample && (environment === "preview" || environment === "development");
}
