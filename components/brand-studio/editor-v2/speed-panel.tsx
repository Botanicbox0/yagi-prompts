'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { FrameClip } from '@/lib/brand-studio/editor-v2/frames';
import {
  LEGACY_SPEEDS,
  MAX_CURVE_POINTS,
  MAX_CURVE_TOTAL_POINTS,
  MAX_SPEED,
  MIN_CURVE_GAP,
  MIN_CURVE_POINTS,
  MIN_SPEED,
  SPEED_PRESETS,
  addCurvePoint,
  clampSpeed,
  compileSpeedCurve,
  curveAverageSpeed,
  curveInverseAt,
  curveSpeedAt,
  curveSpeedRange,
  editablePointsOfCurve,
  findSpeedPreset,
  formatSpeed,
  logSliderToSpeed,
  moveCurvePoint,
  nextSpeedOnSliderKey,
  parseSpeedInput,
  removeCurvePoint,
  speedToLogSlider,
  type SpeedCurve,
  type SpeedPoint,
  type SpeedPresetId,
} from '@/lib/brand-studio/editor-v2/speed-curve';
import type { StudioEditorCopy } from '@/messages/studio-editor';
import styles from './editor-v2.module.css';

export interface SpeedPanelProps {
  clip: FrameClip;
  clipIndex: number;
  clipStart: number;
  playhead: number;
  fps: number;
  readOnly: boolean;
  copy: StudioEditorCopy;
  onSetConstant: (index: number, rate: number, coalesce?: boolean) => void;
  onSetCurve: (index: number, points: readonly SpeedPoint[], coalesce?: boolean) => void;
  onReset: (index: number) => void;
}

