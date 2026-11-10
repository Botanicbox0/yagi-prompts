"use client";
/**
 * The review stage (docs/BRAND-STUDIO-V3.md §7), shared by the brand screen and the team's admin page.
 *
 * Left: the piece. A film plays on a custom player with a timeline that carries one pin per timed
 * note; a still shows its spot pins. "이 장면에 남기기" captures the current moment for the next note,
 * and one click on the frame adds the spot. Right: the notes, threaded one level, with resolve, reply,
 * delete-own and an open/all filter. Above: the status moves and "링크 복사" (the link opens this
 * piece at this moment).
 *
 * The stage owns no data: it receives the review and its comments and calls `actions`; the owner
 * (brand app or admin wrapper) refreshes the props after a write.
 */
import "./review.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  REVIEW_FRAME_MS,
  formatTimecode,
  nextStatuses,
  spotVisibleAt,
  threadComments,
  type ReviewComment,
  type ReviewItem,
  type ReviewStatus,
  type ReviewThread,
} from "@/lib/brand-studio/review-contracts";
import type { studioReviewEn } from "@/messages/studio-review";

export type ReviewCopy = typeof studioReviewEn;
export type ReviewActionResult = { ok: true } | { ok: false; code: string };

export interface ReviewActions {
  addComment(input: { body: string; parentId?: string | null; atMs?: number | null; x?: number | null; y?: number | null }): Promise<ReviewActionResult>;
  resolveComment(commentId: string): Promise<ReviewActionResult>;
  /** Absent on screens where the viewer cannot delete their own notes. */
  deleteComment?(commentId: string): Promise<ReviewActionResult>;
  setStatus(status: ReviewStatus): Promise<ReviewActionResult>;
}

export interface ReviewStageProps {
  review: ReviewItem;
  comments: ReviewComment[];
  canWrite: boolean;
  copy: ReviewCopy;
  locale: "ko" | "en";
  /** `?t=` on arrival: the film opens paused at this moment. */
  initialMs?: number | null;
  actions: ReviewActions;
  /** The address of this piece at a moment (a path; the stage makes it absolute). */
  linkFor(atMs: number | null): string;
  /** A line above the title (the team page names the brand here). */
  eyebrow?: ReactNode;
  /** Phones: back to the list. */
  onBack?: () => void;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function reviewErrorText(copy: ReviewCopy, code: string): string {
  const known = copy.errors as Record<string, string>;
  return known[code] ?? copy.errors.generic;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** Fit a box of `ratio` into the wrapper's width and a height cap, so spot pins map 1:1 onto the media. */
function useFitBox(ratio: number) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      const maxH = Math.max(220, Math.min(760, window.innerHeight * 0.66));
      let w = avail;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ratio]);
  return { wrapRef, box };
}

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg className="bsv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-filled={filled ? "" : undefined}>
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  back: "M15 6l-6 6 6 6",
  forward: "M9 6l6 6-6 6",
  sound: "M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6",
  muted: "M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  pin: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
} as const;

