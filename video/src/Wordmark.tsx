import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { CAP, CREAM, STROKE, layout } from './wordmark';

export type Reveal = 'draw' | 'fade';

const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const STAGGER = 1.8; // frames between letters
const DRAW = 24; // frames a letter takes to construct itself

/** A slanted band of light crossing the strokes once: `x` runs 0 → 1 across the wordmark. */
export interface Sheen {
  x: number;
  /** band half-width as a fraction of the wordmark width */
  width?: number;
  /** peak colour at the centre of the band */
  peak?: string;
}

/**
 * The constructed wordmark, animated. `draw`: every stroke extends along its own path
 * (verticals rise from the baseline, rings sweep round), left to right. `fade`: the quiet
 * A24-style version — letters simply come up, with a whisper of left-to-right stagger.
 */
export const Wordmark = ({
  text = 'YAGI WORKSHOP',
  capHeight,
  at,
  reveal,
  color = CREAM,
  stagger = STAGGER,
  draw = DRAW,
  sheen,
}: {
  text?: string;
  capHeight: number;
  at: number;
  reveal: Reveal;
  color?: string;
  /** frames between letters */
  stagger?: number;
  /** frames a letter takes to construct (or fade) */
  draw?: number;
  sheen?: Sheen;
}) => {
  const frame = useCurrentFrame();
  const { glyphs, width } = layout(text);
  const pad = STROKE / 2 + 2;
  const k = capHeight / CAP;

  // The sheen is a user-space gradient so it sweeps across the whole word, not per letter.
  const bw = (sheen?.width ?? 0.14) * width;
  const cx = sheen ? -bw + sheen.x * (width + 2 * bw) : 0;
  const stroke = sheen ? 'url(#sheen)' : color;

  return (
    <svg
      width={(width + 2 * pad) * k}
      height={(CAP + 2 * pad) * k}
      viewBox={`${-pad} ${-pad} ${width + 2 * pad} ${CAP + 2 * pad}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <clipPath id="cap">
          <rect x={-40} y={0} width={240} height={CAP} />
        </clipPath>
        {sheen ? (
          <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1={cx - bw} y1={0} x2={cx + bw} y2={CAP * 0.45}>
            <stop offset="0" stopColor={color} />
            <stop offset="0.5" stopColor={sheen.peak ?? '#FFFFFF'} />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        ) : null}
      </defs>
      <g fill="none" stroke={stroke} strokeWidth={STROKE} strokeLinecap="butt" strokeLinejoin="miter" strokeMiterlimit={12}>
        {glyphs.map((g) => {
          const start = at + g.index * stagger;
          const p = interpolate(frame, [start, start + draw], [0, 1], { ...clamp, easing: outQuint });
          return (
            <g key={g.index} transform={`translate(${g.x} 0)`} clipPath={g.clip ? 'url(#cap)' : undefined} opacity={reveal === 'fade' ? p : 1}>
              {g.paths.map((d, i) => (
                <path key={i} d={d} pathLength={1} strokeDasharray={reveal === 'draw' ? 1 : undefined} strokeDashoffset={reveal === 'draw' ? 1 - p : undefined} />
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
};
