/**
 * Sample data for the editing studio v2 structure prototype (docs/BRAND-EDITING-STUDIO-V2.md §10).
 *
 * Every file is one of our own films already published under `public/reel`. Nothing comes from a
 * customer, a database or a reference product, and the footage has no sound: the voice and music lanes
 * are drawn from the numbers below, which is why the sound workspace marks itself as a sample.
 *
 * The workspace host (brand.twings.app) serves public files by exact name only
 * (`STUDIO_DEMO_FILES` in lib/routing/surfaces.ts): a file that is committed and loads on twings.app
 * still answers 404 there unless it is on that list. Every path below must be on it;
 * tests/brand-studio/editor-v2/fixture-served.test.ts fails otherwise.
 *
 * `fps` and `frames` are what ffprobe reports for each file (the product reads the measured rate from
 * the asset, lib/brand-studio/asset-fps.ts). The sample film runs at the rate of its first cut, 24.
 * `m7` is a clip made for checking frame accuracy: every frame carries its own number
 * (scripts/editor-v2-frame-check.py reads it back from the preview).
 */
import type { FrameClip, FrameSequence } from './frames';
import { clipMaxFrames } from './frames';
import type { EditorDoc, MusicTrack, SpeechRegion } from './model';

export interface FixtureMaterial {
  id: string;
  src: string;
  poster: string;
  /** The footage's own frame rate and frame count. */
  fps: number;
  frames: number;
  /** Width divided by height of the footage. */
  ratio: number;
  origin: 'video_studio' | 'asset' | 'sample';
  /** Where the subject sits horizontally (`0..100`): what "center on the subject" would find. */
  focusX: number;
}

export interface FixtureReference {
  id: string;
  src: string;
}

export const FIXTURE_FPS = 24;

export const FIXTURE_MATERIALS: readonly FixtureMaterial[] = [
  { id: 'm1', src: '/reel/landing/v7/rx-beauty-world.mp4', poster: '/reel/landing/v7/rx-beauty-world.jpg', fps: 24, frames: 113, ratio: 16 / 9, origin: 'video_studio', focusX: 50 },
  { id: 'm2', src: '/reel/landing/v7/rx-beauty-product.mp4', poster: '/reel/landing/v7/rx-beauty-product.jpg', fps: 24, frames: 113, ratio: 16 / 9, origin: 'video_studio', focusX: 56 },
  { id: 'm3', src: '/reel/landing/v7/film-tutu.mp4', poster: '/reel/landing/v7/film-tutu.jpg', fps: 24, frames: 409, ratio: 16 / 9, origin: 'video_studio', focusX: 48 },
  { id: 'm4', src: '/reel/brands/tea-editorial.mp4', poster: '/reel/brands/tea-editorial.jpg', fps: 24, frames: 289, ratio: 4 / 3, origin: 'asset', focusX: 44 },
  { id: 'm5', src: '/reel/landing/v7/rx-beauty-orig.mp4', poster: '/reel/landing/v7/rx-beauty-orig.jpg', fps: 30, frames: 147, ratio: 16 / 9, origin: 'asset', focusX: 52 },
  { id: 'm6', src: '/reel/brands/production-paris.mp4', poster: '/reel/brands/production-paris.jpg', fps: 30, frames: 540, ratio: 16 / 9, origin: 'asset', focusX: 50 },
  { id: 'm7', src: '/reel/studio-demo/frame-count-24.mp4', poster: '/reel/studio-demo/frame-count-24.jpg', fps: 24, frames: 240, ratio: 16 / 9, origin: 'sample', focusX: 50 },
];

export const FIXTURE_REFERENCES: readonly FixtureReference[] = [
  { id: 'r1', src: '/reel/brands/slot-4-color-french-cobalt.jpg' },
  { id: 'r2', src: '/reel/brands/slot-2-space-concrete-blue.jpg' },
];

/** A narration the sample film is assumed to carry: three spoken stretches, in seconds. */
export const FIXTURE_SPEECH: readonly SpeechRegion[] = [
  { startSec: 0.6, endSec: 3.8 },
  { startSec: 5.4, endSec: 8.9 },
  { startSec: 11.2, endSec: 14.6 },
];

/** What a loudness measurement of the sample film is assumed to return (integrated LUFS). */
export const FIXTURE_MEASURED_LUFS = -19.6;

export const FIXTURE_TRACK_IDS = ['t1', 't2', 't3'] as const;
export const FIXTURE_TRACK_SECONDS: Readonly<Record<(typeof FIXTURE_TRACK_IDS)[number], number>> = { t1: 62, t2: 48, t3: 75 };

/** The cuts the sample film opens with: material id, first frame and length, on the film's frame grid. */
const OPENING: ReadonlyArray<[string, number, number]> = [
  ['m1', 0, 113],
  ['m2', 0, 113],
  ['m3', 48, 120],
  ['m4', 0, 108],
];

export function materialBySrc(src: string): FixtureMaterial | undefined {
  return FIXTURE_MATERIALS.find((material) => material.src === src);
}

/** Seconds of footage, for the bin's duration badge. */
export function materialSeconds(material: FixtureMaterial): number {
  return material.frames / material.fps;
}

/** A cut of `material` for a film at `fps`: from `inFrame`, `frames` long (five seconds by default), never past the footage. */
export function clipOfMaterial(material: FixtureMaterial, id: string, label: string, fps: number, inFrame = 0, frames = fps * 5): FrameClip {
  const clip: FrameClip = {
    id,
    label,
    srcUrl: material.src,
    thumbUrl: material.poster,
    sourceFps: material.fps,
    sourceFrames: material.frames,
    inFrame,
    phase: 0,
    frames: 1,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
  };
  return { ...clip, frames: Math.max(1, Math.min(frames, clipMaxFrames(clip, fps))) };
}

export function fixtureSequence(labelOf: (materialId: string) => string): FrameSequence {
  return {
    fps: FIXTURE_FPS,
    aspect: '16:9',
    clips: OPENING.map(([materialId, inFrame, frames], index) =>
      clipOfMaterial(FIXTURE_MATERIALS.find((m) => m.id === materialId)!, `cut-${index + 1}`, labelOf(materialId), FIXTURE_FPS, inFrame, frames),
    ),
    captions: [],
  };
}

export function fixtureDoc(labelOf: (materialId: string) => string): EditorDoc {
  return {
    sequence: fixtureSequence(labelOf),
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
