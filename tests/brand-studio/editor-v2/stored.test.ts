import { describe, expect, it } from 'vitest';
import {
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  applyTimelinePatches,
  emptyComposerProject,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposeClip,
  type ComposerProject,
  type TimelinePatch,
} from '@/lib/brand-studio/compose/timeline';
import {
  moveClip,
  removeClips,
  setAspect,
  setClipAudio,
  setClipSpeed,
  splitAtFrame,
  spansOf,
  totalFrames,
  trimClipEdge,
  wholeFrameViolations,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import {
  deriveFrames,
  filmFpsOf,
  frameBlockOf,
  fromStored,
  mergeFilmText,
  sourcesToMeasure,
  toStored,
  type MeasuredSources,
} from '@/lib/brand-studio/editor-v2/stored';

/**
 * Editing studio v2, V1 — the bridge between the current editor's stored film (seconds, tenths) and the
 * frame model (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1, §11 V1). Both editors read and write the same
 * browser key, so a film must survive any number of trips between them without losing a frame on a cut
 * the current editor did not touch.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const url = (source: 'asset' | 'output', id: string) => `/api/brand-studio/compose?${new URLSearchParams({ organizationId: ORG, source, id })}`;

const SRC_A = url('asset', '10000000-0000-4000-8000-000000000001');
const SRC_B = url('output', '10000000-0000-4000-8000-000000000002');
const SRC_C = url('asset', '10000000-0000-4000-8000-000000000003');

/** What the browser measured: A is 24 fps, B is 30 fps footage, C is 23.976. */
const MEASURED: MeasuredSources = {
  [SRC_A]: { fps: 24, frames: 240 },
  [SRC_B]: { fps: 30, frames: 300 },
  [SRC_C]: { fps: 23.976, frames: 288 },
};

function clip(id: string, srcUrl: string, durationSec: number, trimStartSec: number, trimEndSec: number, extra: Partial<ComposeClip> = {}): ComposeClip {
  return {
    id,
    label: `clip ${id}`,
    sourceKind: srcUrl.includes('source=output') ? 'output' : 'asset',
    ...(srcUrl.includes('source=output') ? { outputId: id } : { assetId: id }),
    srcUrl,
    thumbUrl: `/thumbs/${id}.jpg`,
    durationSec,
    trimStartSec,
    trimEndSec,
    volume: 1,
    muted: false,
    ...extra,
  };
}

/** A film made in the current editor, read the way the current editor reads it. */
function legacy(raw: Partial<ComposerProject> & { clips: ComposeClip[] }): ComposerProject {
  const project = parseStoredProject(JSON.stringify({ version: 1, aspect: '9:16', captions: [], bgm: null, ...raw }));
  if (!project) throw new Error('fixture did not parse');
  return project;
}

/** Load → save → load in the current editor: its real read and write path. */
function throughCurrentEditor(project: ComposerProject): ComposerProject {
  const once = parseStoredProject(serializeProjectForStorage(project));
  if (!once) throw new Error('current editor could not read it');
  const twice = parseStoredProject(serializeProjectForStorage(once));
  if (!twice) throw new Error('current editor could not read it twice');
  return twice;
}

function frameFields(seq: FrameSequence) {
  return seq.clips.map((c) => [c.id, c.inFrame, c.phase, c.frames, c.speedNum, c.speedDen, c.sourceFps, c.sourceFrames]);
}

/** What v2 owns of a sequence: everything but the captions (they stay the stored film's, review round 1 item 1). */
const cutsOf = (seq: FrameSequence): FrameSequence => ({ ...seq, captions: [] });

const LEGACY = legacy({
  clips: [
    clip('c1', SRC_A, 10, 0.5, 3.2),
    clip('c2', SRC_B, 10, 1, 4.4, { playbackRate: 1.5 }),
    clip('c3', SRC_A, 10, 2, 6),
    clip('c4', SRC_C, 12, 0, 2.5, { playbackRate: 0.5 }),
  ],
  captions: [
    { id: 'k1', text: 'first line', startSec: 0.23, endSec: 1.81, position: 'bottom', size: 'md' },
    { id: 'k2', text: 'second line', startSec: 2.5, endSec: 3.75, position: 'top', size: 'lg' },
  ],
});

describe('film frame rate', () => {
  it('takes the rate of the first cut that carries frame data', () => {
    const film = fromStored(LEGACY, MEASURED);
    const stored = toStored(film.sequence, LEGACY);
    const withBlocks = { ...stored, clips: [{ ...stored.clips[0]!, frameV2: undefined }, ...stored.clips.slice(1)] } as ComposerProject;
    expect(filmFpsOf(withBlocks, { [SRC_A]: { fps: 30, frames: 300 } })).toBe(24);
  });

  it('otherwise snaps the first cut’s measured rate to a whole film rate, else 30', () => {
    const one = legacy({ clips: [clip('x', SRC_A, 10, 0, 5)] });
    expect(filmFpsOf(one, { [SRC_A]: { fps: 23.976, frames: 240 } })).toBe(24);
    expect(filmFpsOf(one, { [SRC_A]: { fps: 29.97, frames: 300 } })).toBe(30);
    expect(filmFpsOf(one, { [SRC_A]: { fps: 59.94, frames: 600 } })).toBe(60);
    expect(filmFpsOf(one, { [SRC_A]: { fps: 25, frames: 250 } })).toBe(25);
    expect(filmFpsOf(one, { [SRC_A]: { fps: 50, frames: 500 } })).toBe(50);
    expect(filmFpsOf(one, { [SRC_A]: null })).toBe(30);
    expect(filmFpsOf(one, {})).toBe(30);
    expect(filmFpsOf(emptyComposerProject('9:16'), {})).toBe(30);
  });
});

describe('a film made in the current editor (no frame data anywhere)', () => {
  const film = fromStored(LEGACY, MEASURED);
  const fps = film.sequence.fps;

  it('converts every cut with frames = round(seconds × fps) on the film rate of its first cut', () => {
    expect(fps).toBe(24);
    expect(film.derived).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(film.exact).toEqual([]);
    for (const [index, stored] of LEGACY.clips.entries()) {
      const c = film.sequence.clips[index]!;
      const rate = stored.playbackRate ?? 1;
      expect(c.inFrame).toBe(Math.round(stored.trimStartSec * fps));
      expect(c.frames).toBe(Math.round(((stored.trimEndSec - stored.trimStartSec) / rate) * fps));
      expect(Math.abs(c.frames - ((stored.trimEndSec - stored.trimStartSec) / rate) * fps)).toBeLessThanOrEqual(0.5);
      expect(c.speedNum / c.speedDen).toBe(rate);
      expect(c.phase).toBe(0);
      expect(c.sourceFps).toBe(MEASURED[stored.srcUrl]!.fps);
      expect(c.sourceFrames).toBe(MEASURED[stored.srcUrl]!.frames);
      expect([c.id, c.label, c.srcUrl, c.thumbUrl, c.volume, c.muted]).toEqual([stored.id, stored.label, stored.srcUrl, stored.thumbUrl, stored.volume, stored.muted]);
    }
    expect(film.sequence.aspect).toBe('9:16');
    expect(wholeFrameViolations(film.sequence)).toEqual([]);
  });

  it('reduces the speed to a fraction', () => {
    expect([film.sequence.clips[1]!.speedNum, film.sequence.clips[1]!.speedDen]).toEqual([3, 2]);
    expect([film.sequence.clips[3]!.speedNum, film.sequence.clips[3]!.speedDen]).toEqual([1, 2]);
  });

  it('puts captions on frames', () => {
    expect(film.sequence.captions).toEqual([
      { id: 'k1', text: 'first line', start: Math.round(0.23 * 24), end: Math.round(1.81 * 24), position: 'bottom', size: 'md' },
      { id: 'k2', text: 'second line', start: 60, end: 90, position: 'top', size: 'lg' },
    ]);
    const tiny = fromStored(legacy({ clips: LEGACY.clips, captions: [{ id: 'z', text: 't', startSec: 1, endSec: 1.01, position: 'bottom', size: 'sm' }] }), MEASURED);
    expect(tiny.sequence.captions[0]).toMatchObject({ start: 24, end: 25 });
  });

  it('a visit that changes nothing leaves every second the current editor sees where it was', () => {
    const saved = throughCurrentEditor(toStored(film.sequence, LEGACY));
    expect(saved.clips.map((c) => [c.id, c.trimStartSec, c.trimEndSec, c.playbackRate, c.durationSec, c.volume, c.muted])).toEqual(
      LEGACY.clips.map((c) => [c.id, c.trimStartSec, c.trimEndSec, c.playbackRate, c.durationSec, c.volume, c.muted]),
    );
    expect(saved.captions).toEqual(LEGACY.captions);
    expect(saved.aspect).toBe(LEGACY.aspect);
  });

  it('assumes the film rate when a rate could not be measured, and says so', () => {
    const blind = fromStored(LEGACY, { [SRC_A]: { fps: 24, frames: 240 }, [SRC_B]: null });
    const b = blind.sequence.clips[1]!;
    expect(b.sourceFps).toBe(24);
    expect(b.sourceFrames).toBe(Math.round(10 * 24));
    expect(blind.rateUnknown).toEqual(['c2', 'c4']);
  });

  it('asks the browser to measure every cut that has no frame data', () => {
    expect(sourcesToMeasure(LEGACY)).toEqual([SRC_A, SRC_B, SRC_C]);
    const saved = toStored(film.sequence, LEGACY);
    expect(sourcesToMeasure(saved)).toEqual([]);
  });
});

/** A tiny deterministic generator so a failure prints a replayable seed. */
function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SPEEDS: Array<[number, number]> = [[1, 2], [1, 1], [3, 2], [2, 1]];

function randomStep(seq: FrameSequence, next: () => number, id: () => string): FrameSequence {
  const pick = Math.floor(next() * 7);
  const index = Math.floor(next() * seq.clips.length);
  switch (pick) {
    case 0:
    case 1: {
      const total = totalFrames(seq);
      return splitAtFrame(seq, 1 + Math.floor(next() * Math.max(1, total - 1)), id());
    }
    case 2:
      return trimClipEdge(seq, index, next() < 0.5 ? 'start' : 'end', Math.round((next() - 0.5) * 40)).seq;
    case 3: {
      const [num, den] = SPEEDS[Math.floor(next() * SPEEDS.length)]!;
      return setClipSpeed(seq, index, num, den);
    }
    case 4:
      return moveClip(seq, index, Math.floor(next() * seq.clips.length));
    case 5:
      return seq.clips.length > 2 ? removeClips(seq, [seq.clips[index]!.id]) : seq;
    default:
      return setClipAudio(seq, index, Math.round(next() * 100) / 100, next() < 0.2);
  }
}

describe('v2 → stored → v2 keeps every frame', () => {
  it('returns exactly the sequence after any run of frame operations, and after the current editor loads and saves it', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const next = rng(seed);
      let n = 0;
      const id = () => `s${seed}-${(n += 1)}`;
      let seq = fromStored(LEGACY, MEASURED).sequence;
      let previous: ComposerProject = LEGACY;
      for (let step = 0; step < 120; step += 1) {
        if (seq.clips.length < MAX_COMPOSE_CLIPS - 1) seq = randomStep(seq, next, id);
        else seq = removeClips(seq, [seq.clips[0]!.id]);
        const stored = toStored(seq, previous);
        // Captions are the stored film's, written back as they were.
        expect(stored.captions, `seed ${seed} step ${step}`).toEqual(LEGACY.captions);
        // 1. Straight back.
        const back = fromStored(stored, MEASURED);
        expect(cutsOf(back.sequence), `seed ${seed} step ${step}`).toEqual(cutsOf(seq));
        expect(back.derived, `seed ${seed} step ${step}`).toEqual([]);
        // 2. Through the current editor's own load and save, twice.
        const visited = throughCurrentEditor(stored);
        expect(cutsOf(fromStored(visited, MEASURED).sequence), `seed ${seed} step ${step} via current editor`).toEqual(cutsOf(seq));
        previous = visited;
      }
    }
  });

  it('keeps cuts shorter than the current editor’s 0.3 s floor exact', () => {
    let seq = fromStored(LEGACY, MEASURED).sequence;
    seq = splitAtFrame(seq, 5, 'short-right');
    expect(seq.clips[0]!.frames).toBe(5);
    const stored = toStored(seq, LEGACY);
    const first = stored.clips[0]!;
    expect(first.trimEndSec - first.trimStartSec).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(fromStored(throughCurrentEditor(stored), MEASURED).sequence).toEqual(seq);
  });

  it('keeps a 30 fps clip in a 24 fps film exact, and a retimed cut split off its speed cycle', () => {
    let seq = fromStored(LEGACY, MEASURED).sequence;
    const b = spansOf(seq)[1]!;
    seq = splitAtFrame(seq, b.start + 7, 'b-right');
    expect(seq.clips[2]!.phase).not.toBe(0);
    seq = trimClipEdge(seq, 0, 'end', -1).seq;
    const back = fromStored(throughCurrentEditor(toStored(seq, LEGACY)), MEASURED).sequence;
    expect(back).toEqual(seq);
    expect(back.clips[1]!.sourceFps).toBe(30);
  });

  it('keeps the aspect', () => {
    const seq = setAspect(fromStored(LEGACY, MEASURED).sequence, '16:9');
    expect(toStored(seq, LEGACY).aspect).toBe('16:9');
    expect(fromStored(toStored(seq, LEGACY), MEASURED).sequence.aspect).toBe('16:9');
  });
});

