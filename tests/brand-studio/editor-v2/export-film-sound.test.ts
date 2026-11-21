import { describe, expect, it } from 'vitest';
import { scheduleCutSound, type SoundGraph } from '@/components/brand-studio/editor-v2/export-film';
import { EXPORT_SAMPLE_RATE, audioPlan } from '@/lib/brand-studio/editor-v2/export-plan';
import { FIXTURE_MATERIALS, clipOfMaterial, fixtureSequence } from '@/lib/brand-studio/editor-v2/fixture';
import { insertClips, moveClip, removeClips, setClipAudio, setClipSpeed, spansOf, splitAtFrame, totalFrames, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';

/**
 * The exporter places each cut's sound with a buffer source started and stopped in context seconds.
 * A browser renders `start(s / 48000)` from sample `s` and `stop(t)` up to `ceil(t × 48000)` exclusive
 * (measured in Chromium 149: start and stop land on the exact sample). These tests hold the numbers the
 * exporter hands the browser to the plan: the first sample, the last sample, the read point and the speed.
 */
interface Call {
  buffer: unknown;
  rate: number;
  gain: number;
  start: [number, number];
  stop: number;
}

function fakeGraph(): { graph: SoundGraph; calls: Call[] } {
  const calls: Call[] = [];
  const destination = { kind: 'destination' };
  const graph = {
    destination,
    createGain() {
      const node = { gain: { value: 1 }, connect: (next: unknown) => next };
      return node;
    },
    createBufferSource() {
      const call: Call = { buffer: null, rate: 1, gain: 1, start: [Number.NaN, Number.NaN], stop: Number.NaN };
      calls.push(call);
      const node = {
        set buffer(value: unknown) {
          call.buffer = value;
        },
        playbackRate: {
          set value(value: number) {
            call.rate = value;
          },
        },
        connect(next: { gain?: { value: number } }) {
          // The gain node this source feeds (its level is set before the source is connected).
          call.gain = next.gain?.value ?? 1;
          return next;
        },
        start(when: number, offset: number) {
          call.start = [when, offset];
        },
        stop(when: number) {
          call.stop = when;
        },
      };
      return node;
    },
  };
  return { graph: graph as unknown as SoundGraph, calls };
}

const fakeBuffer = (url: string) => ({ url }) as unknown as AudioBuffer;

/** The film the real-screen check exports: split, delete, 0.5×, 2×, move, plus a muted cut. */
function editedFilm(): FrameSequence {
  const base = fixtureSequence((id) => id);
  const m7 = FIXTURE_MATERIALS.find((m) => m.id === 'm7')!;
  let seq = insertClips(base, base.clips.length, [clipOfMaterial(m7, 'm7', 'm7', 24, 0, 120)]);
  const start = totalFrames(base);
  seq = splitAtFrame(seq, start + 30, 'p2');
  seq = splitAtFrame(seq, start + 60, 'p3');
  seq = splitAtFrame(seq, start + 90, 'p4');
  seq = removeClips(seq, ['p2']);
  seq = setClipSpeed(seq, seq.clips.findIndex((c) => c.id === 'p3'), 1, 2);
  seq = setClipSpeed(seq, seq.clips.findIndex((c) => c.id === 'p4'), 2, 1);
  seq = moveClip(seq, seq.clips.findIndex((c) => c.id === 'p4'), seq.clips.findIndex((c) => c.id === 'm7'));
  seq = setClipAudio(seq, 1, 1, true);
  return seq;
}

describe('scheduleCutSound places each cut on its planned samples', () => {
  it('starts on the cut’s first sample, stops before the next cut’s, reads from the cut’s first frame at its speed', () => {
    const seq = editedFilm();
    const plan = audioPlan(seq);
    const buffers = new Map(seq.clips.map((clip) => [clip.srcUrl, fakeBuffer(clip.srcUrl)] as const));
    const { graph, calls } = fakeGraph();
    const placed = scheduleCutSound(graph, plan, buffers);
    const audible = plan.segments.filter((segment) => segment.gain > 0);
    expect(placed).toBe(audible.length);
    expect(calls).toHaveLength(audible.length);
    calls.forEach((call, i) => {
      const segment = audible[i]!;
      const [when, offset] = call.start;
      // Exact sample in the browser's arithmetic: start frame = round(when × rate), end frame = ceil(stop × rate).
      expect(when * EXPORT_SAMPLE_RATE).toBeCloseTo(segment.startSample, 6);
      expect(Math.round(when * EXPORT_SAMPLE_RATE)).toBe(segment.startSample);
      expect(Math.ceil(call.stop * EXPORT_SAMPLE_RATE)).toBe(segment.startSample + segment.sampleCount);
      expect(Math.floor(call.stop * EXPORT_SAMPLE_RATE)).toBe(segment.startSample + segment.sampleCount - 1);
      expect(offset).toBe(segment.sourceOffsetSec);
      expect(call.rate).toBe(segment.rate);
      expect(call.gain).toBe(segment.gain);
      expect(call.buffer).toBe(buffers.get(segment.srcUrl));
    });
    // The cuts' sound tiles the film: each one ends exactly where the next begins.
    const edges = calls.map((call) => [Math.round(call.start[0] * EXPORT_SAMPLE_RATE), Math.ceil(call.stop * EXPORT_SAMPLE_RATE)]);
    const spans = spansOf(seq);
    expect(edges.map(([s]) => s)).toEqual(spans.filter((span) => !span.clip.muted).map((span) => span.start * 2000));
  });

  it('the m7 pieces: 2× reads source seconds 3.75 on, the 1× piece from 0, the 0.5× piece from 2.5', () => {
    const seq = editedFilm();
    const plan = audioPlan(seq);
    const m7 = plan.segments.filter((segment) => segment.srcUrl.includes('frame-count-24'));
    expect(m7.map((s) => [s.startSample, s.sampleCount, s.sourceOffsetSec, s.rate])).toEqual([
      [454 * 2000, 15 * 2000, 90 / 24, 2],
      [469 * 2000, 30 * 2000, 0, 1],
      [499 * 2000, 60 * 2000, 60 / 24, 0.5],
    ]);
    // A click at the first sample of source frame 61 lands on the first sample of film frame 501 (0.5×: two film frames per source frame).
    const slow = m7[2]!;
    const sourceSample = 61 * 2000;
    const lands = slow.startSample + (sourceSample - slow.sourceOffsetSec * EXPORT_SAMPLE_RATE) / slow.rate;
    expect(lands).toBe(501 * 2000);
  });

  it('a muted cut and a cut without a sound track are left out; a stored sound offset moves the cut by whole samples', () => {
    const seq = editedFilm();
    const plan = audioPlan(seq);
    const silent = seq.clips[0]!.srcUrl;
    const buffers = new Map(seq.clips.map((clip) => [clip.srcUrl, clip.srcUrl === silent ? null : fakeBuffer(clip.srcUrl)] as const));
    const { graph, calls } = fakeGraph();
    const shifted = seq.clips[3]!.id;
    scheduleCutSound(graph, plan, buffers, (id) => (id === shifted ? 0.25 : 0));
    const placedUrls = calls.map((call) => (call.buffer as { url: string }).url);
    expect(placedUrls).not.toContain(silent);
    expect(placedUrls).not.toContain(seq.clips[1]!.srcUrl);
    const segment = plan.segments[3]!;
    const call = calls.find((c) => (c.buffer as { url: string }).url === segment.srcUrl)!;
    expect(Math.round(call.start[0] * EXPORT_SAMPLE_RATE)).toBe(segment.startSample + 12_000);
    expect(Math.ceil(call.stop * EXPORT_SAMPLE_RATE)).toBe(segment.startSample + segment.sampleCount + 12_000);
  });
});
