"use client";
/**
 * Drawing on the paused frame (docs/BRAND-ROOMS.md §6): a pen and an arrow in two colours, undo and clear.
 * A drawing is lines of points in 0..1 of the frame, so it lands on the same spot at any screen size; it
 * is saved with the note and drawn again when the note is selected.
 *
 * The layer is one SVG over the frame, scaled with it (`viewBox` 1000 wide, the frame's own ratio). Lines
 * keep a fixed on-screen width and carry a thin dark halo so blue and white both read on any footage.
 */
import { useCallback, useMemo, useRef, useState, type PointerEvent } from "react";
import { REVIEW_LIMITS, STROKE_COLORS, STROKE_HEX, type ReviewStroke, type StrokeColor, type StrokeTool } from "@/lib/brand-studio/review-contracts";
import type { studioReviewEn } from "@/messages/studio-review";

type DrawCopy = (typeof studioReviewEn)["draw"];
type Point = [number, number];

const round4 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;

export interface Ink {
  active: boolean;
  tool: StrokeTool;
  color: StrokeColor;
  /** Finished lines while drawing. */
  strokes: ReviewStroke[];
  /** The line under the pointer. */
  current: ReviewStroke | null;
  setTool(tool: StrokeTool): void;
  setColor(color: StrokeColor): void;
  undo(): void;
  clear(): void;
  start(initial: ReviewStroke[]): void;
  /** Leave drawing mode and drop the lines (another mark took over). */
  stop(): void;
  /** Leave drawing mode and hand back the lines. */
  finish(): ReviewStroke[];
  reset(): void;
  begin(point: Point): void;
  extend(point: Point): void;
  end(): void;
}

export function useInk(): Ink {
  const [active, setActive] = useState(false);
  const [tool, setTool] = useState<StrokeTool>("pen");
  const [color, setColor] = useState<StrokeColor>("blue");
  const [strokes, setStrokesState] = useState<ReviewStroke[]>([]);
  const [current, setCurrentState] = useState<ReviewStroke | null>(null);
  const strokesRef = useRef<ReviewStroke[]>([]);
  const currentRef = useRef<ReviewStroke | null>(null);
  const settings = useRef({ tool, color });
  settings.current = { tool, color };

  const setStrokes = useCallback((next: ReviewStroke[]) => {
    strokesRef.current = next;
    setStrokesState(next);
  }, []);
  const setCurrent = useCallback((next: ReviewStroke | null) => {
    currentRef.current = next;
    setCurrentState(next);
  }, []);

  const reset = useCallback(() => {
    setActive(false);
    setStrokes([]);
    setCurrent(null);
  }, [setStrokes, setCurrent]);

  const commit = useCallback(() => {
    const line = currentRef.current;
    setCurrent(null);
    if (!line || line.points.length < 2) return;
    const total = strokesRef.current.reduce((n, l) => n + l.points.length, 0);
    if (strokesRef.current.length >= REVIEW_LIMITS.strokesMax || total + line.points.length > REVIEW_LIMITS.pointsMax) return;
    setStrokes([...strokesRef.current, line]);
  }, [setCurrent, setStrokes]);

  return useMemo<Ink>(
    () => ({
      active,
      tool,
      color,
      strokes,
      current,
      setTool,
      setColor,
      undo: () => setStrokes(strokesRef.current.slice(0, -1)),
      clear: () => setStrokes([]),
      start: (initial) => {
        setStrokes(initial.slice(0, REVIEW_LIMITS.strokesMax));
        setCurrent(null);
        setActive(true);
      },
      stop: () => {
        setActive(false);
        setCurrent(null);
      },
      finish: () => {
        commit();
        setActive(false);
        return strokesRef.current;
      },
      reset,
      begin: (point) => {
        const { tool: t, color: c } = settings.current;
        setCurrent({ tool: t, color: c, points: [point, point] });
      },
      extend: (point) => {
        const line = currentRef.current;
        if (!line) return;
        if (line.tool === "arrow") {
          setCurrent({ ...line, points: [line.points[0]!, point] });
          return;
        }
        const last = line.points[line.points.length - 1]!;
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.004 || line.points.length >= REVIEW_LIMITS.pointsPerStroke) return;
        // The first move replaces the starting duplicate.
        const points = line.points.length === 2 && line.points[0]![0] === line.points[1]![0] && line.points[0]![1] === line.points[1]![1] ? [line.points[0]!, point] : [...line.points, point];
        setCurrent({ ...line, points });
      },
      end: commit,
    }),
    [active, tool, color, strokes, current, setStrokes, setCurrent, reset, commit],
  );
}