export function ReviewStage({ review, comments, canWrite, copy, locale, initialMs, actions, linkFor, eyebrow, onBack }: ReviewStageProps) {
  const isVideo = review.kind === "video";
  const media = review.mediaUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [ratio, setRatio] = useState(() => (review.width && review.height ? review.width / review.height : isVideo ? 16 / 9 : 1));
  const { wrapRef, box } = useFitBox(ratio);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentMs, setCurrentMs] = useState(isVideo ? Math.max(0, initialMs ?? 0) : 0);
  const [durationMs, setDurationMs] = useState(review.seconds ? Math.round(review.seconds * 1000) : 0);
  const [mark, setMark] = useState<{ atMs: number | null; x: number | null; y: number | null } | null>(null);
  const [spotMode, setSpotMode] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seededRef = useRef(false);

  // A different piece: start clean.
  useEffect(() => {
    setMark(null);
    setSpotMode(false);
    setReplyTo(null);
    setActiveId(null);
    setError(null);
    setPlaying(false);
    setRatio(review.width && review.height ? review.width / review.height : review.kind === "video" ? 16 / 9 : 1);
    setDurationMs(review.seconds ? Math.round(review.seconds * 1000) : 0);
    seededRef.current = false;
  }, [review.id, review.width, review.height, review.kind, review.seconds]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  // The playhead follows the film smoothly while it plays.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setCurrentMs(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const threads = useMemo(() => threadComments(comments), [comments]);
  const numberOf = useMemo(() => new Map(threads.map((t, i) => [t.root.id, i + 1])), [threads]);
  const openThreads = threads.filter((t) => !t.root.resolved && !t.root.deleted);
  const shown = filter === "open" ? openThreads : threads;
  const timed = threads.filter((t) => !t.root.deleted && t.root.atMs != null);

  const seek = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      const max = durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER;
      const next = Math.min(Math.max(0, ms), max);
      if (v) v.currentTime = next / 1000;
      setCurrentMs(next);
    },
    [durationMs],
  );
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  const step = useCallback(
    (direction: -1 | 1, size = REVIEW_FRAME_MS) => {
      videoRef.current?.pause();
      seek(Math.round(currentMs + direction * size));
    },
    [currentMs, seek],
  );

  const focusThread = useCallback(
    (thread: ReviewThread) => {
      setActiveId(thread.root.id);
      if (isVideo && thread.root.atMs != null) {
        videoRef.current?.pause();
        seek(thread.root.atMs);
      }
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`bsv-thread-${thread.root.id}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    },
    [isVideo, seek],
  );

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) setDurationMs(Math.round(v.duration * 1000));
    if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
    if (!seededRef.current) {
      seededRef.current = true;
      if (initialMs && initialMs > 0) {
        v.currentTime = initialMs / 1000;
        setCurrentMs(initialMs);
        const near = timed.find((t) => Math.abs((t.root.atMs ?? 0) - initialMs) <= 400);
        if (near) setActiveId(near.root.id);
      }
    }
  }

  function markMoment() {
    if (isVideo) {
      videoRef.current?.pause();
      setMark({ atMs: Math.round(currentMs), x: null, y: null });
    } else {
      setMark({ atMs: null, x: null, y: null });
    }
    setSpotMode(true);
    setError(null);
  }

  function onFrameClick(event: MouseEvent<HTMLDivElement>) {
    if (spotMode && canWrite) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = round4(clamp01((event.clientX - rect.left) / rect.width));
      const y = round4(clamp01((event.clientY - rect.top) / rect.height));
      setMark((m) => ({ atMs: isVideo ? (m?.atMs ?? Math.round(currentMs)) : null, x, y }));
      setSpotMode(false);
      textRef.current?.focus();
      return;
    }
    if (isVideo) togglePlay();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input[type='text'], select")) return;
    if (event.key === "Escape" && spotMode) {
      setSpotMode(false);
      return;
    }
    if (!isVideo || event.metaKey || event.ctrlKey || event.altKey) return;
    const onControl = Boolean(target.closest("button, a, input"));
    const onRange = target.matches("input[type='range']");
    switch (event.key) {
      case " ":
        if (onControl) return;
        event.preventDefault();
        togglePlay();
        break;
      case "k":
      case "K":
        event.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (onRange) return;
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
        break;
      case "j":
      case "J":
        event.preventDefault();
        step(-1, 1000);
        break;
      case "l":
      case "L":
        event.preventDefault();
        step(1, 1000);
        break;
    }
  }

  async function run(key: string, action: () => Promise<ReviewActionResult>): Promise<boolean> {
    setBusy(key);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(reviewErrorText(copy, result.code));
        return false;
      }
      return true;
    } catch {
      setError(copy.errors.generic);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    const ok = await run("send", () => actions.addComment({ body, atMs: mark?.atMs ?? null, x: mark?.x ?? null, y: mark?.y ?? null }));
    if (ok) {
      setDraft("");
      setMark(null);
      setSpotMode(false);
    }
  }

  async function sendReply(rootId: string) {
    const body = replyDraft.trim();
    if (!body || busy) return;
    const ok = await run(`reply:${rootId}`, () => actions.addComment({ body, parentId: rootId }));
    if (ok) {
      setReplyDraft("");
      setReplyTo(null);
    }
  }

  async function copyLink() {
    const path = linkFor(isVideo ? Math.round(currentMs) : null);
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setToast(copy.copied);
    } catch {
      setToast(copy.copyFailed);
    }
  }

  const showSpots = media != null && (!isVideo || !playing);
  const spotThreads = showSpots ? threads.filter((t) => !t.root.deleted && spotVisibleAt(t.root, isVideo ? currentMs : null)) : [];
  const pct = (ms: number) => (durationMs > 0 ? `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%` : "0%");
  // Pins closer than ~2.5% of the film fan out sideways (CSS reads --bsv-nudge).
  const nudge = new Map<string, number>();
  {
    let anchor = Number.NEGATIVE_INFINITY;
    let n = 0;
    for (const t of timed) {
      const at = Math.min(t.root.atMs ?? 0, durationMs || Number.MAX_SAFE_INTEGER);
      const close = durationMs > 0 ? (at - anchor) / durationMs < 0.025 : at === anchor;
      if (close) n += 1;
      else {
        anchor = at;
        n = 0;
      }
      nudge.set(t.root.id, n);
    }
  }

  return (
    <section className="bsv-stage" data-review-stage={review.id} data-review-kind={review.kind} aria-labelledby={`bsv-title-${review.id}`}>
      <header className="bsv-stage-head">
        <div className="bsv-stage-heading">
          {onBack && (
            <button type="button" className="bsv-back" onClick={onBack}>
              <Icon d={ICONS.arrowLeft} />
              <span>{copy.back}</span>
            </button>
          )}
          {eyebrow && <p className="bsv-eyebrow">{eyebrow}</p>}
          <h2 className="bsv-stage-title" id={`bsv-title-${review.id}`}>
            {review.title}
          </h2>
        </div>
        <div className="bsv-stage-tools" data-review-status={review.status}>
          <span className="bsv-status" data-state={review.status}>
            <span className="bsv-visually-hidden">{copy.statusLabel}: </span>
            {copy.status[review.status]}
          </span>
          {canWrite &&
            nextStatuses(review.status).map((s) => (
              <button
                key={s}
                type="button"
                className="bsv-pill"
                data-review-status-action={s}
                disabled={busy !== null}
                onClick={() => void run(`status:${s}`, () => actions.setStatus(s))}
              >
                {s === "approved" && <Icon d={ICONS.check} />}
                {copy.statusActions[s]}
              </button>
            ))}
          <button type="button" className="bsv-pill" onClick={() => void copyLink()} data-review-copy-link>
            <Icon d={ICONS.link} />
            {copy.copyLink}
          </button>
        </div>
      </header>

      <div className="bsv-stage-body">
        <div className="bsv-player" onKeyDown={onKeyDown} data-review-player>
          <div className="bsv-mat">
          <div className="bsv-frame-wrap" ref={wrapRef}>
            {media ? (
              <div
                className="bsv-frame"
                data-spot-mode={spotMode ? "" : undefined}
                style={box ? { width: box.w, height: box.h } : { aspectRatio: String(ratio) }}
                onClick={onFrameClick}
                tabIndex={0}
                role="group"
                aria-label={copy.player.stage}
                aria-describedby={isVideo ? `bsv-keys-${review.id}` : undefined}
              >
                {isVideo ? (
                  <video
                    ref={videoRef}
                    className="bsv-media"
                    src={media}
                    poster={review.thumbUrl ?? undefined}
                    preload="metadata"
                    playsInline
                    muted={muted}
                    onLoadedMetadata={onLoadedMetadata}
                    onPlay={() => setPlaying(true)}
                    onPause={() => {
                      setPlaying(false);
                      if (videoRef.current) setCurrentMs(videoRef.current.currentTime * 1000);
                    }}
                    onEnded={() => setPlaying(false)}
                    onSeeked={() => videoRef.current && setCurrentMs(videoRef.current.currentTime * 1000)}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- private studio media, already sized by the stage
                  <img
                    className="bsv-media"
                    src={media}
                    alt={review.title}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
                    }}
                    draggable={false}
                  />
                )}
                {spotThreads.map((t) => (
                  <button
                    key={t.root.id}
                    type="button"
                    className="bsv-spot"
                    data-review-spot={t.root.id}
                    data-role={t.root.authorRole}
                    data-resolved={t.root.resolved ? "" : undefined}
                    data-active={activeId === t.root.id ? "" : undefined}
                    style={{ left: `${(t.root.x ?? 0) * 100}%`, top: `${(t.root.y ?? 0) * 100}%` }}
                    aria-label={fill(copy.spotPinLabel, { text: t.root.body.slice(0, 80) })}
                    onClick={(e) => {
                      e.stopPropagation();
                      focusThread(t);
                    }}
                  >
                    {numberOf.get(t.root.id)}
                  </button>
                ))}
                {mark?.x != null && mark.y != null && (
                  <span className="bsv-spot" data-pending="" style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }} aria-hidden="true">
                    <Icon d={ICONS.pin} />
                  </span>
                )}
                {spotMode && (
                  <p className="bsv-spot-hint" role="status">
                    {copy.spotHint}
                  </p>
                )}
              </div>
            ) : (
              <div className="bsv-frame bsv-frame-missing" style={{ aspectRatio: String(ratio) }}>
                <p>{copy.unavailable}</p>
              </div>
            )}
          </div>
          </div>

          {isVideo && media && (
            <div className="bsv-controls" data-review-timeline>
              <div className="bsv-transport">
                <button type="button" className="bsv-icon-btn" onClick={() => step(-1)} aria-label={copy.player.back}>
                  <Icon d={ICONS.back} />
                </button>
                <button type="button" className="bsv-icon-btn bsv-play" onClick={togglePlay} aria-label={playing ? copy.player.pause : copy.player.play} data-playing={playing ? "" : undefined}>
                  <Icon d={playing ? ICONS.pause : ICONS.play} filled />
                </button>
                <button type="button" className="bsv-icon-btn" onClick={() => step(1)} aria-label={copy.player.forward}>
                  <Icon d={ICONS.forward} />
                </button>
                <span className="bsv-time" aria-live="off">
                  {formatTimecode(currentMs)} <span className="bsv-time-total">/ {formatTimecode(durationMs)}</span>
                </span>
                <button type="button" className="bsv-icon-btn bsv-mute" onClick={() => setMuted((m) => !m)} aria-label={muted ? copy.player.unmute : copy.player.mute} aria-pressed={muted}>
                  <Icon d={muted ? ICONS.muted : ICONS.sound} />
                </button>
              </div>
              <div className="bsv-track">
                <div className="bsv-pins">
                  {timed.map((t) => (
                    <button
                      key={t.root.id}
                      type="button"
                      className="bsv-pin"
                      data-review-pin={t.root.id}
                      data-role={t.root.authorRole}
                      data-resolved={t.root.resolved ? "" : undefined}
                      data-active={activeId === t.root.id ? "" : undefined}
                      style={{ left: pct(t.root.atMs ?? 0), ["--bsv-nudge" as string]: nudge.get(t.root.id) ?? 0 }}
                      aria-label={fill(copy.pinLabel, { time: formatTimecode(t.root.atMs), text: t.root.body.slice(0, 80) })}
                      onClick={() => focusThread(t)}
                    >
                      <span aria-hidden="true">{numberOf.get(t.root.id)}</span>
                    </button>
                  ))}
                  {mark?.atMs != null && <span className="bsv-pin" data-pending="" style={{ left: pct(mark.atMs) }} aria-hidden="true" />}
                </div>
                <input
                  type="range"
                  className="bsv-range"
                  min={0}
                  max={Math.max(durationMs, 1)}
                  step={REVIEW_FRAME_MS}
                  value={Math.min(currentMs, Math.max(durationMs, 1))}
                  onChange={(e) => {
                    videoRef.current?.pause();
                    seek(Number(e.target.value));
                  }}
                  aria-label={copy.player.timeline}
                  aria-valuetext={formatTimecode(currentMs)}
                  style={{ ["--bsv-progress" as string]: pct(currentMs) }}
                />
              </div>
              <p className="bsv-keys" id={`bsv-keys-${review.id}`}>
                {copy.player.keys}
              </p>
            </div>
          )}
        </div>

        <aside className="bsv-comments" data-review-comments aria-label={copy.commentsTitle}>
          <div className="bsv-comments-head">
            <h3 className="bsv-comments-title">
              {copy.commentsTitle} <span className="bsv-count">{threads.filter((t) => !t.root.deleted).length}</span>
            </h3>
            <div className="bsv-seg" role="group" aria-label={copy.filter.label}>
              {(["open", "all"] as const).map((f) => (
                <button key={f} type="button" className="bsv-seg-btn" aria-pressed={filter === f} onClick={() => setFilter(f)} data-review-filter={f}>
                  {copy.filter[f]}
                  {f === "open" && <span className="bsv-seg-count">{openThreads.length}</span>}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="bsv-quiet">{threads.length === 0 ? copy.noComments : copy.noOpen}</p>
          ) : (
            <ol className="bsv-threads">
              {shown.map((t) => (
                <li
                  key={t.root.id}
                  id={`bsv-thread-${t.root.id}`}
                  className="bsv-thread"
                  data-review-thread={t.root.id}
                  data-active={activeId === t.root.id ? "" : undefined}
                  data-resolved={t.root.resolved ? "" : undefined}
                  onClick={(e) => {
                    // A click on the note itself (not on one of its controls) brings the film to it;
                    // the timecode button is the keyboard path to the same thing.
                    if ((e.target as HTMLElement).closest("button, a, textarea, input, form")) return;
                    if (!t.root.deleted) focusThread(t);
                  }}
                >
                  <CommentBody
                    comment={t.root}
                    number={numberOf.get(t.root.id) ?? 0}
                    copy={copy}
                    locale={locale}
                    onSeek={() => focusThread(t)}
                  />
                  {canWrite && !t.root.deleted && (
                    <div className="bsv-thread-actions">
                      <button type="button" className="bsv-text-btn" onClick={() => setReplyTo((v) => (v === t.root.id ? null : t.root.id))} aria-expanded={replyTo === t.root.id} aria-label={copy.replyLabel}>
                        {copy.reply}
                      </button>
                      <button
                        type="button"
                        className="bsv-text-btn"
                        data-review-resolve={t.root.id}
                        disabled={busy !== null}
                        onClick={() => void run(`resolve:${t.root.id}`, () => actions.resolveComment(t.root.id))}
                      >
                        {t.root.resolved ? copy.reopenThread : copy.resolve}
                      </button>
                      {t.root.mine && actions.deleteComment && (
                        <DeleteButton copy={copy} disabled={busy !== null} onConfirm={() => void run(`delete:${t.root.id}`, () => actions.deleteComment!(t.root.id))} />
                      )}
                    </div>
                  )}
                  {t.replies.length > 0 && (
                    <ul className="bsv-replies">
                      {t.replies.map((r) => (
                        <li key={r.id} className="bsv-reply" data-review-reply={r.id}>
                          <CommentBody comment={r} copy={copy} locale={locale} />
                          {canWrite && r.mine && actions.deleteComment && (
                            <div className="bsv-thread-actions">
                              <DeleteButton copy={copy} disabled={busy !== null} onConfirm={() => void run(`delete:${r.id}`, () => actions.deleteComment!(r.id))} />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canWrite && replyTo === t.root.id && (
                    <form
                      className="bsv-reply-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void sendReply(t.root.id);
                      }}
                    >
                      <label className="bsv-visually-hidden" htmlFor={`bsv-reply-${t.root.id}`}>
                        {copy.replyLabel}
                      </label>
                      <textarea
                        id={`bsv-reply-${t.root.id}`}
                        className="bsv-input"
                        rows={2}
                        maxLength={2000}
                        value={replyDraft}
                        placeholder={copy.replyPlaceholder}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void sendReply(t.root.id);
                          }
                        }}
                        autoFocus
                      />
                      <div className="bsv-form-row">
                        <button type="button" className="bsv-text-btn" onClick={() => setReplyTo(null)}>
                          {copy.cancel}
                        </button>
                        <button type="submit" className="bsv-pill" disabled={!replyDraft.trim() || busy !== null}>
                          {copy.sendReply}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          )}

          {canWrite ? (
            <form
              className="bsv-composer"
              data-review-composer
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {mark && (
                <div className="bsv-marks">
                  {mark.atMs != null && <span className="bsv-chip">{fill(copy.momentChip, { time: formatTimecode(mark.atMs) })}</span>}
                  {mark.x != null && <span className="bsv-chip">{copy.spotChip}</span>}
                  <button type="button" className="bsv-icon-btn bsv-chip-clear" onClick={() => (setMark(null), setSpotMode(false))} aria-label={copy.clearMark}>
                    <Icon d={ICONS.close} />
                  </button>
                </div>
              )}
              <label className="bsv-visually-hidden" htmlFor={`bsv-draft-${review.id}`}>
                {copy.composer.label}
              </label>
              <textarea
                id={`bsv-draft-${review.id}`}
                ref={textRef}
                className="bsv-input"
                rows={3}
                maxLength={2000}
                value={draft}
                placeholder={copy.composer.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="bsv-form-row">
                {media && (
                  <button type="button" className="bsv-pill" onClick={markMoment} data-review-mark aria-pressed={spotMode}>
                    <Icon d={ICONS.pin} />
                    {isVideo ? copy.markMoment : copy.markSpot}
                  </button>
                )}
                <button type="submit" className="bsv-primary" disabled={!draft.trim() || busy !== null}>
                  {busy === "send" ? copy.composer.sending : copy.composer.send}
                </button>
              </div>
            </form>
          ) : (
            <p className="bsv-quiet" data-review-read-only>
              {copy.readOnly}
            </p>
          )}
          <p className="bsv-error" role="alert">
            {error ?? ""}
          </p>
        </aside>
      </div>
      <p className="bsv-toast" role="status" aria-live="polite" data-visible={toast ? "" : undefined}>
        {toast ?? ""}
      </p>
    </section>
  );
}

const STAMP = new Map<string, Intl.DateTimeFormat>();
function stamp(iso: string, locale: "ko" | "en"): string {
  let format = STAMP.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Seoul" });
    STAMP.set(locale, format);
  }
  return format.format(new Date(iso));
}
export { stamp as reviewStamp };

function CommentBody({
  comment,
  number,
  copy,
  locale,
  onSeek,
}: {
  comment: ReviewComment;
  number?: number;
  copy: ReviewCopy;
  locale: "ko" | "en";
  /** Thread heads only: the moment (or spot) is a button that brings the film or the pin to it. */
  onSeek?: () => void;
}) {
  return (
    <article className="bsv-comment" data-role={comment.authorRole}>
      <header className="bsv-comment-head">
        {number ? (
          <span className="bsv-num" aria-hidden="true">
            {number}
          </span>
        ) : null}
        {!comment.deleted && (
          <>
            {comment.authorName && <span className="bsv-author">{comment.authorName}</span>}
            <span className="bsv-role" data-role={comment.authorRole}>
              {copy.roles[comment.authorRole]}
            </span>
          </>
        )}
        <time className="bsv-when" dateTime={comment.createdAt}>
          {stamp(comment.createdAt, locale)}
        </time>
      </header>
      {comment.deleted ? (
        <p className="bsv-body bsv-quiet">{copy.deletedComment}</p>
      ) : (
        <>
          {onSeek && (
            <div className="bsv-meta">
              {comment.atMs != null ? (
                <button type="button" className="bsv-timecode" onClick={onSeek} aria-label={fill(copy.seekTo, { time: formatTimecode(comment.atMs) })}>
                  {formatTimecode(comment.atMs)}
                </button>
              ) : comment.x == null ? (
                <span className="bsv-timecode" data-whole="">
                  {copy.wholePiece}
                </span>
              ) : null}
              {comment.x != null &&
                (comment.atMs == null ? (
                  <button type="button" className="bsv-spot-tag" onClick={onSeek}>
                    <Icon d={ICONS.pin} />
                    {copy.spotChip}
                  </button>
                ) : (
                  <span className="bsv-spot-tag">
                    <Icon d={ICONS.pin} />
                    {copy.spotChip}
                  </span>
                ))}
              {comment.resolved && <span className="bsv-resolved">{copy.resolvedTag}</span>}
            </div>
          )}
          <p className="bsv-body">{comment.body}</p>
        </>
      )}
    </article>
  );
}

function DeleteButton({ copy, disabled, onConfirm }: { copy: ReviewCopy; disabled: boolean; onConfirm: () => void }) {
  return (
    <button
      type="button"
      className="bsv-text-btn"
      data-tone="quiet"
      disabled={disabled}
      onClick={() => {
        if (typeof window === "undefined" || window.confirm(copy.deleteConfirm)) onConfirm();
      }}
    >
      {copy.deleteComment}
    </button>
  );
}
