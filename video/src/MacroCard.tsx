import { CameraMotionBlur } from '@remotion/motion-blur';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Dust } from './Dust';
import { Grain } from './Grain';
import { Wordmark } from './Wordmark';
import { BODY, fontsReady } from './fonts';
import { BLACK, CREAM } from './palette';
import { CAP, STROKE, layout } from './wordmark';

void fontsReady;

export const macroCardSchema = z.object({
  /** Render the lockup on an alpha channel (ProRes 4444) for compositing over footage. */
  transparent: z.boolean(),
  /** A few faint motes drifting past the camera. */
  dust: z.boolean(),
  /** Real multi-sample motion blur on the pull-back (slower render). */
  motionBlur: z.boolean(),
});
type Props = z.infer<typeof macroCardSchema>;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const inQuad = Easing.in(Easing.quad);
const pull = Easing.bezier(0.7, 0, 0.1, 1); // the retreat: slow to let go, violent in the middle, a long landing
const glide = Easing.bezier(0.4, 0, 0.6, 1);
const sweep = Easing.bezier(0.4, 0, 0.2, 1);

/*
 * Timeline (30 fps, 300 frames = 10.0 s) — "macro"
 *   0–52     the camera is ON the letters: a grazing close-up, six times life size, gliding along
 *            the strokes of WORKSHOP while a band of light slides across the surfaces. Abstract —
 *            cream faces, dark extruded sides, grain.
 *  52–215    the pull-back: the camera lets go and retreats hard (motion-blurred), the fragment
 *            resolves into letters, the letters into the wordmark, the grazing angle levels out.
 *            It lands on a long deceleration.
 * 222–262    arrival: one hard band of light crosses the letters, a short monochrome bloom peaks
 *            behind it, the backlight blooms, "PRODUCED BY" comes up.
 * 262–299    hold — still easing back a hair — and dissolve.
 */
const T = { macroEnd: 52, pullEnd: 215, sheen: 222, bloom: 232, eyebrow: 226, out: 270 } as const;

const TEXT = 'YAGI WORKSHOP';
const P = 1600; // perspective distance
const CLOSE = 4.5; // apparent magnification at the start
const SLICES = 20;
const SLICE = 1.5;

type V3 = [number, number, number];
const rad = (d: number) => (d * Math.PI) / 180;
/** CSS `rotateX(rx) rotateY(ry) rotateZ(rz)` applied to a local point (right-to-left). */
const rotate = ([x0, y0, z0]: V3, rx: number, ry: number, rz: number): V3 => {
  let x = x0, y = y0, z = z0;
  let c = Math.cos(rad(rz)), s = Math.sin(rad(rz));
  [x, y] = [x * c - y * s, x * s + y * c];
  c = Math.cos(rad(ry)); s = Math.sin(rad(ry));
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(rad(rx)); s = Math.sin(rad(rx));
  [y, z] = [y * c - z * s, y * s + z * c];
  return [x, y, z];
};
const drift = (frame: number, a: number, pa: number, b: number, pb: number, phase: number) =>
  Math.sin(((frame / 30) * Math.PI * 2) / pa + phase) * a + Math.sin(((frame / 30) * Math.PI * 2) / pb + phase * 1.7) * b;
const mix = (a: string, b: string, t: number) => {
  const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)) as V3;
  const B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)) as V3;
  return `rgb(${A.map((v, i) => Math.round(v + (B[i]! - v) * t)).join(',')})`;
};

