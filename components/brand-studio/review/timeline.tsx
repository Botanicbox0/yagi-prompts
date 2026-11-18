"use client";
/**
 * The review timeline (docs/BRAND-ROOMS-FEEDBACK.md §11): one scrub bar with a thin marker lane under it.
 *
 *   · The bar is 4px (6px while hovered or dragged), the played part in the primary ink. Its thumb shows on
 *     hover, drag and focus; a small time tip follows the pointer. Underneath it is the native range input
 *     (invisible), so the keyboard and the seek logic stay what they were.
 *   · The lane carries one quiet dot per note (8px, at least a 24px target): a client's or guest's note is a
 *     filled neutral dot, the YAGI team's a ring of the same colour, a team-only note a dashed ring. No
 *     numbers on the lane; numbers live in the notes list. A range is a 2px line from its dot.
 *   · Dots closer than 14px become one count pill; it opens a short list of its notes.
 *   · Hover, focus or a tap opens a small card above the dot (author, time, two lines, replies); a click,
 *     Enter or the tap selects the note in the list and brings the film to it.
 *   · The accent marks one thing: the selected note (its dot, its range line, a wash on the bar), and a range
 *     being drawn (its line and two handles, dragged as the old range lane was).
 *   · The lane is one tab stop: ←/→/Home/End move between dots and pills in time order (they never step the
 *     film here), Enter/Space opens, Escape goes back to the stage.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ReviewComment, ReviewThread } from "@/lib/brand-studio/review-contracts";
import type { LoopRange } from "@/lib/brand-studio/review-frames";
import { moveFocus } from "../gallery/menu";
import { useNarrow } from "./stage-menu";
import { clusterGap, clusterMarkers, firstWords, laneX, markerKind, markerPress, nextStop, playheadOn } from "./timeline-model";
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

export function ReviewTimeline(props: ReviewTimelineProps) {
  const { durationMs, currentMs, fps, notes, activeId, hoverId, teamView, copy, extended, canComment, mark } = props;
  const laneRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [stop, setStop] = useState(0);
  const [card, setCard] = useState<{ id: string; pinned: boolean } | null>(null);
  const [cluster, setCluster] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; ms: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const touch = useRef(false);
  const cardShowing = useRef(false);

  // The lane's width decides the clusters: measure it, and again whenever it changes.
  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // The same breakpoint where review.css gives a marker its 28px target.
  const narrow = useNarrow(520);
  const byId = useMemo(() => new Map(notes.map((n) => [n.thread.root.id, n])), [notes]);
  const groups = useMemo(
    () => clusterMarkers(notes.map((n) => ({ id: n.thread.root.id, x: laneX(n.thread.root.atMs ?? 0, durationMs, width || 1) })), clusterGap(width, narrow)),
    [notes, durationMs, width, narrow],
  );
  const stopCount = groups.length;
  const safeStop = Math.min(stop, Math.max(0, stopCount - 1));

  const msAt = useCallback(
    (clientX: number, el: HTMLElement | null) => {
      const rect = el?.getBoundingClientRect();
      if (!rect || !rect.width || durationMs <= 0) return 0;
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * durationMs;
    },
    [durationMs],
  );

  // A pinned card (a tap, or keyboard focus) closes on a press anywhere else.
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
  const ranges = notes.filter((n) => n.thread.root.endMs != null);
  const cardNote = card ? byId.get(card.id) ?? null : null;
  const cardWidth = Math.min(280, Math.max(160, width - 8));
  const placeCard = (x: number) => Math.min(Math.max(0, width - cardWidth), Math.max(0, x - cardWidth / 2));

  function select(thread: ReviewThread) {
    props.onSelect(thread);
  }

  function renderMarker(n: TimelineNote, index: number) {
    const t = n.thread;
    const id = t.root.id;
    const role = props.roleOf(t.root);
    const time = t.root.endMs != null ? fill(copy.range.spanLabel, { start: props.tc(t.root.atMs), end: props.tc(t.root.endMs), text: firstWords(t.root.body) }) : fill(copy.pinLabel, { time: props.tc(t.root.atMs), text: firstWords(t.root.body) });
    const author = t.root.authorName ?? role.label;
    const tag = teamView && t.root.team && props.teamTag ? `${props.teamTag}, ` : "";
    return (
      <button
        key={id}
        type="button"
        className="bsv-marker"
        data-lane-stop=""
        data-review-pin={id}
        data-kind={markerKind(t, teamView)}
        data-resolved={t.root.resolved ? "" : undefined}
        data-active={activeId === id ? "" : undefined}
        data-hover={hoverId === id || card?.id === id ? "" : undefined}
        data-on={playheadOn(t.root, currentMs, fps) ? "" : undefined}
        tabIndex={index === safeStop ? 0 : -1}
        style={{ left: pctOf(t.root.atMs ?? 0, durationMs) }}
        aria-label={`${author}, ${tag}${time}`}
        aria-describedby={card?.id === id ? `bsv-marker-card-${props.reviewId}` : undefined}
        onPointerDown={(e) => {
          touch.current = e.pointerType === "touch";
          // Before the focus a tap brings, which shows the card too.
          cardShowing.current = card?.id === id;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setCard((c) => (c?.pinned ? c : { id, pinned: false }));
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setCard((c) => (c && !c.pinned && c.id === id ? null : c));
        }}
        onFocus={() => {
          setStop(index);
          setCard({ id, pinned: true });
        }}
        onBlur={() => setCard((c) => (c?.id === id && !touch.current ? null : c))}
        onClick={(e) => {
          setCluster(null);
          if (touch.current) setCard({ id, pinned: true });
          if (markerPress({ touch: touch.current, keyboard: e.detail === 0, cardShowing: cardShowing.current }) === "card") return;
          select(t);
        }}
      >
        <span className="bsv-marker-dot" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="bsv-timeline" data-review-timeline-bar>
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
          {props.selectedRange && (
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
        {ranges.map((n) => (
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

        {groups.map((group, index) => {
          if (group.ids.length === 1) {
            const n = byId.get(group.ids[0]!);
            return n ? renderMarker(n, index) : null;
          }
          const members = group.ids.map((id) => byId.get(id)).filter((n): n is TimelineNote => Boolean(n));
          const label = fill(copy.player.cluster, { count: members.length });
          const open = cluster === index;
          return (
            <span key={`cluster-${group.ids[0]}`} className="bsv-cluster-anchor" style={{ left: width ? `${(group.x / width) * 100}%` : "0%" }}>
              <button
                type="button"
                className="bsv-cluster"
                data-lane-stop=""
                data-review-cluster={members.length}
                data-active={activeId && group.ids.includes(activeId) ? "" : undefined}
                data-hover={hoverId && group.ids.includes(hoverId) ? "" : undefined}
                tabIndex={index === safeStop ? 0 : -1}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onFocus={() => setStop(index)}
                onClick={() => {
                  setCard(null);
                  setCluster(open ? null : index);
                }}
              >
                {members.length}
              </button>
              {open && (
                <div
                  className="bsv-cluster-list"
                  data-cluster-list
                  role="menu"
                  aria-label={label}
                  style={{ left: `${placeCard(group.x) - group.x}px`, width: `${cardWidth}px` }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setCluster(null);
                      focusStop(index);
                      return;
                    }
                    moveFocus(e);
                  }}
                  ref={(el) => {
                    if (el && !el.contains(document.activeElement)) el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
                  }}
                >
                  {members.map((m) => (
                    <button
                      key={m.thread.root.id}
                      type="button"
                      role="menuitem"
                      className="bsv-cluster-row"
                      data-cluster-note={m.thread.root.id}
                      onClick={() => {
                        setCluster(null);
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
              )}
            </span>
          );
        })}

        {cardNote && cardNote.thread.root.atMs != null && (
          <div
            className="bsv-marker-card"
            id={`bsv-marker-card-${props.reviewId}`}
            role="tooltip"
            data-marker-card
            style={{ left: `${placeCard(laneX(cardNote.thread.root.atMs, durationMs, width))}px`, width: `${cardWidth}px` }}
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
