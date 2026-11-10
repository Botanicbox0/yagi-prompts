"use client";
/**
 * The team's review stage (`/admin/brand-studio/reviews/[id]`): the same stage the brand sees, wired to
 * the registered admin operations through `/admin/do` (docs/BRAND-STUDIO-V3.md §7). After a write the
 * server page re-renders with the new notes (`router.refresh()`).
 */
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { ReviewComment, ReviewItem } from "@/lib/brand-studio/review-contracts";
import { ReviewStage, type ReviewActionResult, type ReviewActions, type ReviewCopy } from "./stage";

const ADMIN_CODES: Record<string, string> = {
  forbidden: "forbidden",
  notFound: "not_found",
  invalid: "invalid",
  brandConflict: "conflict",
};

export function adminReviewPath(reviewId: string, atMs?: number | null): string {
  return `/admin/brand-studio/reviews/${reviewId}${atMs != null && atMs > 0 ? `?t=${Math.round(atMs)}` : ""}`;
}

export function AdminReviewStage({
  review,
  comments,
  copy,
  locale,
  eyebrow,
  initialMs,
}: {
  review: ReviewItem;
  comments: ReviewComment[];
  copy: ReviewCopy;
  locale: "ko" | "en";
  eyebrow: string;
  initialMs: number | null;
}) {
  const router = useRouter();
  const actions = useMemo<ReviewActions>(() => {
    const post = async (op: string, fields: Record<string, string | number | null | undefined>): Promise<ReviewActionResult> => {
      const form = new FormData();
      form.set("_op", op);
      form.set("_back", adminReviewPath(review.id));
      for (const [key, value] of Object.entries(fields)) if (value != null && value !== "") form.set(key, String(value));
      try {
        const response = await fetch("/admin/do", { method: "POST", body: form, credentials: "same-origin", headers: { accept: "application/json" } });
        const body = (await response.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
        if (body?.ok) {
          router.refresh();
          return { ok: true };
        }
        return { ok: false, code: ADMIN_CODES[body?.code ?? ""] ?? "failed" };
      } catch {
        return { ok: false, code: "failed" };
      }
    };
    return {
      addComment: (input) =>
        post("brand_studio.review.reply", { reviewId: review.id, body: input.body, parentId: input.parentId, atMs: input.atMs, x: input.x, y: input.y }),
      resolveComment: (commentId) => post("brand_studio.review.resolve", { reviewId: review.id, commentId }),
      setStatus: (status) => post("brand_studio.review.status", { reviewId: review.id, status }),
    };
  }, [review.id, router]);

  return (
    <ReviewStage
      review={review}
      comments={comments}
      canWrite
      copy={copy}
      locale={locale}
      initialMs={initialMs}
      actions={actions}
      linkFor={(ms) => adminReviewPath(review.id, ms)}
      eyebrow={eyebrow}
    />
  );
}
