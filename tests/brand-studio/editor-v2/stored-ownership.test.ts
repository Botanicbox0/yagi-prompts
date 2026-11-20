import { describe, expect, it } from 'vitest';
import {
  MAX_COMPOSE_CLIPS,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposeClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import {
  frameStateAt,
  insertClips,
  moveClip,
  removeClips,
  setAspect,
  setClipAudio,
  setClipSpeed,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  visibleCaptions,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { captionsOnFrames, fromStored, inheritClip, toStored, type MeasuredSources } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Review round 1, item 1: v2 never destroys what it does not own.
 *
 * In real mode v2 owns the aspect, the list and order of cuts, and per cut its trims, speed, volume,
 * mute and frame data. Captions belong to the current editor in V1 (the captions workspace is locked):
 * whatever v2 does to the cuts, the stored captions are written back exactly as they were, even when the
 * film gets shorter than a caption. The same holds for music, the colour grade, overlays, sound effects,
 * references, and every field a cut carries that v2 does not own.
 */
const ORG = 'org';
const src = (id: string) => `/api/brand-studio/compose?${new URLSearchParams({ organizationId: ORG, source: 'asset', id })}`;
const SRC_A = src('a');
const SRC_B = src('b');
const SRC_C = src('c');
const MEASURED: MeasuredSources = {
  [SRC_A]: { fps: 24, frames: 240 },
  [SRC_B]: { fps: 30, frames: 300 },
  [SRC_C]: { fps: 24, frames: 120 },
};

function clip(id: string, srcUrl: string, durationSec: number, trimStartSec: number, trimEndSec: number, extra: Partial<ComposeClip> = {}): ComposeClip {
  return { id, label: `clip ${id}`, sourceKind: 'asset', assetId: id, srcUrl, thumbUrl: `/t/${id}.jpg`, durationSec, trimStartSec, trimEndSec, volume: 1, muted: false, ...extra };
}

/** A film made in the current editor, read the way it reads it: 3.5 s + 5 s + 2 s = 10.5 s. */
const RICH = parseStoredProject(
  JSON.stringify({
    version: 1,
    aspect: '9:16',
    clips: [
      clip('r1', SRC_A, 10, 0.5, 4, {
        cutMarkers: [1.2, 2.5],
        transitionIn: 'cross_dissolve',
        transitionDurationSec: 0.6,
        audioOffsetSec: -0.4,
        takes: [
          { id: 't1', label: 'take 1', sourceKind: 'asset', assetId: 'r1', srcUrl: SRC_A, thumbUrl: null, durationSec: 10, trimStartSec: 0.5, trimEndSec: 4 },
          { id: 't2', label: 'take 2', sourceKind: 'asset', assetId: 't2', srcUrl: SRC_B, thumbUrl: null, durationSec: 8, trimStartSec: 0, trimEndSec: 3 },
        ],
        activeTakeIndex: 0,
        ...({ futureField: { keep: true } } as object),
      }),
      clip('r2', SRC_B, 10, 0, 5, { transitionIn: 'dip_to_black', transitionDurationSec: 0.4, playbackRate: 1 }),
      clip('r3', SRC_C, 5, 1, 3, { audioOffsetSec: 0.2 }),
    ],
    captions: [
      { id: 'k1', text: 'first', startSec: 0.4, endSec: 2, position: 'bottom', size: 'md' },
      // Straddles the second and third cut.
      { id: 'k2', text: 'across', startSec: 7.5, endSec: 9.5, position: 'top', size: 'lg' },
      // Only inside the last cut: gone from view the moment the last cut goes.
      { id: 'k3', text: 'last words', startSec: 9.1, endSec: 10.4, position: 'center', size: 'sm' },
    ],
    bgm: { label: 'Track', sourceKind: 'asset', assetId: 'bgm', srcUrl: '/bgm.mp3', durationSec: 60, trimStartSec: 2, volume: 0.4, dropSyncSec: 1.5 },
    colorGrade: { enabled: true, scope: 'selected_clip', clipId: 'r1', presetId: 'kodak-2383-warm', intensity: 0.7, skinProtect: 0.6, grain: 1, halation: 0.02 },
    overlays: [{ id: 'ov', label: 'logo', sourceKind: 'asset', assetId: 'logo', srcUrl: '/logo.png', mediaKind: 'image', startSec: 0, endSec: 9.8, x: 0.8, y: 0.1, scale: 0.2, opacity: 1 }],
    sfxClips: [{ id: 'fx', label: 'whoosh', sourceKind: 'asset', assetId: 'fx', srcUrl: '/fx.mp3', startSec: 9.6, durationSec: 0.8, volume: 0.9 }],
    referenceAssetIds: ['ref-1'],
  }),
)!;

/** Load → save in the current editor, twice: its real read and write path. */
function throughCurrentEditor(project: ComposerProject): ComposerProject {
  return parseStoredProject(serializeProjectForStorage(parseStoredProject(serializeProjectForStorage(project))!))!;
}

const PROJECT_FIELDS = ['captions', 'bgm', 'colorGrade', 'overlays', 'sfxClips', 'referenceAssetIds'] as const;
/** What v2 owns on a stored cut; everything else is carried. */
const OWNED_CLIP_FIELDS = new Set(['trimStartSec', 'trimEndSec', 'playbackRate', 'volume', 'muted', 'frameV2']);

function carried(stored: ComposeClip, withId: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    if (OWNED_CLIP_FIELDS.has(key) || (!withId && key === 'id')) continue;
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function rng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SPEEDS: Array<[number, number]> = [[1, 2], [1, 1], [3, 2], [2, 1]];
const ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const;

describe('a randomised run of v2 operations never changes what v2 does not own', () => {
  for (const seed of [3, 11, 99, 2026, 31337]) {
    it(`seed ${seed}`, () => {
      const next = rng(seed);
      let n = 0;
      const newId = () => `s${seed}-${(n += 1)}`;
      /** The stored clips v2 knows (use-editor's catalogue): what each new cut inherits. */
      const known: Record<string, ComposeClip> = Object.fromEntries(RICH.clips.map((c) => [c.id, c]));
      /** Every cut back to the stored clip it came from. */
      const origin: Record<string, string> = Object.fromEntries(RICH.clips.map((c) => [c.id, c.id]));
      const inherit = (to: string, from: string) => {
        known[to] = inheritClip(known[from]!, to);
        origin[to] = origin[from]!;
      };
      let seq: FrameSequence = fromStored(RICH, MEASURED).sequence;
      const history: FrameSequence[] = [];
      let previous: ComposerProject = RICH;

      for (let step = 0; step < 160; step += 1) {
        const before = seq;
        const index = Math.floor(next() * seq.clips.length);
        const pick = Math.floor(next() * 10);
        if (pick === 0 && history.length > 0) {
          seq = history.pop()!; // undo
        } else {
          switch (pick) {
            case 0:
            case 1: {
              if (seq.clips.length >= MAX_COMPOSE_CLIPS) break;
              const id = newId();
              const frame = 1 + Math.floor(next() * Math.max(1, totalFrames(seq) - 1));
              const parent = frameStateAt(seq, frame).active?.clip.id;
              const split = splitAtFrame(seq, frame, id);
              if (split !== seq && parent) inherit(id, parent);
              seq = split;
              break;
            }
            case 2:
              seq = trimClipEdge(seq, index, next() < 0.5 ? 'start' : 'end', Math.round((next() - 0.5) * 60)).seq;
              break;
            case 3: {
              const [num, den] = SPEEDS[Math.floor(next() * SPEEDS.length)]!;
              seq = setClipSpeed(seq, index, num, den);
              break;
            }
            case 4:
              seq = moveClip(seq, index, Math.floor(next() * seq.clips.length));
              break;
            case 5:
            case 6:
              // Deleting cuts, the last one included, makes the film shorter than the captions.
              seq = seq.clips.length > 1 ? removeClips(seq, [seq.clips[next() < 0.5 ? seq.clips.length - 1 : index]!.id]) : seq;
              break;
            case 7: {
              // Paste a copy after the cut (use-editor's insertCopies).
              if (seq.clips.length >= MAX_COMPOSE_CLIPS) break;
              const source = seq.clips[index]!;
              const id = newId();
              inherit(id, source.id);
              seq = insertClips(seq, index + 1, [{ ...source, id }]);
              break;
            }
            case 8:
              seq = setAspect(seq, ASPECTS[Math.floor(next() * ASPECTS.length)]!);
              break;
            default:
              seq = setClipAudio(seq, index, Math.round(next() * 100) / 100, next() < 0.2);
          }
          if (seq !== before) history.push(before);
        }

        const stored = toStored(seq, previous, { known });
        const at = `seed ${seed} step ${step}`;
        // Captions: the very list that was stored, whatever the cuts look like now.
        expect(stored.captions, at).toEqual(RICH.captions);
        for (const key of PROJECT_FIELDS) expect(stored[key], `${at} ${key}`).toEqual(RICH[key]);
        for (const made of stored.clips) {
          const root = RICH.clips.find((c) => c.id === origin[made.id]);
          expect(root, `${at} ${made.id} has a stored origin`).toBeDefined();
          const own = made.id === root!.id;
          expect(carried(made, own), `${at} ${made.id}`).toEqual(carried(root!, own));
        }
        // The current editor opens and saves it, then v2 writes again onto that.
        previous = throughCurrentEditor(stored);
        for (const key of PROJECT_FIELDS) expect(previous[key], `${at} ${key} after the current editor`).toEqual(RICH[key]);
      }
    });
  }
});

describe('what a real film shows of the stored captions', () => {
  // use-editor keeps the cuts in its document and shows the stored captions on the film's frames.
  const cuts = { ...fromStored(RICH, MEASURED).sequence, captions: [] };
  const view = (seq: FrameSequence): FrameSequence => ({ ...seq, captions: captionsOnFrames(RICH.captions, seq.fps) });
  const shownAnywhere = (seq: FrameSequence) => {
    const ids = new Set<string>();
    for (let frame = 0; frame < totalFrames(seq); frame += 1) for (const caption of frameStateAt(view(seq), frame).captions) ids.add(caption.id);
    return [...ids].sort();
  };

  it('delete the last cut: the caption inside it is gone from view, the straddling one is cut at the end', () => {
    const shorter = removeClips(cuts, [cuts.clips[2]!.id]);
    expect(shownAnywhere(shorter)).toEqual(['k1', 'k2']);
    const lane = visibleCaptions(view(shorter));
    expect(lane.map((c) => c.id)).toEqual(['k1', 'k2']);
    expect(lane[1]!.end).toBe(totalFrames(shorter));
    // Nothing of it reaches storage.
    expect(toStored(shorter, RICH).captions).toBe(RICH.captions);
  });

  it('undo, or a cut added at the end, brings it back; so does opening the film again', () => {
    const shorter = removeClips(cuts, [cuts.clips[2]!.id]);
    expect(shownAnywhere(cuts)).toEqual(['k1', 'k2', 'k3']); // undo: the document before the delete
    const longer = insertClips(shorter, shorter.clips.length, [{ ...cuts.clips[0]!, id: 'again' }]);
    expect(totalFrames(longer)).toBeGreaterThan(Math.round(9.1 * 24));
    expect(shownAnywhere(longer)).toEqual(['k1', 'k2', 'k3']);
    const reopened = fromStored(throughCurrentEditor(toStored(shorter, RICH)), MEASURED).sequence;
    expect(reopened.captions).toEqual(captionsOnFrames(RICH.captions, reopened.fps));
  });
});

describe('captions v2 does not own', () => {
  it('stays in storage, the same objects in the same order, after the cut under it is deleted', () => {
    const seq = fromStored(RICH, MEASURED).sequence;
    const shorter = removeClips(seq, [seq.clips[2]!.id]);
    expect(totalFrames(shorter)).toBeLessThan(Math.round(9.1 * 24));
    const stored = toStored(shorter, RICH);
    expect(stored.captions).toBe(RICH.captions);
    // Reload: the caption is still there, and shows again once the film is long enough.
    const reloaded = fromStored(throughCurrentEditor(stored), MEASURED);
    expect(reloaded.sequence.captions.map((c) => c.id)).toEqual(['k1', 'k2', 'k3']);
  });

  it('is written back untouched even when every cut changed and the film is one frame long', () => {
    let seq = fromStored(RICH, MEASURED).sequence;
    seq = removeClips(seq, [seq.clips[1]!.id, seq.clips[2]!.id]);
    seq = trimClipEdge(seq, 0, 'end', -10_000).seq;
    expect(totalFrames(seq)).toBe(1);
    expect(toStored(seq, RICH).captions).toBe(RICH.captions);
  });
});
