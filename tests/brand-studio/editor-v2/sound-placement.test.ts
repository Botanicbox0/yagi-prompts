import { describe, expect, it } from 'vitest';
import { scheduleCutSound, type SoundGraph } from '@/components/brand-studio/editor-v2/export-film';
import { timingOfFile } from '@/lib/brand-studio/editor-v2/container';
import { EXPORT_SAMPLE_RATE, audioPlan, placeSound, soundLead, soundWindow } from '@/lib/brand-studio/editor-v2/export-plan';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { concat, ftyp, mdat, moov, type TrackSpec } from './mp4-bytes';

/**
 * Spec E, item B1: the export takes picture frame k as the k-th frame the file shows (its first frame at
 * the picture track's start) and the sound from decodeAudioData, whose sample 0 is the sound track's start
 * (lib/brand-studio/editor-v2/container.ts: both measured in Chromium). The sound for picture frame k is
 * decoded sample `(video start − sound start + k / fps) × rate`: a file whose picture starts 0.5 s after
 * its sound was +500 ms off before.
 */
const RATE = EXPORT_SAMPLE_RATE;

describe('which decoded sample belongs to picture frame k', () => {
  const window = (startSample: number, endSample: number, sourceOffsetSec: number) => ({ startSample, endSample, sourceOffsetSec });

  it('both tracks start together: the sample at the frame’s own time', () => {
    expect(placeSound(window(0, 48_000, 1.0), 0, 1)).toEqual({ startSample: 0, endSample: 48_000, offsetSec: 1.0 });
  });

  it('picture 0.5 s after the sound (an empty edit before the picture): read 0.5 s further into the sound', () => {
    // Frame 24 at 24 fps is shown at movie time 0.5 + 1.0; its sound is decoded sample (0.5 − 0 + 1.0) × 48 000.
    const placed = placeSound(window(0, 48_000, 24 / 24), 0.5 - 0, 1)!;
    expect(placed.offsetSec * RATE).toBe(72_000);
  });

  it('sound 0.278 s after the picture: the cut’s first 0.278 s are silent, then the sound from its first sample', () => {
    const placed = placeSound(window(1000, 49_000, 0), 0 - 0.278, 1)!;
    expect(placed.startSample).toBe(1000 + 13_344); // 0.278 s of 48 kHz
    expect(placed.offsetSec).toBeCloseTo(0, 9);
    // Further into the cut, it is just read earlier.
    expect(placeSound(window(0, 48_000, 0.5), -0.278, 1)!.offsetSec).toBeCloseTo(0.222, 12);
  });

  it('at double speed, the silent head is half as long', () => {
    const placed = placeSound(window(0, 48_000, 0), -0.1, 2)!;
    expect(placed.startSample).toBe(Math.ceil((0.1 * RATE) / 2));
  });

  it('a sound that starts after the cut ends: nothing placed', () => {
    expect(placeSound(window(0, 4800, 0), -0.5, 1)).toBeNull();
  });
});

describe('the lead read from the file', () => {
  const video = (edits?: TrackSpec['edits']): TrackSpec => ({ handler: 'vide', timescale: 12288, durations: Array(72).fill(512), edits });
  const sound = (edits?: TrackSpec['edits']): TrackSpec => ({ handler: 'soun', timescale: 48000, durations: Array(141).fill(1024), edits });

  it('picture start minus sound start; unknown when the file cannot be read', async () => {
    const late = concat(ftyp(), moov({ tracks: [video([{ duration: 500, mediaTime: -1 }, { duration: 3000, mediaTime: 0 }]), sound([{ duration: 3000, mediaTime: 1024 }])] }), mdat(8));
    expect(soundLead(await timingOfFile(late))).toEqual({ known: true, leadSec: 0.5 });
    const soundLate = concat(ftyp(), moov({ tracks: [video(), sound([{ duration: 278, mediaTime: -1 }, { duration: 3000, mediaTime: 0 }])] }), mdat(8));
    expect(soundLead(await timingOfFile(soundLate))).toEqual({ known: true, leadSec: -0.278 });
    expect(soundLead(await timingOfFile(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0)))).toEqual({ known: false, leadSec: 0 });
    // A file without sound has nothing to place.
    expect(soundLead(await timingOfFile(concat(ftyp(), moov({ tracks: [video()] }), mdat(8))))).toEqual({ known: true, leadSec: 0 });
  });
});

