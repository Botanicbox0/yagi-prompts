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
 *
 * Stage 2 (docs/BRAND-ROOMS-FEEDBACK.md §11): the wide layout fills the window's height, full screen holds
 * the player with its marks and the notes as a side panel, steps and timecodes use the film's real frame
 * rate (stored, else measured while it plays), a range loops, and the keys work anywhere in the stage.
 */
import "./review.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import {
  FALLBACK_FPS,
  estimateFps,
  formatFrameTimecode,
  frameAt,
  endsOnWholeSecond,
  frameSeekSeconds,
  frameStartMs,
  lastFrame,
  loopKeyOf,
  loopTarget,
  snapToFrameMs,
  stepFrame,
  type LoopRange,
} from "@/lib/brand-studio/review-frames";
import {
  REVIEW_FRAME_MS,
  REVIEW_LIMITS,
  formatTimecode,
  spotVisibleAt,
  threadComments,
  type ReviewComment,
  type ReviewItem,
  type ReviewStatus,
  type ReviewStroke,
  type ReviewThread,
  type ReviewVersion,
} from "@/lib/brand-studio/review-contracts";
import { corsMediaUrl } from "@/lib/brand-studio/cors-media-url";
import type { studioReviewEn } from "@/messages/studio-review";
import type { adminConsoleEn } from "@/messages/admin-console";
import { composerHolds } from "./auto-refresh";
import { CompareView } from "./compare";
import { accentControl, planHeader, planNotesTools, reviewShortcuts, type HeaderKey } from "./header-plan";
import { StageMenuButton, StagePopover, StageSelect, StageSwitch, useNarrow, type StageMenuEntry } from "./stage-menu";
import { ReviewTimeline } from "./timeline";
import { Timecode, fill, fillNodes } from "./timecode";

export { Timecode, fill, fillNodes };
import { InkLayer, InkTools, useInk } from "./ink";

export type ReviewCopy = typeof studioReviewEn;
/** The admin page's words for team notes (`adminConsole.reviewTeam`), never part of `ReviewCopy`. */
export type ReviewTeamCopy = (typeof adminConsoleEn)["reviewTeam"];
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
  /** The team's page only: keep this new note to the team (docs/BRAND-ROOMS-FEEDBACK.md §5). */
  team?: boolean;
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
  /** The share button of the room (a ghost button after the primary, docs/BRAND-ROOMS-FEEDBACK.md §11). */
  share?: ReactNode;
  /** The page's own actions that fold into the head's "⋯" menu (the room's "새 버전 올리기"). */
  moreActions?: ReadonlyArray<{ key: string; label: string; run(): void }>;
  /** A share link that allows download, or an approved cut in the room. */
  downloadUrl?: string | null;
  /** The file name to save as. With it, a file on another origin is fetched and saved instead of opened. */
  downloadName?: string | null;
  /**
   * The team's own page only (`AdminReviewStage`): the "팀만 보기" switch on the composer, the team-note tag
   * and background, and a visibility column in the export. Every other screen leaves it out; their data
   * never holds a team note, and if one ever arrived without this prop the stage would not show it.
   */
  team?: { copy: ReviewTeamCopy } | null;
  /**
   * Told whenever the composer starts or stops holding unsent work (text, an open or unsent drawing, a send
   * in flight), so a page that re-reads on its own can wait (`AdminReviewStage`, ./auto-refresh.ts).
   */
  onComposingChange?: (holding: boolean) => void;
  /**
   * The team's project desk shows the brand, the project and the draft above the stage: the stage keeps its
   * title only for assistive technology, and with a version switcher (which already names each version's
   * status) it drops the separate status mark. Every other screen leaves it out.
   */
  compactHead?: boolean;
  /**
   * `wide` (the room's review mode and the share page, docs/BRAND-ROOMS-FEEDBACK.md §11): the film takes the
   * height the window has, not the old two-thirds cap, so a 9:16 film fits by height. `inline` (default): as before.
   */
  layout?: "inline" | "wide";
}

/** Typing in a field: the stage's keys stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable || el.closest("textarea, select, [contenteditable]:not([contenteditable='false'])")) return true;
  const input = el.closest("input");
  if (!input) return false;
  return !["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"].includes((input.getAttribute("type") ?? "text").toLowerCase());
}

/** Note times land on the start of the frame on screen when the rate is known (stored or measured). */
export function snapNoteToFrames(note: ReviewNoteInput, fps: number | null): ReviewNoteInput {
  if (!fps) return note;
  const out = { ...note };
  if (out.atMs != null) out.atMs = snapToFrameMs(out.atMs, fps);
  if (out.endMs != null) {
    out.endMs = snapToFrameMs(out.endMs, fps);
    // A range never collapses onto its own start.
    if (out.atMs != null && out.endMs <= out.atMs) out.endMs = null;
  }
  return out;
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

/**
 * The notes as a file, built in the browser from the notes the screen holds. `team` (the team's page only)
 * marks team notes: a Visibility column in the CSV, `[team]` in the checklist and the markers. Without it a
 * team note is never written out, should one ever be in the list.
 */
export function exportReviewComments(
  reviewTitle: string,
  comments: readonly ReviewComment[],
  format: ReviewExportFormat,
  options: { team?: boolean } = {},
): { filename: string; mime: string; content: string } {
  const safeBase =
    reviewTitle
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "review";
  const withTeam = options.team === true;
  const listed = withTeam ? comments : comments.filter((c) => !c.team);
  const threads = threadComments(listed as ReviewComment[]).filter((t) => !t.root.deleted);
  const teamMark = (c: ReviewComment) => (withTeam && c.team ? "[team] " : "");

  if (format === "csv") {
    const header = ["#", "Timecode", "End", "Status", "Author", "Role", "Spot", "Drawing", ...(withTeam ? ["Visibility"] : []), "Comment"].join(",");
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
        ...(withTeam ? [t.root.team ? "team" : "public"] : []),
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
      lines.push(`- [${check}] **#${index + 1}** ${teamMark(t.root)}${time}(${author}): ${t.root.body.replace(/\s+/g, " ").trim()}`);
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
    return `${start}\t${end}\t#${index + 1} ${teamMark(t.root)}${author}\t${t.root.body.replace(/\s+/g, " ").trim()}`;
  });
  return { filename: `${safeBase}-markers.txt`, mime: "text/plain;charset=utf-8", content: `${markerLines.join("\n")}\n` };
}

