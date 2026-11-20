import { describe, expect, it } from 'vitest';
import { parseStoredProject, serializeProjectForStorage, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { MEASURE_LIMITS_MS, measureWithRetry, rateFromMediaTimes } from '@/lib/brand-studio/editor-v2/fps';
import { setAspect, splitAtFrame, trimClipEdge } from '@/lib/brand-studio/editor-v2/frames';
import { filmFpsOf, frameBlockOf, fromStored, sourcesToMeasure, toStored, type MeasuredSources } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Review round 1, item 3: a guessed frame rate is never stored, and is measured again.
 *
 * Before: a clip whose rate could not be measured (a background tab, the 8 s limit) got a `frameV2`
 * block at the film's 30, marked `rateGuessed`, and `sourcesToMeasure` skipped every clip with a block:
 * a 24 or 25 fps source stayed at 30 for good and every export of that cut failed. Now nothing
 * frame-based is written from a guess, an old guessed block is not trusted, the film's rate comes only
 * from measured clips, and measuring waits for the page to be visible and tries once more before it
 * gives up for the visit.
 */
const src = (id: string) => `/api/brand-studio/compose?organizationId=org&source=asset&id=${id}`;
const SRC_24 = src('a24');
const SRC_25 = src('b25');

function clip(id: string, srcUrl: string, trimStartSec: number, trimEndSec: number): ComposeClip {
  return { id, label: `clip ${id}`, sourceKind: 'asset', assetId: id, srcUrl, thumbUrl: null, durationSec: 10, trimStartSec, trimEndSec, volume: 1, muted: false };
}

const FILM: ComposerProject = parseStoredProject(
  JSON.stringify({ version: 1, aspect: '9:16', captions: [], bgm: null, clips: [clip('c1', SRC_25, 0.5, 3.2), clip('c2', SRC_24, 1, 4)] }),
)!;
const BOTH: MeasuredSources = { [SRC_24]: { fps: 24, frames: 240 }, [SRC_25]: { fps: 25, frames: 250 } };
const ONLY_24: MeasuredSources = { [SRC_24]: { fps: 24, frames: 240 }, [SRC_25]: null };
const NONE: MeasuredSources = { [SRC_24]: null, [SRC_25]: null };

const through = (project: ComposerProject) => parseStoredProject(serializeProjectForStorage(project))!;

describe('a guessed rate is never stored', () => {
  it('footage whose rate was not measured gets no frame data; the measured one does', () => {
    const film = fromStored(FILM, ONLY_24);
    const seq = trimClipEdge(film.sequence, 1, 'end', -1).seq;
    const stored = through(toStored(seq, FILM, { unmeasuredSources: [SRC_25] }));
    expect(frameBlockOf(stored.clips[0]!)).toBeNull();
    expect(frameBlockOf(stored.clips[1]!)).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain('rateGuessed');
    // And it is measured again on the next load.
    expect(sourcesToMeasure(stored)).toEqual([SRC_25]);
  });

  it('the film’s rate comes only from measured clips: a first clip that could not be read does not set it', () => {
    expect(filmFpsOf(FILM, ONLY_24)).toBe(24);
    expect(fromStored(FILM, ONLY_24).tentative).toBe(false);
    expect(filmFpsOf(FILM, BOTH)).toBe(25);
  });

  it('while no clip is measured the film runs at a tentative rate and nothing frame-based is stored', () => {
    const film = fromStored(FILM, NONE);
    expect(film.tentative).toBe(true);
    expect(film.sequence.fps).toBe(30);
    expect(film.rateUnknown).toEqual(['c1', 'c2']);
    const seq = setAspect(film.sequence, '16:9');
    const stored = through(toStored(seq, FILM, { unmeasuredSources: [SRC_24, SRC_25], tentative: true }));
    expect(stored.clips.map(frameBlockOf)).toEqual([null, null]);
    expect(stored.aspect).toBe('16:9');
    // The seconds the current editor sees did not move.
    expect(stored.clips.map((c) => [c.trimStartSec, c.trimEndSec])).toEqual(FILM.clips.map((c) => [c.trimStartSec, c.trimEndSec]));
  });

  it('even a measured clip writes no frame data into a tentative film (its rate would be the guess)', () => {
    const film = fromStored(FILM, NONE);
    const stored = toStored(film.sequence, FILM, { unmeasuredSources: [SRC_25], tentative: true });
    expect(stored.clips.map(frameBlockOf)).toEqual([null, null]);
  });

  it('a block an earlier version wrote from a guess is not trusted: rebuilt from seconds and measured again', () => {
    const exact = toStored(fromStored(FILM, BOTH).sequence, FILM);
    const block = frameBlockOf(exact.clips[1]!)!;
    const poisoned = through({
      ...exact,
      clips: [exact.clips[0]!, { ...exact.clips[1]!, frameV2: { ...block, fps: 30, sourceFps: 30, sourceFrames: 300, rateGuessed: true } } as ComposeClip],
    });
    expect(frameBlockOf(poisoned.clips[1]!)).toBeNull();
    expect(sourcesToMeasure(poisoned)).toContain(SRC_24);
    const reopened = fromStored(poisoned, BOTH);
    expect(reopened.derived).toContain('c2');
    expect(reopened.sequence.clips[1]!.sourceFps).toBe(24);
  });

  it('the visit that could not measure, an edit, then a visible visit: the film runs at the footage’s own rate', () => {
    // Visit 1: nothing measured (blocked, hidden), the person changes the shape and v2 saves.
    const first = fromStored(FILM, NONE);
    const saved = through(toStored(setAspect(first.sequence, '1:1'), FILM, { unmeasuredSources: [SRC_24, SRC_25], tentative: true }));
    // Visit 2: both measured.
    const second = fromStored(saved, BOTH);
    expect(second.tentative).toBe(false);
    expect(second.sequence.fps).toBe(25);
    expect(second.rateUnknown).toEqual([]);
    expect(second.sequence.clips.map((c) => c.sourceFps)).toEqual([25, 24]);
    // From now on it is frame-exact: a one-frame edit survives the round trip.
    const edited = splitAtFrame(second.sequence, 7, 'piece');
    const third = fromStored(through(toStored(edited, saved)), BOTH);
    expect({ ...third.sequence, captions: [] }).toEqual({ ...edited, captions: [] });
  });
});

describe('measuring a clip’s rate', () => {
  function deps(results: Array<number | null>, visibleAt: number[] = []) {
    const log: string[] = [];
    let visible = visibleAt.length === 0;
    return {
      log,
      deps: {
        visible: () => visible,
        untilVisible: async () => {
          log.push('wait');
          visible = true;
        },
        attempt: async (limitMs: number) => {
          log.push(`try ${limitMs}`);
          return results.shift() ?? null;
        },
      },
    };
  }

  it('waits for the page to be visible before it starts (a hidden tab presents no frames)', async () => {
    const run = deps([24], [1]);
    expect(await measureWithRetry(run.deps)).toBe(24);
    expect(run.log).toEqual(['wait', `try ${MEASURE_LIMITS_MS[0]}`]);
  });

  it('tries once more with a longer limit, then gives up for this visit', async () => {
    const twice = deps([null, 25]);
    expect(await measureWithRetry(twice.deps)).toBe(25);
    expect(twice.log).toEqual([`try ${MEASURE_LIMITS_MS[0]}`, `try ${MEASURE_LIMITS_MS[1]}`]);
    expect(MEASURE_LIMITS_MS[1]!).toBeGreaterThan(MEASURE_LIMITS_MS[0]!);
    const never = deps([null, null, 24]);
    expect(await measureWithRetry(never.deps)).toBeNull();
    expect(never.log).toHaveLength(2);
  });

  it('a constant rate is not variable; a mix of frame lengths is', () => {
    const steady = Array.from({ length: 13 }, (_, i) => i / 24);
    expect(rateFromMediaTimes(steady)).toEqual({ fps: 24, variable: false });
    // A skipped frame is twice the gap: still constant.
    expect(rateFromMediaTimes(steady.filter((_, i) => i !== 5)).variable).toBe(false);
    // Timestamps of 29.97 footage rounded to 10 µs (a container time scale): still constant.
    const rounded = Array.from({ length: 13 }, (_, i) => Math.round((i * 100_100) / 30) / 100_000);
    expect(rateFromMediaTimes(rounded)).toEqual({ fps: 29.97, variable: false });
    // Even 1 ms rounding (33 / 34 ms gaps) is not called variable.
    expect(rateFromMediaTimes(Array.from({ length: 13 }, (_, i) => Math.round((i * 1001) / 30) / 1000)).variable).toBe(false);
    // Frames of 1/24 and 1/30 s mixed (phone footage that changes rate): variable.
    let t = 0;
    const mixed = [0];
    for (let i = 0; i < 12; i += 1) mixed.push((t += i % 2 === 0 ? 1 / 24 : 1 / 30));
    expect(rateFromMediaTimes(mixed).variable).toBe(true);
    expect(rateFromMediaTimes([0, 0.1]).fps).toBeNull();
  });
});
