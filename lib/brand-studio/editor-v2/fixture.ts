/**
 * Sample data for the editing studio v2 structure prototype (docs/BRAND-EDITING-STUDIO-V2.md §8).
 *
 * Every file is one of our own films already published under `public/reel`. Nothing comes from a
 * customer, a database or a reference product, and the footage has no sound: the voice and music lanes
 * are drawn from the numbers below, which is why the sound workspace marks itself as a sample.
 */
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import type { EditorDoc, MusicTrack, SpeechRegion } from './model';

export interface FixtureMaterial {
  id: string;
  src: string;
  poster: string;
  durationSec: number;
  /** Width divided by height of the footage. */
  ratio: number;
  origin: 'video_studio' | 'asset';
  /** Where the subject sits horizontally (`0..100`): what "center on the subject" would find. */
  focusX: number;
}

export interface FixtureReference {
  id: string;
  src: string;
}

export const FIXTURE_MATERIALS: readonly FixtureMaterial[] = [
  { id: 'm1', src: '/reel/landing/v7/rx-beauty-world.mp4', poster: '/reel/landing/v7/rx-beauty-world.jpg', durationSec: 4.7, ratio: 16 / 9, origin: 'video_studio', focusX: 50 },
  { id: 'm2', src: '/reel/landing/v7/rx-beauty-product.mp4', poster: '/reel/landing/v7/rx-beauty-product.jpg', durationSec: 4.7, ratio: 16 / 9, origin: 'video_studio', focusX: 56 },
  { id: 'm3', src: '/reel/landing/v7/film-tutu.mp4', poster: '/reel/landing/v7/film-tutu.jpg', durationSec: 17, ratio: 16 / 9, origin: 'video_studio', focusX: 48 },
  { id: 'm4', src: '/reel/landing/v7/film-aquarium.mp4', poster: '/reel/landing/v7/film-aquarium.jpg', durationSec: 10, ratio: 4 / 3, origin: 'asset', focusX: 50 },
  { id: 'm5', src: '/reel/landing/v7/film-daydream.mp4', poster: '/reel/landing/v7/film-daydream.jpg', durationSec: 13, ratio: 4 / 3, origin: 'asset', focusX: 50 },
  { id: 'm6', src: '/reel/brands/tea-editorial.mp4', poster: '/reel/brands/tea-editorial.jpg', durationSec: 12, ratio: 4 / 3, origin: 'asset', focusX: 44 },
];

export const FIXTURE_REFERENCES: readonly FixtureReference[] = [
  { id: 'r1', src: '/reel/brands/slot-4-color-french-cobalt.jpg' },
  { id: 'r2', src: '/reel/brands/tea-editorial.jpg' },
];

/** A narration the sample film is assumed to carry: three spoken stretches. */
export const FIXTURE_SPEECH: readonly SpeechRegion[] = [
  { startSec: 0.6, endSec: 3.8 },
  { startSec: 5.4, endSec: 8.9 },
  { startSec: 11.2, endSec: 14.6 },
];

/** What a loudness measurement of the sample film is assumed to return (integrated LUFS). */
export const FIXTURE_MEASURED_LUFS = -19.6;

export const FIXTURE_TRACK_IDS = ['t1', 't2', 't3'] as const;
export const FIXTURE_TRACK_SECONDS: Readonly<Record<(typeof FIXTURE_TRACK_IDS)[number], number>> = { t1: 62, t2: 48, t3: 75 };

/** The cuts the sample film opens with: material id, in and out points. */
const OPENING: ReadonlyArray<[string, number, number]> = [
  ['m1', 0, 4.7],
  ['m2', 0, 4.7],
  ['m3', 2, 7],
  ['m4', 0, 4.5],
];

export function materialBySrc(src: string): FixtureMaterial | undefined {
  return FIXTURE_MATERIALS.find((material) => material.src === src);
}

export function fixtureProject(labelOf: (materialId: string) => string): ComposerProject {
  return {
    version: 1,
    aspect: '16:9',
    clips: OPENING.map(([materialId, trimStartSec, trimEndSec], index) => {
      const material = FIXTURE_MATERIALS.find((m) => m.id === materialId)!;
      return {
        id: `cut-${index + 1}`,
        label: labelOf(materialId),
        sourceKind: 'local' as const,
        srcUrl: material.src,
        thumbUrl: material.poster,
        durationSec: material.durationSec,
        trimStartSec,
        trimEndSec,
        volume: 1,
        muted: false,
      };
    }),
    captions: [],
    bgm: null,
  };
}

export function fixtureDoc(labelOf: (materialId: string) => string): EditorDoc {
  return {
    project: fixtureProject(labelOf),
    looks: {},
    reframe: {},
    sound: { speechClear: false, duck: null, loudness: false, fades: false, musicVolume: 0.8 },
    music: null,
    captionSettings: { styleId: 'clean', safeArea: 'reels', lift: false, output: 'burn' },
    titles: [],
  };
}

export function fixtureTrack(id: (typeof FIXTURE_TRACK_IDS)[number], label: string, mood: string): MusicTrack {
  return { id, label, mood, durationSec: FIXTURE_TRACK_SECONDS[id] };
}
