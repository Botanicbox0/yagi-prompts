import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Grain } from './Grain';
import { Wordmark } from './Wordmark';
import { BODY, fontsReady } from './fonts';
import { BLACK, CREAM } from './palette';
import { CAP, STROKE, layout } from './wordmark';

void fontsReady;

export const longCardSchema = z.object({
  /** Render the lockup on an alpha channel (ProRes 4444) for compositing over footage. */
  transparent: z.boolean(),
});
type Props = z.infer<typeof longCardSchema>;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const inQuad = Easing.in(Easing.quad);
// A heavy camera move: slow off the mark, a long deceleration into the final frame.
const dolly = Easing.bezier(0.55, 0, 0.1, 1);
const sweep = Easing.bezier(0.4, 0, 0.2, 1);

/*
 * Timeline (30 fps, 300 frames = 10.0 s) — "the long approach"
 *   0–20     black
 *  20–96     far away, the wordmark constructs itself (3.2 f between letters, 40 f per letter)
 *  10–250    the camera dollies in: scale 0.42 → 1, focus pulls from soft to sharp, exposure lifts
 *  40–250    a faint backlight gathers behind the mark
 * 160–200    "PRODUCED BY" comes up
 * 206–250    one slanted band of light crosses the letters — it has arrived
 * 250–299    hold, still creeping in
 * 270–299    dissolve to black
 */
const T = { black: 20, dollyStart: 10, dollyEnd: 250, eyebrow: 160, sheen: 206, out: 270 } as const;

const TEXT = 'YAGI WORKSHOP';

export const LongCard = ({ transparent }: Props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;

  // Final size: 70 % of a landscape frame, 86 % of a portrait one, never taller than 104 px cap.
  const inkWidth = layout(TEXT).width + STROKE + 4;
  const capHeight = Math.min(104, ((portrait ? 0.86 : 0.7) * width * CAP) / inkWidth);
  const s = capHeight / 96;

  const p = interpolate(frame, [T.dollyStart, T.dollyEnd], [0, 1], { ...clamp, easing: dolly });
  const creep = interpolate(frame, [T.dollyEnd, durationInFrames], [0, 0.025], clamp);
  const scale = 0.42 + 0.58 * p + creep;
  const focus = interpolate(p, [0, 0.85], [2.8, 0], clamp); // px of blur at 1080p, scaled below
  const exposure = 0.55 + 0.45 * p;
  const backlight = interpolate(frame, [40, T.dollyEnd], [0, 0.085], { ...clamp, easing: sweep });

  const eyebrow = interpolate(frame, [T.eyebrow, T.eyebrow + 40], [0, 1], { ...clamp, easing: outQuint });
  const sheenX = interpolate(frame, [T.sheen, T.sheen + 44], [0, 1], { ...clamp, easing: sweep });
  const sheen = frame > T.sheen && frame < T.sheen + 44 ? { x: sheenX, width: 0.16 } : undefined;
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });

  const lockupWidth = (inkWidth / CAP) * capHeight;

  return (
    <AbsoluteFill style={{ background: transparent ? 'transparent' : BLACK }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: out }}>
        {/* Backlight: a luminance haze that gathers behind the mark as it arrives. Monochrome. */}
        {transparent ? null : (
          <div
            style={{
              position: 'absolute',
              width: lockupWidth * 1.6 * scale,
              height: lockupWidth * 0.55 * scale,
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, rgba(232,228,220,${backlight}) 0%, rgba(232,228,220,0) 62%)`,
              transform: `translateY(${-0.03 * height}px)`,
            }}
          />
        )}
        <div
          style={{
            transform: `translateY(${-0.03 * height}px) scale(${scale})`,
            filter: focus > 0.05 ? `blur(${focus * (height / 1080)}px)` : undefined,
            opacity: exposure,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 58 * s,
          }}
        >
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
          <Wordmark text={TEXT} capHeight={capHeight} at={T.black} reveal="draw" stagger={3.2} draw={40} sheen={sheen} />
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
