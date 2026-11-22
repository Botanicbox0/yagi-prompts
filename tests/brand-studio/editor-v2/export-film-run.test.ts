import { afterEach, describe, expect, it, vi } from 'vitest';
import { clip, events, film, loadExport, made, settle, unloadExport } from './export-harness';
import { makeIndex } from './fake-decoder';

/**
 * Spec I (G1, G5): the real `exportFilm` run with a faked browser (./export-harness.ts), so the export's own
 * order of things is tested as behaviour, not read from its source text.
 */
afterEach(() => unloadExport());

const SEEKED = '/media/seeked.mp4';
const DECODED = '/media/decoded.mp4';

describe('the harness', () => {
  it('a film of a seeked and a decoded cut is exported: every frame encoded, both paths, the sound written', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({
      clips: {
        [SEEKED]: { facts: { fps: 24, frames: 24 }, index: 'refused' },
        [DECODED]: { facts: { fps: 24, frames: 24 }, index: makeIndex(24) },
      },
    });
    const outcome = await settle(exportFilm({ sequence: film([clip('a', SEEKED, 12), clip('b', DECODED, 12)]) }));
    expect(outcome.error).toBeUndefined();
    expect(outcome.value!.frames).toBe(24);
    expect(outcome.value!.paths.map((p) => [p.clip, p.path])).toEqual([
      ['a', 'seek'],
      ['b', 'decoder'],
    ]);
    expect(made.videoEncoders).toBe(1);
    expect(made.audioEncoders).toBe(1);
    expect(events).toContain('VideoEncoder 0');
  });
});

describe('spec I, G1: a clip’s frame facts are waited for once per export', () => {
  it('facts that never come: one wait (45 s) when the path is chosen; opening the clip and the restart do not wait again', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips: { [SEEKED]: { facts: 'never', index: 'refused' } }, reclaimVideoAfter: [6] });
    const outcome = await settle(exportFilm({ sequence: film([clip('a', SEEKED, 12)]) }));
    expect(outcome.error).toBeUndefined();
    expect(outcome.value!.paths[0]).toMatchObject({ path: 'seek', reason: 'facts:timeout' });
    expect(outcome.value!.restarts).toBe(1);
    expect(made.videoEncoders).toBe(2);
    expect(made.factsReads.get(SEEKED)).toBe(1);
    // One shared wait, not one more per opening of the clip.
    expect(outcome.ms).toBeGreaterThanOrEqual(45_000);
    expect(outcome.ms).toBeLessThan(60_000);
  });
});

describe('spec I, G5 (A4): every source’s path is chosen before the encoder exists', () => {
  it('the last source’s facts come 5 s late: the encoder is made only after its path is settled', async () => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({
      clips: {
        [SEEKED]: { facts: { fps: 24, frames: 24 }, index: 'refused' },
        [DECODED]: { facts: { fps: 24, frames: 24 }, index: makeIndex(24), factsDelayMs: 5_000 },
      },
    });
    const outcome = await settle(exportFilm({ sequence: film([clip('a', SEEKED, 12), clip('b', DECODED, 12)]) }));
    expect(outcome.error).toBeUndefined();
    const encoder = events.indexOf('VideoEncoder 0');
    expect(encoder).toBeGreaterThan(-1);
    expect(events.indexOf(`facts ${DECODED}`)).toBeGreaterThan(-1);
    expect(events.indexOf(`facts ${DECODED}`)).toBeLessThan(encoder);
    expect(events.lastIndexOf('decoder supported')).toBeGreaterThan(-1);
    expect(events.lastIndexOf('decoder supported')).toBeLessThan(encoder);
  });
});

describe('spec I, G5: a taken-back encoder starts its own part again, one budget for both', () => {
  const clips = { [DECODED]: { facts: { fps: 24, frames: 24 }, index: makeIndex(24) } };
  const run = async (reclaimVideoAfter: number[], reclaimAudioAfter: number[]) => {
    vi.useFakeTimers();
    const { exportFilm } = await loadExport({ clips, reclaimVideoAfter, reclaimAudioAfter });
    const progress: Array<{ phase: string; done: number; restarts?: number }> = [];
    const outcome = await settle(exportFilm({ sequence: film([clip('b', DECODED, 24)]), onProgress: (p) => progress.push(p) }));
    return { outcome, progress };
  };

  it('pictures: the video encoder taken back after 6 frames: the pictures again from frame 0, the sound once', async () => {
    const { outcome, progress } = await run([6], []);
    expect(outcome.error).toBeUndefined();
    expect(outcome.value!.restarts).toBe(1);
    expect(outcome.value!.frames).toBe(24);
    expect(made.videoEncoders).toBe(2);
    expect(made.audioEncoders).toBe(1);
    const restart = progress.findIndex((p) => p.restarts === 1);
    expect(progress[restart]).toMatchObject({ phase: 'video', done: 0 });
    expect(progress.slice(0, restart).some((p) => p.phase === 'video' && p.done >= 6)).toBe(true);
  });

  it('sound: the sound encoder taken back after 5 blocks: only the sound again, the pictures once', async () => {
    const { outcome, progress } = await run([], [5]);
    expect(outcome.error).toBeUndefined();
    expect(outcome.value!.restarts).toBe(1);
    expect(made.videoEncoders).toBe(1);
    expect(made.audioEncoders).toBe(2);
    expect(progress.find((p) => p.restarts === 1)).toMatchObject({ phase: 'audio', done: 0 });
  });

  it('one budget: two picture restarts and one sound restart pass (3); a fourth taking-back stops the export (hidden)', async () => {
    const three = await run([3, 3], [2]);
    expect(three.outcome.error).toBeUndefined();
    expect(three.outcome.value!.restarts).toBe(3);
    unloadExport();
    const four = await run([3, 3], [2, 2]);
    expect(four.outcome.error).toMatchObject({ reason: 'hidden' });
  });
});
