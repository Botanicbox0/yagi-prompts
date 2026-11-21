import { describe, expect, it } from 'vitest';
import { emptyComposerProject, timelineSpans, type ComposeCaption, type ComposeOverlayClip, type ComposeSfxClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { captionsOnFrames, cutAnchor, effectStartSec, overlayFrames, storedEndToFrame, storedSecToFilmSec, storedSecToFrame, storedSpanToFrames } from '@/lib/brand-studio/editor-v2/cut-anchor';
import { captionsAt, imageOverlaysAt } from '@/lib/brand-studio/editor-v2/export-plan';
import { filmContents } from '@/lib/brand-studio/editor-v2/film-contents';
import { frameStateAt, totalFrames, visibleCaptions, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { fromStored, storedFilmView, toStored } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Spec E, item A: captions, sound effects and still overlays are stored in the current editor's timeline
 * seconds, whose cuts are rounded to tenths (at least 0.3 s) one after another; v2 lays the same cuts on
 * exact frames. v2 reads a stored time as "this cut, this far into it", so it lands on the same moment of
 * the same cut in both editors.
 */
const SRC = '/api/brand-studio/compose?organizationId=org&source=asset&id=frames';
const FPS = 24;

function cut(id: string, inFrame: number, frames: number, speed: [number, number] = [1, 1]): FrameClip {
  return { id, label: id, srcUrl: SRC, thumbUrl: null, sourceFps: FPS, sourceFrames: 240, inFrame, phase: 0, frames, speedNum: speed[0], speedDen: speed[1], volume: 1, muted: false };
}

function film(clips: FrameClip[]): { sequence: FrameSequence; stored: ComposerProject } {
  const sequence: FrameSequence = { fps: FPS, aspect: '16:9', clips, captions: [] };
  return { sequence, stored: toStored(sequence, emptyComposerProject('16:9')) };
}

function anchorOf(clips: FrameClip[]) {
  const { sequence, stored } = film(clips);
  return { anchor: cutAnchor(stored, sequence), sequence, stored };
}

const caption = (id: string, startSec: number, endSec: number): ComposeCaption => ({ id, text: id, startSec, endSec, position: 'bottom', size: 'md' });

describe('a stored time is the same moment of the same cut', () => {
  // 37 frames (1.5417 s; the current editor reads 1.5 s), then 53 frames from frame 100 (2.2083 s; it reads 4.2 → 6.4 = 2.2 s).
  const { anchor, stored } = anchorOf([cut('a', 0, 37), cut('b', 100, 53)]);

  it('the current editor’s layout is its own timelineSpans', () => {
    expect(anchor.stored).toEqual(timelineSpans(stored).map((span) => ({ start: span.timelineStartSec, end: span.timelineEndSec })));
    expect(anchor.stored).toEqual([{ start: 0, end: 1.5 }, { start: 1.5, end: 3.7 }]);
    expect(anchor.frames).toEqual([{ start: 0, length: 37 }, { start: 37, length: 53 }]);
  });

  it('inside a cut: 2.0 s is half a second into the second cut, frame 37 + 12 (not 48)', () => {
    expect(storedSecToFrame(anchor, 2.0)).toBe(49);
  });

  it('exactly on a boundary: the cut that starts there', () => {
    expect(storedSecToFrame(anchor, 1.5)).toBe(37);
    expect(storedSecToFrame(anchor, 1.4999)).toBe(36);
  });

  it('a span across two cuts starts in the first at its offset and ends in the second at its offset', () => {
    expect(storedSpanToFrames(anchor, 1.2, 2.0)).toEqual({ start: 29, end: 49 });
  });

  it('past the end of the film: still past the end, at its distance', () => {
    expect(storedSecToFrame(anchor, 3.7)).toBe(90);
    expect(storedSecToFrame(anchor, 4.7)).toBe(90 + 24);
  });

  it('negative or broken times are the start', () => {
    expect(storedSecToFrame(anchor, -2)).toBe(0);
    expect(storedSecToFrame(anchor, Number.NaN)).toBe(0);
  });

  it('a span is at least one frame long', () => {
    expect(storedSpanToFrames(anchor, 2.0, 2.0)).toEqual({ start: 49, end: 50 });
  });

  it('no cuts: seconds on the film’s frames', () => {
    const empty = cutAnchor(emptyComposerProject(), { fps: 24, clips: [] });
    expect(storedSecToFrame(empty, 1.26)).toBe(30);
  });
});

describe('the tail of a cut never spills into the next one (review round 1 of part E, item 9)', () => {
  it('a cut the current editor rounds longer than v2 (22 frames from frame 1 read as 0.0 → 1.0 s): its tail lands on its last frame', () => {
    const { anchor } = anchorOf([cut('a', 1, 22), cut('b', 50, 24)]);
    expect(anchor.stored[0]).toEqual({ start: 0, end: 1 });
    expect(storedSecToFrame(anchor, 0.5)).toBe(12);
    // 0.99 s into it is 23.76 frames: past v2's 22, so the cut's last frame (21), not the next cut's first (22).
    expect(storedSecToFrame(anchor, 0.99)).toBe(21);
    // A sound starts at the latest where the cut's last frame starts.
    expect(storedSecToFilmSec(anchor, 0.99)).toBeCloseTo(21 / 24, 12);
    // An end (one past the last frame shown) may be the cut's end.
    expect(storedEndToFrame(anchor, 0.99)).toBe(22);
    // A time on the boundary still belongs to the cut that starts there.
    expect(storedSecToFrame(anchor, 1.0)).toBe(22);
    expect(storedEndToFrame(anchor, 1.0)).toBe(22);
  });

  it('a cut the current editor stretches to its 0.3 s minimum (3 frames): the tail lands on its last frame', () => {
    const { anchor } = anchorOf([cut('a', 0, 3), cut('b', 50, 24)]);
    expect(anchor.stored[0]).toEqual({ start: 0, end: 0.3 });
    expect(storedSecToFrame(anchor, 0.1)).toBe(2);
    expect(storedSecToFrame(anchor, 0.25)).toBe(2);
    expect(storedSecToFrame(anchor, 0.3)).toBe(3);
  });

  it('a caption, a still overlay and an effect starting in the tail stay in their cut', () => {
    const { anchor, stored } = anchorOf([cut('a', 0, 3), cut('b', 50, 24)]);
    const caption = captionsOnFrames([{ id: 'c', text: 'c', startSec: 0.25, endSec: 0.29, position: 'bottom', size: 'md' }], anchor)[0]!;
    // Starts on the cut's last frame (2), ends at the cut's end (3): one frame long, never in cut b.
    expect([caption.start, caption.end]).toEqual([2, 3]);
    expect(overlayFrames(anchor, { startSec: 0.25, endSec: 0.28 })).toEqual({ first: 2, last: 2 });
    expect(effectStartSec(anchor, { startSec: 0.28 })).toBeCloseTo(2 / 24, 12);
    // Spans across the boundary keep their end in the next cut.
    expect(storedSpanToFrames(anchor, 0.2, 0.5)).toEqual({ start: 2, end: 3 + 5 });
  });
});

describe('speed: the offset is timeline time in both editors', () => {
  it('a 2× cut and a 0.5× cut after a cut that drifted', () => {
    const { anchor } = anchorOf([cut('a', 0, 37), cut('fast', 40, 24, [2, 1]), cut('slow', 100, 48, [1, 2])]);
    // 37 frames read as 1.5 s; the 2× cut: 2 s of footage = 1.0 s of timeline in both; the 0.5× cut: 1 s of footage = 2.0 s.
    expect(anchor.stored).toEqual([{ start: 0, end: 1.5 }, { start: 1.5, end: 2.5 }, { start: 2.5, end: 4.5 }]);
    expect(storedSecToFrame(anchor, 2.0)).toBe(37 + 12);
    expect(storedSecToFrame(anchor, 3.5)).toBe(37 + 24 + 24);
  });
});

describe('a film whose cuts never drifted: nothing moves', () => {
  it('cut lengths and trims on whole half seconds at 24 fps: the mapping is round(t × fps), never past the cut a time is in', () => {
    const { anchor } = anchorOf([cut('a', 0, 36), cut('b', 48, 12), cut('c', 120, 60), cut('d', 12, 24)]);
    // Cut ends at frames 36, 48, 108, 132. A time less than half a frame before a cut's end rounds onto the
    // next cut's first frame; it is a moment of THIS cut, so it stays on this cut's last frame (item 9).
    const ends = [36, 48, 108, 132];
    for (let t = 0; t <= 6.5; t += 0.01) {
      const exact = t * FPS;
      const end = ends.find((e) => t < e / FPS);
      const expected = end === undefined ? Math.round(exact) : Math.min(Math.round(exact), end - 1);
      expect(storedSecToFrame(anchor, t), `t=${t}`).toBe(expected);
      // An end (one past the last frame shown) is round(t × fps) everywhere.
      expect(storedEndToFrame(anchor, t), `end t=${t}`).toBe(Math.round(exact));
    }
  });
});

describe('the mapping never reorders two times', () => {
  it('monotonic over random films', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const speeds: Array<[number, number]> = [[1, 1], [2, 1], [1, 2], [3, 2]];
    for (let run = 0; run < 60; run += 1) {
      const clips = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) =>
        cut(`c${i}`, Math.floor(random() * 120), 1 + Math.floor(random() * 70), speeds[Math.floor(random() * speeds.length)]!),
      );
      const { anchor } = anchorOf(clips);
      let lastFrame = -1;
      let lastSec = -1;
      for (let t = -0.2; t <= anchor.storedTotal + 1; t += 0.005) {
        const frame = storedSecToFrame(anchor, t);
        const sec = storedSecToFilmSec(anchor, t);
        expect(frame, `run ${run} t=${t}`).toBeGreaterThanOrEqual(lastFrame);
        expect(sec, `run ${run} t=${t}`).toBeGreaterThanOrEqual(lastSec - 1e-12);
        lastFrame = frame;
        lastSec = sec;
      }
    }
  });
});

