"use client";
/**
 * The brand's review screen (`/brand/studio/review`, docs/BRAND-STUDIO-V3.md §7): the list of pieces
 * under review on the left, the stage on the right, the first-use explainer and the picker.
 *
 * The URL keeps `?review=<id>` (and `t` on arrival) so a copied link opens the same piece at the same
 * moment. The list and the open piece refresh after every write and every 30 seconds while the tab is
 * visible, so the team's replies show up without a reload.
 */
import "./review.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Explainer } from "../explainer";
import { ShareReviewDialog, useShareReviewEvent, type ShareReviewTarget } from "../share-review-dialog";
import { reviewHref, type ReviewDetail, type ReviewList, type ReviewListItem } from "@/lib/brand-studio/review-contracts";
import { fetchReviewDetail, fetchReviewList, postReview } from "./api";
import { ReviewPicker } from "./picker";
import { ReviewStage, fill, reviewErrorText, type ReviewActionResult, type ReviewActions, type ReviewCopy } from "./stage";

/** Fired on `window` (by the explainer's button) to open the picker. */
export const REVIEW_PICK_EVENT = "twings:studio-review-pick";
const EXPLAINER_KEY = "twings_studio_review_explainer_v1";
const POLL_MS = 30_000;

export interface ReviewAppProps {
  organizationId: string;
  locale: "ko" | "en";
  copy: ReviewCopy;
  initialList: ReviewList;
  initialDetail: ReviewDetail | null;
  initialMs: number | null;
}

