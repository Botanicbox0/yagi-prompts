import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Grain } from './Grain';
import { Wordmark } from './Wordmark';
import { BODY, fontsReady } from './fonts';
import { BLACK, CREAM } from './palette';
import { CAP, STROKE, layout } from './wordmark';

void fontsReady;

export const endingCardSchema = z.object({
  /** Render the lockup on an alpha channel (ProRes 4444) for compositing over footage. */
  transparent: z.boolean(),
  /** `draw`: strokes construct the letters. `fade`: the letters simply come up. */
  reveal: z.enum(['draw', 'fade']),
});
type Props = z.infer<typeof endingCardSchema>;

const inQuad = Easing.in(Easing.quad);
const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/*
 * Timeline (30 fps, 90 frames = 3.0 s)
 *   0–6    black
 *   6–50   the wordmark constructs itself, left to right (1.8 f between letters)
 *  34–54   "PRODUCED BY" comes up above it
 *  50–76   hold
 *  76–89   dissolve to black
 * The whole lockup pushes in 2.5 % across the shot.
 */
const T = { mark: 6, eyebrow: 34, out: 76 } as const;

const TEXT = 'YAGI WORKSHOP';

export const EndingCard = ({ transparent, reveal }: Props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;

  // The wordmark takes 64 % of a landscape frame, 86 % of a portrait one, never taller than 96 px cap.
  const inkWidth = layout(TEXT).width + STROKE + 4;
  const capHeight = Math.min(96, ((portrait ? 0.86 : 0.64) * width * CAP) / inkWidth);
  const s = capHeight / 96; // everything else scales with the mark

  const eyebrow = interpolate(frame, [T.eyebrow, T.eyebrow + 20], [0, 1], { ...clamp, easing: outQuint });
  const push = interpolate(frame, [0, durationInFrames], [1, 1.025]);
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });

  return (
    <AbsoluteFill style={{ background: transparent ? 'transparent' : BLACK }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: out }}>
        {/* Optical centre: the lockup sits a touch above the geometric centre. */}
        <div style={{ transform: `translateY(${-0.03 * height}px) scale(${push})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 54 * s }}>
          <div
            style={{
              fontFamily: BODY,
              fontWeight: 500,
              fontSize: 22 * s,
              lineHeight: 1,
              letterSpacing: '0.32em',
              marginLeft: '0.32em',
              color: CREAM,
              opacity: 0.55 * eyebrow,
            }}
          >
            PRODUCED BY
          </div>
          <Wordmark text={TEXT} capHeight={capHeight} at={T.mark} reveal={reveal} />
        </div>
      </AbsoluteFill>
      {transparent ? null : (
        <>
          <AbsoluteFill
            style={{ background: 'radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.62) 100%)', pointerEvents: 'none' }}
          />
          <Grain />
          <AbsoluteFill style={{ background: BLACK, opacity: 1 - out }} />
        </>
      )}
    </AbsoluteFill>
  );
};