describe('the current editor changes one cut: only that cut is rebuilt from seconds', () => {
  // A v2 film with frame-exact edits the tenths cannot hold: one-frame trims and a split off the grid.
  let seq = fromStored(LEGACY, MEASURED).sequence;
  seq = trimClipEdge(seq, 0, 'start', 1).seq;
  seq = trimClipEdge(seq, 2, 'end', -1).seq;
  seq = splitAtFrame(seq, spansOf(seq)[3]!.start + 11, 'c4-right');
  const stored = throughCurrentEditor(toStored(seq, LEGACY));

  const patched = (patch: TimelinePatch) => throughCurrentEditor(applyTimelinePatches(stored, [patch]).project);
  const derivedFrom = (project: ComposerProject, index: number, sourceOf = seq.clips) => {
    const c = project.clips[index]!;
    const source = sourceOf.find((entry) => entry.srcUrl === c.srcUrl)!;
    return deriveFrames(c, seq.fps, { sourceFps: source.sourceFps, sourceFrames: source.sourceFrames });
  };

  it('trim: that cut to the nearest frame, every other cut exact', () => {
    const project = patched({ op: 'trim_clip', clipIndex: 1, trimEndSec: 3.6 });
    const film = fromStored(project, MEASURED);
    expect(film.derived).toEqual([seq.clips[1]!.id]);
    expect(film.sequence.clips[1]).toMatchObject(derivedFrom(project, 1));
    expect(film.sequence.clips.filter((_, i) => i !== 1)).toEqual(seq.clips.filter((_, i) => i !== 1));
  });

  it('split: both halves to the nearest frame, every other cut exact', () => {
    const project = patched({ op: 'split_clip_at', clipIndex: 2, atMediaSec: 3.5 });
    const film = fromStored(project, MEASURED);
    expect(film.derived).toEqual([project.clips[2]!.id, project.clips[3]!.id]);
    expect(film.sequence.clips[2]).toMatchObject(derivedFrom(project, 2));
    expect(film.sequence.clips[3]).toMatchObject(derivedFrom(project, 3));
    expect([...film.sequence.clips.slice(0, 2), ...film.sequence.clips.slice(4)]).toEqual([...seq.clips.slice(0, 2), ...seq.clips.slice(3)]);
  });

  it('speed: that cut rebuilt at the new speed', () => {
    const project = patched({ op: 'set_clip_speed', clipIndex: 0, playbackRate: 2 });
    const film = fromStored(project, MEASURED);
    expect(film.derived).toEqual([seq.clips[0]!.id]);
    expect([film.sequence.clips[0]!.speedNum, film.sequence.clips[0]!.speedDen]).toEqual([2, 1]);
    expect(film.sequence.clips.slice(1)).toEqual(seq.clips.slice(1));
  });

  it('move and remove: nothing rebuilt, every cut exact in its new place', () => {
    const moved = fromStored(patched({ op: 'move_clip', fromIndex: 0, toIndex: 3 }), MEASURED);
    expect(moved.derived).toEqual([]);
    expect(moved.sequence.clips).toEqual([seq.clips[1], seq.clips[2], seq.clips[3], seq.clips[0], ...seq.clips.slice(4)]);
    const removed = fromStored(patched({ op: 'remove_clip', clipIndex: 1 }), MEASURED);
    expect(removed.derived).toEqual([]);
    expect(removed.sequence.clips).toEqual(seq.clips.filter((_, i) => i !== 1));
  });

  it('the stored frame data says what it mirrors', () => {
    const block = frameBlockOf(stored.clips[0]!)!;
    expect(block.fps).toBe(24);
    expect(block.mirror).toEqual({ trimStartSec: stored.clips[0]!.trimStartSec, trimEndSec: stored.clips[0]!.trimEndSec, playbackRate: stored.clips[0]!.playbackRate ?? 1 });
    expect(frameBlockOf({ ...stored.clips[0]!, frameV2: { ...block, frames: 1.5 } } as ComposeClip)).toBeNull();
    expect(frameBlockOf({ ...stored.clips[0]!, frameV2: { ...block, phase: block.speedDen } } as ComposeClip)).toBeNull();
    expect(frameBlockOf(LEGACY.clips[0]!)).toBeNull();
  });
});

