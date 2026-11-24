import { describe, expect, it } from 'vitest';
import { curveRefusalLine } from '@/components/brand-studio/editor-v2/use-editor';
import { applyClipSpeedCurve, setClipSpeedCurve, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { MAX_CURVE_TOTAL_POINTS, SPEED_PRESETS, type SpeedPoint } from '@/lib/brand-studio/editor-v2/speed-curve';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * Audit A2 (2026-11-24): a curve shape that would make a cut shorter than one frame, or pass the point limit,
 * left the film as it was and said nothing, so the button looked broken. The caller now learns why, and the
 * editor says it in one line.
 */
const COPIES: ReadonlyArray<[string, StudioEditorCopy]> = [
  ['ko', studioEditorKo],
  ['en', studioEditorEn],
];

const FPS = 24;
const cut = (extra: Partial<FrameClip> = {}): FrameClip => ({
  id: 'c1',
  label: 'c1',
  srcUrl: '/media/a.mp4',
  thumbUrl: null,
  sourceFps: FPS,
  sourceFrames: 240,
  inFrame: 0,
  phase: 0,
  frames: 240,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});
const film = (clips: FrameClip[]): FrameSequence => ({ fps: FPS, aspect: '9:16', captions: [], clips });
const preset = (id: string): SpeedPoint[] => SPEED_PRESETS.find((entry) => entry.id === id)!.points;

describe('A2: a curve shape that cannot go on says why', () => {
  it('a one-frame cut and "fast middle": refused as too short, the film unchanged', () => {
    const one = film([cut({ frames: 1 })]);
    const result = applyClipSpeedCurve(one, 0, preset('fastMiddle'));
    expect(result.refused).toBe('too_short');
    expect(result.seq).toBe(one);
    expect(setClipSpeedCurve(one, 0, preset('fastMiddle'))).toBe(one);
  });

  it('the same cut takes a shape that keeps it at least a frame long ("slow middle")', () => {
    const one = film([cut({ frames: 1 })]);
    const result = applyClipSpeedCurve(one, 0, preset('slowMiddle'));
    expect(result.refused).toBeNull();
    expect(result.seq.clips[0]!.speedCurve).toBeDefined();
    expect(result.seq.clips[0]!.frames).toBeGreaterThanOrEqual(1);
  });

  it(`more than ${MAX_CURVE_TOTAL_POINTS} points: refused as the point limit`, () => {
    const many = Array.from({ length: MAX_CURVE_TOTAL_POINTS + 1 }, (_, i) => ({ pos: i / MAX_CURVE_TOTAL_POINTS, speed: 1 }));
    const whole = film([cut()]);
    const result = applyClipSpeedCurve(whole, 0, many);
    expect(result.refused).toBe('point_limit');
    expect(result.seq).toBe(whole);
  });

  it('an ordinary shape on an ordinary cut: applied, nothing refused', () => {
    const whole = film([cut()]);
    const result = applyClipSpeedCurve(whole, 0, preset('fastMiddle'));
    expect(result.refused).toBeNull();
    expect(result.seq).not.toBe(whole);
    expect(result.seq.clips[0]!.speedCurve).toBeDefined();
  });

  it('asking for the shape the cut already has is not a refusal', () => {
    const shaped = applyClipSpeedCurve(film([cut()]), 0, preset('fastMiddle')).seq;
    const again = applyClipSpeedCurve(shaped, 0, preset('fastMiddle'));
    expect(again.refused).toBeNull();
    expect(again.seq).toBe(shaped);
  });

  for (const [lang, copy] of COPIES) {
    it(`${lang}: each refusal has its own line`, () => {
      const short = curveRefusalLine(copy, 'too_short');
      const limit = curveRefusalLine(copy, 'point_limit');
      expect(short.length).toBeGreaterThan(10);
      expect(limit.length).toBeGreaterThan(10);
      expect(short).not.toBe(limit);
      expect(short).not.toMatch(/[{}]/);
      expect(limit).toContain(String(MAX_CURVE_TOTAL_POINTS));
    });
  }
});
