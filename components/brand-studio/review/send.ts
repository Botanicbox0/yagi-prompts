/** Stub until slice D lands (docs/BRAND-STUDIO-V3.md §7): the gallery's "리뷰에 올리기". */
import type { SendToReviewInput, SendToReviewResult } from "../seams";

export async function sendToReview(_input: SendToReviewInput): Promise<SendToReviewResult> {
  return { ok: false, code: "feature_unavailable" };
}