describe('what v2 does not own is never dropped or changed', () => {
  const rich = legacy({
    aspect: '16:9',
    clips: [
      clip('r1', SRC_A, 10, 0.5, 4, {
        cutMarkers: [1.2, 2.5],
        transitionIn: 'cross_dissolve',
        transitionDurationSec: 0.6,
        audioOffsetSec: -0.4,
        takes: [
          { id: 't1', label: 'take 1', sourceKind: 'asset', assetId: 'r1', srcUrl: SRC_A, thumbUrl: null, durationSec: 10, trimStartSec: 0.5, trimEndSec: 4 },
          { id: 't2', label: 'take 2', sourceKind: 'output', outputId: 'o2', srcUrl: SRC_B, thumbUrl: null, durationSec: 8, trimStartSec: 0, trimEndSec: 3 },
        ],
        activeTakeIndex: 0,
        ...({ futureField: { keep: true } } as object),
      }),
      clip('r2', SRC_B, 10, 0, 5, { transitionIn: 'dip_to_black', transitionDurationSec: 0.4 }),
    ],
    captions: [{ id: 'k', text: 'hello', startSec: 0.4, endSec: 2, position: 'bottom', size: 'md' }],
    bgm: { label: 'Track', sourceKind: 'asset', assetId: 'bgm', srcUrl: '/bgm.mp3', durationSec: 60, trimStartSec: 2, volume: 0.4, dropSyncSec: 1.5 },
    colorGrade: { enabled: true, scope: 'full_timeline', presetId: null, intensity: 0.7, skinProtect: 0.6, grain: 1, halation: 0.02 } as ComposerProject['colorGrade'],
    overlays: [{ id: 'ov', label: 'logo', sourceKind: 'asset', assetId: 'logo', srcUrl: '/logo.png', mediaKind: 'image', startSec: 0, endSec: 2, x: 0.8, y: 0.1, scale: 0.2, opacity: 1 }],
    sfxClips: [{ id: 'fx', label: 'whoosh', sourceKind: 'asset', assetId: 'fx', srcUrl: '/fx.mp3', startSec: 1, durationSec: 0.8, volume: 0.9 }],
    referenceAssetIds: ['ref-1'],
  });

  it('carries the project’s music, look, overlays, effects and references untouched through any v2 edit', () => {
    let seq = fromStored(rich, MEASURED).sequence;
    seq = trimClipEdge(seq, 0, 'end', -3).seq;
    seq = splitAtFrame(seq, 20, 'r1-right');
    seq = setClipSpeed(seq, 2, 3, 2);
    seq = moveClip(seq, 2, 0);
    const stored = toStored(seq, rich);
    for (const key of ['bgm', 'colorGrade', 'overlays', 'sfxClips', 'referenceAssetIds'] as const) expect(stored[key], key).toEqual(rich[key]);
    const visited = throughCurrentEditor(stored);
    for (const key of ['bgm', 'colorGrade', 'overlays', 'sfxClips', 'referenceAssetIds'] as const) expect(visited[key], key).toEqual(rich[key]);
  });

  it('keeps takes, cut markers, transitions, audio offsets and unknown fields on every cut, and copies them onto both halves of a split like the current editor does', () => {
    let seq = fromStored(rich, MEASURED).sequence;
    seq = trimClipEdge(seq, 0, 'start', 2).seq;
    seq = splitAtFrame(seq, 30, 'r1-right');
    const stored = throughCurrentEditor(toStored(seq, rich));
    const carried = (c: ComposeClip) => ({
      takes: c.takes,
      activeTakeIndex: c.activeTakeIndex,
      cutMarkers: c.cutMarkers,
      transitionIn: c.transitionIn,
      transitionDurationSec: c.transitionDurationSec,
      audioOffsetSec: c.audioOffsetSec,
      futureField: (c as ComposeClip & { futureField?: unknown }).futureField,
      sourceKind: c.sourceKind,
      assetId: c.assetId,
      outputId: c.outputId,
      durationSec: c.durationSec,
    });
    const r1 = rich.clips[0]!;
    expect(carried(stored.clips[0]!)).toEqual(carried(r1));
    expect(stored.clips[1]!.id).toBe('r1-right');
    expect(carried(stored.clips[1]!)).toEqual(carried(r1));
    expect(carried(stored.clips[2]!)).toEqual(carried(rich.clips[1]!));
    // The current editor's own split does the same with takes: both halves keep the stack.
    const ownSplit = applyTimelinePatches(rich, [{ op: 'split_clip_at', clipIndex: 0, atMediaSec: 2 }]).project;
    expect(ownSplit.clips[0]!.takes).toEqual(r1.takes);
    expect(ownSplit.clips[1]!.takes).toEqual(r1.takes);
  });

  it('a pasted copy of a cut v2 has not saved yet keeps what the bin or its original carried', () => {
    const seq = fromStored(rich, MEASURED).sequence;
    const copy = { ...seq.clips[0]!, id: 'pasted' };
    const known = { pasted: { ...rich.clips[0]!, id: 'pasted' } };
    const stored = toStored({ ...seq, clips: [...seq.clips, copy] }, rich, { known });
    expect(stored.clips[2]!.takes).toEqual(rich.clips[0]!.takes);
    expect(stored.clips[2]!.id).toBe('pasted');
    expect(fromStored(stored, MEASURED).sequence.clips[2]).toEqual(copy);
  });

  it('a cut with no stored origin becomes a clip of its own footage', () => {
    const seq = fromStored(rich, MEASURED).sequence;
    const fresh = { ...seq.clips[0]!, id: 'new', srcUrl: SRC_C, label: 'new clip', thumbUrl: null, sourceFps: 23.976, sourceFrames: 288 };
    const stored = toStored({ ...seq, clips: [...seq.clips, fresh] }, rich);
    const made = stored.clips[2]!;
    expect(made).toMatchObject({ id: 'new', label: 'new clip', sourceKind: 'asset', assetId: '10000000-0000-4000-8000-000000000003', srcUrl: SRC_C });
    expect(made.takes).toBeUndefined();
    expect(parseStoredProject(serializeProjectForStorage(stored))!.clips).toHaveLength(3);
    expect(fromStored(stored, MEASURED).sequence.clips[2]).toEqual(fresh);
  });

  it('writes no frame data for footage whose rate was not measured, and measures it again next time (review round 1, item 3)', () => {
    const seq = fromStored(rich, { [SRC_A]: { fps: 24, frames: 240 } }).sequence;
    const stored = toStored(seq, rich, { unmeasuredSources: [SRC_B] });
    expect(frameBlockOf(stored.clips[1]!)).toBeNull();
    expect(frameBlockOf(stored.clips[0]!)).not.toBeNull();
    expect(sourcesToMeasure(stored)).toEqual([SRC_B]);
    expect(fromStored(stored, { [SRC_A]: { fps: 24, frames: 240 }, [SRC_B]: null }).rateUnknown).toEqual(['r2']);
    expect(fromStored(stored, MEASURED).rateUnknown).toEqual([]);
  });
});

