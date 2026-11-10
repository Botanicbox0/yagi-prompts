/**
 * The review screen's typed client for `/api/brand-studio/review` (lib/brand-studio/review-contracts.ts).
 * Failures always come back as `{ ok: false, code }`; the screen maps codes to sentences and never shows
 * a server message.
 */
import {
  isReviewErrorCode,
  type CommentAddInput,
  type ReviewCommentAdded,
  type ReviewCreateInput,
  type ReviewCreated,
  type ReviewDetail,
  type ReviewDone,
  type ReviewErrorCode,
  type ReviewFailure,
  type ReviewList,
  type ReviewStatusInput,
} from "@/lib/brand-studio/review-contracts";

export const REVIEW_ENDPOINT = "/api/brand-studio/review";

export type ReviewResult<T> = T | ReviewFailure;

const STATUS_CODES: Record<number, ReviewErrorCode> = {
  400: "invalid",
  401: "sign_in_required",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
};

async function read<T>(response: Response): Promise<ReviewResult<T>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (response.ok && record?.ok === true) return record as T;
  const code = record?.code;
  if (isReviewErrorCode(code)) return { ok: false, code };
  return { ok: false, code: STATUS_CODES[response.status] ?? "failed" };
}

async function call<T>(input: string, init?: RequestInit): Promise<ReviewResult<T>> {
  try {
    return await read<T>(await fetch(input, { credentials: "same-origin", cache: "no-store", ...init }));
  } catch {
    return { ok: false, code: "failed" };
  }
}

export function fetchReviewList(organizationId: string): Promise<ReviewResult<ReviewList>> {
  return call<ReviewList>(`${REVIEW_ENDPOINT}?${new URLSearchParams({ organizationId })}`);
}

export function fetchReviewDetail(organizationId: string, reviewId: string): Promise<ReviewResult<ReviewDetail>> {
  return call<ReviewDetail>(`${REVIEW_ENDPOINT}?${new URLSearchParams({ organizationId, review: reviewId })}`);
}

export interface ReviewOps {
  "review.create": [ReviewCreateInput, ReviewCreated];
  "review.status": [ReviewStatusInput, ReviewDone];
  "review.delete": [{ organizationId: string; reviewId: string }, ReviewDone];
  "comment.add": [CommentAddInput, ReviewCommentAdded];
  "comment.resolve": [{ organizationId: string; reviewId: string; commentId: string }, ReviewDone];
  "comment.delete": [{ organizationId: string; reviewId: string; commentId: string }, ReviewDone];
}

export function postReview<K extends keyof ReviewOps>(operation: K, input: ReviewOps[K][0]): Promise<ReviewResult<ReviewOps[K][1]>> {
  return call<ReviewOps[K][1]>(REVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });
}
