"use client";
/**
 * The review timeline (docs/BRAND-ROOMS-FEEDBACK.md §11): one scrub bar with a thin marker lane under it.
 *
 *   · The bar is 4px (6px while hovered or dragged), the played part in the primary ink. Its thumb shows on
 *     hover, drag and focus; a small time tip follows the pointer. Underneath it is the native range input
 *     (invisible), so the keyboard and the seek logic stay what they were.
 *   · While there is room the lane carries one quiet dot per note (8px, at least a 24px target): a client's or
 *     guest's note is a filled neutral dot, the YAGI team's a ring of the same colour, a team-only note a dashed
 *     ring. No numbers on the lane; numbers live in the notes list. Dots closer than their 24px target become one
 *     count pill (2026-11-19; it was 14px, and neighbouring targets overlapped).
 *   · A range is its start dot at rest. Its line (2px) shows for the selected note and the note under the
 *     pointer or keyboard (the dot, its card, its row in the list), never under a range being drawn.
 *   · When the lane is crowded (`planLane`: under 30px per note, 40 on a phone, or a pill that would stand for a
 *     long run) it folds into evenly spaced stretches drawn as a quiet strip of short bars, taller for more
 *     notes. A stretch of one note acts as its dot; a stretch of several, like a pill, opens their list.
 *   · Pills and stretches show their list on hover (a short pause, then it stays while the pointer moves into
 *     it), and pin it on a click, a tap, Enter or Space. A row under the pointer lights its note on the lane.
 *   · Hover, focus or a tap on a dot opens a small card above it (author, time, two lines, replies); a click,
 *     Enter or the second tap selects the note in the list and brings the film to it.
 *   · The accent marks only what is being added right now: a range being drawn (its line and two handles) or a
 *     moment being marked. The selected note is primary ink (its dot, its line, a wash on the bar), so it never
 *     competes with the view's one accent-filled action (docs/design/TASTE.md 18).
 *   · The lane is one tab stop: ←/→/Home/End move between its stops in time order (they never step the film
 *     here), Enter/Space opens, Escape goes back to the stage.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ReviewComment, ReviewThread } from "@/lib/brand-studio/review-contracts";
import type { LoopRange } from "@/lib/brand-studio/review-frames";
import { moveFocus } from "../gallery/menu";
import { useNarrow } from "./stage-menu";
import { firstWords, laneX, markerKind, markerPress, nextStop, planLane, playheadOn, rangeLinesShown, stretchLevel, type LaneGroup, type LaneStretch } from "./timeline-model";
import { Timecode, fill } from "./timecode";
import type { ReviewCopy } from "./stage";

export interface TimelineNote {
  thread: ReviewThread;
  /** The number the notes list shows for it. */
  number: number;
}

export interface ReviewTimelineProps {
  reviewId: string;
  durationMs: number;
  currentMs: number;
  fps: number | null;
  /** Step of the native input (one frame, or the old fixed step without a rate). */
  stepMs: number;
  /** Timed notes the list currently shows, in time order. */
  notes: readonly TimelineNote[];
  activeId: string | null;
  /** A row of the notes list under the pointer or focus. */
  hoverId: string | null;
  teamView: boolean;
  /** The team page's tag for a team-only note (named in the card and the marker's spoken name). */
  teamTag?: string | null;
  copy: ReviewCopy;
  /** The role badge's words for a note. */
  roleOf: (comment: ReviewComment) => { role: string; label: string };
  tc: (ms: number | null | undefined) => string;
  extended: boolean;
  canComment: boolean;
  /** The range (or moment) being written, if any. */
  mark: { atMs: number | null; endMs?: number | null } | null;
  /** The selected range note: a wash on the bar. */
  selectedRange: LoopRange | null;
  onScrub(ms: number): void;
  onSelect(thread: ReviewThread): void;
  onRange(from: number, to: number | null): void;
  onSeekTo(ms: number): void;
  onPause(): void;
  onEscape(): void;
}

type Drag = { mode: "new" | "start" | "end"; from: number; to: number };

