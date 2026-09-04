import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { z } from 'zod';
import { Dust } from './Dust';
import { Grain } from './Grain';
import { Wordmark } from './Wordmark';
import { BODY, fontsReady } from './fonts';
import { BLACK, CREAM } from './palette';
import { CAP, STROKE, layout } from './wordmark';

void fontsReady;

export const shipCardSchema = z.object({
  /** Render the lockup on an alpha channel (ProRes 4444) for compositing over footage. */
  transparent: z.boolean(),
  /** A few faint motes drifting past the camera — the only thing that says "space". */
  dust: z.boolean(),
});
type Props = z.infer<typeof shipCardSchema>;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outQuint = Easing.bezier(0.22, 1, 0.36, 1);
const inQuad = Easing.in(Easing.quad);
const heavy = Easing.bezier(0.42, 0, 0.15, 1); // a hull, not a camera: slow to start, long to settle
const level = Easing.bezier(0.6, 0, 0.1, 1);
const sweep = Easing.bezier(0.4, 0, 0.2, 1);

/*
 * Timeline (30 fps, 300 frames = 10.0 s) — "the ship"
 *   0–14     black
 *  14–120    far out, tilted hard away, the wordmark constructs itself
 *  10–252    the hull closes on the camera: real Z travel under perspective, so it grows the way a
 *            body at constant speed does (slowly, then fast), while pitch 58° → 6°, yaw −22° → 3°,
 *            roll −4° → 0.5° level it out. Slow sines of different periods keep every axis drifting:
 *            it never moves on rails.
 *  50–252    focus pulls sharp, exposure lifts, a faint backlight gathers
 * 176–216    "PRODUCED BY" comes up on the hull
 * 218–258    the arrival light crosses the letters
 * 252–299    hold — still drifting, still creeping in
 * 272–299    dissolve to black
 */
const T = { black: 14, travel: [10, 252] as const, eyebrow: 176, sheen: 218, out: 272 } as const;

const TEXT = 'YAGI WORKSHOP';
const PERSPECTIVE = 1400;
const FAR = 5.2; // distance ratio at the start: apparent size = 1 / FAR
const SLICES = 20; // extrusion depth in slices
const SLICE = 1.5; // px per slice at the front face

/** A slow, deterministic drift: sum of two sines with unrelated periods (seconds). */
const drift = (frame: number, a: number, pa: number, b: number, pb: number, phase: number) =>
  Math.sin(((frame / 30) * Math.PI * 2) / pa + phase) * a + Math.sin(((frame / 30) * Math.PI * 2) / pb + phase * 1.7) * b;

const mix = (a: string, b: string, t: number) => {
  const A = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)) as [number, number, number];
  const B = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)) as [number, number, number];
  return `rgb(${A.map((v, i) => Math.round(v + (B[i]! - v) * t)).join(',')})`;
};

