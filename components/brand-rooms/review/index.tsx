"use client";
/**
 * The deliverables tab of a project room (docs/BRAND-ROOMS.md §6): the project's drafts as version stacks
 * on the left, the review stage on the right with ranges, drawings, the version switcher, "나란히 비교",
 * the notes carried over from the previous version, and the share button.
 *
 * Owners and editors add their own studio work, post a new version, move the status, resolve and share;
 * everyone seated in the room (viewers, invited project guests) watches and writes notes. The address keeps
 * `review` (and `t` on arrival) next to whatever the room page put there, so a copied link opens the same
 * draft at the same moment. The list and the open draft refresh every 30 seconds while the tab is visible.
 */
import "@/components/brand-studio/review/review.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { roomReviewHref, type ReviewCreated, type ReviewStack, type RoomReviewDetail } from "@/lib/brand-studio/review-contracts";
import { ReviewPicker } from "@/components/brand-studio/review/picker";
import { ReviewStage, fill, reviewErrorText, type ReviewActionResult, type ReviewActions } from "@/components/brand-studio/review/stage";
import type { ProjectReviewTabProps } from "../seams";
import { ShareButton } from "../share";
import { fetchRoomReview, fetchRoomReviews, postRoomReview } from "./api";

const POLL_MS = 30_000;

function rememberInAddress(reviewId: string | null) {
  try {
    const url = new URL(window.location.href);
    if (reviewId) url.searchParams.set("review", reviewId);
    else url.searchParams.delete("review");
    url.searchParams.delete("t");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // History can be locked down (embedded views); the tab still works.
  }
}