const Scene = ({ transparent }: { transparent: boolean }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  const k = height / 1080;

  const inkWidth = layout(TEXT).width + STROKE + 4;
  const capHeight = Math.min(112, ((portrait ? 0.88 : 0.78) * width * CAP) / inkWidth);
  const s = capHeight / 96;
  const lockupWidth = (inkWidth / CAP) * capHeight;

  // --- camera -----------------------------------------------------------------
  const g = interpolate(frame, [0, T.macroEnd], [0, 1], { ...clamp, easing: glide }); // the glide along the surface
  const u = interpolate(frame, [T.macroEnd, T.pullEnd], [0, 1], { ...clamp, easing: pull }); // the pull-back
  const settle = interpolate(frame, [T.pullEnd, durationInFrames], [0, 1], clamp);

  // Where the camera looks, in the wordmark's own coordinates (x across the word, y down).
  const fx = interpolate(g, [0, 1], [0.34, 0.12]) * lockupWidth * (1 - u); // slides from "SHOP" toward "WOR", then to centre
  const fy = interpolate(g, [0, 1], [0.05, -0.12]) * capHeight * (1 - u);
  const depth = interpolate(u, [0, 1], [P * (1 - 1 / CLOSE), 0]) - settle * 40 * k; // z of the focus point
  const rx = interpolate(u, [0, 1], [interpolate(g, [0, 1], [64, 58]), 5]) + drift(frame, 1.2, 6.1, 0.5, 2.6, 0.3) * (1 - 0.6 * u);
  const ry = interpolate(u, [0, 1], [-9, 2]) + drift(frame, 1.6, 5.3, 0.6, 3.1, 2.0) * (1 - 0.6 * u);
  const rz = interpolate(u, [0, 1], [-7, 0.4]) + drift(frame, 0.7, 7.3, 0.3, 3.4, 1.2) * (1 - 0.6 * u);

  const rd = rotate([fx, fy, 0], rx, ry, rz);
  const tx = -rd[0] * k;
  const ty = -rd[1] * k;
  const tz = (depth - rd[2]) * k;

  // --- light -------------------------------------------------------------------
  const macroBand = interpolate(g, [0, 1], [0.95, 0.25]);
  const passX = interpolate(frame, [T.sheen, T.sheen + 40], [0, 1], { ...clamp, easing: sweep });
  const passing = frame >= T.sheen && frame < T.sheen + 40;
  const sheen = passing
    ? { x: passX, width: 0.16 }
    : frame < T.macroEnd + 30
      ? { x: macroBand, width: 0.22, peak: '#FFFFFF' }
      : { x: 0.5 - ry / 50, width: 0.36, peak: '#FAF8F3' };
  const bloom = interpolate(frame, [T.bloom - 8, T.bloom + 6, T.bloom + 40], [0, 0.45, 0.08], { ...clamp, easing: sweep });
  const backlight = interpolate(frame, [T.pullEnd - 30, T.bloom + 30], [0, 0.1], { ...clamp, easing: sweep });
  const exposure = interpolate(u, [0, 1], [0.8, 1]);

  const eyebrow = interpolate(frame, [T.eyebrow, T.eyebrow + 36], [0, 1], { ...clamp, easing: outQuint });
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });

  const mark = (color?: string, sh?: typeof sheen) => (
    <Wordmark text={TEXT} capHeight={capHeight} at={-200} reveal="draw" color={color} sheen={sh} />
  );
  const stack = (children: React.ReactNode, hidden = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60 * s }}>
      <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 22 * s, lineHeight: 1, letterSpacing: '0.32em', marginLeft: '0.32em', color: CREAM, opacity: hidden ? 0 : 0.55 * eyebrow }}>
        PRODUCED BY
      </div>
      {children}
    </div>
  );

  return (
    <AbsoluteFill style={{ opacity: out }}>
      {transparent ? null : (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div
            style={{
              width: lockupWidth * 1.7,
              height: lockupWidth * 0.6,
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, rgba(232,228,220,${backlight}) 0%, rgba(232,228,220,0) 62%)`,
            }}
          />
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ opacity: exposure }}>
        <AbsoluteFill style={{ perspective: P * k, perspectiveOrigin: '50% 50%', justifyContent: 'center', alignItems: 'center' }}>
          <div
            style={{
              position: 'relative',
              transformStyle: 'preserve-3d',
              transform: `translate3d(${tx}px, ${ty}px, ${tz}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
            }}
          >
            {Array.from({ length: SLICES }, (_, i) => (
              <div key={i} style={{ position: 'absolute', inset: 0, transform: `translateZ(${-(i + 1) * SLICE * k}px)` }}>
                {stack(mark(mix('#8F8B84', '#2A2826', i / (SLICES - 1))), true)}
              </div>
            ))}
            {/* bloom: a blurred twin of the face, screened over it, peaking on arrival */}
            {bloom > 0.01 ? (
              <div style={{ position: 'absolute', inset: 0, transform: 'translateZ(1px)', filter: `blur(${18 * k}px)`, opacity: bloom, mixBlendMode: 'screen' }}>
                {stack(mark('#FFFFFF'), true)}
              </div>
            ) : null}
            {stack(mark(undefined, sheen))}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const MacroCard = ({ transparent, dust, motionBlur }: Props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const u = interpolate(frame, [T.macroEnd, T.pullEnd], [0, 1], { ...clamp, easing: pull });
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });
  const scene = <Scene transparent={transparent} />;
  return (
    <AbsoluteFill style={{ background: transparent ? 'transparent' : BLACK }}>
      {transparent || !dust ? null : <Dust progress={0.15 + 0.85 * (1 - u)} width={width} height={height} />}
      {/* Real motion blur only while the camera is actually moving fast: the pull-back. */}
      {motionBlur && frame >= T.macroEnd + 4 && frame <= T.pullEnd - 8 ? (
        <CameraMotionBlur shutterAngle={200} samples={4}>
          {scene}
        </CameraMotionBlur>
      ) : (
        scene
      )}
      {transparent ? null : (
        <>
          <AbsoluteFill
            style={{ background: 'radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.62) 100%)', pointerEvents: 'none' }}
          />
          <Grain opacity={interpolate(u, [0, 1], [0.11, 0.075])} />
          <AbsoluteFill style={{ background: BLACK, opacity: 1 - out }} />
        </>
      )}
    </AbsoluteFill>
  );
};