const W = 1000;

function Line({ stroke, h }: { stroke: ReviewStroke; h: number }) {
  const pts = stroke.points.map(([x, y]) => [x * W, y * h] as const);
  const color = STROKE_HEX[stroke.color];
  let head: string | null = null;
  if (stroke.tool === "arrow" && pts.length >= 2) {
    const [x1, y1] = pts[0]!;
    const [x2, y2] = pts[pts.length - 1]!;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const size = 26;
    const a1 = angle + Math.PI - 0.5;
    const a2 = angle + Math.PI + 0.5;
    head = `${x2 + size * Math.cos(a1)},${y2 + size * Math.sin(a1)} ${x2},${y2} ${x2 + size * Math.cos(a2)},${y2 + size * Math.sin(a2)}`;
  }
  const body = (stroke.tool === "arrow" ? [pts[0]!, pts[pts.length - 1]!] : pts).map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <g>
      <polyline points={body} className="bsv-ink-halo" />
      {head && <polyline points={head} className="bsv-ink-halo" />}
      <polyline points={body} stroke={color} className="bsv-ink-line" />
      {head && <polyline points={head} stroke={color} className="bsv-ink-line" />}
    </g>
  );
}

/** Over the frame: the lines to show, or (while drawing) the canvas itself. */
export function InkLayer({ ratio, ink, strokes, label, hint }: { ratio: number; ink: Ink; strokes: ReviewStroke[] | null; label: string; hint: string }) {
  const h = W / (ratio > 0 ? ratio : 1);
  const lines = ink.active ? [...ink.strokes, ...(ink.current ? [ink.current] : [])] : (strokes ?? []);
  const pointAt = (e: PointerEvent<SVGSVGElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [round4((e.clientX - rect.left) / (rect.width || 1)), round4((e.clientY - rect.top) / (rect.height || 1))];
  };
  if (!ink.active && lines.length === 0) return null;
  return (
    <>
      <svg
        className="bsv-ink"
        viewBox={`0 0 ${W} ${h}`}
        preserveAspectRatio="none"
        data-review-ink
        data-drawing={ink.active ? "" : undefined}
        role={lines.length ? "img" : undefined}
        aria-label={lines.length ? label : undefined}
        aria-hidden={lines.length ? undefined : true}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (!ink.active || e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          ink.begin(pointAt(e));
        }}
        onPointerMove={(e) => {
          if (ink.active && ink.current) ink.extend(pointAt(e));
        }}
        onPointerUp={() => ink.active && ink.end()}
        onPointerCancel={() => ink.active && ink.end()}
      >
        {lines.map((stroke, i) => (
          <Line key={i} stroke={stroke} h={h} />
        ))}
      </svg>
      {ink.active && lines.length === 0 && (
        <p className="bsv-spot-hint" role="status">
          {hint}
        </p>
      )}
    </>
  );
}

/** Pen or arrow, blue or white, undo, clear, done. */
export function InkTools({ ink, copy, onDone }: { ink: Ink; copy: DrawCopy; onDone(): void }) {
  return (
    <div className="bsv-ink-tools" role="toolbar" aria-label={copy.tools} data-review-ink-tools>
      <div className="bsv-seg" role="group" aria-label={copy.tools}>
        {(["pen", "arrow"] as const).map((t) => (
          <button key={t} type="button" className="bsv-seg-btn" aria-pressed={ink.tool === t} onClick={() => ink.setTool(t)} data-ink-tool={t}>
            {copy[t]}
          </button>
        ))}
      </div>
      <div className="bsv-swatches" role="group" aria-label={copy.tools}>
        {STROKE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="bsv-swatch"
            aria-pressed={ink.color === c}
            aria-label={copy[c]}
            title={copy[c]}
            style={{ ["--bsv-swatch" as string]: STROKE_HEX[c] }}
            onClick={() => ink.setColor(c)}
            data-ink-color={c}
          />
        ))}
      </div>
      <button type="button" className="bsv-text-btn" onClick={ink.undo} disabled={ink.strokes.length === 0}>
        {copy.undo}
      </button>
      <button type="button" className="bsv-text-btn" onClick={ink.clear} disabled={ink.strokes.length === 0}>
        {copy.clear}
      </button>
      <button type="button" className="bsv-pill" onClick={onDone} data-ink-done>
        {copy.done}
      </button>
    </div>
  );
}