describe('limits', () => {
  it('stores at most the current editor’s clip limit, and never writes captions of its own', () => {
    let seq = fromStored(LEGACY, MEASURED).sequence;
    const extra = Array.from({ length: 40 }, (_, i) => ({ ...seq.clips[0]!, id: `x${i}` }));
    seq = { ...seq, clips: [...seq.clips, ...extra], captions: Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, text: `t${i}`, start: i, end: i + 1, position: 'bottom' as const, size: 'md' as const })) };
    const stored = toStored(seq, LEGACY);
    expect(stored.clips).toHaveLength(MAX_COMPOSE_CLIPS);
    expect(stored.captions).toBe(LEGACY.captions);
    expect(fromStored({ ...stored, clips: [...stored.clips, ...stored.clips] }, MEASURED).sequence.clips).toHaveLength(MAX_COMPOSE_CLIPS);
    // Reading a stored film keeps at most the current editor's caption limit.
    const many = Array.from({ length: 45 }, (_, i) => ({ id: `c${i}`, text: `t${i}`, startSec: i / 10, endSec: i / 10 + 0.1, position: 'bottom' as const, size: 'md' as const }));
    expect(fromStored({ ...LEGACY, captions: many }, MEASURED).sequence.captions).toHaveLength(MAX_COMPOSE_CAPTIONS);
  });
});