describe('scheduleCutSound reads each cut’s sound at its lead', () => {
  interface Call {
    start: [number, number];
    stop: number;
  }
  function fakeGraph(): { graph: SoundGraph; calls: Call[] } {
    const calls: Call[] = [];
    const graph = {
      destination: {},
      createGain: () => ({ gain: { value: 1 }, connect: (next: unknown) => next }),
      createBufferSource() {
        const call: Call = { start: [Number.NaN, Number.NaN], stop: Number.NaN };
        calls.push(call);
        return {
          set buffer(_v: unknown) {},
          playbackRate: { value: 1 },
          connect: (next: unknown) => next,
          start(when: number, offset: number) {
            call.start = [when, offset];
          },
          stop(when: number) {
            call.stop = when;
          },
        };
      },
    };
    return { graph: graph as unknown as SoundGraph, calls };
  }
  const clip = (id: string, srcUrl: string, inFrame: number, frames: number): FrameClip => ({
    id, label: id, srcUrl, thumbUrl: null, sourceFps: 24, sourceFrames: 72, inFrame, phase: 0, frames, speedNum: 1, speedDen: 1, volume: 1, muted: false,
  });

  it('two cuts from two files: each with its own lead', () => {
    const sequence: FrameSequence = { fps: 24, aspect: '16:9', clips: [clip('a', '/a.mp4', 0, 36), clip('b', '/b.mp4', 12, 36)], captions: [] };
    const plan = audioPlan(sequence);
    const { graph, calls } = fakeGraph();
    const buffers = new Map([['/a.mp4', {} as AudioBuffer], ['/b.mp4', {} as AudioBuffer]]);
    const leads: Record<string, number> = { '/a.mp4': 0.5, '/b.mp4': 0.5 - 0.478 };
    scheduleCutSound(graph, plan, buffers, () => 0, (url) => leads[url] ?? 0);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.start[0]).toBe(0);
    expect(calls[0]!.start[1]).toBeCloseTo(0.5, 12);
    expect(calls[1]!.start[0]).toBe(1.5);
    expect(calls[1]!.start[1]).toBeCloseTo(0.5 + 0.022, 12);
    // Without leads it is today's placement.
    const plain = fakeGraph();
    scheduleCutSound(plain.graph, plan, buffers);
    expect(plain.calls[1]!.start).toEqual([1.5, 0.5]);
    expect(soundWindow(plan.segments[1]!, plan.totalSamples)!.sourceOffsetSec).toBe(0.5);
  });
});

describe('a cut whose sound position could not be checked is named after the export', () => {
  it('a quiet note naming the cut', async () => {
    const { createElement: h } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { ExportStatus } = await import('@/components/brand-studio/editor-v2/export-sheet');
    const { studioEditorEn, studioEditorKo } = await import('@/messages/studio-editor');
    const job = { status: 'done' as const, url: 'blob:x', filename: 'f.mp4', bytes: 1, frames: 24, fps: 24, elapsedMs: 1, captionFile: null, warnings: [{ kind: 'soundPosition' as const, clip: 'webm clip' }] };
    const html = renderToStaticMarkup(h(ExportStatus, { job, copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-warning="soundPosition"');
    expect(html).toContain('&quot;webm clip&quot; 클립은 소리 위치를 확인하지 못해');
    expect(studioEditorEn.export.warnSoundPosition).toContain('{clip}');
  });
});