export const ShipCard = ({ transparent, dust }: Props) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;

  // Final size: 78 % of a landscape frame, 88 % of a portrait one, never taller than 112 px cap.
  const inkWidth = layout(TEXT).width + STROKE + 4;
  const capHeight = Math.min(112, ((portrait ? 0.88 : 0.78) * width * CAP) / inkWidth);
  const s = capHeight / 96;
  const k = height / 1080;

  // --- the approach ---------------------------------------------------------
  const e = interpolate(frame, T.travel, [0, 1], { ...clamp, easing: heavy });
  const lv = interpolate(frame, [T.travel[0], T.travel[1] - 16], [0, 1], { ...clamp, easing: level });
  const creep = interpolate(frame, [T.travel[1], durationInFrames], [0, 0.03], clamp);
  const distance = FAR + (1 - FAR) * e - creep; // 6.2 → 1 → 0.97
  const z = -PERSPECTIVE * (distance - 1) * k;

  const rx = interpolate(lv, [0, 1], [58, 6]) + drift(frame, 1.6, 6.3, 0.7, 2.7, 0.4);
  const ry = interpolate(lv, [0, 1], [-22, 3]) + drift(frame, 2.2, 5.1, 0.8, 2.9, 2.1);
  const rz = interpolate(lv, [0, 1], [-4, 0.5]) + drift(frame, 0.9, 7.7, 0.35, 3.3, 1.3);
  const tx = interpolate(lv, [0, 1], [-0.1, 0]) * width + drift(frame, 0.012, 8.2, 0.004, 3.7, 0.2) * width;
  const ty = interpolate(lv, [0, 1], [0.05, -0.02]) * height + drift(frame, 0.008, 6.9, 0.003, 3.1, 1.9) * height;

  const focus = interpolate(e, [0, 0.8], [3, 0], clamp) * k;
  const exposure = interpolate(e, [0, 1], [0.38, 1]);
  const backlight = interpolate(frame, [50, T.travel[1]], [0, 0.09], { ...clamp, easing: sweep });

  // --- light --------------------------------------------------------------
  // A standing specular that slides with the yaw, then one hard pass on arrival.
  const passX = interpolate(frame, [T.sheen, T.sheen + 40], [0, 1], { ...clamp, easing: sweep });
  const passing = frame >= T.sheen && frame < T.sheen + 40;
  const sheen = passing ? { x: passX, width: 0.16 } : { x: 0.5 - ry / 50, width: 0.36, peak: '#FAF8F3' };

  const eyebrow = interpolate(frame, [T.eyebrow, T.eyebrow + 40], [0, 1], { ...clamp, easing: outQuint });
  const out = interpolate(frame, [T.out, durationInFrames - 1], [1, 0], { ...clamp, easing: inQuad });

  const lockupWidth = (inkWidth / CAP) * capHeight;
  const apparent = PERSPECTIVE / (PERSPECTIVE - z / k);

  const face = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60 * s }}>
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
      <Wordmark text={TEXT} capHeight={capHeight} at={T.black} reveal="draw" stagger={3.4} draw={44} sheen={sheen} />
    </div>
  );

  return (
    <AbsoluteFill style={{ background: transparent ? 'transparent' : BLACK }}>
      {transparent || !dust ? null : <Dust progress={e} width={width} height={height} />}
      <AbsoluteFill style={{ opacity: out }}>
        {transparent ? null : (
          <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
            <div
              style={{
                width: lockupWidth * 1.7 * apparent,
                height: lockupWidth * 0.6 * apparent,
                borderRadius: '50%',
                background: `radial-gradient(ellipse at center, rgba(232,228,220,${backlight}) 0%, rgba(232,228,220,0) 62%)`,
                transform: `translate(${tx * 0.6}px, ${ty * 0.6}px)`,
              }}
            />
          </AbsoluteFill>
        )}
        {/* blur lives outside the 3D context: a filter would flatten preserve-3d */}
        <AbsoluteFill style={{ filter: focus > 0.05 ? `blur(${focus}px)` : undefined, opacity: exposure }}>
          <AbsoluteFill style={{ perspective: PERSPECTIVE * k, perspectiveOrigin: '50% 50%', justifyContent: 'center', alignItems: 'center' }}>
            <div
              style={{
                position: 'relative',
                transformStyle: 'preserve-3d',
                transform: `translate3d(${tx}px, ${ty}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
              }}
            >
              {/* extrusion: the same strokes stacked behind the face, darkening with depth */}
              {Array.from({ length: SLICES }, (_, i) => (
                <div key={i} style={{ position: 'absolute', inset: 0, transform: `translateZ(${-(i + 1) * SLICE * k}px)` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 60 * s }}>
                    <div style={{ fontSize: 22 * s, lineHeight: 1, opacity: 0 }}>PRODUCED BY</div>
                    <Wordmark
                      text={TEXT}
                      capHeight={capHeight}
                      at={T.black}
                      reveal="draw"
                      stagger={3.4}
                      draw={44}
                      color={mix('#8F8B84', '#2A2826', i / (SLICES - 1))}
                    />
                  </div>
                </div>
              ))}
              {face}
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
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
