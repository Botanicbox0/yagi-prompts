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