export function ReviewApp({ organizationId, locale, copy, initialList, initialDetail, initialMs }: ReviewAppProps) {
  const [list, setList] = useState<ReviewListItem[]>(initialList.reviews);
  const [canWrite, setCanWrite] = useState(initialList.canWrite);
  const [selectedId, setSelectedId] = useState<string | null>(initialDetail?.review.id ?? null);
  const [detail, setDetail] = useState<ReviewDetail | null>(initialDetail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareReviewTarget | null>(null);

  useShareReviewEvent(organizationId, setShareTarget);

  const reloadList = useCallback(async () => {
    const result = await fetchReviewList(organizationId);
    if (result.ok) {
      setList(result.reviews);
      setCanWrite(result.canWrite);
    }
  }, [organizationId]);

  const loadDetail = useCallback(
    async (reviewId: string, quiet = false) => {
      if (!quiet) setLoading(true);
      const result = await fetchReviewDetail(organizationId, reviewId);
      if (!quiet) setLoading(false);
      if (result.ok) {
        setDetail(result);
        setCanWrite(result.canWrite);
        setError(null);
      } else if (!quiet) {
        setDetail(null);
        setError(reviewErrorText(copy, result.code));
      }
    },
    [organizationId, copy],
  );

  const select = useCallback(
    (reviewId: string) => {
      setSelectedId(reviewId);
      setDetail((d) => (d?.review.id === reviewId ? d : null));
      try {
        window.history.replaceState(window.history.state, "", reviewHref(organizationId, reviewId));
      } catch {
        // History can be locked down (embedded views); the screen still works.
      }
      void loadDetail(reviewId);
    },
    [organizationId, loadDetail],
  );

  // The explainer's "리뷰할 작업 고르기" button speaks through a window event.
  useEffect(() => {
    const open = () => setPicking(true);
    window.addEventListener(REVIEW_PICK_EVENT, open);
    return () => window.removeEventListener(REVIEW_PICK_EVENT, open);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reloadList();
      if (selectedId) void loadDetail(selectedId, true);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reloadList, loadDetail, selectedId]);

  const refresh = useCallback(async () => {
    await Promise.all([reloadList(), selectedId ? loadDetail(selectedId, true) : Promise.resolve()]);
  }, [reloadList, loadDetail, selectedId]);

  const actions = useMemo<ReviewActions | null>(() => {
    if (!selectedId) return null;
    const base = { organizationId, reviewId: selectedId };
    const after = async (result: { ok: boolean; code?: string }): Promise<ReviewActionResult> => {
      if (!result.ok) return { ok: false, code: result.code ?? "failed" };
      await refresh();
      return { ok: true };
    };
    return {
      addComment: async (input) => after(await postReview("comment.add", { ...base, ...input })),
      resolveComment: async (commentId) => after(await postReview("comment.resolve", { ...base, commentId })),
      deleteComment: async (commentId) => after(await postReview("comment.delete", { ...base, commentId })),
      setStatus: async (status) => after(await postReview("review.status", { ...base, status })),
    };
  }, [organizationId, selectedId, refresh]);

  const steps = [copy.explainer.step1, copy.explainer.step2, copy.explainer.step3, copy.explainer.step4];
  const activeSummary = useMemo(
    () => (selectedId ? list.find((item) => item.id === selectedId) ?? null : null),
    [list, selectedId],
  );
  const shareBtnLabel = locale === "en" ? "Share link (/s/...) · Client chat" : "공유 링크 (/s/...) · 대화방 연결";

  return (
    <div className="bsv-review" data-studio-review>
      <header className="bsv-head">
        <div>
          <h1 className="bsv-title">{copy.title}</h1>
          <p className="bsv-lede">{copy.lede}</p>
        </div>
        {canWrite && list.length > 0 && (
          <div className="bsv-head-actions">
            {selectedId && (
              <button
                type="button"
                className="bsv-primary"
                onClick={() =>
                  setShareTarget({
                    organizationId,
                    reviewId: selectedId,
                    title: detail?.review.title ?? activeSummary?.title ?? "",
                  })
                }
                data-review-share-open
              >
                <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </svg>
                {shareBtnLabel}
              </button>
            )}
            <button type="button" className="bsv-pill" onClick={() => setPicking(true)} data-review-pick-open>
              <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {copy.pick}
            </button>
          </div>
        )}
      </header>

      {list.length === 0 ? (
        <>
          {/* First use: the explainer carries the one blue button; the empty card below stays quiet. */}
          <Explainer
            storageKey={EXPLAINER_KEY}
            title={copy.explainer.title}
            line={copy.explainer.line}
            actions={canWrite ? [{ label: copy.pick, event: REVIEW_PICK_EVENT, primary: true }] : []}
            stepsTitle={copy.explainer.stepsTitle}
            steps={steps}
            dismissLabel={copy.explainer.dismiss}
            reopenLabel={copy.explainer.reopen}
          />
          <section className="bsv-empty" data-review-empty>
            <h2 className="bsv-empty-title">{copy.empty.title}</h2>
            <p className="bsv-lede">{copy.empty.line}</p>
            {canWrite ? (
              <button type="button" className="bsv-pill" onClick={() => setPicking(true)} data-review-pick-open>
                <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {copy.pick}
              </button>
            ) : (
              <p className="bsv-quiet">{copy.readOnly}</p>
            )}
          </section>
        </>
      ) : (
        <div className="bsv-layout">
          <nav className="bsv-list" aria-label={copy.listLabel} data-review-list>
            <ul>
              {list.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="bsv-item"
                    aria-current={item.id === selectedId ? "true" : undefined}
                    onClick={() => select(item.id)}
                    data-review-item={item.id}
                    data-review-item-status={item.status}
                  >
                    <span className="bsv-thumb" data-kind={item.kind}>
                      {item.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- private studio media
                        <img src={item.thumbUrl} alt="" loading="lazy" draggable={false} />
                      ) : (
                        <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled="">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </span>
                    <span className="bsv-item-text">
                      <span className="bsv-item-title">{item.title}</span>
                      <span className="bsv-item-meta">
                        <span className="bsv-status" data-state={item.status}>
                          {copy.status[item.status]}
                        </span>
                        {item.commentsOpen > 0 ? (
                          <span className="bsv-open-count">{fill(copy.openCount, { count: item.commentsOpen })}</span>
                        ) : item.commentsTotal > 0 ? (
                          <span className="bsv-quiet">{copy.allResolved}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="bsv-main">
            {detail && actions ? (
              <ReviewStage
                key={detail.review.id}
                review={detail.review}
                comments={detail.comments}
                canWrite={detail.canWrite}
                copy={copy}
                locale={locale}
                initialMs={detail.review.id === initialDetail?.review.id ? initialMs : null}
                actions={actions}
                linkFor={(ms) => reviewHref(organizationId, detail.review.id, ms)}
                extended={detail.extended === true}
                versions={detail.versions}
                onVersion={select}
              />
            ) : loading ? (
              <p className="bsv-quiet bsv-main-note" role="status">
                {copy.picker.loading}
              </p>
            ) : error ? (
              <p className="bsv-error bsv-main-note" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {picking && (
        <ReviewPicker
          organizationId={organizationId}
          copy={copy}
          locale={locale}
          onClose={() => setPicking(false)}
          onCreated={(created) => {
            setPicking(false);
            setList((items) => (items.some((i) => i.id === created.review.id) ? items : [created.review, ...items]));
            select(created.review.id);
            void reloadList();
          }}
        />
      )}

      {shareTarget && (
        <ShareReviewDialog
          target={shareTarget}
          locale={locale}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
