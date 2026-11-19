import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_MATERIALS,
  FIXTURE_REFERENCES,
  FIXTURE_SPEECH,
  FIXTURE_TRACK_IDS,
  fixtureDoc,
  fixtureProject,
  fixtureTrack,
  materialBySrc,
} from '@/lib/brand-studio/editor-v2/fixture';
import { railActive } from '@/components/brand-workspace/rail-model';

const PUBLIC = join(process.cwd(), 'public');

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

  it('builds a valid opening cut', () => {
    const project = fixtureProject((id) => `label-${id}`);
    const ids = project.clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(project.clips.length).toBeGreaterThan(1);
    for (const clip of project.clips) {
      expect(clip.trimStartSec).toBeGreaterThanOrEqual(0);
      expect(clip.trimEndSec).toBeGreaterThan(clip.trimStartSec);
      expect(clip.trimEndSec).toBeLessThanOrEqual(clip.durationSec);
      const material = materialBySrc(clip.srcUrl);
      expect(material).toBeDefined();
      expect(clip.durationSec).toBe(material!.durationSec);
      expect(clip.thumbUrl).toBe(material!.poster);
      expect(clip.label).toBe(`label-${material!.id}`);
    }
  });

  it('has sorted, non-overlapping speech inside the opening film', () => {
    const project = fixtureProject((id) => id);
    const total = project.clips.reduce((sum, c) => sum + (c.trimEndSec - c.trimStartSec), 0);
    for (let i = 0; i < FIXTURE_SPEECH.length; i += 1) {
      const region = FIXTURE_SPEECH[i]!;
      expect(region.endSec).toBeGreaterThan(region.startSec);
      expect(region.endSec).toBeLessThanOrEqual(total);
      if (i > 0) expect(region.startSec).toBeGreaterThan(FIXTURE_SPEECH[i - 1]!.endSec);
    }
  });

  it('opens with no looks, no music and no captions', () => {
    const doc = fixtureDoc((id) => id);
    expect(doc.looks).toEqual({});
    expect(doc.reframe).toEqual({});
    expect(doc.music).toBeNull();
    expect(doc.project.captions).toEqual([]);
    expect(doc.project.bgm).toBeNull();
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
