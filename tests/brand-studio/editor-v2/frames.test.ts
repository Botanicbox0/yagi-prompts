import { describe, expect, it } from 'vitest';
import {
  MAX_PX_PER_FRAME,
  addCaption,
  clipFrameAt,
  clipMaxFrames,
  formatTimecode,
  frameStateAt,
  insertClips,
  moveClip,
  removeClips,
  rulerTicks,
  setClipSpeed,
  sliderToPpf,
  snapFrame,
  sourceFrameIndex,
  sourceSeekSec,
  spansOf,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  wholeFrameViolations,
  zoomScrollLeft,
  ppfToSlider,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';

/**
 * The founder (2026-11-20): "프레임 단위로 정밀하게 자를 수도 있어야 할 것 같은데 그게 안되네."
 * The editor's time base is the frame. These tests pin the two promises that follow from it:
 * no operation can leave a fractional frame anywhere, and a split at frame N gives two pieces that
 * meet at N and show exactly the pictures the uncut clip showed.
 */
const clip = (id: string, sourceFrames: number, extra: Partial<FrameClip> = {}): FrameClip => ({
  id,
  label: id,
  srcUrl: `/reel/${id}.mp4`,
  thumbUrl: null,
  sourceFps: 24,
  sourceFrames,
  inFrame: 0,
  phase: 0,
  frames: sourceFrames,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});

const film = (): FrameSequence => ({
  fps: 24,
  aspect: '16:9',
  clips: [clip('a', 113), clip('b', 113), clip('c', 409, { inFrame: 48, frames: 120 }), clip('d', 289, { frames: 108 })],
  captions: [],
});

/** Every picture the film shows, as `clipSource@sourceFrame`, one per timeline frame. */
const pictures = (seq: FrameSequence) =>
  Array.from({ length: totalFrames(seq) }, (_, frame) => {
    const state = frameStateAt(seq, frame).active!;
    return `${state.clip.srcUrl}@${state.sourceFrame}`;
  });

describe('frame time base', () => {
  it('starts whole and lays cuts end to end', () => {
    const seq = film();
    expect(wholeFrameViolations(seq)).toEqual([]);
    expect(spansOf(seq).map((span) => [span.start, span.end])).toEqual([[0, 113], [113, 226], [226, 346], [346, 454]]);
    expect(totalFrames(seq)).toBe(454);
  });

  it('splits at frame N into two pieces that meet at N and show the same pictures', () => {
    const seq = film();
    const before = pictures(seq);
    for (const at of [1, 57, 112, 114, 300, 453]) {
      const next = splitAtFrame(seq, at, 'new');
      expect(next.clips).toHaveLength(5);
      const spans = spansOf(next);
      const right = spans.find((span) => span.clip.id === 'new')!;
      const left = spans[right.index - 1]!;
      expect(left.end).toBe(at);
      expect(right.start).toBe(at);
      expect(totalFrames(next)).toBe(454);
      expect(pictures(next)).toEqual(before);
      expect(wholeFrameViolations(next)).toEqual([]);
    }
  });

  it('refuses a split on a cut boundary or outside the film', () => {
    const seq = film();
    for (const at of [0, 113, 226, 454, -3, 9999, 12.5]) expect(splitAtFrame(seq, at, 'new')).toBe(seq);
  });

  it('keeps the pictures through a split of a slowed or sped-up cut, at every frame', () => {
    for (const [num, den] of [[1, 2], [3, 2], [2, 1], [1, 4]] as const) {
      const seq = setClipSpeed(film(), 1, num, den);
      expect(wholeFrameViolations(seq)).toEqual([]);
      const before = pictures(seq);
      const span = spansOf(seq)[1]!;
      for (let at = span.start + 1; at < span.end; at += 1) {
        const next = splitAtFrame(seq, at, 'new');
        expect(pictures(next), `speed ${num}/${den} split at ${at}`).toEqual(before);
        expect(wholeFrameViolations(next)).toEqual([]);
      }
    }
  });

  it('trims by whole frames and never past the footage or below one frame', () => {
    const seq = film();
    const start = trimClipEdge(seq, 2, 'start', 7);
    expect(start.applied).toBe(7);
    expect(start.seq.clips[2]).toMatchObject({ inFrame: 55, frames: 113 });
    expect(trimClipEdge(seq, 2, 'start', -100).applied).toBe(-48);
    expect(trimClipEdge(seq, 2, 'start', 500).seq.clips[2]!.frames).toBe(1);
    const end = trimClipEdge(seq, 2, 'end', 1000);
    expect(end.seq.clips[2]!.frames).toBe(409 - 48);
    expect(trimClipEdge(seq, 0, 'end', -500).seq.clips[0]!.frames).toBe(1);
    expect(trimClipEdge(seq, 2, 'end', 2.4).applied).toBe(2);
    expect(trimClipEdge(seq, 0, 'end', 2.4).applied).toBe(0);
    expect(trimClipEdge(seq, 0, 'end', 0).seq).toBe(seq);
    for (const result of [start, end]) expect(wholeFrameViolations(result.seq)).toEqual([]);
  });

  it('trims a slowed cut frame by frame without drifting', () => {
    let seq = setClipSpeed(film(), 0, 1, 2);
    const before = pictures(seq).slice(0, spansOf(seq)[0]!.frames);
    for (let i = 0; i < 9; i += 1) seq = trimClipEdge(seq, 0, 'start', 1).seq;
    expect(pictures(seq).slice(0, spansOf(seq)[0]!.frames)).toEqual(before.slice(9));
    expect(wholeFrameViolations(seq)).toEqual([]);
  });

  it('survives a long random run of operations with nothing fractional', () => {
    let seed = 20261120;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    let seq = film();
    for (let step = 0; step < 400; step += 1) {
      const pick = Math.floor(random() * 6);
      const index = Math.floor(random() * seq.clips.length);
      if (pick === 0) seq = splitAtFrame(seq, Math.floor(random() * (totalFrames(seq) + 2)), `s${step}`);
      else if (pick === 1) seq = trimClipEdge(seq, index, random() < 0.5 ? 'start' : 'end', Math.round((random() - 0.5) * 60) + (random() < 0.2 ? 0.37 : 0)).seq;
      else if (pick === 2) seq = moveClip(seq, index, Math.floor(random() * seq.clips.length));
      else if (pick === 3 && seq.clips.length > 2) seq = removeClips(seq, [seq.clips[index]!.id]);
      else if (pick === 4) {
        const [num, den] = ([[1, 2], [1, 1], [3, 2], [2, 1]] as const)[Math.floor(random() * 4)]!;
        seq = setClipSpeed(seq, index, num, den);
      }
      else if (seq.clips.length < 20) seq = insertClips(seq, index, [{ ...seq.clips[index]!, id: `p${step}` }]);
      expect(wholeFrameViolations(seq), `after step ${step}`).toEqual([]);
      expect(spansOf(seq).every((span, i, all) => span.start === (i === 0 ? 0 : all[i - 1]!.end))).toBe(true);
    }
  });

  it('moves, removes and inserts without touching the cuts themselves', () => {
    const seq = film();
    expect(moveClip(seq, 0, 2).clips.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveClip(seq, 1, 1)).toBe(seq);
    expect(removeClips(seq, ['b', 'zzz']).clips.map((c) => c.id)).toEqual(['a', 'c', 'd']);
    expect(removeClips(seq, ['a', 'b', 'c', 'd'])).toBe(seq);
    expect(insertClips(seq, 1, [clip('x', 10)]).clips.map((c) => c.id)).toEqual(['a', 'x', 'b', 'c', 'd']);
  });

  it('keeps captions on whole frames inside the film', () => {
    const seq = addCaption(film(), { id: 'cap', text: '  hello  ', start: 14.6, end: 9999, position: 'bottom', size: 'md' });
    expect(seq.captions[0]).toMatchObject({ text: 'hello', start: 15, end: 454 });
    expect(wholeFrameViolations(seq)).toEqual([]);
    expect(frameStateAt(seq, 14).captions).toHaveLength(0);
    expect(frameStateAt(seq, 15).captions).toHaveLength(1);
  });
});

describe('which picture a frame shows', () => {
  it('shows source frame N for timeline frame N when the rates match', () => {
    const seq = film();
    expect(frameStateAt(seq, 0).active).toMatchObject({ index: 0, sourceFrame: 0 });
    expect(frameStateAt(seq, 112).active).toMatchObject({ index: 0, sourceFrame: 112 });
    expect(frameStateAt(seq, 113).active).toMatchObject({ index: 1, sourceFrame: 0 });
    expect(frameStateAt(seq, 226).active).toMatchObject({ index: 2, sourceFrame: 48 });
    expect(frameStateAt(seq, 9999).active).toMatchObject({ index: 3, sourceFrame: 107 });
  });

  it('aims a seek at the middle of the source frame, so rounding cannot land on a neighbour', () => {
    expect(sourceSeekSec(0, 24)).toBeCloseTo(0.5 / 24, 9);
    expect(sourceSeekSec(48, 24)).toBeCloseTo(48.5 / 24, 9);
    for (let frame = 0; frame < 600; frame += 1) expect(Math.floor(sourceSeekSec(frame, 29.97) * 29.97)).toBe(frame);
  });

  it('conforms footage of another rate by sampling the frame on screen at that moment', () => {
    // 30 fps footage in a 24 fps film: every film frame shows the source frame current at its start.
    expect([0, 1, 2, 3, 4, 5, 24].map((m) => sourceFrameIndex(m, 24, 30))).toEqual([0, 1, 2, 3, 5, 6, 30]);
    // 24 fps footage in a 30 fps film: every fifth film frame repeats a picture.
    expect([0, 1, 2, 3, 4, 5, 30].map((m) => sourceFrameIndex(m, 30, 24))).toEqual([0, 0, 1, 2, 3, 4, 24]);
    const thirty = clip('thirty', 147, { sourceFps: 30, frames: 10 });
    expect(clipMaxFrames(thirty, 24)).toBe(117);
    expect(clipFrameAt(thirty, 4, 24)).toMatchObject({ mediaFrame: 4, sourceFrame: 5 });
  });

  it('plays a 2× cut on every other frame and a 0.5× cut on each frame twice', () => {
    const fast = clip('fast', 100, { speedNum: 2, speedDen: 1, frames: 50 });
    expect([0, 1, 2].map((k) => clipFrameAt(fast, k, 24).sourceFrame)).toEqual([0, 2, 4]);
    const slow = clip('slow', 100, { speedNum: 1, speedDen: 2, frames: 200 });
    expect([0, 1, 2, 3].map((k) => clipFrameAt(slow, k, 24).sourceFrame)).toEqual([0, 0, 1, 1]);
    expect(clipMaxFrames(slow, 24)).toBe(200);
    expect(clipMaxFrames(fast, 24)).toBe(50);
  });
});

describe('timecode, ruler, zoom and snapping', () => {
  it('writes time as minutes, seconds and frames', () => {
    expect(formatTimecode(0, 24)).toBe('0:00:00');
    expect(formatTimecode(3, 24)).toBe('0:00:03');
    expect(formatTimecode(132, 24)).toBe('0:05:12');
    expect(formatTimecode(24 * 61 + 23, 24)).toBe('1:01:23');
    expect(formatTimecode(29, 30)).toBe('0:00:29');
  });

  it('labels seconds when zoomed out and frames when zoomed in', () => {
    const far = rulerTicks(2, 24, 0, 480).filter((tick) => tick.label);
    expect(far.every((tick) => tick.frame % 24 === 0)).toBe(true);
    expect(far[0]!.label).toBe('0:00');
    const near = rulerTicks(64, 24, 20, 32);
    expect(near.map((tick) => tick.frame)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    expect(near.filter((tick) => tick.label).map((tick) => tick.label)).toEqual(['20f', '22f', '0:01', '2f', '4f', '6f', '8f']);
    for (const ppf of [0.5, 2, 6, 14, 30, 64, MAX_PX_PER_FRAME]) {
      const labels = rulerTicks(ppf, 24, 0, Math.ceil(1200 / ppf)).filter((tick) => tick.label);
      for (let i = 1; i < labels.length; i += 1) expect((labels[i]!.frame - labels[i - 1]!.frame) * ppf).toBeGreaterThanOrEqual(44);
    }
  });

  it('reaches a frame at least 60 px wide, and maps the slider both ways', () => {
    expect(MAX_PX_PER_FRAME).toBeGreaterThanOrEqual(60);
    const fit = 2.4;
    expect(sliderToPpf(0, fit)).toBeCloseTo(fit, 6);
    expect(sliderToPpf(1, fit)).toBeCloseTo(MAX_PX_PER_FRAME, 6);
    for (const t of [0, 0.25, 0.5, 0.9, 1]) expect(ppfToSlider(sliderToPpf(t, fit), fit)).toBeCloseTo(t, 6);
  });

  it('keeps the frame under the pointer where it is while zooming', () => {
    const scrollLeft = 500;
    const pointerX = 300;
    const frameUnderPointer = (scrollLeft + pointerX) / 4;
    const next = zoomScrollLeft(4, 32, pointerX, scrollLeft);
    expect((next + pointerX) / 32).toBeCloseTo(frameUnderPointer, 9);
    expect(zoomScrollLeft(4, 1, 0, 0)).toBe(0);
  });

  it('snaps to a nearby edge only within the pixel threshold', () => {
    expect(snapFrame(98, [100, 200], 2, 7)).toBe(100);
    expect(snapFrame(95, [100, 200], 2, 7)).toBe(95);
    expect(snapFrame(101, [100, 200], 64, 7)).toBe(101);
    expect(snapFrame(150, [], 2, 7)).toBe(150);
  });
});
