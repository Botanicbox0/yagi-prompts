"use client";
/**
 * Marks drawn over the viewer's clip, and in mark mode the layer that places them (docs/BRAND-STUDIO-V6-PLAN.md
 * §4.5). Rendered by the revise form into the viewer's media figure through a portal, so the marks stay
 * with the form (one set per shown version). The stage covers the displayed picture only (letterboxing
 * worked out from the clip's size); the layer that takes clicks leaves the native controls strip free.
 * One gesture: a click places a pin, a drag of more than 6 px a box. Keyboard: Enter places a pin in the
 * middle, arrows move the last mark (Shift for bigger steps), Escape leaves mark mode.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { StudioCopy } from "./copy";
import {
  MARKS_MAX,
  boxFrom,
  controlsInset,
  isBox,
  isDrag,
  markFromGesture,
  pictureRect,
  toFraction,
  visibleAt,
  type MarkGeometry,
  type MarkState,
  type Point,
  type Rect,
} from "./revise-marks";

// Layout effects only run in the browser; on the server this is a plain effect that never runs.
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface MarkLayerProps {
  video: RefObject<HTMLVideoElement | null>;
  host: HTMLElement;
  marks: readonly MarkState[];
  /** Mark mode: the layer takes clicks and keys. Off: marks are only drawn. */
  active: boolean;
  copy: StudioCopy;
  onPlace(geometry: MarkGeometry): void;
  onNudge(dx: number, dy: number): void;
  onLeave(): void;
}

/** Where the picture sits inside `host` (px), and how much of its bottom the controls need. */
function measure(video: HTMLVideoElement, host: HTMLElement): { stage: Rect; inset: number } {
  const hostBox = host.getBoundingClientRect();
  const videoBox = video.getBoundingClientRect();
  const box = { width: video.clientWidth, height: video.clientHeight };
  const picture = pictureRect(box, video.videoWidth > 0 && video.videoHeight > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
  return {
    stage: {
      left: videoBox.left - hostBox.left - host.clientLeft + host.scrollLeft + video.clientLeft + picture.left,
      top: videoBox.top - hostBox.top - host.clientTop + host.scrollTop + video.clientTop + picture.top,
      width: picture.width,
      height: picture.height,
    },
    inset: controlsInset(picture, box.height),
  };
}

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function MarkLayer({ video, host, marks, active, copy, onPlace, onNudge, onLeave }: MarkLayerProps) {
  const [frame, setFrame] = useState<{ stage: Rect; inset: number } | null>(null);
  const [time, setTime] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; start: Point } | null>(null);
  const [preview, setPreview] = useState<{ a: Point; b: Point } | null>(null);
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const full = marks.length >= MARKS_MAX;

  useBrowserLayoutEffect(() => {
    const element = video.current;
    if (!element) return;
    const update = () => setFrame(measure(element, host));
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(element);
    observer?.observe(host);
    element.addEventListener("loadedmetadata", update);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      element.removeEventListener("loadedmetadata", update);
      window.removeEventListener("resize", update);
    };
  }, [video, host]);

  // The clip's moment decides which marks are drawn.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const sync = () => setTime(element.currentTime);
    sync();
    const events = ["timeupdate", "seeked", "seeking", "loadedmetadata"] as const;
    for (const name of events) element.addEventListener(name, sync);
    return () => {
      for (const name of events) element.removeEventListener(name, sync);
    };
  }, [video]);

  // Playing the clip leaves mark mode.
  useEffect(() => {
    const element = video.current;
    if (!active || !element) return;
    const off = () => leave.current();
    element.addEventListener("play", off);
    return () => element.removeEventListener("play", off);
  }, [active, video]);

  // The layer takes focus when mark mode starts so Enter and the arrows work at once.
  const measured = frame !== null;
  useEffect(() => {
    if (active && measured) layer.current?.focus({ preventScroll: true });
  }, [active, measured]);

  if (!frame || frame.stage.width <= 0 || frame.stage.height <= 0) return null;
  const size = { width: frame.stage.width, height: frame.stage.height };
  const local = (event: PointerEvent): Point => {
    const box = stage.current?.getBoundingClientRect();
    return box ? { x: event.clientX - box.left, y: event.clientY - box.top } : { x: 0, y: 0 };
  };
  const now = () => video.current?.currentTime ?? time;
  const reset = () => {
    drag.current = null;
    setPreview(null);
  };

  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!full) onPlace({ time: now(), x: 0.5, y: 0.5 });
    } else if (moves[event.key]) {
      // Arrows never reach the viewer's previous/next while marking.
      event.preventDefault();
      if (marks.length) onNudge(...moves[event.key]!);
    }
  };

  const ghost = preview ? boxFrom(toFraction(preview.a, size), toFraction(preview.b, size)) : null;

  return createPortal(
    <div
      ref={stage}
      className="bs-mark-stage"
      data-active={active ? "" : undefined}
      style={{ left: frame.stage.left, top: frame.stage.top, width: frame.stage.width, height: frame.stage.height }}
    >
      {marks.map((mark, i) =>
        visibleAt(mark, time) ? (
          isBox(mark) ? (
            <span key={mark.key} className="bs-mark-box" aria-hidden="true" data-mark-badge={i + 1} style={{ left: pct(mark.x), top: pct(mark.y), width: pct(mark.w!), height: pct(mark.h!) }}>
              <span className="bs-mark-num bs-num">{i + 1}</span>
            </span>
          ) : (
            <span key={mark.key} className="bs-mark-pin bs-num" aria-hidden="true" data-mark-badge={i + 1} style={{ left: pct(mark.x), top: pct(mark.y) }}>
              {i + 1}
            </span>
          )
        ) : null,
      )}
      {ghost && <span className="bs-mark-box" data-preview="" aria-hidden="true" style={{ left: pct(ghost.x), top: pct(ghost.y), width: pct(ghost.w), height: pct(ghost.h) }} />}
      {active && (
        <div
          ref={layer}
          className="bs-mark-layer"
          role="application"
          aria-label={copy.revise.markLayer}
          tabIndex={0}
          data-revise-mark-layer
          data-full={full ? "" : undefined}
          style={{ bottom: frame.inset }}
          onKeyDown={keys}
          onPointerDown={(event) => {
            if (full || (event.pointerType === "mouse" && event.button !== 0)) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.currentTarget.focus({ preventScroll: true });
            drag.current = { id: event.pointerId, start: local(event) };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            const at = local(event);
            setPreview(isDrag(start.start, at) ? { a: start.start, b: at } : null);
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId) return;
            reset();
            onPlace(markFromGesture(start.start, local(event), size, now()));
          }}
          onPointerCancel={reset}
          onLostPointerCapture={() => {
            if (drag.current) reset();
          }}
        />
      )}
    </div>,
    host,
  );
}
