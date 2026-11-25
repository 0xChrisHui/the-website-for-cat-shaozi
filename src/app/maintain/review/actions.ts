"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { sameOrigin } from "@/features/foundation/samples";
import { approveSubmission, ReviewConflict } from "@/features/review/approve";
import { prepareReviewSample } from "@/features/review/sample";
import { reviewScope } from "@/features/review/store";
import { withdrawSubmission } from "@/features/review/withdraw";

async function requireReviewAction() {
  if (!sameOrigin(await headers()) || !(await reviewScope())) notFound();
}

export async function prepareSample() {
  await requireReviewAction();
  await prepareReviewSample();
  redirect("/maintain/review");
}

export async function confirmReview(submissionId: string, requestId: string, form: FormData) {
  await requireReviewAction();
  if (!z.uuid().safeParse(submissionId).success) notFound();
  const path = "/maintain/review/" + submissionId;
  try {
    await approveSubmission({
      submissionId, requestId,
      decisions: form.getAll("item").map((value) => {
        if (typeof value !== "string") throw new ReviewConflict();
        if (!/^[-a-f0-9]+\/[-a-f0-9]+$/i.test(value)) throw new ReviewConflict();
        const [itemId, versionId] = value.split("/");
        if (!itemId || !versionId) throw new ReviewConflict();
        return { itemId, versionId, publicView: form.get("public-" + itemId) === "on", arweave: false, nft: false };
      }),
    });
  } catch (error) {
    if (!(error instanceof ReviewConflict || error instanceof z.ZodError)) throw error;
    redirect(path + "?status=conflict");
  }
  redirect(path + "?status=confirmed");
}

export async function withdrawReview(submissionId: string) {
  await requireReviewAction();
  try {
    await withdrawSubmission(submissionId);
  } catch (error) {
    if (!(error instanceof ReviewConflict)) throw error;
    notFound();
  }
  redirect("/maintain/review/" + submissionId);
}