export function reviewErrorText(copy: ReviewCopy, code: string): string {
  const known = copy.errors as Record<string, string>;
  return known[code] ?? copy.errors.generic;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** The tallest the media may be: the old cap inline, or the window minus the stage's own chrome when filling. */
export function fitHeightCap(viewportH: number, fill: boolean, reserve: number): number {
  return fill ? Math.max(200, viewportH - reserve) : Math.max(220, Math.min(760, viewportH * 0.66));
}

/**
 * A bar the page keeps over the bottom of the window (a phone's tab bar): the frame and its controls fit
 * above it instead of under it. Found by what sits at the bottom centre of the window.
 */
function bottomBarInset(): number {
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return 0;
  let el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 2) as HTMLElement | null;
  while (el && el !== document.body) {
    const position = getComputedStyle(el).position;
    if (position === "fixed" || position === "sticky") {
      const top = el.getBoundingClientRect().top;
      return top > window.innerHeight / 2 ? Math.max(0, Math.round(window.innerHeight - top)) : 0;
    }
    el = el.parentElement;
  }
  return 0;
}

/** The smallest the filled stage body gets (a short window): the notes column stays usable. */
export const MIN_FILL_BODY = 360;

/**
 * The height of the stage body in the wide two-column layout (docs/BRAND-ROOMS-FEEDBACK.md §11.7, 2026-11-19):
 * from the body's top to the bottom of the window, so the player (its mat, the frame, the controls) and the
 * notes column end on the same line and nothing is left empty under the controls.
 *   · `anchorTop`: where the anchor sits in the window once the page shows it (the room scrolls its review
 *     mode to its scroll margin; the studio and the share page show it where it is on the page);
 *   · `above`: from the anchor's top to the body's top (the back bar, the head, the paddings);
 *   · `bottomBar`: a bar the page keeps over the window's bottom (a phone's tab bar).
 * 32px under the body: the stage's own bottom padding and a little air.
 */
export function fillBodyHeight(input: { viewportH: number; anchorTop: number; above: number; bottomBar?: number }): number {
  return Math.max(MIN_FILL_BODY, Math.round(input.viewportH - Math.max(0, input.anchorTop) - Math.max(0, input.above) - 32 - (input.bottomBar ?? 0)));
}

/**
 * Fit a box of `ratio` into the wrapper's width and a height cap, so spot pins map 1:1 onto the media.
 * `fill` (wide layout, full screen): the cap is the window's height minus `reserve()` (the head, the
 * controls, the paddings), so the frame, its controls and the head fit in one view. `stretch` (the filled
 * two-column body, full screen): the wrapper is as tall as its mat and the cap is its own height, so the frame
 * takes the most of the mat both ways and sits in its middle.
 */
function useFitBox(ratio: number, fill: boolean, reserve: MutableRefObject<() => number>, layoutKey: string, stretch: boolean) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      const maxH = stretch ? Math.max(120, el.clientHeight) : fitHeightCap(window.innerHeight, fill, fill ? reserve.current() : 0);
      let w = avail;
      let h = w / ratio;
      if (h > maxH) {
        h = maxH;
        w = h * ratio;
      }
      const next = { w: Math.round(w), h: Math.round(h) };
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    // A second pass once the controls under the frame have laid out at their final size.
    const raf = typeof requestAnimationFrame === "undefined" ? 0 : requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ratio, fill, reserve, layoutKey, stretch]);
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
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  exitFullscreen: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  loop: "M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4",
  notes: "M4 5h16v14H4zM14 5v14",
  more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  help: "M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4M12 17.6h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  filter: "M4 6h16M7 12h10M10 18h4",
  export: "M12 4v11M7 10l5 5 5-5M5 20h14",
} as const;

type Mark = { atMs: number | null; endMs?: number | null; x: number | null; y: number | null; strokes?: ReviewStroke[] | null };
export type ReviewMark = Mark;

/**
 * A note on a film carries the moment it was written at unless the writer took the time off (`general`):
 * focusing or typing in the composer pins the playhead, keeping a drawing already made. A still has no time.
 */
export function stampMoment(mark: Mark | null, at: { isVideo: boolean; general: boolean; currentMs: number }): Mark | null {
  if (!at.isVideo || at.general || mark?.atMs != null) return mark;
  return { atMs: Math.max(0, Math.round(at.currentMs)), endMs: null, x: mark?.x ?? null, y: mark?.y ?? null, strokes: mark?.strokes ?? null };
}

/** The note `send()` posts. On a film the time is never dropped silently: no mark and not `general` means the playhead. */
export function composeNote(
  body: string,
  mark: Mark | null,
  at: { isVideo: boolean; general: boolean; extended: boolean; currentMs: number; strokes: ReviewStroke[] | null },
): ReviewNoteInput {
  const stamped = stampMoment(mark, at);
  const note: ReviewNoteInput = { body, atMs: at.isVideo ? (stamped?.atMs ?? null) : (mark?.atMs ?? null), x: mark?.x ?? null, y: mark?.y ?? null };
  if (at.extended) {
    note.endMs = mark?.endMs ?? null;
    note.strokes = at.strokes;
    // A drawing on a film belongs to the frame it was drawn on.
    if (at.strokes && at.isVideo && note.atMs == null) note.atMs = Math.round(at.currentMs);
  }
  return note;
}

/** "Spring film-v2.mp4": the review title made safe for a file name, the version and the media's extension. */
export function reviewDownloadName(title: string, version: number | null | undefined, mediaUrl: string): string {
  const base =
    title
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 80)
      .trim() || "review";
  let ext = "";
  try {
    const path = new URL(mediaUrl, "http://x").pathname;
    const hit = /\.([a-z0-9]{2,5})$/i.exec(path);
    if (hit) ext = `.${hit[1]!.toLowerCase()}`;
  } catch {
    // Keep no extension; the browser still names the file.
  }
  return `${base}${version ? `-v${version}` : ""}${ext}`;
}