describe('everything v2 reads of the stored film goes through it', () => {
  // The real-screen film: six cuts of the frame-numbered clip, lengths not on tenths.
  const lengths = [37, 53, 29, 61, 43, 19];
  const clips = lengths.map((frames, i) => cut(`k${i + 1}`, i * 30, frames));
  const { sequence, stored } = film(clips);
  const starts = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  const spans = timelineSpans(stored);
  const inSixth = spans[5]!.timelineStartSec + 0.3; // 0.3 s into the sixth cut
  const inThird = spans[2]!.timelineStartSec + 0.5;
  const overlay: ComposeOverlayClip = { id: 'o', label: 'logo', sourceKind: 'asset', srcUrl: '/o.png', mediaKind: 'image', startSec: inThird, endSec: inThird + 0.4, x: 0.5, y: 0.5, scale: 0.2, opacity: 1 };
  const effect: ComposeSfxClip = { id: 'fx', label: 'click', sourceKind: 'asset', srcUrl: '/fx.wav', startSec: inSixth, durationSec: 0.2, volume: 1 };
  const withExtras: ComposerProject = { ...stored, captions: [caption('six', inSixth, inSixth + 0.25), caption('three', inThird, inThird + 0.5)], overlays: [overlay], sfxClips: [effect] };

  it('the drift it removes: 0.3 s into the sixth cut is 3 frames off when read straight (83 ms)', () => {
    expect(Math.round(inSixth * FPS)).not.toBe(starts[5]! + Math.round(0.3 * FPS));
    expect(Math.abs(Math.round(inSixth * FPS) - (starts[5]! + 7))).toBeGreaterThanOrEqual(2);
  });

  it('opening the stored film puts each caption at its offset into its cut', () => {
    const opened = fromStored(withExtras, { [SRC]: { fps: 24, frames: 240, counted: true } }).sequence;
    const six = opened.captions.find((c) => c.id === 'six')!;
    const three = opened.captions.find((c) => c.id === 'three')!;
    expect(six.start).toBe(starts[5]! + Math.round(0.3 * FPS));
    expect(three.start).toBe(starts[2]! + Math.round(0.5 * FPS));
  });

  it('preview and export read the same view: the same frame for the same caption', () => {
    const view = storedFilmView(sequence, withExtras);
    const six = view.sequence.captions.find((c) => c.id === 'six')!;
    expect(six.start).toBe(starts[5]! + 7);
    // The preview shows it from that frame (frameStateAt); the export burns it from that frame (captionsAt).
    expect(frameStateAt(view.sequence, six.start).captions.map((c) => c.id)).toContain('six');
    expect(frameStateAt(view.sequence, six.start - 1).captions.map((c) => c.id)).not.toContain('six');
    expect(captionsAt(view.sequence, six.start).map((c) => c.id)).toContain('six');
    expect(captionsAt(view.sequence, six.start - 1).map((c) => c.id)).not.toContain('six');
    expect(visibleCaptions(view.sequence).map((c) => c.id).sort()).toEqual(['six', 'three']);
    expect(view.sequence.captions).toEqual(captionsOnFrames(withExtras.captions, view.anchor));
  });

  it('still overlays: the same mapping in the preview and the export', () => {
    const view = storedFilmView(sequence, withExtras);
    const { first, last } = overlayFrames(view.anchor, overlay);
    expect(first).toBe(starts[2]! + 12);
    expect(imageOverlaysAt(view.film, first - 1, view.anchor)).toEqual([]);
    expect(imageOverlaysAt(view.film, first, view.anchor).map((o) => o.id)).toEqual(['o']);
    expect(imageOverlaysAt(view.film, last, view.anchor).map((o) => o.id)).toEqual(['o']);
    expect(imageOverlaysAt(view.film, last + 1, view.anchor)).toEqual([]);
  });

  it('a sound effect starts at its exact offset into its cut (to the sample, not the frame)', () => {
    const view = storedFilmView(sequence, withExtras);
    expect(effectStartSec(view.anchor, effect)).toBeCloseTo(starts[5]! / FPS + 0.3, 12);
  });

  it('what is in the file is counted on the mapped times', () => {
    const view = storedFilmView(sequence, withExtras);
    expect(filmContents(view.sequence, view.film, view.anchor)).toMatchObject({ cuts: 6, captions: 2, effects: 1, stills: 1 });
    // Cut the film after the third cut: the sixth cut's caption and effect are past the end.
    const shorter = { ...sequence, clips: sequence.clips.slice(0, 3) };
    const cutView = storedFilmView(shorter, withExtras);
    expect(totalFrames(cutView.sequence)).toBe(37 + 53 + 29);
    expect(filmContents(cutView.sequence, cutView.film, cutView.anchor)).toMatchObject({ cuts: 3, captions: 1, effects: 0, stills: 1 });
  });

  it('the stored values themselves never change', () => {
    const view = storedFilmView(sequence, withExtras);
    expect(view.film.captions).toBe(withExtras.captions);
    expect(view.film.overlays).toBe(withExtras.overlays);
    expect(view.film.sfxClips).toBe(withExtras.sfxClips);
  });
});