export function ProjectReviewTab({
  organizationId,
  projectId,
  locale,
  copy,
  reviewCopy,
  canEdit,
  canTalk,
  initial,
  filterStatus,
  finalsEmptyText,
}: ProjectReviewTabProps) {
  const t = copy.tab;
  const [stacks, setStacks] = useState<ReviewStack[] | null>(null);
  const [rights, setRights] = useState({ canEdit, canTalk });
  const [selectedId, setSelectedId] = useState<string | null>(initial?.reviewId ?? null);
  const [detail, setDetail] = useState<RoomReviewDetail | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [picking, setPicking] = useState<null | "new" | "version">(null);
  const [arrivalMs] = useState<number | null>(initial?.atMs ?? null);
  const [arrivalCommentId] = useState<string | null>(initial?.commentId ?? null);
  const visibleStacks = useMemo(
    () => (stacks === null ? null : filterStatus ? stacks.filter((s) => s.versions[0]?.status === filterStatus) : stacks),
    [stacks, filterStatus],
  );

  const loadList = useCallback(async () => {
    const result = await fetchRoomReviews(organizationId, projectId);
    if (result.ok) {
      setStacks(result.stacks);
      setRights({ canEdit: result.canEdit, canTalk: result.canTalk });
      setListError(null);
      return result.stacks;
    }
    setListError(reviewErrorText(reviewCopy, result.code) || t.failed);
    return null;
  }, [organizationId, projectId, reviewCopy, t.failed]);

  const loadDetail = useCallback(
    async (reviewId: string, quiet = false) => {
      const result = await fetchRoomReview(organizationId, projectId, reviewId);
      if (result.ok) {
        setDetail(result);
        setRights({ canEdit: result.canEdit, canTalk: result.canTalk });
        setDetailError(null);
      } else if (!quiet) {
        setDetail(null);
        setDetailError(reviewErrorText(reviewCopy, result.code));
      }
    },
    [organizationId, projectId, reviewCopy],
  );

  const select = useCallback(
    (reviewId: string) => {
      setSelectedId(reviewId);
      setDetail((d) => (d?.review.id === reviewId ? d : null));
      rememberInAddress(reviewId);
      void loadDetail(reviewId);
    },
    [loadDetail],
  );

  // First load: the list, then the draft the address named or the most recent one.
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await loadList();
      if (!live || !list) return;
      const shown = filterStatus ? list.filter((s) => s.versions[0]?.status === filterStatus) : list;
      const first = initial?.reviewId ?? shown[0]?.versions[0]?.id ?? null;
      if (first) {
        setSelectedId(first);
        void loadDetail(first);
      }
    })();
    return () => {
      live = false;
    };
    // Once per room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      if (selectedId) void loadDetail(selectedId, true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [loadList, loadDetail, selectedId]);

  const refresh = useCallback(async () => {
    await Promise.all([loadList(), selectedId ? loadDetail(selectedId, true) : Promise.resolve()]);
  }, [loadList, loadDetail, selectedId]);

  const actions = useMemo<ReviewActions | null>(() => {
    if (!selectedId) return null;
    const base = { organizationId, projectId, reviewId: selectedId };
    const after = async (result: { ok: boolean; code?: string }): Promise<ReviewActionResult> => {
      if (!result.ok) return { ok: false, code: result.code ?? "failed" };
      await refresh();
      return { ok: true };
    };
    return {
      addComment: async (input) => after(await postRoomReview("comment.add", { ...base, ...input })),
      resolveComment: async (commentId) => after(await postRoomReview("comment.resolve", { ...base, commentId })),
      deleteComment: async (commentId) => after(await postRoomReview("comment.delete", { ...base, commentId })),
      setStatus: async (status) => after(await postRoomReview("review.status", { ...base, status })),
    };
  }, [organizationId, projectId, selectedId, refresh]);

  const created = useCallback(
    async (result: ReviewCreated) => {
      setPicking(null);
      await loadList();
      select(result.review.id);
    },
    [loadList, select],
  );

  const stackOfSelected = stacks?.find((s) => s.versions.some((v) => v.id === selectedId)) ?? null;
  const latestOfStack = stackOfSelected?.versions[0] ?? null;

  return (
    <div className="bsv-review bsv-room-review" data-room-review>
      <header className="bsv-head">
        <div>
          <h2 className="bsv-title bsv-room-title">{t.title}</h2>
          <p className="bsv-lede">{t.lede}</p>
        </div>
        {rights.canEdit && (
          <button type="button" className="bsv-pill" onClick={() => setPicking("new")} data-room-review-add>
            <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t.addOwn}
          </button>
        )}
      </header>

      {visibleStacks === null ? (
        listError ? (
          <div className="bsv-empty" role="alert">
            <p className="bsv-error">{listError}</p>
            <button type="button" className="bsv-pill" onClick={() => void loadList()}>
              {t.retry}
            </button>
          </div>
        ) : (
          <p className="bsv-quiet" role="status">
            {t.loading}
          </p>
        )
      ) : visibleStacks.length === 0 ? (
        <section className="bsv-empty" data-room-review-empty>
          <h3 className="bsv-empty-title">{t.empty.title}</h3>
          <p className="bsv-lede">{finalsEmptyText ?? t.empty.line}</p>
        </section>
      ) : (
        <div className="bsv-layout">
          <nav className="bsv-list" aria-label={t.listLabel} data-room-review-list>
            <ul>
              {visibleStacks.map((stack) => {
                const latest = stack.versions[0]!;
                const current = stack.versions.some((v) => v.id === selectedId);
                return (
                  <li key={stack.stackId}>
                    <button
                      type="button"
                      className="bsv-item"
                      aria-current={current ? "true" : undefined}
                      onClick={() => select(latest.id)}
                      data-room-review-stack={stack.stackId}
                      data-review-item-status={latest.status}
                    >
                      <span className="bsv-thumb" data-kind={latest.kind}>
                        {latest.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- private studio media
                          <img src={latest.thumbUrl} alt="" loading="lazy" draggable={false} />
                        ) : (
                          <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled="">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        )}
                      </span>
                      <span className="bsv-item-text">
                        <span className="bsv-item-title">{latest.title}</span>
                        <span className="bsv-item-meta">
                          <span className="bsv-version-chip">{`v${latest.version ?? 1}`}</span>
                          <span className="bsv-status" data-state={latest.status}>
                            {reviewCopy.status[latest.status]}
                          </span>
                          {latest.commentsOpen > 0 ? <span className="bsv-open-count">{fill(reviewCopy.openCount, { count: latest.commentsOpen })}</span> : null}
                        </span>
                        <span className="bsv-item-source">{latest.source === "delivery" ? t.delivered : t.fromStudio}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="bsv-main">
            {detail && actions ? (
              <ReviewStage
                key={detail.review.id}
                review={detail.review}
                comments={detail.comments}
                canWrite={rights.canEdit}
                canComment={rights.canTalk}
                canManage={rights.canEdit}
                extended
                versions={detail.versions}
                onVersion={select}
                copy={reviewCopy}
                locale={locale}
                initialMs={detail.review.id === initial?.reviewId ? arrivalMs : null}
                initialCommentId={detail.review.id === initial?.reviewId ? arrivalCommentId : null}
                actions={actions}
                linkFor={(ms) => roomReviewHref(organizationId, projectId, detail.review.id, ms)}
                tools={
                  rights.canEdit ? (
                    <>
                      {latestOfStack && (
                        <button type="button" className="bsv-pill" onClick={() => setPicking("version")} data-room-review-version>
                          {t.newVersion}
                        </button>
                      )}
                      <ShareButton organizationId={organizationId} target={{ kind: "review", id: detail.review.id }} locale={locale} copy={copy} canEdit={rights.canEdit} />
                    </>
                  ) : null
                }
              />
            ) : detailError ? (
              <p className="bsv-error bsv-main-note" role="alert">
                {detailError}
              </p>
            ) : (
              <p className="bsv-quiet bsv-main-note" role="status">
                {t.loading}
              </p>
            )}
          </div>
        </div>
      )}

      {picking && (
        <ReviewPicker
          organizationId={organizationId}
          copy={reviewCopy}
          locale={locale}
          heading={picking === "new" ? t.pickTitle : t.versionPickTitle}
          onClose={() => setPicking(null)}
          onCreated={(result) => void created(result)}
          create={(input) =>
            picking === "version" && latestOfStack
              ? postRoomReview("review.version", { organizationId, projectId, reviewId: latestOfStack.id, ...input })
              : postRoomReview("review.create", { organizationId, projectId, ...input })
          }
        />
      )}
    </div>
  );
}
