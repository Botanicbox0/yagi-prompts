/**
 * The gallery's "리뷰에 올리기" (docs/BRAND-STUDIO-V3.md §7, seam in ../seams.ts). Opens a review on a
 * result or an upload and answers with the review screen's address for it, keeping the organization
 * in the URL. A piece that already has a live review gets that review's address instead of a second one.
 */
import type { StudioErrorCode } from "@/lib/brand-studio/contracts";
import { REVIEW_LIMITS, reviewHref, type ReviewErrorCode } from "@/lib/brand-studio/review-contracts";
import type { SendToReviewInput, SendToReviewResult } from "../seams";
import { postReview } from "./api";

/** The seam speaks studio codes; the review-only `rate_limited` has no studio twin. */
function studioCode(code: ReviewErrorCode): StudioErrorCode {
  return code === "rate_limited" ? "failed" : code;
}

export async function sendToReview(input: SendToReviewInput): Promise<SendToReviewResult> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, REVIEW_LIMITS.titleMax);
  if (!title) return { ok: false, code: "invalid" };
  const ref = "assetId" in input.ref ? { assetId: input.ref.assetId } : { outputId: input.ref.outputId };
  const result = await postReview("review.create", { organizationId: input.organizationId, title, ...ref });
  if (!result.ok) return { ok: false, code: studioCode(result.code) };
  return { ok: true, href: reviewHref(input.organizationId, result.review.id) };
}
