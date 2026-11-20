'use client';
/**
 * A sound's shape as thin bars (docs/BRAND-SOUND-STUDIO.md §4.2). Compact in the row, full width in the open
 * row where it also seeks: click, or the arrow keys on the focused bar (5 % a step, Home/End).
 * Before the file is decoded it draws a quiet flat line, so rows never jump.
 */
import type { KeyboardEvent, PointerEvent } from 'react';
import s from './sound.module.css';

const COMPACT_BARS = 56;

function resample(values: readonly number[], bars: number): number[] {
  if (values.length <= bars) return [...values];
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor((i * values.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * values.length) / bars));
    let peak = 0;
    for (let j = start; j < end; j += 1) peak = Math.max(peak, values[j]!);
    out.push(peak);
  }
  return out;
}

export function Waveform(props: {
  peaks: readonly number[] | null;
  /** 0..1 of the way through. */
  progress: number;
  compact?: boolean;
  onSeek?: (ratio: number) => void;
  label?: string;
}) {
  const bars = props.peaks ? (props.compact ? resample(props.peaks, COMPACT_BARS) : [...props.peaks]) : null;
  const count = bars?.length ?? (props.compact ? COMPACT_BARS : 160);
  const width = count * 3;
  const played = Math.round(props.progress * count);
  const seekable = Boolean(props.onSeek);

  const fromPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    props.onSeek?.(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
  };
  const fromKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === 'ArrowRight' ? 0.05 : event.key === 'ArrowLeft' ? -0.05 : null;
    if (event.key === 'Home') props.onSeek?.(0);
    else if (event.key === 'End') props.onSeek?.(0.999);
    else if (step !== null) props.onSeek?.(Math.max(0, Math.min(1, props.progress + step)));
    else return;
    event.preventDefault();
  };

  return (
    <svg
      className={s.wave}
      data-compact={props.compact ? '' : undefined}
      data-ready={bars ? '' : undefined}
      viewBox={`0 0 ${width} 40`}
      preserveAspectRatio="none"
      role={seekable ? 'slider' : undefined}
      aria-label={seekable ? props.label : undefined}
      aria-valuemin={seekable ? 0 : undefined}
      aria-valuemax={seekable ? 100 : undefined}
      aria-valuenow={seekable ? Math.round(props.progress * 100) : undefined}
      tabIndex={seekable ? 0 : undefined}
      onPointerDown={seekable ? fromPointer : undefined}
      onKeyDown={seekable ? fromKey : undefined}
      aria-hidden={seekable ? undefined : true}
      data-sound-wave
    >
      {bars ? (
        bars.map((value, i) => {
          const h = Math.max(2, value * 36);
          return <rect key={i} x={i * 3} y={20 - h / 2} width={1.6} height={h} rx={0.8} data-played={i < played ? '' : undefined} />;
        })
      ) : (
        <rect x={0} y={19.5} width={width} height={1} data-flat />
      )}
    </svg>
  );
}