const SVG_W = 264;
const SVG_H = 114;
const PAD_LEFT = 28;
const PAD_RIGHT = 10;
const PAD_Y = 10;
const PLOT_W = SVG_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = SVG_H - PAD_Y * 2;
const GRAPH_SAMPLES = 64;
const SPARK_W = 42;
const SPARK_H = 16;

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`));
}

function posToX(pos: number): number {
  return PAD_LEFT + Math.min(1, Math.max(0, pos)) * PLOT_W;
}

function xToPos(x: number): number {
  return Math.min(1, Math.max(0, (x - PAD_LEFT) / PLOT_W));
}

function speedToY(speed: number): number {
  const safe = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  const norm = (Math.log10(safe) + 1) / 2;
  return PAD_Y + (1 - norm) * PLOT_H;
}

function yToSpeed(y: number): number {
  const norm = Math.min(1, Math.max(0, 1 - (y - PAD_Y) / PLOT_H));
  return clampSpeed(Math.pow(10, norm * 2 - 1));
}

export function speedFromTrackOffset(offsetX: number, trackWidth: number): number {
  if (trackWidth <= 0) return 1;
  const norm = Math.min(1, Math.max(0, offsetX / trackWidth));
  return logSliderToSpeed(norm * 1000);
}

export function applySpeedNumberCommit(rawInput: string, fallbackRate: number): number {
  const parsed = parseSpeedInput(rawInput);
  return parsed !== null ? parsed : clampSpeed(fallbackRate);
}

export interface PointKeyEventLike {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function applyCurvePointKeyDown(
  event: PointKeyEventLike,
  points: readonly SpeedPoint[],
  idx: number,
  readOnly: boolean,
  commitCurve: (nextPoints: SpeedPoint[], coalesce?: boolean) => void,
): number {
  if (readOnly) return idx;
  const pt = points[idx];
  if (!pt) return idx;

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    event.stopPropagation();
    if (points.length > MIN_CURVE_POINTS && idx > 0 && idx < points.length - 1) {
      commitCurve(removeCurvePoint(points, idx), false);
      return Math.max(0, idx - 1);
    }
    return idx;
  }

  const speedStep = event.shiftKey ? 0.01 : 0.05;
  const posStep = event.shiftKey ? 0.01 : MIN_CURVE_GAP;

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    commitCurve(moveCurvePoint(points, idx, pt.pos, clampSpeed(pt.speed + speedStep)), true);
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    commitCurve(moveCurvePoint(points, idx, pt.pos, clampSpeed(pt.speed - speedStep)), true);
  } else if (event.key === 'ArrowLeft' && idx > 0 && idx < points.length - 1) {
    event.preventDefault();
    event.stopPropagation();
    commitCurve(moveCurvePoint(points, idx, pt.pos - posStep, pt.speed), true);
  } else if (event.key === 'ArrowRight' && idx > 0 && idx < points.length - 1) {
    event.preventDefault();
    event.stopPropagation();
    commitCurve(moveCurvePoint(points, idx, pt.pos + posStep, pt.speed), true);
  }
  return idx;
}

function sparkPathOf(points: readonly SpeedPoint[]): string {
  const compiled = compileSpeedCurve({ startMedia: 0, spanMedia: 100, points: [...points] });
  const coords: string[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const u = i / 12;
    const norm = (Math.log10(Math.min(MAX_SPEED, Math.max(MIN_SPEED, curveSpeedAt(compiled, u)))) + 1) / 2;
    const x = 3 + u * (SPARK_W - 6);
    const y = 3 + (1 - norm) * (SPARK_H - 6);
    coords.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return coords.join(' ');
}

function curvePathOf(curve: SpeedCurve): { line: string; area: string } {
  const compiled = compileSpeedCurve(curve);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= GRAPH_SAMPLES; i += 1) {
    const u = i / GRAPH_SAMPLES;
    const speed = curveSpeedAt(compiled, u);
    pts.push({ x: posToX(u), y: speedToY(speed) });
  }
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const bottom = (PAD_Y + PLOT_H).toFixed(2);
  const area = `${line} L${pts[pts.length - 1]!.x.toFixed(2)},${bottom} L${pts[0]!.x.toFixed(2)},${bottom} Z`;
  return { line, area };
}

function presetLabelOf(id: SpeedPresetId, c: StudioEditorCopy['cut']['clip']): string {
  switch (id) {
    case 'slowMiddle':
      return c.speedPresetSlowMiddle;
    case 'fastMiddle':
      return c.speedPresetFastMiddle;
    case 'fastStart':
      return c.speedPresetFastStart;
    case 'fastEnd':
      return c.speedPresetFastEnd;
    case 'twoPulses':
      return c.speedPresetTwoPulses;
    case 'slowDrop':
      return c.speedPresetSlowDrop;
  }
}

const SPARKLINE_CACHE: Record<SpeedPresetId, string> = {
  slowMiddle: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'slowMiddle')!.points),
  fastMiddle: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'fastMiddle')!.points),
  fastStart: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'fastStart')!.points),
  fastEnd: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'fastEnd')!.points),
  twoPulses: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'twoPulses')!.points),
  slowDrop: sparkPathOf(SPEED_PRESETS.find((p) => p.id === 'slowDrop')!.points),
};

export interface SpeedSliderTrackProps {
  label: string;
  constantRate: number;
  readOnly: boolean;
  trackRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onCommit: (rate: number, coalesce?: boolean) => void;
  onDraggingChange: (dragging: boolean) => void;
}

export function SpeedSliderTrack({
  label,
  constantRate,
  readOnly,
  trackRef,
  dragging,
  onCommit,
  onDraggingChange,
}: SpeedSliderTrackProps) {
  const sliderPct = speedToLogSlider(constantRate) / 10;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const track = trackRef.current;
    if (!track) return;
    event.currentTarget.focus();
    const rect = track.getBoundingClientRect();
    onCommit(speedFromTrackOffset(event.clientX - rect.left, rect.width), true);
    onDraggingChange(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (readOnly || !dragging) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    onCommit(speedFromTrackOffset(event.clientX - rect.left, rect.width), true);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging || event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onDraggingChange(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const next = nextSpeedOnSliderKey(constantRate, event.key);
    if (next !== constantRate || /^(Arrow|Page|Home|End)/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (next !== constantRate) {
        onCommit(next, false);
      }
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={readOnly ? -1 : 0}
      aria-label={label}
      aria-valuemin={MIN_SPEED}
      aria-valuemax={MAX_SPEED}
      aria-valuenow={constantRate}
      aria-valuetext={`${formatSpeed(constantRate)}×`}
      aria-disabled={readOnly || undefined}
      className={styles.speedSliderTrack}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.speedSliderRail} />
      <div className={styles.speedSliderFill} style={{ width: `${sliderPct}%` }} />
      <div className={styles.speedSliderThumb} style={{ left: `${sliderPct}%` }} />
    </div>
  );
}

export function SpeedPanel({
  clip,
  clipIndex,
  clipStart,
  playhead,
  fps,
  readOnly,
  copy,
  onSetConstant,
  onSetCurve,
  onReset,
}: SpeedPanelProps) {
  const c = copy.cut.clip;
  const isCurved = Boolean(clip.speedCurve);
  const constantRate = clampSpeed(clip.speedNum / clip.speedDen);

  const [draftRate, setDraftRate] = useState(() => formatSpeed(constantRate));
  const [rateFocused, setRateFocused] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(0);
  const [draggingPointIdx, setDraggingPointIdx] = useState<number | null>(null);
  const [draggingSlider, setDraggingSlider] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sliderTrackRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!rateFocused) {
      setDraftRate(formatSpeed(constantRate));
    }
  }, [clip.id, constantRate, rateFocused]);

  const points = useMemo(() => (clip.speedCurve ? editablePointsOfCurve(clip.speedCurve) : []), [clip.speedCurve]);
  const safeSelected = points.length > 0 ? Math.min(selectedPoint, points.length - 1) : 0;

  useEffect(() => {
    setSelectedPoint((prev) => (points.length === 0 ? 0 : Math.min(prev, points.length - 1)));
  }, [points.length]);

  const activePreset = useMemo(() => (clip.speedCurve ? findSpeedPreset(points) : null), [clip.speedCurve, points]);
  const curveMinSpeed = useMemo(() => (clip.speedCurve ? curveSpeedRange(clip.speedCurve).min : constantRate), [clip.speedCurve, constantRate]);
  const showSlowNote = (isCurved ? curveMinSpeed : constantRate) < 0.999;

  const lengthText = fillTemplate(c.speedResultLength, {
    frames: clip.frames,
    seconds: (clip.frames / Math.max(1, fps)).toFixed(2),
  });

  const curveGeometry = useMemo(() => (clip.speedCurve ? curvePathOf(clip.speedCurve) : null), [clip.speedCurve]);
  const playheadDot = useMemo(() => {
    if (!clip.speedCurve) return null;
    const offset = playhead - clipStart;
    if (offset < 0 || offset >= clip.frames) return null;
    const compiled = compileSpeedCurve(clip.speedCurve);
    const u = curveInverseAt(compiled, offset);
    const speed = curveSpeedAt(compiled, u);
    return { x: posToX(u), y: speedToY(speed) };
  }, [clip.frames, clip.speedCurve, clipStart, playhead]);

  const switchMode = (target: 'constant' | 'curve') => {
    if (readOnly) return;
    if (target === 'constant' && clip.speedCurve) {
      onSetConstant(clipIndex, clampSpeed(curveAverageSpeed(clip.speedCurve)));
    } else if (target === 'curve' && !clip.speedCurve) {
      const rate = clampSpeed(clip.speedNum / clip.speedDen);
      onSetCurve(clipIndex, [
        { pos: 0, speed: rate },
        { pos: 0.5, speed: rate },
        { pos: 1, speed: rate },
      ]);
      setSelectedPoint(1);
    }
  };

  const commitConstantDraft = () => {
    const next = applySpeedNumberCommit(draftRate, constantRate);
    if (parseSpeedInput(draftRate) !== null) {
      onSetConstant(clipIndex, next);
    }
    setDraftRate(formatSpeed(next));
  };

  const svgCoordsFromEvent = (event: PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: PAD_LEFT, y: PAD_Y + PLOT_H / 2 };
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: PAD_LEFT, y: PAD_Y + PLOT_H / 2 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * SVG_W,
      y: ((event.clientY - rect.top) / rect.height) * SVG_H,
    };
  };

  const handleSvgPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (readOnly || !clip.speedCurve) return;
    const { x, y } = svgCoordsFromEvent(event);
    let hitIndex = -1;
    let bestDist = 14;
    points.forEach((pt, idx) => {
      const dx = posToX(pt.pos) - x;
      const dy = speedToY(pt.speed) - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= bestDist) {
        bestDist = dist;
        hitIndex = idx;
      }
    });

    if (hitIndex >= 0) {
      setSelectedPoint(hitIndex);
      setDraggingPointIdx(hitIndex);
      dragOriginRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    if (points.length < MAX_CURVE_POINTS) {
      const nextPos = xToPos(x);
      const nextSpeed = yToSpeed(y);
      const nextPoints = addCurvePoint(points, nextPos, nextSpeed);
      if (nextPoints.length > points.length) {
        const addedIdx = nextPoints.findIndex((p) => Math.abs(p.pos - nextPos) < 0.03);
        onSetCurve(clipIndex, nextPoints);
        if (addedIdx >= 0) {
          setSelectedPoint(addedIdx);
          setDraggingPointIdx(addedIdx);
          dragOriginRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
      }
    }
  };

  const handleSvgPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (readOnly || draggingPointIdx === null || !clip.speedCurve) return;
    const origin = dragOriginRef.current;
    if (origin && Math.abs(event.clientX - origin.x) < 0.5 && Math.abs(event.clientY - origin.y) < 0.5) {
      return;
    }
    const { x, y } = svgCoordsFromEvent(event);
    const nextPoints = moveCurvePoint(points, draggingPointIdx, xToPos(x), yToSpeed(y));
    onSetCurve(clipIndex, nextPoints, true);
  };

  const handleSvgPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    dragOriginRef.current = null;
    if (draggingPointIdx !== null) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDraggingPointIdx(null);
    }
  };

  const handlePointKeyDown = (event: KeyboardEvent<SVGGElement>, idx: number) => {
    if (!clip.speedCurve) return;
    const nextSel = applyCurvePointKeyDown(event, points, idx, readOnly, (nextPts, coalesce) => {
      onSetCurve(clipIndex, nextPts, coalesce);
    });
    if (nextSel !== selectedPoint) setSelectedPoint(nextSel);
  };

  const currentPoint = points[safeSelected];
  const isCustomOrModified = isCurved || Math.abs(constantRate - 1) >= 0.005;

  return (
    <div className={styles.speedPanel}>
      <div className={styles.speedHeadRow}>
        <div className={styles.seg} role="group" aria-label={`${c.speed} ${c.speedModeConstant} / ${c.speedModeCurve}`}>
          <button type="button" disabled={readOnly} aria-pressed={!isCurved} onClick={() => switchMode('constant')}>
            {c.speedModeConstant}
          </button>
          <button type="button" disabled={readOnly} aria-pressed={isCurved} onClick={() => switchMode('curve')}>
            {c.speedModeCurve}
          </button>
        </div>
        <span className={styles.speedLengthReadout}>{lengthText}</span>
      </div>

      {!isCurved ? (
        <div className={styles.speedConstantBox}>
          <div className={styles.speedNumericRow}>
            <label className={styles.speedInputWrap}>
              <span>{c.speedValueLabel}</span>
              <div className={styles.speedInputField}>
                <input
                  type="text"
                  inputMode="decimal"
                  disabled={readOnly}
                  aria-label={c.speedValueLabel}
                  className={styles.speedNumberInput}
                  value={draftRate}
                  onFocus={() => setRateFocused(true)}
                  onChange={(e) => setDraftRate(e.target.value)}
                  onBlur={() => {
                    setRateFocused(false);
                    commitConstantDraft();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitConstantDraft();
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setDraftRate(formatSpeed(constantRate));
                      e.currentTarget.blur();
                    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      const delta = e.key === 'ArrowUp' ? 0.01 : -0.01;
                      const next = clampSpeed((parseSpeedInput(draftRate) ?? constantRate) + delta);
                      setDraftRate(formatSpeed(next));
                      onSetConstant(clipIndex, next, false);
                    }
                  }}
                />
                <span aria-hidden="true">×</span>
              </div>
            </label>
            {isCustomOrModified && (
              <button type="button" className={styles.speedResetBtn} disabled={readOnly} onClick={() => onReset(clipIndex)}>
                {c.speedReset}
              </button>
            )}
          </div>

          <div className={styles.speedSliderBlock}>
            <SpeedSliderTrack
              label={c.speedSliderLabel}
              constantRate={constantRate}
              readOnly={readOnly}
              trackRef={sliderTrackRef}
              dragging={draggingSlider}
              onCommit={(rate, coalesce) => onSetConstant(clipIndex, rate, coalesce)}
              onDraggingChange={setDraggingSlider}
            />
            <div className={styles.speedTicks} aria-hidden="true">
              <span>0.1×</span>
              <span>1×</span>
              <span>10×</span>
            </div>
          </div>

          <div className={styles.seg} role="group" aria-label={c.speed}>
            {LEGACY_SPEEDS.map((speed) => {
              const active = clip.speedNum === speed.num && clip.speedDen === speed.den;
              return (
                <button key={speed.label} type="button" disabled={readOnly} aria-pressed={active} onClick={() => onSetConstant(clipIndex, speed.rate)}>
                  {speed.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={styles.speedCurveBox}>
          <div className={styles.speedPresetsGrid} role="group" aria-label={c.speedPresets}>
            {SPEED_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={styles.speedPresetBtn}
                disabled={readOnly}
                aria-pressed={activePreset === preset.id}
                onClick={() => {
                  onSetCurve(clipIndex, preset.points);
                  setSelectedPoint(1);
                }}
              >
                <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width={SPARK_W} height={SPARK_H} aria-hidden="true">
                  <line x1={3} y1={SPARK_H / 2} x2={SPARK_W - 3} y2={SPARK_H / 2} stroke="var(--ys-line-strong)" strokeWidth="1" />
                  <path d={SPARKLINE_CACHE[preset.id]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{presetLabelOf(preset.id, c)}</span>
              </button>
            ))}
          </div>

          <div className={styles.speedGraphWrap}>
            <svg
              ref={svgRef}
              data-testid="speed-curve-svg"
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className={styles.speedGraphSvg}
              role="application"
              aria-label={c.speedCurveCanvas}
              onPointerDown={handleSvgPointerDown}
              onPointerMove={handleSvgPointerMove}
              onPointerUp={handleSvgPointerUp}
              onPointerCancel={handleSvgPointerUp}
            >
              {[10, 2, 1, 0.5, 0.1].map((tick) => {
                const y = speedToY(tick);
                const isBase = tick === 1;
                return (
                  <g key={tick}>
                    <line
                      x1={PAD_LEFT}
                      y1={y}
                      x2={PAD_LEFT + PLOT_W}
                      y2={y}
                      stroke={isBase ? 'var(--ys-line-strong)' : 'var(--ys-line)'}
                      strokeDasharray={isBase ? undefined : '2 3'}
                      strokeWidth="1"
                    />
                    {(tick === 10 || tick === 1 || tick === 0.1) && (
                      <text x={PAD_LEFT - 4} y={y + 3} textAnchor="end" className={styles.speedSvgLabel}>
                        {tick}×
                      </text>
                    )}
                  </g>
                );
              })}

              {curveGeometry && (
                <>
                  <path d={curveGeometry.area} fill="var(--ys-ink)" fillOpacity="0.06" />
                  <path d={curveGeometry.line} fill="none" stroke="var(--ys-ink)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}

              {playheadDot && (
                <g data-testid="speed-curve-playhead">
                  <line
                    x1={playheadDot.x}
                    y1={PAD_Y}
                    x2={playheadDot.x}
                    y2={PAD_Y + PLOT_H}
                    stroke="var(--ys-accent)"
                    strokeWidth="1.25"
                    strokeDasharray="2 2"
                  />
                  <circle cx={playheadDot.x} cy={playheadDot.y} r="3" fill="var(--ys-accent)" />
                </g>
              )}

              {points.map((pt, idx) => {
                const cx = posToX(pt.pos);
                const cy = speedToY(pt.speed);
                const active = idx === safeSelected;
                return (
                  <g
                    key={idx}
                    tabIndex={readOnly ? -1 : 0}
                    role="slider"
                    data-curve-point={idx}
                    className={styles.speedCurvePoint}
                    aria-label={fillTemplate(c.speedPointLabel, {
                      index: idx + 1,
                      percent: Math.round(pt.pos * 100),
                      speed: formatSpeed(pt.speed),
                    })}
                    aria-valuemin={MIN_SPEED}
                    aria-valuemax={MAX_SPEED}
                    aria-valuenow={pt.speed}
                    onKeyDown={(e) => handlePointKeyDown(e, idx)}
                    onFocus={() => setSelectedPoint(idx)}
                    onClick={() => setSelectedPoint(idx)}
                    style={{ cursor: readOnly ? 'default' : 'grab' }}
                  >
                    <circle cx={cx} cy={cy} r={points.length > 24 ? 6 : 10} fill="transparent" />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={points.length > 16 ? (active ? 4.5 : 3) : active ? 5 : 4}
                      fill={active ? 'var(--ys-accent)' : 'var(--ys-canvas)'}
                      stroke="var(--ys-ink)"
                      strokeWidth={active ? 2 : 1.5}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {currentPoint && (
            <div className={styles.speedPointBar}>
              <label className={styles.speedMiniField}>
                <span>{c.speedPointTime}</span>
                <input
                  type="number"
                  min={0.1}
                  max={99.9}
                  step={0.1}
                  disabled={readOnly || safeSelected === 0 || safeSelected === points.length - 1}
                  value={Number((currentPoint.pos * 100).toFixed(1))}
                  onChange={(e) => {
                    const pct = Number(e.target.value);
                    if (!Number.isFinite(pct)) return;
                    onSetCurve(clipIndex, moveCurvePoint(points, safeSelected, pct / 100, currentPoint.speed), true);
                  }}
                />
              </label>
              <label className={styles.speedMiniField}>
                <span>{c.speedPointRate}</span>
                <input
                  type="number"
                  min={MIN_SPEED}
                  max={MAX_SPEED}
                  step={0.01}
                  disabled={readOnly}
                  value={Number(currentPoint.speed.toFixed(2))}
                  onChange={(e) => {
                    const spd = Number(e.target.value);
                    if (!Number.isFinite(spd) || spd <= 0) return;
                    onSetCurve(clipIndex, moveCurvePoint(points, safeSelected, currentPoint.pos, spd), true);
                  }}
                />
              </label>
              <button
                type="button"
                className={styles.speedPointRemoveBtn}
                disabled={readOnly || points.length <= MIN_CURVE_POINTS || safeSelected === 0 || safeSelected === points.length - 1}
                onClick={() => {
                  onSetCurve(clipIndex, removeCurvePoint(points, safeSelected));
                  setSelectedPoint(Math.max(0, safeSelected - 1));
                }}
              >
                {c.speedRemovePoint}
              </button>
              <button type="button" className={styles.speedResetBtn} disabled={readOnly} onClick={() => onReset(clipIndex)}>
                {c.speedReset}
              </button>
            </div>
          )}

          <p className={styles.hint}>
            {points.length >= MAX_CURVE_TOTAL_POINTS ? c.speedCurveCapHint : points.length >= MAX_CURVE_POINTS ? c.speedCurveLimitHint : c.speedCurveHint}
          </p>
        </div>
      )}

      {showSlowNote && <p className={styles.speedSlowNote}>{c.speedSlowNote}</p>}
    </div>
  );
}
