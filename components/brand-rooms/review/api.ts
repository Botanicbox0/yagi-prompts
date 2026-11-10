/**
 * The deliverables tab's and the share dialog's typed clients (docs/BRAND-ROOMS.md §6). Failures come
 * back as `{ ok: false, code }`; the screens map codes to sentences and never show a server message.
 */
import {
  isReviewErrorCode,
  type CommentAddInput,
  type ReviewCommentAdded,
  type ReviewCreated,
  type ReviewDone,
  type ReviewErrorCode,
  type ReviewFailure,
  type RoomReviewCreateInput,
  type RoomReviewDetail,
  type RoomReviewList,
  type ReviewVersionInput,
} from "@/lib/brand-studio/review-contracts";
import {
  isShareErrorCode,
  type ShareCreated,
  type ShareCreateInput,
  type ShareDone,
  type ShareErrorCode,
  type ShareFailure,
  type ShareKind,
  type ShareList,
} from "@/lib/brand-rooms/share-contracts";

export const ROOM_REVIEW_ENDPOINT = "/api/brand-rooms/reviews";
export const SHARE_ENDPOINT = "/api/brand-rooms/shares";
export const SHARE_PUBLIC_ENDPOINT = "/api/brand-rooms/shares/public";

const STATUS: Record<number, string> = { 400: "invalid", 401: "sign_in_required", 403: "forbidden", 404: "not_found", 409: "conflict", 429: "rate_limited" };

async function call<T, C extends string>(input: string, known: (code: unknown) => code is C, init?: RequestInit): Promise<T | { ok: false; code: C }> {
  try {
    const response = await fetch(input, { credentials: "same-origin", cache: "no-store", ...init });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
    if (response.ok && record?.ok === true) return record as T;
    const code = record?.code;
    if (known(code)) return { ok: false, code };
    const fallback = STATUS[response.status] ?? "failed";
    return { ok: false, code: (known(fallback) ? fallback : "failed") as C };
  } catch {
    return { ok: false, code: "failed" as C };
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/* ------------------------------------------------------------ deliverables */

export function fetchRoomReviews(organizationId: string, projectId: string) {
  return call<RoomReviewList, ReviewErrorCode>(`${ROOM_REVIEW_ENDPOINT}?${new URLSearchParams({ organizationId, projectId })}`, isReviewErrorCode);
}

export function fetchRoomReview(organizationId: string, projectId: string, reviewId: string) {
  return call<RoomReviewDetail, ReviewErrorCode>(`${ROOM_REVIEW_ENDPOINT}?${new URLSearchParams({ organizationId, projectId, review: reviewId })}`, isReviewErrorCode);
}

type InRoom = { organizationId: string; projectId: string };

export interface RoomReviewOps {
  "review.create": [RoomReviewCreateInput, ReviewCreated];
  "review.version": [ReviewVersionInput, ReviewCreated];
  "review.status": [InRoom & { reviewId: string; status: string }, ReviewDone];
  "comment.add": [InRoom & CommentAddInput, ReviewCommentAdded];
  "comment.resolve": [InRoom & { reviewId: string; commentId: string }, ReviewDone];
  "comment.delete": [InRoom & { reviewId: string; commentId: string }, ReviewDone];
}

export function postRoomReview<K extends keyof RoomReviewOps>(operation: K, input: RoomReviewOps[K][0]): Promise<RoomReviewOps[K][1] | ReviewFailure> {
  return call<RoomReviewOps[K][1], ReviewErrorCode>(ROOM_REVIEW_ENDPOINT, isReviewErrorCode, post({ operation, input }));
}

/* ------------------------------------------------------------ share links */

export function fetchShares(organizationId: string, kind: ShareKind, targetId: string): Promise<ShareList | ShareFailure> {
  return call<ShareList, ShareErrorCode>(`${SHARE_ENDPOINT}?${new URLSearchParams({ organizationId, kind, targetId })}`, isShareErrorCode);
}

export function createShareLink(input: ShareCreateInput): Promise<ShareCreated | ShareFailure> {
  return call<ShareCreated, ShareErrorCode>(SHARE_ENDPOINT, isShareErrorCode, post({ operation: "share.create", input }));
}

export function revokeShareLink(organizationId: string, shareId: string): Promise<ShareDone | ShareFailure> {
  return call<ShareDone, ShareErrorCode>(SHARE_ENDPOINT, isShareErrorCode, post({ operation: "share.revoke", input: { organizationId, shareId } }));
}

/** The share page's own door: count a view, unlock, leave a guest note. */
export function sharePublic<T = { ok: true }>(body: Record<string, unknown>): Promise<T | ShareFailure> {
  return call<T, ShareErrorCode>(SHARE_PUBLIC_ENDPOINT, isShareErrorCode, post(body));
}