describe('nothing in the editor reads a stored time around the mapping', () => {
  it('stored start and end times are read only in cut-anchor.ts (the sample film’s own speech regions aside)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = process.cwd();
    const dirs = ['lib/brand-studio/editor-v2', 'components/brand-studio/editor-v2'];
    // The sample film's speech regions (fixture.ts, model.ts, and the two places that draw them) are its own seconds.
    const allowed = new Set(['lib/brand-studio/editor-v2/cut-anchor.ts', 'lib/brand-studio/editor-v2/model.ts', 'lib/brand-studio/editor-v2/fixture.ts']);
    const sampleOnly: Record<string, RegExp> = {
      'components/brand-studio/editor-v2/timeline.tsx': /region\.(startSec|endSec)/g,
      'components/brand-studio/editor-v2/use-editor.ts': /region\.(startSec|endSec)/g,
    };
    for (const dir of dirs) {
      for (const name of readdirSync(join(root, dir)).filter((n) => /\.tsx?$/.test(n))) {
        const path = `${dir}/${name}`;
        if (allowed.has(path)) continue;
        let source = readFileSync(join(root, path), 'utf8');
        if (sampleOnly[path]) source = source.replace(sampleOnly[path]!, '');
        expect(source.match(/\.(startSec|endSec)\b/g) ?? [], path).toEqual([]);
      }
    }
  });
});