describe('read, merge, write', () => {
  const seq = trimClipEdge(fromStored(LEGACY, MEASURED).sequence, 0, 'end', -2).seq;

  it('puts v2’s cuts onto whatever the key holds now, keeping what another screen added meanwhile', () => {
    const now = { ...LEGACY, bgm: { label: 'From the sound studio', sourceKind: 'asset' as const, assetId: 'm', srcUrl: '/m.mp3', durationSec: 30, trimStartSec: 0, volume: 0.5 } };
    const text = mergeFilmText(serializeProjectForStorage(now), seq);
    const written = parseStoredProject(text)!;
    expect(written.bgm).toEqual(now.bgm);
    expect(fromStored(written, MEASURED).sequence).toEqual(seq);
  });

  it('starts a film when the key is empty or unreadable', () => {
    for (const text of [null, '', 'not json', JSON.stringify({ version: 9 })]) {
      const written = parseStoredProject(mergeFilmText(text, seq))!;
      expect(written.bgm).toBeNull();
      // Captions are not v2's to write: an empty key stays without captions.
      expect(written.captions).toEqual([]);
      expect(cutsOf(fromStored(written, MEASURED).sequence)).toEqual(cutsOf(seq));
    }
  });

  it('writes exactly what the current editor’s own writer would write for the same project', () => {
    const text = mergeFilmText(serializeProjectForStorage(LEGACY), seq);
    expect(serializeProjectForStorage(parseStoredProject(text)!)).toBe(text);
  });
});
