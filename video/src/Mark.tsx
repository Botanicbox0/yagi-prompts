import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { LEFT, RIGHT, STEM, hornPath } from './mark-geometry';
import { CREAM } from './palette';

const outQuint = Easing.bezier(0.22, 1, 0.36, 1);

/** Animated monogram: the stem rises from its foot, then both horns grow out of its top. */
export const Mark = ({ size, stemAt, hornsAt, color = CREAM }: { size: number; stemAt: number; hornsAt: number; color?: string }) => {
  const frame = useCurrentFrame();
  const stem = interpolate(frame, [stemAt, stemAt + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outQuint });
  const grow = interpolate(frame, [hornsAt, hornsAt + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: outQuint });
  const stemH = STEM.h * stem;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ display: 'block' }}>
      <g fill={color}>
        <rect x={STEM.x} y={STEM.y + STEM.h - stemH} width={STEM.w} height={stemH} />
        {grow > 0 ? (
          <>
            <path d={hornPath(LEFT, grow)} />
            <path d={hornPath(RIGHT, grow)} />
          </>
        ) : null}
      </g>
    </svg>
  );
};
