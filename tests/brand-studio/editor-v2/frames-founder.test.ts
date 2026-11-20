import { describe, expect, it } from 'vitest';
import { FIXTURE_FPS, FIXTURE_MATERIALS, clipOfMaterial, fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import {
  clipFrameAt,
  frameStateAt,
  insertClips,
  neighbourCut,
  rulerTicks,
  splitAtFrame,
  spansOf,
  totalFrames,
  wholeFrameViolations,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { withSequence, type EditorDoc } from '@/lib/brand-studio/editor-v2/model';

/**
 * The founder's requirements of 2026-11-20 at the model level: step from cut to cut, see the exact
 * frame (the frame-numbered sample clip shows source frame N at media frame N), a ruler that counts
 * frames when zoomed in at any rate, and a split at any frame of the sample film that leaves nothing
 * between two frames.
 */
const label = (id: string) => id;
const material = (id: string) => FIXTURE_MATERIALS.find((m) => m.id === id)!;

/** The sample film with the 30 fps clip and the frame-numbered clip after it. */
function longFilm(): FrameSequence {
  const base = fixtureDoc(label).sequence;
  return insertClips(base, base.clips.length, [
    clipOfMaterial(material('m5'), 'cut-5', 'm5', FIXTURE_FPS, 0, 10_000),
    clipOfMaterial(material('m7'), 'cut-6', 'm7', FIXTURE_FPS, 0, 10_000),
  ]);
}

const pictures = (seq: FrameSequence) =>
  Array.from({ length: totalFrames(seq) }, (_, frame) => {
    const state = frameStateAt(seq, frame).active!;
    return `${state.clip.srcUrl}@${state.sourceFrame}`;
  });

describe('neighbourCut steps from cut to cut', () => {
  // Cut starts 0, 113, 226, 346; the last frame is 453.
  const seq = fixtureDoc(label).sequence;

  it('forward to the next cut start, then to the last frame', () => {
    expect([0, 1, 112, 113, 200, 226, 345, 346, 400, 453, 9999].map((f) => neighbourCut(seq, f, 1))).toEqual([
      113, 113, 113, 226, 226, 346, 346, 453, 453, 453, 453,
    ]);
  });

  it('backward to the previous cut start, then to the first frame', () => {
    expect([453, 400, 347, 346, 227, 226, 114, 113, 50, 1, 0, -5].map((f) => neighbourCut(seq, f, -1))).toEqual([
      346, 346, 346, 226, 226, 113, 113, 0, 0, 0, 0, 0,
    ]);
  });

  it('walks every cut and stops at both ends', () => {
    const forward = [0];
    while (forward.length < 20) {
      const next = neighbourCut(seq, forward.at(-1)!, 1);
      if (next === forward.at(-1)) break;
      forward.push(next);
    }
    expect(forward).toEqual([0, 113, 226, 346, 453]);
    const back = [453];
    while (back.length < 20) {
      const next = neighbourCut(seq, back.at(-1)!, -1);
      if (next === back.at(-1)) break;
      back.push(next);
    }
    expect(back).toEqual([453, 346, 226, 113, 0]);
  });
});

describe('the frame-numbered sample clip shows the frame it is on', () => {
  const m7 = material('m7');

  it('is 240 frames at 24 fps and fits whole in the 24 fps film', () => {
    expect(m7).toMatchObject({ fps: 24, frames: 240, origin: 'sample' });
    expect(clipOfMaterial(m7, 'n', 'n', FIXTURE_FPS, 0, 10_000).frames).toBe(240);
  });

  it('source frame equals media frame for all 240 frames, and the seek lands inside that frame', () => {
    const clip = clipOfMaterial(m7, 'n', 'n', FIXTURE_FPS, 0, 240);
    const seq: FrameSequence = { fps: FIXTURE_FPS, aspect: '16:9', clips: [clip], captions: [] };
    for (let frame = 0; frame < 240; frame += 1) {
      const active = frameStateAt(seq, frame).active!;
      expect(active.mediaFrame, `frame ${frame}`).toBe(frame);
      expect(active.sourceFrame, `frame ${frame}`).toBe(frame);
      expect(clipFrameAt(clip, frame, FIXTURE_FPS)).toEqual({ mediaFrame: frame, sourceFrame: frame, seekSec: active.seekSec });
      expect(active.seekSec, `frame ${frame}`).toBeGreaterThan(frame / m7.fps);
      expect(active.seekSec, `frame ${frame}`).toBeLessThan((frame + 1) / m7.fps);
    }
  });

  it('keeps that promise after the sample film, from any in-point', () => {
    const seq = longFilm();
    const span = spansOf(seq).find((entry) => entry.clip.id === 'cut-6')!;
    expect(span.frames).toBe(240);
    for (let offset = 0; offset < 240; offset += 1) {
      expect(frameStateAt(seq, span.start + offset).active!.sourceFrame).toBe(offset);
    }
    const late = clipOfMaterial(m7, 'n', 'n', FIXTURE_FPS, 100, 10_000);
    expect(late.frames).toBe(140);
    for (let offset = 0; offset < late.frames; offset += 1) expect(clipFrameAt(late, offset, FIXTURE_FPS).sourceFrame).toBe(100 + offset);
  });
});

describe('the ruler counts frames when zoomed in, at 30 fps too', () => {
  it('labels every second frame at frame-level zoom and names the second on its frame', () => {
    const near = rulerTicks(64, 30, 26, 34);
    expect(near.map((tick) => tick.frame)).toEqual([26, 27, 28, 29, 30, 31, 32, 33, 34]);
    expect(near.filter((tick) => tick.label).map((tick) => tick.label)).toEqual(['26f', '28f', '0:01', '2f', '4f']);
  });

  it('labels every third frame a little further out', () => {
    const ticks = rulerTicks(30, 30, 0, 30);
    expect(ticks.map((tick) => tick.frame)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    expect(ticks.filter((tick) => tick.label).map((tick) => tick.label)).toEqual([
      '0:00', '3f', '6f', '9f', '12f', '15f', '18f', '21f', '24f', '27f', '0:01',
    ]);
  });

  it('labels only whole seconds when zoomed out, and never crowds labels', () => {
    const far = rulerTicks(2, 30, 0, 600).filter((tick) => tick.label);
    expect(far.every((tick) => tick.frame % 30 === 0)).toBe(true);
    for (const ppf of [0.5, 2, 6, 14, 30, 48, 64, 80]) {
      const ticks = rulerTicks(ppf, 30, 0, Math.ceil(1200 / ppf));
      const labels = ticks.filter((tick) => tick.label);
      expect(labels.length, `ppf ${ppf}`).toBeGreaterThan(0);
      for (let i = 1; i < labels.length; i += 1) expect((labels[i]!.frame - labels[i - 1]!.frame) * ppf).toBeGreaterThanOrEqual(44);
      for (let i = 1; i < ticks.length; i += 1) expect((ticks[i]!.frame - ticks[i - 1]!.frame) * ppf).toBeGreaterThanOrEqual(8);
      for (const tick of labels) {
        expect(tick.label).toMatch(tick.frame % 30 === 0 ? /^\d+:\d{2}$/ : /^([1-9]|1\d|2\d)f$/);
      }
    }
  });
});

describe('a split at any frame of the sample film', () => {
  it('stays on whole frames and shows the same pictures, through withSequence', () => {
    const doc: EditorDoc = { ...fixtureDoc(label), sequence: longFilm() };
    expect(wholeFrameViolations(doc.sequence)).toEqual([]);
    const before = pictures(doc.sequence);
    const total = totalFrames(doc.sequence);
    expect(total).toBe(454 + 117 + 240);
    for (let at = 0; at <= total; at += 1) {
      const under = spansOf(doc.sequence).find((span) => at > span.start && at < span.end);
      const next = withSequence(doc, splitAtFrame(doc.sequence, at, 'split'), under ? [['split', under.clip.id]] : []);
      expect(wholeFrameViolations(next.sequence), `split at ${at}`).toEqual([]);
      expect(totalFrames(next.sequence), `split at ${at}`).toBe(total);
      if (at % 7 === 0) expect(pictures(next.sequence), `split at ${at}`).toEqual(before);
    }
  });
});
