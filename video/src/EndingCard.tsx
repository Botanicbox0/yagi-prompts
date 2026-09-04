import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Grain } from './Grain';
import { Mark } from './Mark';
import { BODY, DISPLAY, MONO, fontsReady } from './fonts';
import { BLACK, CREAM, MUTED } from './palette';

void fontsReady;

export const endingCardSchema = z.object({
  /** Render the lockup on an alpha channel (ProRes 4444) for compositing over footage. */
  transparent: z.boolean(),
});
type Props = z.infer<typeof endingCardSchema>;

const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const inQuad = Easing.in(Easing.quad);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/*
 * Timeline (30 fps, 90 frames = 3.0 s)
 *   0–4    black
 *   4–18   stem rises
 *  12–34   horns grow
 *  16–36   "PRODUCED BY" tracks in
 *  20–46   Y A G I rise through the baseline clip, 3 f apart
 *  30–52   W O R K S H O P fade in, tracking settles
 *  36–56   hairline extends from centre
 *  72–89   dissolve to black
 * Whole lockup pushes in 3.5 % across the shot.
 */
const T = { stem: 4, horns: 12, eyebrow: 16, yagi: 20, workshop: 30, rule: 36, out: 72 } as const;

const Letters = ({ word, at, stagger, rise, style }: { word: string; at: number; stagger: number; rise: boolean; style: React.CSSProperties }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: 'flex', ...style }}>
      {word.split('').map((ch, i) => {
        const p = interpolate(frame, [at + i * stagger, at + i * stagger + 18], [0, 1], { ...clamp, easing: outQuint });
        return rise ? (
          <span key={i} style={{ display: 'block', overflow: 'hidden', padding: '0.12em 0', margin: '-0.12em 0' }}>
            <span style={{ display: 'block', transform: `translateY(${(1 - p) * 1.15}em)` }}>{ch}</span>
          </span>
        ) : (
          <span key={i} style={{ display: 'block', opacity: p }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
};

const Lockup = () => {
  const frame = useCurrentFrame();
  const eyebrow = interpolate(frame, [T.eyebrow, T.eyebrow + 20], [0, 1], { ...clamp, easing: outQuint });
  const workTrack = interpolate(frame, [T.workshop, T.workshop + 26], [0, 1], { ...clamp, easing: outQuint });
  const rule = interpolate(frame, [T.rule, T.rule + 20], [0, 1], { ...clamp, easing: outQuint });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, color: CREAM }}>
      <Mark size={150} stemAt={T.stem} hornsAt={T.horns} />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: `${0.42 + (1 - eyebrow) * 0.5}em`,
          marginLeft: `${0.42 + (1 - eyebrow) * 0.5}em`,
          color: MUTED,
          opacity: eyebrow,
          lineHeight: 1.2,
        }}
      >
        PRODUCED BY
      </div>
      <Letters
        word="YAGI"
        at={T.yagi}
        stagger={3}
        rise
        style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 230, lineHeight: 0.86, letterSpacing: '-0.015em', marginRight: '-0.015em' }}
      />
      <Letters
        word="WORKSHOP"
        at={T.workshop}
        stagger={1.5}
        rise={false}
        style={{
          fontFamily: BODY,
          fontWeight: 500,
          fontSize: 30,
          lineHeight: 1.2,
          letterSpacing: `${0.58 + (1 - workTrack) * 0.3}em`,
          marginLeft: `${0.58 + (1 - workTrack) * 0.3}em`,
          opacity: 0.85,
        }}
      />
      <div style={{ width: 120, height: 1, background: CREAM, opacity: 0.5, transform: `scaleX(${rule})` }} />
    </div>
  );
};

export const EndingCard = ({ transparent }: Props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  // The lockup is designed on a 1920-wide canvas; portrait gets a larger share of its width.
  const k = portrait ? width / 1320 : width / 1920;
  const push = interpolate(frame, [0, durationInFrames], [1, 1.035]);
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });

  return (
    <AbsoluteFill style={{ background: transparent ? 'transparent' : BLACK }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: out }}>
        <div style={{ transform: `scale(${k * push})` }}>
          <Lockup />
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