/** Same-origin files save straight from the link; a file on the media domain is fetched (CORS) and saved as a blob. */
async function saveMedia(url: string, filename: string): Promise<void> {
  const response = await fetch(corsMediaUrl(url), { credentials: "omit" });
  if (!response.ok) throw new Error(`download ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function isCrossOrigin(url: string): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

export function ReviewStage({
  review,
  comments: allComments,
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
  share,
  moreActions,
  downloadUrl,
  downloadName,
  team = null,
  onComposingChange,
  compactHead = false,
  layout = "inline",
}: ReviewStageProps) {
  // Outside the team's page a team note is never shown, whatever the caller passed.
  const comments = useMemo(() => (team ? allComments : allComments.filter((c) => !c.team)), [team, allComments]);
  const [teamOnly, setTeamOnly] = useState(false);
  const isVideo = review.kind === "video";
  const media = review.mediaUrl;
  const videoRef = useRef<HTMLVideoElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  // Full screen holds the player, its marks and controls, and the notes as a side panel (shown on demand).
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // The film's frame rate: read from the file (0096), else measured while it plays; 24 until then for steps.
  const [measuredFps, setMeasuredFps] = useState<number | null>(null);
  const frameRate = isVideo ? (review.fps ?? measuredFps) : null;
  const stepRate = frameRate ?? FALLBACK_FPS;
  const tc = useCallback((ms: number | null | undefined) => (frameRate ? formatFrameTimecode(ms, frameRate) : formatTimecode(ms)), [frameRate]);
  // The loop runs on one range; picking another range or clearing it ends the loop.
  const [loopKey, setLoopKey] = useState<string | null>(null);
  const [ratio, setRatio] = useState(() => (review.width && review.height ? review.width / review.height : isVideo ? 16 / 9 : 1));
  const reserveRef = useRef<() => number>(() => 260);
  reserveRef.current = () => {
    const player = playerRef.current;
    const wrap = wrapRef.current;
    if (!player || !wrap) return 260;
    // Everything in the player column but the frame: the mat's padding, the controls, the keys line.
    const chrome = Math.max(0, player.offsetHeight - wrap.offsetHeight);
    // A narrow screen in full screen stacks the open notes under the picture: leave them about half.
    if (fullscreen) return chrome + 40 + (notesOpen && window.innerWidth <= 900 ? Math.round(window.innerHeight * 0.45) : 0);
    // Wide: everything from the top of what scrolls into view (the room's review mode, with its "시안 목록"
    // bar, or this stage) down to the frame, plus everything under it, plus the stage's bottom padding.
    const section = sectionRef.current;
    if (!section) return chrome + (headRef.current?.offsetHeight ?? 0) + 72;
    const anchor = section.closest("[data-room-review-mode]") ?? section;
    const above = wrap.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
    const below = player.getBoundingClientRect().bottom - wrap.getBoundingClientRect().bottom;
    return Math.max(0, above) + Math.max(0, below) + 32 + bottomBarInset();
  };
  const fillHeight = layout === "wide" || fullscreen;
  // From 1241px the notes sit beside the player (review.css); below that they go under it.
  const oneColumn = useNarrow(1240);
  const under900 = useNarrow(900);
  // The wide layout with the notes beside the player fills the window's height (fillBodyHeight).
  const fillBody = layout === "wide" && !oneColumn && !fullscreen;
  const [bodyHeight, setBodyHeight] = useState<number | null>(null);
  // The player's mat takes the column's height and the frame sits in its middle: the filled body, and full
  // screen unless a narrow screen stacks the open notes under the picture. The filled body starts at a CSS
  // estimate of its height (review.css) and takes the measured one a moment later, so the page is already
  // about as tall as it will be when the room scrolls review mode into view.
  const stretchPlayer = fillBody || (fullscreen && !(notesOpen && under900));
  const { wrapRef, box } = useFitBox(ratio, fillHeight, reserveRef, `${fullscreen}:${notesOpen}:${bodyHeight ?? 0}`, stretchPlayer);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [currentMs, setCurrentMs] = useState(isVideo ? Math.max(0, initialMs ?? 0) : 0);
  const [durationMs, setDurationMs] = useState(review.seconds ? Math.round(review.seconds * 1000) : 0);
  const [mark, setMark] = useState<Mark | null>(null);
  // The writer took the time off this note: it is about the whole film until sent or re-marked.
  const [general, setGeneral] = useState(false);
  const [spotMode, setSpotMode] = useState(false);
  const [comparing, setComparing] = useState(false);
  useLayoutEffect(() => {
    if (!fillBody || comparing) {
      setBodyHeight(null);
      return;
    }
    const measure = () => {
      const body = bodyRef.current;
      const section = sectionRef.current;
      if (!body || !section) return;
      // The room's review mode and the team desk's open version are scrolled to their scroll margin when they
      // open (`data-review-fit-scroll`); the studio's review page and the share page show the stage where it is.
      const room = section.closest<HTMLElement>("[data-room-review-mode], [data-review-fit-scroll]");
      const anchor = room ?? section.closest<HTMLElement>("[data-review-fit-anchor]") ?? section;
      const anchorRect = anchor.getBoundingClientRect();
      const anchorTop = room ? Number.parseFloat(getComputedStyle(room).scrollMarginTop) || 0 : anchorRect.top + window.scrollY;
      const above = body.getBoundingClientRect().top - anchorRect.top;
      const next = fillBodyHeight({ viewportH: window.innerHeight, anchorTop, above, bottomBar: bottomBarInset() });
      setBodyHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    window.addEventListener("resize", measure);
    // The head can wrap onto a second line (a long title): the body moves down and gets shorter.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (headRef.current) observer?.observe(headRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [fillBody, comparing]);
  // A row of the notes list under the pointer or keyboard focus: its marker on the timeline grows.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const narrow = useNarrow(520);
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
  const holding = composerHolds({ draft, replyDraft, drawing: ink.active, pendingStrokes: mark?.strokes?.length ?? 0, sending: busy !== null });
  useEffect(() => {
    onComposingChange?.(holding);
  }, [holding, onComposingChange]);

  // A different piece: start clean.
  useEffect(() => {
    setMark(null);
    setGeneral(false);
    setSpotMode(false);
    setReplyTo(null);
    setActiveId(null);
    setError(null);
    setPlaying(false);
    setRatio(review.width && review.height ? review.width / review.height : review.kind === "video" ? 16 / 9 : 1);
    setDurationMs(review.seconds ? Math.round(review.seconds * 1000) : 0);
    setComparing(false);
    setHoverId(null);
    setTeamOnly(false);
    setMeasuredFps(null);
    setLoopKey(null);
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

  // Read by the clock below on every frame: the range being looped (or null) and the known rate.
  const loopRef = useRef<LoopRange | null>(null);
  const rateRef = useRef<number | null>(null);
  rateRef.current = frameRate;
  const needsRate = isVideo && review.fps == null && measuredFps == null;

  /** Put the player on `ms`; with a known rate, on that frame's start plus the small bias that lands on it. */
  const placeAt = useCallback((v: HTMLVideoElement, ms: number) => {
    const rate = rateRef.current;
    v.currentTime = rate ? frameSeekSeconds(frameAt(ms, rate), rate) : ms / 1000;
  }, []);

  // The playhead follows the film while it plays: on every presented frame where the browser says which one
  // it is (requestVideoFrameCallback), else on every paint. The same clock measures the frame rate when none
  // was stored, and keeps a looping range inside its bounds.
  useEffect(() => {
    if (!playing) return;
    const v = videoRef.current;
    if (!v) return;
    let stopped = false;
    const gaps: number[] = [];
    let lastMedia: number | null = null;
    let measuring = needsRate;
    const onTime = (seconds: number) => {
      let ms = seconds * 1000;
      const target = loopTarget(ms, loopRef.current, rateRef.current);
      if (target != null) {
        placeAt(v, target);
        ms = target;
      }
      setCurrentMs(ms);
    };
    type FrameVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    const fv = v as FrameVideo;
    if (typeof fv.requestVideoFrameCallback === "function") {
      let handle = 0;
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (stopped) return;
        if (measuring && fv.playbackRate === 1 && lastMedia != null) {
          gaps.push(meta.mediaTime - lastMedia);
          if (gaps.length >= 12) {
            const rate = estimateFps(gaps);
            if (rate) {
              measuring = false;
              setMeasuredFps(rate);
            } else if (gaps.length > 120) measuring = false;
          }
        }
        lastMedia = meta.mediaTime;
        onTime(meta.mediaTime);
        handle = fv.requestVideoFrameCallback!(onFrame);
      };
      handle = fv.requestVideoFrameCallback(onFrame);
      return () => {
        stopped = true;
        fv.cancelVideoFrameCallback?.(handle);
      };
    }
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      onTime(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [playing, needsRate, placeAt]);

  // Full screen: whether this browser can put an element there (not iPhone Safari), and when it leaves.
  useEffect(() => {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null };
    setFullscreenAvailable(Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled));
    const onChange = () => {
      const on = bodyRef.current != null && (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) === bodyRef.current;
      setFullscreen(on);
      if (!on) setNotesOpen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
    const el = bodyRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    if (!el) return;
    try {
      if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
        void (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.());
      } else {
        const ask = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
        if (ask && typeof (ask as Promise<void>).catch === "function") (ask as Promise<void>).catch(() => undefined);
      }
    } catch {
      // A browser that refuses (no user gesture, a policy): the wide layout stays.
    }
  }, []);

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

  // The range a loop would run on: the one being marked (I / O, the lane) first, else the picked range note.
  const markRange: LoopRange | null = isVideo && mark?.atMs != null && mark.endMs != null ? { startMs: mark.atMs, endMs: mark.endMs } : null;
  const noteRange: LoopRange | null =
    isVideo && activeThread && !activeThread.root.deleted && activeThread.root.atMs != null && activeThread.root.endMs != null
      ? { startMs: activeThread.root.atMs, endMs: activeThread.root.endMs }
      : null;
  const loopRange = markRange ?? noteRange;
  const rangeKey = markRange ? loopKeyOf("mark", null, markRange) : loopKeyOf("note", activeThread?.root.id ?? null, noteRange);
  const looping = extended && loopKey !== null && loopKey === rangeKey;
  loopRef.current = looping ? loopRange : null;
  useEffect(() => {
    if (loopKey !== null && loopKey !== rangeKey) setLoopKey(null);
  }, [loopKey, rangeKey]);

  const seek = useCallback(
    (ms: number) => {
      const v = videoRef.current;
      const max = durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER;
      const next = Math.min(Math.max(0, ms), max);
      if (v) placeAt(v, next);
      setCurrentMs(next);
    },
    [durationMs, placeAt],
  );
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  /** R and the loop button: run the current range over and over, or stop. Starts from the range's start. */
  const toggleLoop = useCallback(() => {
    if (!rangeKey || !loopRange) return;
    if (looping) {
      setLoopKey(null);
      return;
    }
    setLoopKey(rangeKey);
    const v = videoRef.current;
    const at = v && Number.isFinite(v.currentTime) ? v.currentTime * 1000 : currentMs;
    if (at < loopRange.startMs || at >= loopRange.endMs) seek(loopRange.startMs);
  }, [rangeKey, loopRange, looping, currentMs, seek]);

  /** A double click on a range note's time: pick it and play it on a loop. */
  const loopThread = useCallback(
    (thread: ReviewThread) => {
      const { atMs, endMs } = thread.root;
      if (thread.root.deleted || atMs == null || endMs == null || !extended) return;
      setActiveId(thread.root.id);
      if (fullscreen) setNotesOpen(true);
      setLoopKey(loopKeyOf("note", thread.root.id, { startMs: atMs, endMs }));
      seek(atMs);
      void videoRef.current?.play().catch(() => undefined);
    },
    [extended, fullscreen, seek],
  );

  /** One real frame (the stored or measured rate, 24 until known), or `seconds` when given (J / L). */
  const step = useCallback(
    (direction: -1 | 1, seconds?: number) => {
      const v = videoRef.current;
      v?.pause();
      const from = v && Number.isFinite(v.currentTime) ? v.currentTime * 1000 : currentMs;
      if (seconds) {
        seek(Math.round(from + direction * seconds * 1000));
        return;
      }
      const frame = stepFrame(from, stepRate, direction, durationMs);
      const max = durationMs > 0 ? durationMs : Number.MAX_SAFE_INTEGER;
      const at = Math.min(frameSeekSeconds(frame, stepRate) * 1000, max);
      if (v) v.currentTime = at / 1000;
      setCurrentMs(at);
    },
    [currentMs, seek, stepRate, durationMs],
  );

  const focusThread = useCallback(
    (thread: ReviewThread) => {
      setActiveId(thread.root.id);
      // In full screen a note picked on the frame or the timeline shows in the side panel.
      if (fullscreen) setNotesOpen(true);
      if (isVideo && thread.root.atMs != null) {
        videoRef.current?.pause();
        seek(thread.root.atMs);
      }
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(`bsv-thread-${thread.root.id}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    },
    [isVideo, seek, fullscreen],
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
    const out = exportReviewComments(review.title, comments, format, { team: team != null });
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
        placeAt(v, initialMs);
        setCurrentMs(initialMs);
        const near = timed.find((t) => Math.abs((t.root.atMs ?? 0) - initialMs) <= 400);
        if (near) setActiveId(near.root.id);
      }
    }
  }

  /** Focus or first keystroke in the composer: a film stops and the note takes the moment on screen. */
  function pinMomentForDraft() {
    if (!isVideo || general || mark?.atMs != null) return;
    const v = videoRef.current;
    v?.pause();
    const at = v && Number.isFinite(v.currentTime) && v.currentTime > 0 ? v.currentTime * 1000 : currentMs;
    setMark((m) => stampMoment(m, { isVideo, general, currentMs: at }));
  }

  /** The chip's ×: this note is about the whole film. */
  function dropMoment() {
    setGeneral(true);
    setMark((m) => {
      if (!m) return null;
      const rest: Mark = { ...m, atMs: null, endMs: null };
      return rest.x == null && !(rest.strokes && rest.strokes.length) ? null : rest;
    });
    textRef.current?.focus();
  }

  function markMoment() {
    setGeneral(false);
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
      setGeneral(false);
      setError(null);
    },
    [],
  );

  function startDrawing() {
    if (!canDraw) return;
    setGeneral(false);
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

  /**
   * The stage's keys, wherever focus is inside the stage (the whole section takes focus on a click), except
   * while typing in a field, a select or editable text.
   */
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    // Typing, a dialog, or an open menu or popover (its own arrows and Escape): the stage's keys stay out.
    if (isTypingTarget(target) || target.closest("dialog, [role='menu'], [role='dialog']")) return;
    if (comparing) return;
    if (event.key === "Escape" && ink.active) {
      finishDrawing();
      return;
    }
    if (event.key === "Escape" && spotMode) {
      setSpotMode(false);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // The timeline's marker lane moves its own focus with the arrows; they never step the film from there.
    if (target.closest("[data-review-marker-lane]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (event.key === "?" && isVideo && media) {
      event.preventDefault();
      setShortcutsOpen((open) => !open);
      return;
    }
    if ((event.key === "f" || event.key === "F") && fullscreenAvailable && media && !comparing) {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (!isVideo) return;
    if (extended && (event.key === "r" || event.key === "R")) {
      if (!rangeKey) return;
      event.preventDefault();
      toggleLoop();
      return;
    }
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
        step(-1, 1);
        break;
      case "l":
      case "L":
        event.preventDefault();
        step(1, 1);
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
    const composed = snapNoteToFrames(composeNote(body, mark, { isVideo, general, extended, currentMs, strokes }), frameRate);
    const note = team && teamOnly ? { ...composed, team: true } : composed;
    const ok = await run("send", () => actions.addComment(note));
    if (ok) {
      setDraft("");
      setMark(null);
      setGeneral(false);
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
  // In full screen, starting a note (a range, a spot, the pen, typed text) brings the side panel out. The
  // bare moment the composer pins when it takes focus is not on its own a note being written.
  const composing = holding || ink.active || spotMode || (mark !== null && (mark.endMs != null || mark.x != null || (mark.strokes?.length ?? 0) > 0));
  useEffect(() => {
    if (fullscreen && composing) setNotesOpen(true);
  }, [fullscreen, composing]);

  const setStatus = actions.setStatus;
  const resolveComment = canManage ? actions.resolveComment : undefined;
  const activeStrokes =
    activeThread && !activeThread.root.deleted && activeThread.root.strokes && !playing && (!isVideo || activeThread.root.atMs == null || Math.abs(activeThread.root.atMs - currentMs) <= 400)
      ? activeThread.root.strokes
      : null;
  const roleOf = (c: ReviewComment) => {
    const role = c.guest ? "guest" : c.authorRole;
    return { role, label: copy.roles[role] };
  };
  // The timeline shows what the list shows (its filters), timed notes only, in time order.
  const laneNotes = shownAll
    .filter((t) => !t.root.deleted && t.root.atMs != null)
    .sort((a, b) => (a.root.atMs ?? 0) - (b.root.atMs ?? 0))
    .map((t) => ({ thread: t, number: numberOf.get(t.root.id) ?? 0 }));
  const header = planHeader({
    status: review.status,
    canSetStatus: Boolean(canManage && setStatus),
    team: team != null,
    hasLink: Boolean(linkFor),
    hasDownload: Boolean(downloadUrl),
    hasCompare: Boolean(stack),
    extra: (moreActions ?? []).map((a) => a.key),
    narrow,
  });
  const notesTools = planNotesTools({ extended, hasNotes: threads.some((t) => !t.root.deleted), authorCount: authorOptions.length });
  const accent = accentControl({ headPrimary: header.primary != null, composer: canComment });
  // The length as a timecode: the end of the last frame, so a stored length rounded to 0.1 s and the
  // browser's own length read the same (192 frames at 23.976 end at 0:08:00 either way).
  const lastFrameIndex = frameRate ? lastFrame(durationMs, frameRate) : null;
  const endOfFilm = frameRate && lastFrameIndex != null ? frameStartMs(lastFrameIndex + 1, frameRate) : durationMs;
  const statusChip = (
    <span className="bsv-status" data-state={review.status}>
      <span className="bsv-visually-hidden">{copy.statusLabel}: </span>
      {copy.status[review.status]}
    </span>
  );
  // The version switcher: the stage's own select (a button and a menu), not the browser's white list.
  const versionControl = stack ? (
    <div className="bsv-versions" data-review-versions>
      <StageSelect
        label={copy.versions.label}
        value={review.id}
        options={stack.map((v) => ({ value: v.id, label: `v${v.version} · ${copy.status[v.status]}` }))}
        onChange={(id) => onVersion?.(id)}
        disabled={!onVersion}
        size={compactHead ? "md" : "sm"}
        className="bsv-version-select"
        marker={{ "data-review-version-select": "" }}
      />
    </div>
  ) : null;

  function startDownload() {
    if (!downloadUrl) return;
    if (downloadName && isCrossOrigin(downloadUrl)) {
      saveMedia(downloadUrl, downloadName).catch(() => window.open(downloadUrl, "_blank", "noopener"));
      return;
    }
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = downloadName ?? "";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** One of the head's actions as a button: the one filled primary, or an outlined secondary. */
  function headerButton(key: HeaderKey, primary: boolean): ReactNode {
    if (key.startsWith("status:") && setStatus) {
      const status = key.slice("status:".length) as ReviewStatus;
      return (
        <button
          key={key}
          type="button"
          className={primary ? "bsv-primary" : "bsv-ghost"}
          data-review-status-action={status}
          data-primary={primary ? "" : undefined}
          disabled={busy !== null}
          onClick={() => void run(`status:${status}`, () => setStatus(status))}
        >
          {status === "approved" && <Icon d={ICONS.check} />}
          {copy.statusActions[status]}
        </button>
      );
    }
    if (key === "download" && downloadUrl) {
      return (
        <a
          key={key}
          className="bsv-ghost"
          href={downloadUrl}
          download={downloadName ?? true}
          rel="noreferrer"
          onClick={(event) => {
            // `download` is ignored on another origin (the media domain): fetch the file and save it under its name.
            if (!downloadName || !isCrossOrigin(downloadUrl)) return;
            event.preventDefault();
            startDownload();
          }}
          data-review-download
        >
          <Icon d={ICONS.download} />
          {copy.download}
        </a>
      );
    }
    return null;
  }

  /** One of the head's actions as an entry of the "⋯" menu. */
  function headerEntry(key: HeaderKey): StageMenuEntry {
    if (key.startsWith("status:")) {
      const status = key.slice("status:".length) as ReviewStatus;
      return { key, label: copy.statusActions[status], disabled: busy !== null || !setStatus, run: () => void (setStatus && run(`status:${status}`, () => setStatus(status))) };
    }
    if (key === "download") return { key, label: copy.download, run: startDownload };
    if (key === "copy-link") return { key, label: copy.copyLink, run: () => void copyLink() };
    if (key === "compare") return { key, label: comparing ? copy.versions.closeCompare : copy.versions.compare, run: () => setComparing((c) => !c) };
    const extra = (moreActions ?? []).find((a) => `extra:${a.key}` === key);
    return { key, label: extra?.label ?? key, run: () => extra?.run() };
  }

  const shortcutRows = reviewShortcuts(copy.player, { isVideo, extended, canComment, fullscreen: fullscreenAvailable });

  const fullscreenButton =
    fullscreenAvailable && media ? (
      <button
        type="button"
        className="bsv-icon-btn"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? copy.player.exitFullscreen : copy.player.fullscreen}
        title={`${fullscreen ? copy.player.exitFullscreen : copy.player.fullscreen} (F)`}
        data-review-fullscreen={fullscreen ? "on" : "off"}
      >
        <Icon d={fullscreen ? ICONS.exitFullscreen : ICONS.fullscreen} />
      </button>
    ) : null;
  const notesButton = fullscreen ? (
    <button
      type="button"
      className="bsv-icon-btn"
      onClick={() => setNotesOpen((open) => !open)}
      aria-label={notesOpen ? copy.player.notesHide : copy.player.notesShow}
      title={notesOpen ? copy.player.notesHide : copy.player.notesShow}
      aria-pressed={notesOpen}
      aria-controls={`bsv-notes-${review.id}`}
      data-review-notes-toggle
    >
      <Icon d={ICONS.notes} />
    </button>
  ) : null;

  return (
    <section
      ref={sectionRef}
      className="bsv-stage"
      data-review-stage={review.id}
      data-review-kind={review.kind}
      data-layout={layout}
      aria-labelledby={`bsv-title-${review.id}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="bsv-stage-head" ref={headRef}>
        <div className={compactHead ? "bsv-visually-hidden" : "bsv-stage-heading"} data-review-heading={compactHead ? "hidden" : undefined}>
          {onBack && (
            <button type="button" className="bsv-back" onClick={onBack}>
              <Icon d={ICONS.arrowLeft} />
              <span>{copy.back}</span>
            </button>
          )}
          {eyebrow && !compactHead && <p className="bsv-eyebrow">{eyebrow}</p>}
          <div className="bsv-title-row">
            <h2 className="bsv-stage-title" id={`bsv-title-${review.id}`} title={review.title}>
              {review.title}
            </h2>
            {/* With a version switcher (which names each version's status) the separate status mark would say it twice. */}
            {!compactHead && !stack && statusChip}
            {!compactHead && versionControl}
          </div>
        </div>
        <div className="bsv-stage-tools" data-review-status={review.status}>
          {compactHead && versionControl}
          {compactHead && !stack && statusChip}
          {header.secondary.map((key) => headerButton(key, false))}
          {tools}
          {header.primary && headerButton(header.primary, true)}
          {share}
          <StageMenuButton label={copy.more} icon={<Icon d={ICONS.more} />} entries={header.menu.map(headerEntry)} marker={{ "data-review-more": "" }} />
        </div>
      </header>

      {comparing && stack ? (
        <CompareView versions={stack} currentId={review.id} copy={copy} onClose={() => setComparing(false)} />
      ) : (
      <div
        className="bsv-stage-body"
        ref={bodyRef}
        data-fullscreen={fullscreen ? "" : undefined}
        data-notes-open={fullscreen && notesOpen ? "" : undefined}
        data-fill={fillBody ? "" : undefined}
        data-stretch={stretchPlayer ? "" : undefined}
        style={fillBody && bodyHeight != null ? ({ "--bsv-body-h": `${bodyHeight}px` } as CSSProperties) : undefined}
        data-review-body
      >
        <div className="bsv-player" ref={playerRef} data-review-player>
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
                    onEnded={() => {
                      // A range that runs to the very end loops from its start like any other.
                      const v = videoRef.current;
                      const range = loopRef.current;
                      if (v && range) {
                        placeAt(v, range.startMs);
                        setCurrentMs(range.startMs);
                        void v.play().catch(() => setPlaying(false));
                        return;
                      }
                      setPlaying(false);
                    }}
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

          {!isVideo && media && (fullscreenButton || notesButton) && (
            <div className="bsv-still-tools" data-review-still-tools>
              {notesButton}
              {fullscreenButton}
            </div>
          )}

          {isVideo && media && (
            <div className="bsv-controls" data-review-timeline>
              <ReviewTimeline
                reviewId={review.id}
                durationMs={durationMs}
                currentMs={currentMs}
                fps={frameRate}
                stepMs={frameRate ? 1000 / frameRate : REVIEW_FRAME_MS}
                notes={laneNotes}
                activeId={activeId}
                hoverId={hoverId}
                teamView={team != null}
                teamTag={team?.copy.tag ?? null}
                copy={copy}
                roleOf={roleOf}
                tc={tc}
                extended={extended}
                canComment={canComment}
                mark={mark}
                selectedRange={noteRange}
                onScrub={(ms) => {
                  videoRef.current?.pause();
                  seek(ms);
                }}
                onSelect={focusThread}
                onRange={setRange}
                onSeekTo={(ms) => {
                  videoRef.current?.pause();
                  seek(ms);
                }}
                onPause={() => videoRef.current?.pause()}
                onEscape={() => sectionRef.current?.focus({ preventScroll: true })}
              />
              <div className="bsv-transport">
                <button type="button" className="bsv-icon-btn" onClick={() => step(-1)} aria-label={copy.player.back} title={copy.player.back}>
                  <Icon d={ICONS.back} />
                </button>
                <button
                  type="button"
                  className="bsv-icon-btn bsv-play"
                  onClick={togglePlay}
                  aria-label={playing ? copy.player.pause : copy.player.play}
                  title={playing ? copy.player.pause : copy.player.play}
                  data-playing={playing ? "" : undefined}
                >
                  <Icon d={playing ? ICONS.pause : ICONS.play} filled />
                </button>
                <button type="button" className="bsv-icon-btn" onClick={() => step(1)} aria-label={copy.player.forward} title={copy.player.forward}>
                  <Icon d={ICONS.forward} />
                </button>
                <span className="bsv-time" aria-live="off" data-review-time>
                  <Timecode ms={currentMs} fps={frameRate} />{" "}
                  <span className="bsv-time-total">
                    / <Timecode ms={endOfFilm} fps={frameRate} clockOnly={frameRate != null && endsOnWholeSecond(endOfFilm, frameRate)} />
                  </span>
                </span>
                {frameRate ? (
                  <span className="bsv-fps" data-review-fps={frameRate}>
                    {`${frameRate} fps`}
                  </span>
                ) : null}
                <span className="bsv-transport-end">
                  {extended && (
                    <StageSelect
                      label={copy.player.speed}
                      value={String(speed)}
                      options={[0.5, 1, 1.5, 2].map((rate) => ({ value: String(rate), label: `${rate}×` }))}
                      onChange={(value) => changeSpeed(Number(value))}
                      className="bsv-speed"
                      marker={{ "data-review-speed": "" }}
                    />
                  )}
                  {extended && (
                    <button
                      type="button"
                      className="bsv-icon-btn"
                      onClick={toggleLoop}
                      disabled={!rangeKey}
                      aria-label={copy.player.loop}
                      title={`${copy.player.loop} (R)`}
                      aria-pressed={looping}
                      data-review-loop={looping ? "on" : rangeKey ? "off" : "none"}
                    >
                      <Icon d={ICONS.loop} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="bsv-icon-btn bsv-mute"
                    onClick={() => setMuted((m) => !m)}
                    aria-label={muted ? copy.player.unmute : copy.player.mute}
                    title={muted ? copy.player.unmute : copy.player.mute}
                    aria-pressed={muted}
                  >
                    <Icon d={muted ? ICONS.muted : ICONS.sound} />
                  </button>
                  {notesButton}
                  {fullscreenButton}
                  <StagePopover
                    label={copy.player.shortcuts}
                    icon={<Icon d={ICONS.help} />}
                    open={shortcutsOpen}
                    onOpenChange={setShortcutsOpen}
                    marker={{ "data-review-shortcuts": "" }}
                    wide
                  >
                    <p className="bsv-popover-title">{copy.player.shortcuts}</p>
                    <dl className="bsv-shortcuts" data-review-shortcut-list>
                      {shortcutRows.map(([keys, action]) => (
                        <div key={keys} className="bsv-shortcut">
                          <dt>
                            {keys.split(" ").map((k) => (
                              <kbd key={k}>{k}</kbd>
                            ))}
                          </dt>
                          <dd>{action}</dd>
                        </div>
                      ))}
                    </dl>
                  </StagePopover>
                </span>
              </div>
            </div>
          )}
        </div>

        <aside className="bsv-comments" id={`bsv-notes-${review.id}`} data-review-comments aria-label={copy.commentsTitle}>
          <div className="bsv-comments-head">
            <h3 className="bsv-comments-title">
              {copy.commentsTitle} <span className="bsv-count">{threads.filter((t) => !t.root.deleted).length}</span>
            </h3>
            <div className="bsv-tabs" role="group" aria-label={copy.filter.label}>
              {(extended ? (["open", "resolved", "all"] as const) : (["open", "all"] as const)).map((f) => (
                <button key={f} type="button" className="bsv-tab" aria-pressed={filter === f} onClick={() => setFilter(f)} data-review-filter={f}>
                  {copy.filter[f]}
                  {f === "open" && <span className="bsv-seg-count">{openThreads.length}</span>}
                </button>
              ))}
            </div>
            {notesTools.filter.length > 0 || notesTools.export.length > 0 ? (
              <span className="bsv-comments-tools" data-review-comments-tools>
                {notesTools.filter.length > 0 && (
                  <StagePopover
                    label={copy.filter.menu}
                    icon={<Icon d={ICONS.filter} />}
                    active={drawingOnly || authorFilter !== "all"}
                    marker={{ "data-review-filter-menu": "" }}
                  >
                    {notesTools.filter.includes("drawing") && (
                      <StageSwitch checked={drawingOnly} onChange={setDrawingOnly} marker={{ "data-review-filter-drawing": "" }}>
                        {copy.filter.drawingOnly}
                      </StageSwitch>
                    )}
                    {notesTools.filter.includes("author") && (
                      // The authors as a short list of choices inside the panel (no second popup on top of it).
                      <div className="bsv-field-row" role="radiogroup" aria-labelledby={`bsv-author-${review.id}`} data-review-filter-author>
                        <span className="bsv-popover-title" id={`bsv-author-${review.id}`}>
                          {copy.filter.authorLabel}
                        </span>
                        {[{ value: "all", label: copy.filter.authorAll }, ...authorOptions.map((name) => ({ value: name, label: name }))].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            className="bsv-option"
                            aria-checked={authorFilter === option.value}
                            onClick={() => setAuthorFilter(option.value)}
                            data-review-filter-author-option={option.value}
                          >
                            <svg className="bsv-icon bsv-menu-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                              <path d={ICONS.check} />
                            </svg>
                            <span>{option.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </StagePopover>
                )}
                <StageMenuButton
                  label={copy.exportNotes.label}
                  icon={<Icon d={ICONS.export} />}
                  entries={notesTools.export.map((fmt) => ({ key: fmt, label: copy.exportNotes[fmt], run: () => downloadExport(fmt) }))}
                  marker={{ "data-review-export-menu": "" }}
                />
              </span>
            ) : null}
          </div>

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
              data-team={team && teamOnly ? "" : undefined}
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
                        {fillNodes(copy.range.chip, { start: <Timecode ms={mark.atMs} fps={frameRate} />, end: <Timecode ms={mark.endMs} fps={frameRate} /> })}
                      </span>
                    ) : (
                      <span className="bsv-chip" data-review-moment-chip>
                        {fillNodes(copy.momentChip, { time: <Timecode ms={mark.atMs} fps={frameRate} /> })}
                        {isVideo && !ink.active && !(mark.strokes && mark.strokes.length) && (
                          <button type="button" className="bsv-chip-x" onClick={dropMoment} aria-label={copy.dropMoment} title={copy.dropMoment} data-review-moment-drop>
                            <Icon d={ICONS.close} />
                          </button>
                        )}
                      </span>
                    ))}
                  {mark?.x != null && <span className="bsv-chip">{copy.spotChip}</span>}
                  {(ink.active ? ink.strokes.length : (mark?.strokes?.length ?? 0)) > 0 && (
                    <span className="bsv-chip" data-review-drawing-chip>
                      {fill(copy.draw.chip, { count: ink.active ? ink.strokes.length : (mark?.strokes?.length ?? 0) })}
                    </span>
                  )}
                  {/* A bare moment has its own × on the chip; this one clears a range, a spot or a drawing. */}
                  {(!isVideo || ink.active || mark?.endMs != null || mark?.x != null || (mark?.strokes?.length ?? 0) > 0) && (
                  <button
                    type="button"
                    className="bsv-icon-btn bsv-chip-clear"
                    onClick={() => {
                      setMark(null);
                      // Cleared on a film: the note is about the whole film, not re-pinned on the next keystroke.
                      if (isVideo) setGeneral(true);
                      setSpotMode(false);
                      ink.reset();
                    }}
                    aria-label={copy.clearMark}
                  >
                    <Icon d={ICONS.close} />
                  </button>
                  )}
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
                onFocus={pinMomentForDraft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (e.target.value.trim()) pinMomentForDraft();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              {team && (
                <div className="bsv-team-switch-row">
                  <StageSwitch
                    checked={teamOnly}
                    onChange={setTeamOnly}
                    className="bsv-team-switch"
                    describedBy={teamOnly ? `bsv-team-hint-${review.id}` : undefined}
                    marker={{ "data-review-team-toggle": "true" }}
                  >
                    {team.copy.toggle}
                  </StageSwitch>
                  {/* Always laid out, shown only while on: switching never moves the switch (the composer sits at the column's foot). */}
                  <p className="bsv-team-hint" id={`bsv-team-hint-${review.id}`} data-shown={teamOnly ? "true" : "false"} aria-hidden={teamOnly ? undefined : true}>
                    {team.copy.hint}
                  </p>
                </div>
              )}
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
                {/* The view's one accent fill is its main act (header-plan `accentControl`): beside 승인하기 this is primary ink. */}
                <button
                  type="submit"
                  className="bsv-primary"
                  data-tone={accent === "composer" ? undefined : "neutral"}
                  data-review-send
                  disabled={!draft.trim() || busy !== null}
                >
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
        data-team={team && t.root.team ? "" : undefined}
        data-replying={replyTo === t.root.id ? "" : undefined}
        // The row under the pointer or keyboard focus lights its marker on the timeline.
        onPointerEnter={() => setHoverId(t.root.id)}
        onPointerLeave={() => setHoverId((h) => (h === t.root.id ? null : h))}
        onFocus={() => setHoverId(t.root.id)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHoverId((h) => (h === t.root.id ? null : h));
        }}
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
          onLoop={isVideo && extended ? () => loopThread(t) : undefined}
          teamTag={team && t.root.team ? team.copy.tag : null}
          tc={tc}
          fps={frameRate}
          tools={t.root.deleted ? null : rowTools(t, carried)}
        />
        {t.replies.length > 0 && (
          <ul className="bsv-replies">
            {t.replies.map((r) => (
              <li key={r.id} className="bsv-reply" data-review-reply={r.id}>
                <CommentBody comment={r} copy={copy} locale={locale} tc={tc} fps={frameRate} tools={replyTools(r)} />
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

  /** Delete one's own note or reply: the same confirm as before, then the same call. */
  function confirmDelete(commentId: string) {
    if (!actions.deleteComment) return;
    if (typeof window !== "undefined" && !window.confirm(copy.deleteConfirm)) return;
    void run(`delete:${commentId}`, () => actions.deleteComment!(commentId));
  }

  /**
   * A note's own controls (2026-11-19): 답글 is the one visible action (on hover, focus or selection; always on a
   * touch screen), and "⋯" opens the stage's menu with 해결 (or 다시 열기) and 삭제. Neither of those two sits in
   * the row, so a click aimed at the row selects the note and never resolves or deletes it. Tab reaches 답글,
   * then "⋯"; the menu takes the arrows and Escape.
   */
  function rowTools(t: ReviewThread, carried: boolean): ReactNode {
    const canReply = canComment && !carried;
    const entries: StageMenuEntry[] = [];
    if (resolveComment) {
      entries.push({
        key: "resolve",
        label: t.root.resolved ? copy.reopenThread : copy.resolve,
        disabled: busy !== null,
        run: () => void run(`resolve:${t.root.id}`, () => resolveComment(t.root.id)),
      });
    }
    if (canComment && !carried && t.root.mine && actions.deleteComment) {
      entries.push({ key: "delete", label: copy.deleteComment, disabled: busy !== null, run: () => confirmDelete(t.root.id) });
    }
    if (!canReply && entries.length === 0) return null;
    return (
      <span className="bsv-row-actions" data-review-row-actions={t.root.id}>
        {canReply && (
          <button
            type="button"
            className="bsv-text-btn"
            onClick={() => setReplyTo((v) => (v === t.root.id ? null : t.root.id))}
            aria-expanded={replyTo === t.root.id}
            aria-label={copy.replyLabel}
            data-review-reply-open={t.root.id}
          >
            {copy.reply}
          </button>
        )}
        {entries.length > 0 && (
          <StageMenuButton label={copy.more} icon={<Icon d={ICONS.more} />} entries={entries} className="bsv-icon-btn bsv-row-more" marker={{ "data-review-row-more": t.root.id }} />
        )}
      </span>
    );
  }

  /** A reply's controls: only one's own reply has any, and its 삭제 sits in the "⋯" menu too. */
  function replyTools(r: ReviewComment): ReactNode {
    if (r.deleted || !canComment || !r.mine || !actions.deleteComment) return null;
    return (
      <span className="bsv-row-actions" data-review-row-actions={r.id}>
        <StageMenuButton
          label={copy.more}
          icon={<Icon d={ICONS.more} />}
          entries={[{ key: "delete", label: copy.deleteComment, disabled: busy !== null, run: () => confirmDelete(r.id) }]}
          className="bsv-icon-btn bsv-row-more"
          marker={{ "data-review-row-more": r.id }}
        />
      </span>
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
  onLoop,
  teamTag = null,
  tc = formatTimecode,
  fps = null,
  tools = null,
}: {
  comment: ReviewComment;
  number?: number;
  copy: ReviewCopy;
  locale: "ko" | "en";
  /** Thread heads only: the moment (or spot) is a button that brings the film or the pin to it. */
  onSeek?: () => void;
  /** A range note on the room stage: a double click on its time plays the range on a loop. */
  onLoop?: () => void;
  /** The team's page only: the "팀 메모" tag on a team note's thread head. */
  teamTag?: string | null;
  /** The stage's timecode as text (labels): `m:ss:ff` once the frame rate is known, `m:ss.t` before. */
  tc?: (ms: number | null | undefined) => string;
  /** The frame rate, for the timecode drawn on the chip (`Timecode`). */
  fps?: number | null;
  /**
   * The row's controls (답글 · "⋯"). A thread head keeps them at the end of its time line, a reply at the end of
   * its name line: their place is always laid out, so showing them never moves the row.
   */
  tools?: ReactNode;
}) {
  const role = comment.guest ? "guest" : comment.authorRole;
  const timecode = comment.atMs == null ? "" : comment.endMs != null ? `${tc(comment.atMs)}–${tc(comment.endMs)}` : tc(comment.atMs);
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
            {teamTag && (
              <span className="bsv-team-tag" data-review-team-tag>
                {teamTag}
              </span>
            )}
          </>
        )}
        <time className="bsv-when" dateTime={comment.createdAt}>
          {stamp(comment.createdAt, locale)}
        </time>
        {!onSeek && tools}
      </header>
      {comment.deleted ? (
        <p className="bsv-body bsv-quiet">{copy.deletedComment}</p>
      ) : (
        <>
          {onSeek && (
            <div className="bsv-meta">
              {comment.atMs != null ? (
                <button
                  type="button"
                  className="bsv-timecode"
                  onClick={onSeek}
                  onDoubleClick={comment.endMs != null ? onLoop : undefined}
                  aria-label={fill(copy.seekTo, { time: timecode })}
                  data-range={comment.endMs != null ? "" : undefined}
                >
                  <Timecode ms={comment.atMs} fps={fps} />
                  {comment.endMs != null ? (
                    <>
                      –<Timecode ms={comment.endMs} fps={fps} />
                    </>
                  ) : null}
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
              {tools}
            </div>
          )}
          <p className="bsv-body">{comment.body}</p>
        </>
      )}
    </article>
  );
}

