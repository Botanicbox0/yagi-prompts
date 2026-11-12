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
  REVIEW_LIMITS,
  formatTimecode,
  nextStatuses,
  spotVisibleAt,
  threadComments,
  type ReviewComment,
  type ReviewItem,
  type ReviewStatus,
  type ReviewStroke,
  type ReviewThread,
  type ReviewVersion,
} from "@/lib/brand-studio/review-contracts";
import type { studioReviewEn } from "@/messages/studio-review";
import { CompareView } from "./compare";
import { InkLayer, InkTools, useInk } from "./ink";

export type ReviewCopy = typeof studioReviewEn;
export type ReviewActionResult = { ok: true } | { ok: false; code: string };

export interface ReviewNoteInput {
  body: string;
  parentId?: string | null;
  atMs?: number | null;
  /** Rooms: a range ends here. */
  endMs?: number | null;
  x?: number | null;
  y?: number | null;
  /** Rooms: a drawing on the frame. */
  strokes?: ReviewStroke[] | null;
}

export interface ReviewActions {
  addComment(input: ReviewNoteInput): Promise<ReviewActionResult>;
  /** Absent where the viewer may not resolve (a share link). */
  resolveComment?(commentId: string): Promise<ReviewActionResult>;
  /** Absent on screens where the viewer cannot delete their own notes. */
  deleteComment?(commentId: string): Promise<ReviewActionResult>;
  /** Absent where the viewer may not move the status (a share link). */
  setStatus?(status: ReviewStatus): Promise<ReviewActionResult>;
}