const pctOf = (ms: number, durationMs: number) => (durationMs > 0 ? `${Math.min(100, Math.max(0, (ms / durationMs) * 100))}%` : "0%");
/** A stretch's segment: as wide as its stretch less a 3px gap to the next one (24px at least, the target). */
const segmentWidth = (group: LaneGroup) => {
  const s = group as Partial<LaneStretch>;
  return s.from != null && s.to != null ? Math.max(24, Math.round(s.to - s.from - 3)) : 24;
};
/** A short pause before a pill's or a stretch's list opens on hover, so a pointer passing over does not flash it. */
const HOVER_OPEN_MS = 140;
/** How long a hover-opened list waits for the pointer to reach it (or come back) before it closes. */
const HOVER_CLOSE_MS = 220;

export function ReviewTimeline(props: ReviewTimelineProps) {
  const { durationMs, currentMs, fps, notes, activeId, hoverId, teamView, copy, extended, canComment, mark } = props;
  const laneRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [stop, setStop] = useState(0);
  const [card, setCard] = useState<{ id: string; pinned: boolean } | null>(null);
  // An open list of a pill or a stretch: `pinned` once clicked, tapped or opened from the keyboard.
  const [cluster, setCluster] = useState<{ index: number; pinned: boolean } | null>(null);
  // A row of an open list under the pointer or focus: its note lights on the lane.
  const [rowHover, setRowHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; ms: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const touch = useRef(false);
  const cardShowing = useRef(false);
  const hoverTimer = useRef<number | null>(null);

  // The lane's width decides the clusters and the stretches: measure it, and again whenever it changes.
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);
  useEffect(() => () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
  }, []);

  // The same breakpoint where review.css gives a marker its 28px target.
  const narrow = useNarrow(520);
  const byId = useMemo(() => new Map(notes.map((n) => [n.thread.root.id, n])), [notes]);
  const plan = useMemo(
    () => planLane(notes.map((n) => ({ id: n.thread.root.id, x: laneX(n.thread.root.atMs ?? 0, durationMs, width || 1) })), width, narrow),
    [notes, durationMs, width, narrow],
  );
  const groups = plan.groups;
  const stretched = plan.mode === "stretches";
  const stopCount = groups.length;
  const safeStop = Math.min(stop, Math.max(0, stopCount - 1));
  // A different set of stops (a resize, a filter, a new note): an open list would point at another stretch.
  const stopsKey = `${plan.mode}:${groups.map((g) => g.ids.join(",")).join("|")}`;
  useEffect(() => {
    setCluster(null);
  }, [stopsKey]);

  const msAt = useCallback(
    (clientX: number, el: HTMLElement | null) => {
      const rect = el?.getBoundingClientRect();
      if (!rect || !rect.width || durationMs <= 0) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs;
    },
    [durationMs],
  );

  // A pinned card (a tap, or keyboard focus) or an open list closes on a press anywhere else.
  useEffect(() => {
    if (!card?.pinned && cluster == null) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && laneRef.current?.contains(event.target)) return;
      setCard(null);
      setCluster(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [card?.pinned, cluster]);

  const clearHover = () => {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  /** The pointer rests on a pill or a stretch: its list opens after a short pause (at once if another is open). */
  const hoverOpen = (index: number) => {
    clearHover();
    hoverTimer.current = window.setTimeout(
      () => setCluster((c) => (c?.pinned ? c : { index, pinned: false })),
      cluster && !cluster.pinned ? 0 : HOVER_OPEN_MS,
    );
  };
  /** The pointer left a pill, a stretch or the list: a hover-opened list closes unless it comes back in time. */
  const hoverClose = () => {
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      setCluster((c) => (c && !c.pinned ? null : c));
      setRowHover(null);
    }, HOVER_CLOSE_MS);
  };

  const stops = () => Array.from(laneRef.current?.querySelectorAll<HTMLElement>("[data-lane-stop]") ?? []);
  const focusStop = (index: number) => {
    setStop(index);
    stops()[index]?.focus({ preventScroll: true });
  };

  function onLaneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-cluster-list]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (card || cluster != null) {
        setCard(null);
        setCluster(null);
        return;
      }
      props.onEscape();
      return;
    }
    const next = nextStop(stopCount, safeStop, event.key);
    if (next == null) return;
    // Arrows move between markers here; they never step the film while the lane has focus.
    event.preventDefault();
    event.stopPropagation();
    setCluster(null);
    focusStop(next);
  }

  /* --- the lane's own drag: a new range from an empty spot, or a handle of the range being written --- */
  function startDrag(event: ReactPointerEvent<HTMLElement>, mode: Drag["mode"]) {
    if (!extended || !canComment || durationMs <= 0 || event.button !== 0) return;
    const lane = laneRef.current;
    if (!lane) return;
    lane.setPointerCapture?.(event.pointerId);
    props.onPause();
    const at = msAt(event.clientX, lane);
    if (mode === "new") setDrag({ mode, from: at, to: at });
    else setDrag({ mode, from: mark?.atMs ?? at, to: mark?.endMs ?? at });
  }
  function onLanePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-lane-stop], [data-lane-handle], [data-cluster-list], [data-marker-card]")) return;
    startDrag(event, "new");
  }
  function onLanePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const at = msAt(event.clientX, laneRef.current);
    if (drag.mode === "new") setDrag({ ...drag, to: at });
    else if (drag.mode === "start") props.onRange(at, drag.to);
    else props.onRange(drag.from, at);
  }
  function onLanePointerUp() {
    if (!drag) return;
    const { mode, from, to } = drag;
    setDrag(null);
    if (mode !== "new") return;
    if (Math.abs(to - from) < 100) {
      props.onSeekTo(from);
      props.onRange(from, null);
    } else {
      props.onSeekTo(Math.min(from, to));
      props.onRange(from, to);
    }
  }

  const pendingRange =
    drag?.mode === "new"
      ? { start: Math.min(drag.from, drag.to), end: Math.max(drag.from, drag.to), handles: false }
      : mark?.atMs != null && mark.endMs != null
        ? { start: mark.atMs, end: mark.endMs, handles: true }
        : null;
  const drawing = pendingRange !== null;
  const lit = [hoverId, card?.id ?? null, rowHover];
  const rangeNotes = notes.filter((n) => n.thread.root.endMs != null);
  const linesShown = rangeLinesShown({ rangeIds: rangeNotes.map((n) => n.thread.root.id), activeId, lit, drawing });
  // Notes the lane does not draw as their own dot (inside a pill or a stretch) get a small dot at their real
  // time while they are selected or lit, so the eye finds the moment the card or the row talks about.
  const drawnAlone = useMemo(() => new Set(stretched ? [] : groups.filter((g) => g.ids.length === 1).map((g) => g.ids[0]!)), [groups, stretched]);
  const pointDots = [...new Set([activeId, ...lit])].filter((id): id is string => Boolean(id && byId.has(id) && !drawnAlone.has(id)));
  const cardNote = card ? byId.get(card.id) ?? null : null;
  const cardWidth = Math.min(280, Math.max(160, width - 8));
  const placeCard = (x: number) => Math.min(Math.max(0, width - cardWidth), Math.max(0, x - cardWidth / 2));

  function select(thread: ReviewThread) {
    props.onSelect(thread);
  }

  /** What a single note's stop does (a dot, or a stretch holding one note): card on hover and focus, select on press. */
  function noteStopProps(n: TimelineNote, index: number) {
    const t = n.thread;
    const id = t.root.id;
    const role = props.roleOf(t.root);
    const time = t.root.endMs != null ? fill(copy.range.spanLabel, { start: props.tc(t.root.atMs), end: props.tc(t.root.endMs), text: firstWords(t.root.body) }) : fill(copy.pinLabel, { time: props.tc(t.root.atMs), text: firstWords(t.root.body) });
    const author = t.root.authorName ?? role.label;
    const tag = teamView && t.root.team && props.teamTag ? `${props.teamTag}, ` : "";
    return {
      type: "button" as const,
      "data-lane-stop": "",
      "data-review-pin": id,
      "data-kind": markerKind(t, teamView),
      "data-resolved": t.root.resolved ? "" : undefined,
      "data-active": activeId === id ? "" : undefined,
      "data-hover": lit.includes(id) ? "" : undefined,
      "data-on": playheadOn(t.root, currentMs, fps) ? "" : undefined,
      tabIndex: index === safeStop ? 0 : -1,
      "aria-label": `${author}, ${tag}${time}`,
      "aria-describedby": card?.id === id ? `bsv-marker-card-${props.reviewId}` : undefined,
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        touch.current = e.pointerType === "touch";
        // Before the focus a tap brings, which shows the card too.
        cardShowing.current = card?.id === id;
      },
      onPointerEnter: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType !== "mouse") return;
        clearHover();
        setCluster((c) => (c?.pinned ? c : null));
        setCard((c) => (c?.pinned ? c : { id, pinned: false }));
      },
      onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse") setCard((c) => (c && !c.pinned && c.id === id ? null : c));
      },
      onFocus: () => {
        setStop(index);
        setCard({ id, pinned: true });
      },
      onBlur: () => setCard((c) => (c?.id === id && !touch.current ? null : c)),
      onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
        setCluster(null);
        if (touch.current) setCard({ id, pinned: true });
        if (markerPress({ touch: touch.current, keyboard: e.detail === 0, cardShowing: cardShowing.current }) === "card") return;
        select(t);
      },
    };
  }

  /** The short list a pill or a stretch opens: one row per note (time, author, first line). */
  function groupList(group: LaneGroup, index: number, members: TimelineNote[], label: string, pinned: boolean) {
    return (
      <div
        className="bsv-cluster-list"
        data-cluster-list
        role="menu"
        aria-label={label}
        style={{ left: `${placeCard(group.x) - group.x}px`, width: `${cardWidth}px` }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") clearHover();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hoverClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setCluster(null);
            setRowHover(null);
            focusStop(index);
            return;
          }
          moveFocus(e);
        }}
        ref={(el) => {
          // Opened from a click, a tap or the keyboard: focus goes into the list. A hover never takes focus.
          if (el && pinned && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
        }}
      >
        {members.map((m) => (
          <button
            key={m.thread.root.id}
            type="button"
            role="menuitem"
            className="bsv-cluster-row"
            data-cluster-note={m.thread.root.id}
            data-active={activeId === m.thread.root.id ? "" : undefined}
            onPointerEnter={() => setRowHover(m.thread.root.id)}
            onPointerLeave={() => setRowHover((h) => (h === m.thread.root.id ? null : h))}
            onFocus={() => setRowHover(m.thread.root.id)}
            onBlur={() => setRowHover((h) => (h === m.thread.root.id ? null : h))}
            onClick={() => {
              setCluster(null);
              setRowHover(null);
              select(m.thread);
              focusStop(index);
            }}
          >
            <span className="bsv-timecode" data-small="">
              <Timecode ms={m.thread.root.atMs} fps={fps} />
            </span>
            <span className="bsv-cluster-author">{m.thread.root.authorName ?? props.roleOf(m.thread.root).label}</span>
            <span className="bsv-cluster-text">{m.thread.root.body.split("\n")[0]}</span>
          </button>
        ))}
      </div>
    );
  }

  /** A stop that stands for several notes: a count pill (room on the lane) or a stretch (crowded). */
  function renderGroup(group: LaneGroup, index: number) {
    const members = group.ids.map((id) => byId.get(id)).filter((n): n is TimelineNote => Boolean(n));
    const label = fill(copy.player.cluster, { count: members.length });
    const open = cluster?.index === index;
    const shared = {
      type: "button" as const,
      "data-lane-stop": "",
      "data-review-cluster": members.length,
      "data-active": activeId && group.ids.includes(activeId) ? "" : undefined,
      "data-hover": group.ids.some((id) => lit.includes(id)) ? "" : undefined,
      "data-on": members.some((m) => playheadOn(m.thread.root, currentMs, fps)) ? "" : undefined,
      tabIndex: index === safeStop ? 0 : -1,
      "aria-label": label,
      "aria-haspopup": "menu" as const,
      "aria-expanded": open,
      onFocus: () => setStop(index),
      onPointerEnter: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType !== "mouse") return;
        setCard((c) => (c?.pinned ? c : null));
        hoverOpen(index);
      },
      onPointerLeave: (e: ReactPointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse") hoverClose();
      },
      onClick: () => {
        clearHover();
        setCard(null);
        // A click on a list the hover opened pins it; a second click closes it.
        setCluster(open && cluster?.pinned ? null : { index, pinned: true });
      },
    };
    return (
      <span key={`group-${group.ids[0]}`} className="bsv-cluster-anchor" style={{ left: width ? `${(group.x / width) * 100}%` : "0%" }}>
        {stretched && !narrow ? (
          <button {...shared} className="bsv-stretch" data-review-stretch={members.length} data-level={stretchLevel(members.length)} style={{ width: segmentWidth(group) }}>
            <span className="bsv-stretch-bar" aria-hidden="true" />
          </button>
        ) : stretched ? (
          // A phone: about six stretches across, each a count pill to tap (one per screen-sixth), opening its list.
          <button {...shared} className="bsv-cluster" data-review-stretch={members.length}>
            {members.length}
          </button>
        ) : (
          <button {...shared} className="bsv-cluster">
            {members.length}
          </button>
        )}
        {open && groupList(group, index, members, label, cluster?.pinned === true)}
      </span>
    );
  }

  function renderStop(group: LaneGroup, index: number) {
    if (group.ids.length > 1) return renderGroup(group, index);
    const n = byId.get(group.ids[0]!);
    if (!n) return null;
    if (stretched) {
      // A stretch holding one note acts exactly like that note's dot; it is drawn as the strip's shortest bar.
      return (
        <span key={`stretch-${n.thread.root.id}`} className="bsv-cluster-anchor" style={{ left: width ? `${(group.x / width) * 100}%` : "0%" }}>
          <button {...noteStopProps(n, index)} className="bsv-stretch" data-review-stretch={1} data-level={1} style={{ width: segmentWidth(group) }}>
            <span className="bsv-stretch-bar" aria-hidden="true" />
          </button>
        </span>
      );
    }
    return (
      <button key={n.thread.root.id} {...noteStopProps(n, index)} className="bsv-marker" style={{ left: pctOf(n.thread.root.atMs ?? 0, durationMs) }}>
        <span className="bsv-marker-dot" aria-hidden="true" />
      </button>
    );
  }

  const cardX = cardNote && cardNote.thread.root.atMs != null ? laneX(cardNote.thread.root.atMs, durationMs, width) : 0;

  return (
    <div className="bsv-timeline" data-review-timeline-bar data-lane-mode={plan.mode}>
      <div
        ref={scrubRef}
        className="bsv-scrub"
        data-dragging={scrubbing ? "" : undefined}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" && !scrubbing) return;
          const rect = scrubRef.current?.getBoundingClientRect();
          if (!rect) return;
          setTip({ x: Math.min(rect.width, Math.max(0, e.clientX - rect.left)), ms: msAt(e.clientX, scrubRef.current) });
        }}
        onPointerLeave={() => setTip(null)}
      >
        <div className="bsv-scrub-track" aria-hidden="true">
          {props.selectedRange && !drawing && (
            <span
              className="bsv-scrub-wash"
              style={{ left: pctOf(props.selectedRange.startMs, durationMs), width: `calc(${pctOf(props.selectedRange.endMs, durationMs)} - ${pctOf(props.selectedRange.startMs, durationMs)})` }}
            />
          )}
          <span className="bsv-scrub-fill" style={{ width: pctOf(currentMs, durationMs) }} />
        </div>
        <span className="bsv-scrub-thumb" aria-hidden="true" style={{ left: pctOf(currentMs, durationMs) }} />
        {tip && (
          <span className="bsv-scrub-tip" aria-hidden="true" style={{ left: `${tip.x}px` }}>
            <Timecode ms={tip.ms} fps={fps} />
          </span>
        )}
        <input
          type="range"
          className="bsv-range"
          min={0}
          max={Math.max(durationMs, 1)}
          step={props.stepMs}
          value={Math.min(currentMs, Math.max(durationMs, 1))}
          onChange={(e) => props.onScrub(Number(e.target.value))}
          onPointerDown={() => setScrubbing(true)}
          onPointerUp={() => setScrubbing(false)}
          onPointerCancel={() => setScrubbing(false)}
          aria-label={copy.player.timeline}
          aria-valuetext={props.tc(currentMs)}
        />
      </div>

      <div
        ref={laneRef}
        className="bsv-lane"
        data-review-marker-lane
        data-review-range-lane={extended ? "" : undefined}
        data-active={drag ? "" : undefined}
        data-drawable={extended && canComment ? "" : undefined}
        role="group"
        aria-label={copy.commentsTitle}
        onKeyDown={onLaneKeyDown}
        onPointerDown={onLanePointerDown}
        onPointerMove={onLanePointerMove}
        onPointerUp={onLanePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {rangeNotes
          .filter((n) => linesShown.has(n.thread.root.id))
          .map((n) => (
            <span
              key={`range-${n.thread.root.id}`}
              className="bsv-range-line"
              data-review-span={n.thread.root.id}
              data-kind={markerKind(n.thread, teamView)}
              data-resolved={n.thread.root.resolved ? "" : undefined}
              data-active={activeId === n.thread.root.id ? "" : undefined}
              aria-hidden="true"
              style={{ left: pctOf(n.thread.root.atMs ?? 0, durationMs), width: `calc(${pctOf(n.thread.root.endMs ?? 0, durationMs)} - ${pctOf(n.thread.root.atMs ?? 0, durationMs)})` }}
            />
          ))}
        {pendingRange && (
          <>
            <span
              className="bsv-range-line"
              data-pending=""
              aria-hidden="true"
              style={{ left: pctOf(pendingRange.start, durationMs), width: `calc(${pctOf(pendingRange.end, durationMs)} - ${pctOf(pendingRange.start, durationMs)})` }}
            />
            {pendingRange.handles && extended && canComment && (
              <>
                <span className="bsv-range-handle" data-lane-handle="start" aria-hidden="true" style={{ left: pctOf(pendingRange.start, durationMs) }} onPointerDown={(e) => { e.stopPropagation(); startDrag(e, "start"); }} />
                <span className="bsv-range-handle" data-lane-handle="end" aria-hidden="true" style={{ left: pctOf(pendingRange.end, durationMs) }} onPointerDown={(e) => { e.stopPropagation(); startDrag(e, "end"); }} />
              </>
            )}
          </>
        )}
        {mark?.atMs != null && mark.endMs == null && !drag && <span className="bsv-marker-pending" aria-hidden="true" style={{ left: pctOf(mark.atMs, durationMs) }} />}

        {groups.map((group, index) => renderStop(group, index))}

        {pointDots.map((id) => {
          const at = byId.get(id)!.thread.root.atMs ?? 0;
          return <span key={`point-${id}`} className="bsv-lane-point" data-active={id === activeId ? "" : undefined} aria-hidden="true" style={{ left: pctOf(at, durationMs) }} />;
        })}

        {cardNote && cardNote.thread.root.atMs != null && (
          <div
            className="bsv-marker-card"
            id={`bsv-marker-card-${props.reviewId}`}
            role="tooltip"
            data-marker-card
            style={{ left: `${placeCard(cardX)}px`, width: `${cardWidth}px` }}
          >
            <span className="bsv-marker-card-head">
              <span className="bsv-author">{cardNote.thread.root.authorName ?? props.roleOf(cardNote.thread.root).label}</span>
              <span className="bsv-role" data-role={props.roleOf(cardNote.thread.root).role}>
                {props.roleOf(cardNote.thread.root).label}
              </span>
              {teamView && cardNote.thread.root.team && props.teamTag ? (
                <span className="bsv-team-tag" data-review-team-tag="">
                  {props.teamTag}
                </span>
              ) : null}
              <span className="bsv-timecode" data-small="">
                <Timecode ms={cardNote.thread.root.atMs} fps={fps} />
                {cardNote.thread.root.endMs != null ? (
                  <>
                    –<Timecode ms={cardNote.thread.root.endMs} fps={fps} />
                  </>
                ) : null}
              </span>
            </span>
            <span className="bsv-marker-card-body">{cardNote.thread.root.body}</span>
            {cardNote.thread.replies.filter((r) => !r.deleted).length > 0 && (
              <span className="bsv-marker-card-foot">{fill(copy.replies, { count: cardNote.thread.replies.filter((r) => !r.deleted).length })}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
