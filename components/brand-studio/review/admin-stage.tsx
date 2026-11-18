"use client";
/**
 * The team's review stage (`/admin/brand-studio/reviews/[id]` and a project's desk
 * `/admin/brand-rooms/<org>/<project>?review=<id>`): the same stage the brand sees, wired to the registered
 * admin operations through `/admin/do` (docs/BRAND-STUDIO-V3.md §7). After a write the server page
 * re-renders with the new notes (`router.refresh()`). Notes and versions from others arrive through the
 * team's pulse (`/admin/brand-rooms/<org>/pulse`, every 5 seconds while the tab is on screen): the page
 * re-reads only when the stack's stamp moved, and waits while the composer holds unsent work. Where that
 * door answers "not here" (rooms off), the 15-second quiet re-read of ./auto-refresh.ts takes over.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewComment, ReviewItem, ReviewVersion } from "@/lib/brand-studio/review-contracts";
import { roomDeskPath } from "@/lib/brand-rooms/message-contracts";
import type { RoomPulseStamp } from "@/lib/brand-rooms/pulse";
import { readPulse, staffPulseUrl, usePulse } from "@/components/brand-rooms/pulse";
import { useQuietRefresh } from "./auto-refresh";
import { ReviewStage, type ReviewActionResult, type ReviewActions, type ReviewCopy, type ReviewTeamCopy } from "./stage";

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
  extended = false,
  versions,
  teamCopy,
  desk = null,
}: {
  review: ReviewItem;
  comments: ReviewComment[];
  copy: ReviewCopy;
  locale: "ko" | "en";
  eyebrow: string;
  initialMs: number | null;
  /** Rooms on and 0084 applied: ranges, drawings and the version tools (docs/BRAND-ROOMS.md §6). */
  extended?: boolean;
  versions?: ReviewVersion[];
  /** Team notes (docs/BRAND-ROOMS-FEEDBACK.md §5): this page alone offers "팀만 보기" and shows the tag. */
  teamCopy: ReviewTeamCopy;
  /** On a project's desk: versions, moments and the form's way back stay on the desk (`?review=&t=`). */
  desk?: { organizationId: string; projectId: string } | null;
}) {
  const router = useRouter();
  const deskOrg = desk?.organizationId ?? null;
  const deskProject = desk?.projectId ?? null;
  const pathFor = useCallback(
    (reviewId: string, atMs?: number | null) => (deskOrg && deskProject ? roomDeskPath(deskOrg, deskProject, { review: reviewId, t: atMs ?? null }) : adminReviewPath(reviewId, atMs)),
    [deskOrg, deskProject],
  );
  const actions = useMemo<ReviewActions>(() => {
    const post = async (op: string, fields: Record<string, string | number | null | undefined>): Promise<ReviewActionResult> => {
      const form = new FormData();
      form.set("_op", op);
      form.set("_back", pathFor(review.id));
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
        post("brand_studio.review.reply", {
          reviewId: review.id,
          body: input.body,
          parentId: input.parentId,
          atMs: input.atMs,
          endMs: input.endMs,
          x: input.x,
          y: input.y,
          strokes: input.strokes?.length ? JSON.stringify(input.strokes) : null,
          // A reply sends nothing here: the server gives it its thread's visibility.
          visibility: input.team ? "team" : null,
        }),
      resolveComment: (commentId) => post("brand_studio.review.resolve", { reviewId: review.id, commentId }),
      setStatus: (status) => post("brand_studio.review.status", { reviewId: review.id, status }),
    };
  }, [review.id, router, pathFor]);
  const team = useMemo(() => ({ copy: teamCopy }), [teamCopy]);

  // New notes from the brand and guests show up without a reload, never on top of something being written:
  // the pulse (docs/BRAND-ROOMS-FEEDBACK.md §11) says when the stack's notes or versions moved; while the
  // composer holds unsent work the re-read waits and runs the moment it lets go.
  const refresh = useCallback(() => router.refresh(), [router]);
  const holding = useRef(false);
  const pending = useRef(false);
  const onComposingChange = useCallback(
    (value: boolean) => {
      holding.current = value;
      if (!value && pending.current) {
        pending.current = false;
        refresh();
      }
    },
    [refresh],
  );
  const organizationId = desk?.organizationId ?? review.organizationId;
  const scope = useMemo(() => (deskProject ? { projectId: deskProject } : { reviewId: review.id }), [deskProject, review.id]);
  const [pulseGone, setPulseGone] = useState(false);
  const readStamp = useCallback(() => readPulse<RoomPulseStamp & Record<string, string | null>>(staffPulseUrl(organizationId, scope)), [organizationId, scope]);
  const onPulse = useCallback(
    (changed: string[]) => {
      if (!changed.includes("reviews")) return;
      if (holding.current) pending.current = true;
      else refresh();
    },
    [refresh],
  );
  const onPulseGone = useCallback(() => setPulseGone(true), []);
  usePulse(organizationId && !pulseGone ? `${organizationId}:${"projectId" in scope ? scope.projectId : scope.reviewId}` : null, readStamp, onPulse, onPulseGone);
  // Where the pulse door is not there (rooms switched off: a studio review page), the old quiet re-read.
  const paused = useCallback(() => holding.current || !pulseGone, [pulseGone]);
  useQuietRefresh(refresh, paused);

  // On a project's desk the open version works like the client's review mode (docs/BRAND-ROOMS-FEEDBACK.md
  // §11.7): it is brought to the top of the window once, and the stage fills the window from there, so the
  // notes column runs to the window's bottom with its own scroll instead of stopping at the player's height.
  useEffect(() => {
    if (!deskOrg || !deskProject) return;
    const box = Array.from(document.querySelectorAll<HTMLElement>("[data-admin-desk-stage]")).find((el) => el.dataset.adminDeskStage === review.id);
    if (!box) return;
    // At once, not smoothly: the team opened this version to work on it.
    requestAnimationFrame(() => box.scrollIntoView({ block: "start", behavior: "auto" }));
  }, [deskOrg, deskProject, review.id]);

  return (
    <ReviewStage
      review={review}
      comments={comments}
      canWrite
      copy={copy}
      locale={locale}
      initialMs={initialMs}
      actions={actions}
      linkFor={(ms) => pathFor(review.id, ms)}
      eyebrow={eyebrow}
      extended={extended}
      versions={versions}
      onVersion={(id) => router.push(pathFor(id))}
      team={team}
      onComposingChange={onComposingChange}
      compactHead={Boolean(deskOrg && deskProject)}
      layout={deskOrg && deskProject ? "wide" : "inline"}
    />
  );
}