export interface ReviewStageProps {
  review: ReviewItem;
  comments: ReviewComment[];
  canWrite: boolean;
  copy: ReviewCopy;
  locale: "ko" | "en";
  /** `?t=` on arrival: the film opens paused at this moment. */
  initialMs?: number | null;
  /** `?comment=` on arrival: highlights and scrolls to that comment thread. */
  initialCommentId?: string | null;
  actions: ReviewActions;
  /** The address of this piece at a moment (a path; the stage makes it absolute). Absent: no "링크 복사". */
  linkFor?: (atMs: number | null) => string;
  /** A line above the title (the team page names the brand here). */
  eyebrow?: ReactNode;
  /** Phones: back to the list. */
  onBack?: () => void;
  /** Rooms (docs/BRAND-ROOMS.md §6): ranges, drawings, the version switcher and "나란히 비교". Off: the v3 screen as it was. */
  extended?: boolean;
  /** Who may write notes and replies. Defaults to `canWrite`. */
  canComment?: boolean;
  /** Who may resolve notes and move the status. Defaults to `canWrite`. */
  canManage?: boolean;
  /** A share link's guest: the name they sign their notes with. */
  guest?: { name: string; onName(name: string): void } | null;
  /** The stack, newest first. The switcher shows once there are two. */
  versions?: ReviewVersion[];
  onVersion?: (reviewId: string) => void;
  /** More controls at the end of the header (the room's 공유 button). */
  tools?: ReactNode;
  /** A share link that allows download. */
  downloadUrl?: string | null;
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export type ReviewExportFormat = "csv" | "markdown" | "markers";

function formatMarkerMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.round(ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function csvCell(value: string | number | boolean): string {
  const raw = String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function exportReviewComments(
  reviewTitle: string,
  comments: readonly ReviewComment[],
  format: ReviewExportFormat,
): { filename: string; mime: string; content: string } {
  const safeBase =
    reviewTitle
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "review";
  const threads = threadComments(comments as ReviewComment[]).filter((t) => !t.root.deleted);

  if (format === "csv") {
    const header = ["#", "Timecode", "End", "Status", "Author", "Role", "Spot", "Drawing", "Comment"].join(",");
    const rows = threads.map((t, index) => {
      const author = t.root.authorName ?? (t.root.authorRole === "studio" ? "YAGI team" : t.root.guest ? "Guest" : "Brand");
      return [
        index + 1,
        formatMarkerMs(t.root.atMs),
        formatMarkerMs(t.root.endMs),
        t.root.resolved ? "resolved" : "open",
        author,
        t.root.guest ? "guest" : t.root.authorRole,
        t.root.x != null ? `${Math.round(t.root.x * 100)}%,${Math.round((t.root.y ?? 0) * 100)}%` : "",
        Boolean(t.root.strokes?.length),
        t.root.body,
      ]
        .map(csvCell)
        .join(",");
    });
    return { filename: `${safeBase}-notes.csv`, mime: "text/csv;charset=utf-8", content: `\uFEFF${[header, ...rows].join("\r\n")}` };
  }

  if (format === "markdown") {
    const lines = [`# ${reviewTitle}`, ""];
    threads.forEach((t, index) => {
      const check = t.root.resolved ? "x" : " ";
      const author = t.root.authorName ?? (t.root.authorRole === "studio" ? "YAGI team" : t.root.guest ? "Guest" : "Brand");
      const time =
        t.root.atMs != null
          ? t.root.endMs != null
            ? `[${formatTimecode(t.root.atMs)}–${formatTimecode(t.root.endMs)}] `
            : `[${formatTimecode(t.root.atMs)}] `
          : "";
      lines.push(`- [${check}] **#${index + 1}** ${time}(${author}): ${t.root.body.replace(/\s+/g, " ").trim()}`);
      for (const reply of t.replies) {
        if (reply.deleted) continue;
        const replyAuthor = reply.authorName ?? (reply.authorRole === "studio" ? "YAGI team" : reply.guest ? "Guest" : "Brand");
        lines.push(`  - (${replyAuthor}): ${reply.body.replace(/\s+/g, " ").trim()}`);
      }
    });
    return { filename: `${safeBase}-notes.md`, mime: "text/markdown;charset=utf-8", content: `${lines.join("\n")}\n` };
  }

  const markerLines = threads.map((t, index) => {
    const start = formatMarkerMs(t.root.atMs ?? 0);
    const end = formatMarkerMs(t.root.endMs ?? t.root.atMs ?? 0);
    const author = t.root.authorName ?? (t.root.authorRole === "studio" ? "YAGI team" : t.root.guest ? "Guest" : "Brand");
    return `${start}\t${end}\t#${index + 1} ${author}\t${t.root.body.replace(/\s+/g, " ").trim()}`;
  });
  return { filename: `${safeBase}-markers.txt`, mime: "text/plain;charset=utf-8", content: `${markerLines.join("\n")}\n` };
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
  compare: "M4 5h7v14H4zM13 5h7v14h-7",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  pen: "M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4zM14 7l3 3",
} as const;

type Mark = { atMs: number | null; endMs?: number | null; x: number | null; y: number | null; strokes?: ReviewStroke[] | null };

export function ReviewStage({
  review,
  comments,
  canWrite,
  copy,
  locale,
  initialMs,
  initialCommentId,
  actions,
  linkFor,
  eyebrow,
  onBack,
  extended = false,
  canComment = canWrite,
  canManage = canWrite,
  guest = null,
  versions,
  onVersion,
  tools,
  downloadUrl,
}: ReviewStageProps) {
  const isVideo = review.kind === "video";
  const media = review.mediaUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => (review.width && review.height ? review.width / review.height : isVideo ? 16 / 9 : 1));
  const { wrapRef, box } = useFitBox(ratio);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [currentMs, setCurrentMs] = useState(isVideo ? Math.max(0, initialMs ?? 0) : 0);
  const [durationMs, setDurationMs] = useState(review.seconds ? Math.round(review.seconds * 1000) : 0);
  const [mark, setMark] = useState<Mark | null>(null);
  const [spotMode, setSpotMode] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [dragRange, setDragRange] = useState<{ from: number; to: number } | null>(null);
  const ink = useInk();
  const canDraw = extended && canComment && media != null;
  const stack = extended && versions && versions.length > 1 ? versions : null;
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("all");
  const [drawingOnly, setDrawingOnly] = useState(false);
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seededRef = useRef(false);
  const seededCommentRef = useRef<string | null>(null);

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
    setComparing(false);
    setDragRange(null);
    ink.reset();
    seededRef.current = false;
    // `ink.reset` is stable (useInk).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const resolvedThreads = threads.filter((t) => t.root.resolved && !t.root.deleted);
  const authorOptions = useMemo(() => {
    const names = new Set<string>();
    for (const t of threads) {
      if (t.root.deleted) continue;
      const label = t.root.authorName ?? (t.root.authorRole === "studio" ? copy.roles.studio : t.root.guest ? copy.roles.guest : copy.roles.brand);
      if (label) names.add(label);
    }
    return [...names];
  }, [threads, copy.roles]);
  const statusFiltered = filter === "open" ? openThreads : filter === "resolved" ? resolvedThreads : threads;
  const shownAll = statusFiltered.filter((t) => {
    if (extended && drawingOnly && !(t.root.strokes && t.root.strokes.length > 0)) return false;
    if (extended && authorFilter !== "all") {
      const label = t.root.authorName ?? (t.root.authorRole === "studio" ? copy.roles.studio : t.root.guest ? copy.roles.guest : copy.roles.brand);
      if (label !== authorFilter) return false;
    }
    return true;
  });
  // Notes carried over from an earlier version sit in their own group, oldest version first.
  const shown = shownAll.filter((t) => !t.root.carriedFrom);
  const carriedGroups = useMemo(() => {
    const groups = new Map<number, ReviewThread[]>();
    for (const t of shownAll) {
      if (!t.root.carriedFrom) continue;
      const list = groups.get(t.root.carriedFrom.version) ?? [];
      list.push(t);
      groups.set(t.root.carriedFrom.version, list);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [shownAll]);
  const timed = threads.filter((t) => !t.root.deleted && t.root.atMs != null);
  const activeThread = activeId ? threads.find((t) => t.root.id === activeId) ?? null : null;

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

  useEffect(() => {
    if (!initialCommentId || seededCommentRef.current === initialCommentId || threads.length === 0) return;
    const hit = threads.find((t) => t.root.id === initialCommentId || t.replies.some((r) => r.id === initialCommentId));
    if (!hit) return;
    seededCommentRef.current = initialCommentId;
    focusThread(hit);
  }, [initialCommentId, threads, focusThread]);

  function changeSpeed(next: number) {
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }

  function downloadExport(format: ReviewExportFormat) {
    const out = exportReviewComments(review.title, comments, format);
    const blob = new Blob([out.content], { type: out.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = out.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
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
    ink.stop();
    if (isVideo) {
      videoRef.current?.pause();
      setMark((m) => ({ atMs: Math.round(currentMs), endMs: null, x: null, y: null, strokes: m?.strokes ?? null }));
    } else {
      setMark((m) => ({ atMs: null, x: null, y: null, strokes: m?.strokes ?? null }));
    }
    setSpotMode(true);
    setError(null);
  }

  /** I / O and the lane: a range of the film. The in-point keeps a drawing already made. */
  const setRange = useCallback(
    (from: number, to: number | null) => {
      const start = Math.max(0, Math.round(Math.min(from, to ?? from)));
      const end = to == null ? null : Math.round(Math.max(from, to));
      setMark((m) => ({
        atMs: start,
        endMs: end != null && end - start >= 100 ? end : null,
        x: m?.x ?? null,
        y: m?.y ?? null,
        strokes: m?.strokes ?? null,
      }));
      setError(null);
    },
    [],
  );

  const msAtLane = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || durationMs <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width) * durationMs;
  };

  function startDrawing() {
    if (!canDraw) return;
    if (isVideo) {
      videoRef.current?.pause();
      setMark((m) => ({ atMs: m?.atMs ?? Math.round(currentMs), endMs: m?.endMs ?? null, x: m?.x ?? null, y: m?.y ?? null, strokes: m?.strokes ?? null }));
    }
    setSpotMode(false);
    ink.start(mark?.strokes ?? []);
    setError(null);
  }

  function finishDrawing() {
    const strokes = ink.finish();
    setMark((m) => {
      const base: Mark = m ?? { atMs: isVideo ? Math.round(currentMs) : null, x: null, y: null };
      return { ...base, strokes: strokes.length ? strokes : null };
    });
    textRef.current?.focus();
  }

  function onFrameClick(event: MouseEvent<HTMLDivElement>) {
    if (ink.active) return;
    if (spotMode && canComment) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = round4(clamp01((event.clientX - rect.left) / rect.width));
      const y = round4(clamp01((event.clientY - rect.top) / rect.height));
      setMark((m) => ({ ...(m ?? {}), atMs: isVideo ? (m?.atMs ?? Math.round(currentMs)) : null, x, y }));
      setSpotMode(false);
      textRef.current?.focus();
      return;
    }
    if (isVideo) togglePlay();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input[type='text'], input[type='password'], select")) return;
    if (event.key === "Escape" && ink.active) {
      finishDrawing();
      return;
    }
    if (event.key === "Escape" && spotMode) {
      setSpotMode(false);
      return;
    }
    if (!isVideo || event.metaKey || event.ctrlKey || event.altKey) return;
    if (extended && canComment && (event.key === "i" || event.key === "I")) {
      event.preventDefault();
      videoRef.current?.pause();
      setRange(currentMs, null);
      return;
    }
    if (extended && canComment && (event.key === "o" || event.key === "O")) {
      event.preventDefault();
      videoRef.current?.pause();
      const from = mark?.atMs ?? 0;
      if (currentMs > from) setRange(from, currentMs);
      return;
    }
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
      case ",":
      case ".":
        if (!extended || onRange) return;
        event.preventDefault();
        step(event.key === "," ? -1 : 1);
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
    if (guest && !guest.name.trim()) {
      setError(copy.guest.nameNeeded);
      return;
    }
    const pending = ink.active ? ink.finish() : null;
    const strokes = pending && pending.length ? pending : (mark?.strokes ?? null);
    const note: ReviewNoteInput = { body, atMs: mark?.atMs ?? null, x: mark?.x ?? null, y: mark?.y ?? null };
    if (extended) {
      note.endMs = mark?.endMs ?? null;
      note.strokes = strokes;
      // A drawing on a film belongs to the frame it was drawn on.
      if (strokes && isVideo && note.atMs == null) note.atMs = Math.round(currentMs);
    }
    const ok = await run("send", () => actions.addComment(note));
    if (ok) {
      setDraft("");
      setMark(null);
      setSpotMode(false);
      ink.reset();
    }
  }

  async function sendReply(rootId: string) {
    const body = replyDraft.trim();
    if (!body || busy) return;
    if (guest && !guest.name.trim()) {
      setError(copy.guest.nameNeeded);
      return;
    }
    const ok = await run(`reply:${rootId}`, () => actions.addComment({ body, parentId: rootId }));
    if (ok) {
      setReplyDraft("");
      setReplyTo(null);
    }
  }

  async function copyLink() {
    if (!linkFor) return;
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

  const setStatus = actions.setStatus;
  const resolveComment = canManage ? actions.resolveComment : undefined;
  const activeStrokes =
    activeThread && !activeThread.root.deleted && activeThread.root.strokes && !playing && (!isVideo || activeThread.root.atMs == null || Math.abs(activeThread.root.atMs - currentMs) <= 400)
      ? activeThread.root.strokes
      : null;
  const spans = extended ? timed.filter((t) => t.root.endMs != null) : [];

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
          {stack && (
            <div className="bsv-versions" data-review-versions>
              <label className="bsv-visually-hidden" htmlFor={`bsv-version-${review.id}`}>
                {copy.versions.label}
              </label>
              <select
                id={`bsv-version-${review.id}`}
                className="bsv-version-select"
                value={review.id}
                onChange={(e) => onVersion?.(e.target.value)}
                disabled={!onVersion}
              >
                {stack.map((v) => (
                  <option key={v.id} value={v.id}>
                    {`v${v.version} · ${copy.status[v.status]}`}
                  </option>
                ))}
              </select>
              <button type="button" className="bsv-pill" aria-pressed={comparing} onClick={() => setComparing((c) => !c)} data-review-compare-open>
                <Icon d={ICONS.compare} />
                {comparing ? copy.versions.closeCompare : copy.versions.compare}
              </button>
            </div>
          )}
          <span className="bsv-status" data-state={review.status}>
            <span className="bsv-visually-hidden">{copy.statusLabel}: </span>
            {copy.status[review.status]}
          </span>
          {canManage &&
            setStatus &&
            nextStatuses(review.status).map((s) => (
              <button
                key={s}
                type="button"
                className="bsv-pill"
                data-review-status-action={s}
                disabled={busy !== null}
                onClick={() => void run(`status:${s}`, () => setStatus(s))}
              >
                {s === "approved" && <Icon d={ICONS.check} />}
                {copy.statusActions[s]}
              </button>
            ))}
          {linkFor && (
            <button type="button" className="bsv-pill" onClick={() => void copyLink()} data-review-copy-link>
              <Icon d={ICONS.link} />
              {copy.copyLink}
            </button>
          )}
          {downloadUrl && (
            <a className="bsv-pill" href={downloadUrl} download rel="noreferrer" data-review-download>
              <Icon d={ICONS.download} />
              {copy.download}
            </a>
          )}
          {tools}
        </div>
      </header>

      {comparing && stack ? (
        <CompareView versions={stack} currentId={review.id} copy={copy} onClose={() => setComparing(false)} />
      ) : (
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
                {extended && (
                  <InkLayer
                    ratio={ratio}
                    ink={ink}
                    strokes={ink.active ? null : (mark?.strokes ?? activeStrokes)}
                    label={copy.draw.layer}
                    hint={copy.draw.hint}
                  />
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
                {extended && (
                  <select
                    className="bsv-version-select"
                    aria-label={copy.player.speed}
                    data-review-speed
                    value={String(speed)}
                    onChange={(e) => changeSpeed(Number(e.target.value))}
                    style={{ marginLeft: "auto", fontSize: 12, padding: "2px 8px", height: 28 }}
                  >
                    {[0.5, 1, 1.5, 2].map((rate) => (
                      <option key={rate} value={String(rate)}>
                        {`${rate}×`}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="bsv-icon-btn bsv-mute" onClick={() => setMuted((m) => !m)} aria-label={muted ? copy.player.unmute : copy.player.mute} aria-pressed={muted}>
                  <Icon d={muted ? ICONS.muted : ICONS.sound} />
                </button>
              </div>
              <div className="bsv-track">
                {extended && (
                  <div
                    ref={laneRef}
                    className="bsv-lane"
                    data-review-range-lane
                    role="group"
                    aria-label={copy.range.lane}
                    aria-describedby={`bsv-keys-${review.id}`}
                    data-active={dragRange ? "" : undefined}
                    onPointerDown={(e) => {
                      if (!canComment || durationMs <= 0 || e.button !== 0) return;
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                      videoRef.current?.pause();
                      const at = msAtLane(e.clientX);
                      setDragRange({ from: at, to: at });
                    }}
                    onPointerMove={(e) => {
                      if (!dragRange) return;
                      setDragRange({ from: dragRange.from, to: msAtLane(e.clientX) });
                    }}
                    onPointerUp={() => {
                      if (!dragRange) return;
                      const { from, to } = dragRange;
                      setDragRange(null);
                      if (Math.abs(to - from) < 100) {
                        seek(from);
                        setRange(from, null);
                      } else {
                        seek(Math.min(from, to));
                        setRange(from, to);
                      }
                    }}
                    onPointerCancel={() => setDragRange(null)}
                  >
                    {spans.map((t) => (
                      <button
                        key={t.root.id}
                        type="button"
                        className="bsv-span"
                        data-review-span={t.root.id}
                        data-role={t.root.authorRole}
                        data-resolved={t.root.resolved ? "" : undefined}
                        data-active={activeId === t.root.id ? "" : undefined}
                        style={{ left: pct(t.root.atMs ?? 0), width: `calc(${pct(t.root.endMs ?? 0)} - ${pct(t.root.atMs ?? 0)})` }}
                        aria-label={fill(copy.range.spanLabel, { start: formatTimecode(t.root.atMs), end: formatTimecode(t.root.endMs), text: t.root.body.slice(0, 80) })}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => focusThread(t)}
                      />
                    ))}
                    {(dragRange || mark?.endMs != null) && (
                      <span
                        className="bsv-span"
                        data-pending=""
                        aria-hidden="true"
                        style={
                          dragRange
                            ? { left: pct(Math.min(dragRange.from, dragRange.to)), width: `calc(${pct(Math.max(dragRange.from, dragRange.to))} - ${pct(Math.min(dragRange.from, dragRange.to))})` }
                            : { left: pct(mark?.atMs ?? 0), width: `calc(${pct(mark?.endMs ?? 0)} - ${pct(mark?.atMs ?? 0)})` }
                        }
                      />
                    )}
                    <span className="bsv-lane-label" aria-hidden="true">
                      {copy.range.lane}
                    </span>
                  </div>
                )}
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
                {extended && canComment ? ` ${copy.range.keys}` : ""}
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
              {(extended ? (["open", "resolved", "all"] as const) : (["open", "all"] as const)).map((f) => (
                <button key={f} type="button" className="bsv-seg-btn" aria-pressed={filter === f} onClick={() => setFilter(f)} data-review-filter={f}>
                  {copy.filter[f]}
                  {f === "open" && <span className="bsv-seg-count">{openThreads.length}</span>}
                </button>
              ))}
            </div>
          </div>

          {extended && threads.some((t) => !t.root.deleted) ? (
            <div
              className="bsv-comments-tools"
              data-review-comments-tools
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "0 0 10px" }}
            >
              <button
                type="button"
                className="bsv-pill"
                aria-pressed={drawingOnly}
                data-review-filter-drawing
                onClick={() => setDrawingOnly((v) => !v)}
                style={{ fontSize: 12, padding: "4px 10px" }}
              >
                {copy.filter.drawingOnly}
              </button>
              {authorOptions.length > 1 ? (
                <select
                  className="bsv-version-select"
                  aria-label={copy.filter.authorLabel}
                  data-review-filter-author
                  value={authorFilter}
                  onChange={(e) => setAuthorFilter(e.target.value)}
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  <option value="all">{copy.filter.authorAll}</option>
                  {authorOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : null}
              <div style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }} role="group" aria-label={copy.exportNotes.label}>
                {(["csv", "markdown", "markers"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className="bsv-pill"
                    data-review-export={fmt}
                    onClick={() => downloadExport(fmt)}
                    style={{ fontSize: 11, padding: "4px 8px" }}
                  >
                    {copy.exportNotes[fmt]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {shown.length === 0 && carriedGroups.length === 0 ? (
            <p className="bsv-quiet">{threads.length === 0 ? copy.noComments : copy.noOpen}</p>
          ) : (
            <div className="bsv-thread-scroll">
              {shown.length > 0 && <ol className="bsv-threads">{shown.map((t) => renderThread(t, false))}</ol>}
              {carriedGroups.map(([version, group]) => (
                <section key={version} className="bsv-carried" data-review-carried={version} aria-labelledby={`bsv-carried-${review.id}-${version}`}>
                  <h4 className="bsv-carried-title" id={`bsv-carried-${review.id}-${version}`}>
                    {fill(copy.carried.title, { version })}
                  </h4>
                  {resolveComment && <p className="bsv-carried-hint">{copy.carried.hint}</p>}
                  <ol className="bsv-threads">{group.map((t) => renderThread(t, true))}</ol>
                </section>
              ))}
            </div>
          )}

          {canComment ? (
            <form
              className="bsv-composer"
              data-review-composer
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {guest && (
                <div className="bsv-guest-name">
                  <label htmlFor={`bsv-guest-${review.id}`}>{copy.guest.nameLabel}</label>
                  <input
                    id={`bsv-guest-${review.id}`}
                    className="bsv-input"
                    type="text"
                    autoComplete="name"
                    maxLength={40}
                    value={guest.name}
                    placeholder={copy.guest.namePlaceholder}
                    onChange={(e) => guest.onName(e.target.value)}
                    data-review-guest-name
                  />
                </div>
              )}
              {(mark || ink.active) && (
                <div className="bsv-marks">
                  {mark?.atMs != null &&
                    (mark.endMs != null ? (
                      <span className="bsv-chip" data-review-range-chip>
                        {fill(copy.range.chip, { start: formatTimecode(mark.atMs), end: formatTimecode(mark.endMs) })}
                      </span>
                    ) : (
                      <span className="bsv-chip">{fill(copy.momentChip, { time: formatTimecode(mark.atMs) })}</span>
                    ))}
                  {mark?.x != null && <span className="bsv-chip">{copy.spotChip}</span>}
                  {(ink.active ? ink.strokes.length : (mark?.strokes?.length ?? 0)) > 0 && (
                    <span className="bsv-chip" data-review-drawing-chip>
                      {fill(copy.draw.chip, { count: ink.active ? ink.strokes.length : (mark?.strokes?.length ?? 0) })}
                    </span>
                  )}
                  <button
                    type="button"
                    className="bsv-icon-btn bsv-chip-clear"
                    onClick={() => {
                      setMark(null);
                      setSpotMode(false);
                      ink.reset();
                    }}
                    aria-label={copy.clearMark}
                  >
                    <Icon d={ICONS.close} />
                  </button>
                </div>
              )}
              {ink.active && <InkTools ink={ink} copy={copy.draw} onDone={finishDrawing} />}
              <label className="bsv-visually-hidden" htmlFor={`bsv-draft-${review.id}`}>
                {copy.composer.label}
              </label>
              <textarea
                id={`bsv-draft-${review.id}`}
                ref={textRef}
                className="bsv-input"
                rows={3}
                maxLength={guest ? 1000 : REVIEW_LIMITS.bodyMax}
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
                {canDraw && !ink.active && (
                  <button type="button" className="bsv-pill" onClick={startDrawing} data-review-draw>
                    <Icon d={ICONS.pen} />
                    {mark?.strokes?.length ? copy.draw.edit : copy.draw.open}
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
      )}
      <p className="bsv-toast" role="status" aria-live="polite" data-visible={toast ? "" : undefined}>
        {toast ?? ""}
      </p>
    </section>
  );

  function renderThread(t: ReviewThread, carried: boolean) {
    return (
      <li
        key={t.root.id}
        id={`bsv-thread-${t.root.id}`}
        className="bsv-thread"
        data-review-thread={t.root.id}
        data-carried={carried ? "" : undefined}
        data-active={activeId === t.root.id ? "" : undefined}
        data-resolved={t.root.resolved ? "" : undefined}
        onClick={(e) => {
          // A click on the note itself (not on one of its controls) brings the film to it;
          // the timecode button is the keyboard path to the same thing.
          if ((e.target as HTMLElement).closest("button, a, textarea, input, form")) return;
          if (!t.root.deleted) focusThread(t);
        }}
      >
        <CommentBody comment={t.root} number={numberOf.get(t.root.id) ?? 0} copy={copy} locale={locale} onSeek={() => focusThread(t)} />
        {!t.root.deleted && (canComment || canManage) && (
          <div className="bsv-thread-actions">
            {canComment && !carried && (
              <button type="button" className="bsv-text-btn" onClick={() => setReplyTo((v) => (v === t.root.id ? null : t.root.id))} aria-expanded={replyTo === t.root.id} aria-label={copy.replyLabel}>
                {copy.reply}
              </button>
            )}
            {resolveComment && (
              <button
                type="button"
                className="bsv-text-btn"
                data-review-resolve={t.root.id}
                disabled={busy !== null}
                onClick={() => void run(`resolve:${t.root.id}`, () => resolveComment(t.root.id))}
              >
                {t.root.resolved ? copy.reopenThread : copy.resolve}
              </button>
            )}
            {canComment && !carried && t.root.mine && actions.deleteComment && (
              <DeleteButton copy={copy} disabled={busy !== null} onConfirm={() => void run(`delete:${t.root.id}`, () => actions.deleteComment!(t.root.id))} />
            )}
          </div>
        )}
        {t.replies.length > 0 && (
          <ul className="bsv-replies">
            {t.replies.map((r) => (
              <li key={r.id} className="bsv-reply" data-review-reply={r.id}>
                <CommentBody comment={r} copy={copy} locale={locale} />
                {canComment && r.mine && actions.deleteComment && (
                  <div className="bsv-thread-actions">
                    <DeleteButton copy={copy} disabled={busy !== null} onConfirm={() => void run(`delete:${r.id}`, () => actions.deleteComment!(r.id))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canComment && !carried && replyTo === t.root.id && (
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
              maxLength={guest ? 1000 : REVIEW_LIMITS.bodyMax}
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
    );
  }
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
  const role = comment.guest ? "guest" : comment.authorRole;
  const timecode = comment.atMs == null ? "" : comment.endMs != null ? `${formatTimecode(comment.atMs)}–${formatTimecode(comment.endMs)}` : formatTimecode(comment.atMs);
  return (
    <article className="bsv-comment" data-role={role}>
      <header className="bsv-comment-head">
        {number ? (
          <span className="bsv-num" aria-hidden="true">
            {number}
          </span>
        ) : null}
        {!comment.deleted && (
          <>
            {comment.authorName && <span className="bsv-author">{comment.authorName}</span>}
            <span className="bsv-role" data-role={role}>
              {copy.roles[role]}
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
                <button type="button" className="bsv-timecode" onClick={onSeek} aria-label={fill(copy.seekTo, { time: timecode })} data-range={comment.endMs != null ? "" : undefined}>
                  {timecode}
                </button>
              ) : comment.x == null && !comment.strokes?.length ? (
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
              {comment.strokes?.length ? (
                <button type="button" className="bsv-spot-tag" onClick={onSeek} data-review-drawing-tag aria-label={copy.draw.show}>
                  <Icon d={ICONS.pen} />
                  {copy.draw.tag}
                </button>
              ) : null}
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
