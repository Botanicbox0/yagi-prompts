import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { CAP, CREAM, STROKE, layout } from './wordmark';

export type Reveal = 'draw' | 'fade';

const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

const STAGGER = 1.8; // frames between letters
const DRAW = 24; // frames a letter takes to construct itself

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
}: {
  text?: string;
  capHeight: number;
  at: number;
  reveal: Reveal;
  color?: string;
}) => {
  const frame = useCurrentFrame();
  const { glyphs, width } = layout(text);
  const pad = STROKE / 2 + 2;
  const k = capHeight / CAP;

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
      </defs>
      <g fill="none" stroke={color} strokeWidth={STROKE} strokeLinecap="butt" strokeLinejoin="miter" strokeMiterlimit={12}>
        {glyphs.map((g) => {
          const start = at + g.index * STAGGER;
          const p = interpolate(frame, [start, start + (reveal === 'draw' ? DRAW : 24)], [0, 1], { ...clamp, easing: outQuint });
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
