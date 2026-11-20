import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_FPS,
  FIXTURE_MATERIALS,
  FIXTURE_REFERENCES,
  FIXTURE_SPEECH,
  FIXTURE_TRACK_IDS,
  clipOfMaterial,
  fixtureDoc,
  fixtureSequence,
  fixtureTrack,
  materialBySrc,
  materialSeconds,
} from '@/lib/brand-studio/editor-v2/fixture';
import { clipFrameAt, clipMaxFrames, sourceFrameIndex, totalFrames, wholeFrameViolations } from '@/lib/brand-studio/editor-v2/frames';
import { railActive } from '@/components/brand-workspace/rail-model';

const PUBLIC = join(process.cwd(), 'public');

function hasFfprobe(): boolean {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

describe('editor v2 sample data', () => {
  const paths = [
    ...FIXTURE_MATERIALS.flatMap((m) => [m.src, m.poster]),
    ...FIXTURE_REFERENCES.map((r) => r.src),
  ];

  it('points only at our own published files', () => {
    for (const path of paths) {
      expect(path.startsWith('/'), path).toBe(true);
      expect(existsSync(join(PUBLIC, path)), `missing public${path}`).toBe(true);
      expect(path.toLowerCase()).not.toContain('morphic');
    }
  });

  it.skipIf(!hasFfprobe())('carries the frame rate and frame count ffprobe reports for every file', () => {
    for (const material of FIXTURE_MATERIALS) {
      const out = execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,nb_frames', '-of', 'csv=p=0', join(PUBLIC, material.src)],
        { encoding: 'utf8', windowsHide: true },
      ).trim();
      const [rate, frames] = out.split(/\r?\n/)[0]!.split(',');
      const [num, den] = rate!.split('/').map(Number);
      expect(Math.abs(material.fps - num! / (den ?? 1)), `${material.id} fps (${out})`).toBeLessThan(1e-9);
      expect(material.frames, `${material.id} frames (${out})`).toBe(Number(frames));
    }
  });

  it('describes every material with whole, positive frame numbers', () => {
    expect(new Set(FIXTURE_MATERIALS.map((m) => m.id)).size).toBe(FIXTURE_MATERIALS.length);
    for (const material of FIXTURE_MATERIALS) {
      expect(Number.isInteger(material.fps) && material.fps > 0, material.id).toBe(true);
      expect(Number.isInteger(material.frames) && material.frames > 0, material.id).toBe(true);
      expect(materialSeconds(material)).toBeCloseTo(material.frames / material.fps, 9);
    }
    expect(FIXTURE_MATERIALS.find((m) => m.id === 'm7')).toMatchObject({
      src: '/reel/studio-demo/frame-count-24.mp4',
      origin: 'sample',
      fps: 24,
      frames: 240,
    });
  });

  it('builds a valid opening cut at 24 fps, 454 frames long', () => {
    const sequence = fixtureSequence((id) => `label-${id}`);
    expect(sequence.fps).toBe(FIXTURE_FPS);
    expect(FIXTURE_FPS).toBe(24);
    expect(totalFrames(sequence)).toBe(454);
    expect(wholeFrameViolations(sequence)).toEqual([]);
    const ids = sequence.clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sequence.clips.length).toBeGreaterThan(1);
    for (const clip of sequence.clips) {
      const material = materialBySrc(clip.srcUrl);
      expect(material).toBeDefined();
      expect(clip.sourceFps).toBe(material!.fps);
      expect(clip.sourceFrames).toBe(material!.frames);
      expect(clip.thumbUrl).toBe(material!.poster);
      expect(clip.label).toBe(`label-${material!.id}`);
      expect(clip.inFrame).toBeGreaterThanOrEqual(0);
      expect(clip.frames).toBeLessThanOrEqual(clipMaxFrames(clip, sequence.fps));
    }
  });

  it('never cuts past the footage, whatever the material and in-point', () => {
    for (const material of FIXTURE_MATERIALS) {
      for (const inFrame of [0, 1, 24, 100, material.frames - 1]) {
        for (const asked of [1, 24, FIXTURE_FPS * 5, 10_000]) {
          const clip = clipOfMaterial(material, 'x', 'x', FIXTURE_FPS, inFrame, asked);
          expect(clip.frames).toBeGreaterThanOrEqual(1);
          expect(clip.frames).toBeLessThanOrEqual(asked);
          expect(clip.frames, `${material.id} from ${inFrame}`).toBeLessThanOrEqual(clipMaxFrames(clip, FIXTURE_FPS));
          const lastMedia = clipFrameAt(clip, clip.frames - 1, FIXTURE_FPS).mediaFrame;
          // The raw source frame (before the reader's clamp) is still inside the file.
          if (inFrame < Math.floor((material.frames * FIXTURE_FPS) / material.fps)) {
            expect(sourceFrameIndex(lastMedia, FIXTURE_FPS, material.fps), `${material.id} from ${inFrame} × ${asked}`).toBeLessThan(material.frames);
          }
        }
      }
    }
  });

  it('conforms the 30 fps materials into the 24 fps film without running past them', () => {
    const m5 = FIXTURE_MATERIALS.find((m) => m.id === 'm5')!;
    const m6 = FIXTURE_MATERIALS.find((m) => m.id === 'm6')!;
    expect(m5.fps).toBe(30);
    // 147 frames at 30 fps = 4.9 s = 117.6 film frames: at most 117 whole ones.
    expect(clipOfMaterial(m5, 'x', 'x', 24, 0, 10_000).frames).toBe(117);
    expect(clipOfMaterial(m5, 'x', 'x', 24).frames).toBe(117);
    expect(clipOfMaterial(m5, 'x', 'x', 24, 100, 10_000).frames).toBe(17);
    // 540 frames at 30 fps = 18 s = 432 film frames.
    expect(clipOfMaterial(m6, 'x', 'x', 24, 0, 10_000).frames).toBe(432);
    expect(clipOfMaterial(m6, 'x', 'x', 24).frames).toBe(120);
  });

  it('has sorted, non-overlapping speech inside the opening film', () => {
    const sequence = fixtureSequence((id) => id);
    const totalSec = totalFrames(sequence) / sequence.fps;
    for (let i = 0; i < FIXTURE_SPEECH.length; i += 1) {
      const region = FIXTURE_SPEECH[i]!;
      expect(region.endSec).toBeGreaterThan(region.startSec);
      expect(region.endSec).toBeLessThanOrEqual(totalSec);
      if (i > 0) expect(region.startSec).toBeGreaterThan(FIXTURE_SPEECH[i - 1]!.endSec);
    }
  });

  it('opens with no looks, no music and no captions', () => {
    const doc = fixtureDoc((id) => id);
    expect(doc.looks).toEqual({});
    expect(doc.reframe).toEqual({});
    expect(doc.music).toBeNull();
    expect(doc.sequence.captions).toEqual([]);
    expect(doc.titles).toEqual([]);
    expect(doc.sound).toMatchObject({ duck: null, loudness: false, speechClear: false });
  });

  it('builds tracks with their own lengths and finds materials by src', () => {
    for (const id of FIXTURE_TRACK_IDS) expect(fixtureTrack(id, 'L', 'M').durationSec).toBeGreaterThan(0);
    expect(materialBySrc('/nope.mp4')).toBeUndefined();
  });
});

describe('rail: /brand/studio/editor is the editing studio', () => {
  it('lights 편집 스튜디오 and not 이미지 스튜디오', () => {
    expect(railActive('/brand/studio/compose', '/brand/studio/editor')).toBe(true);
    expect(railActive('/brand/studio/compose', '/brand/studio/editor/x')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio/editor')).toBe(false);
    expect(railActive('/brand/studio/video', '/brand/studio/editor')).toBe(false);
  });

  it('keeps the compose expectations', () => {
    expect(railActive('/brand/studio/compose', '/brand/studio/compose')).toBe(true);
    expect(railActive('/brand/studio/compose', '/brand/studio/compose/abc')).toBe(true);
    expect(railActive('/brand/studio/compose', '/brand/studio')).toBe(false);
    expect(railActive('/brand/studio/compose', '/brand/studio/video')).toBe(false);
    expect(railActive('/brand/studio/compose', '/brand/studio/editorial')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio/compose')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio')).toBe(true);
  });
});
