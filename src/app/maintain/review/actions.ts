"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { sameOrigin } from "@/features/foundation/samples";
import { approveInbox, approveSubmission, ReviewConflict } from "@/features/review/approve";
import type { InboxBinding } from "@/features/review/inbox-policy";
import { readReviewForm } from "@/features/review/photo-decision";
import { prepareReviewSample } from "@/features/review/sample";
import { changeRealPreparation, retryInboxDisplays } from "@/features/review/real-preparation";
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
      decisions: readReviewForm(form),
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


export async function prepareRealItem(submissionId: string, itemId: string, versionId: string) {
  await updatePreparation(submissionId, itemId, versionId, { kind: "prepare" });
}

export async function saveRealItem(submissionId: string, itemId: string, versionId: string, form: FormData) {
  await updatePreparation(submissionId, itemId, versionId, {
    kind: "save", date: form.get("date"), publicView: form.get("site") === "on",
    privateExport: form.get("zip") === "on", arweave: form.get("archive") === "on", nft: form.get("mint") === "on",
  });
}

async function updatePreparation(submissionId: string, itemId: string, versionId: string,
  change: Parameters<typeof changeRealPreparation>[2],
) {
  await requireReviewAction();
  if (!z.uuid().safeParse(submissionId).success) notFound();
  const path = "/maintain/review/" + submissionId;
  try {
    await changeRealPreparation(submissionId, { itemId, versionId }, change);
  } catch (error) {
    if (!(error instanceof ReviewConflict || error instanceof z.ZodError)) throw error;
    redirect(path + "?status=setup-conflict");
  }
  redirect(path + (change.kind === "prepare" ? "?status=preparing" : "?status=setup-saved"));
}

export async function confirmInbox(submissionId: string, binding: InboxBinding[]) {
  await requireReviewAction();
  try {
    await approveInbox(submissionId, binding);
  } catch (error) {
    if (!(error instanceof ReviewConflict || error instanceof z.ZodError)) throw error;
    redirect("/maintain?status=conflict");
  }
  redirect("/maintain?status=confirmed");
}

export async function retryInbox(submissionId: string, binding: { itemId: string; versionId: string }[], force: boolean) {
  await requireReviewAction();
  try {
    await retryInboxDisplays(submissionId, binding, force);
  } catch (error) {
    if (!(error instanceof ReviewConflict || error instanceof z.ZodError)) throw error;
    redirect("/maintain?status=conflict");
  }
  redirect("/maintain?status=preparing");
}

export async function withdrawInbox(submissionId: string) {
  await requireReviewAction();
  try {
    await withdrawSubmission(submissionId);
  } catch (error) {
    if (!(error instanceof ReviewConflict)) throw error;
    redirect("/maintain?status=conflict");
  }
  redirect("/maintain?status=withdrawn");
}
