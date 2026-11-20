import { describe, expect, it } from 'vitest';
import { COMPOSE_COLOR_PRESET_IDS, parseStoredProject, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { GRADE_PRESET_COPY_KEYS, filmContents, gradeName, type GradeNames } from '@/lib/brand-studio/editor-v2/film-contents';
import { removeClips } from '@/lib/brand-studio/editor-v2/frames';
import { fromStored } from '@/lib/brand-studio/editor-v2/stored';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Review round 1, item 6: what goes into the file of a real film is named before export. The stored
 * film's captions, colour grade, music, sound effects and still images, counted the way the exporters
 * draw and mix them (only what lands inside the film).
 */
const SRC = '/api/brand-studio/compose?organizationId=org&source=asset&id=a';
const MEASURED = { [SRC]: { fps: 24, frames: 240 } };

function clip(id: string, trimStartSec: number, trimEndSec: number): ComposeClip {
  return { id, label: id, sourceKind: 'asset', assetId: 'a', srcUrl: SRC, thumbUrl: null, durationSec: 10, trimStartSec, trimEndSec, volume: 1, muted: false };
}

const FILM: ComposerProject = parseStoredProject(
  JSON.stringify({
    version: 1,
    aspect: '9:16',
    clips: [clip('c1', 0, 3), clip('c2', 3, 6)], // 6 s
    captions: [
      { id: 'k1', text: 'first', startSec: 0.5, endSec: 2, position: 'bottom', size: 'md' },
      { id: 'k2', text: '   ', startSec: 2, endSec: 3, position: 'bottom', size: 'md' },
      { id: 'k3', text: 'late', startSec: 4, endSec: 5, position: 'top', size: 'md' },
    ],
    bgm: { label: 'Morning walk', sourceKind: 'asset', assetId: 'm', srcUrl: '/m.mp3', durationSec: 60, trimStartSec: 0, volume: 0.4 },
    colorGrade: { enabled: true, scope: 'full_timeline', presetId: 'kodak-2383-warm', intensity: 0.8, skinProtect: 0.7, grain: 2, halation: 0.04 },
    sfxClips: [
      { id: 'fx1', label: 'whoosh', sourceKind: 'asset', assetId: 'f', srcUrl: '/f.mp3', startSec: 1, durationSec: 0.5, volume: 0.9 },
      { id: 'fx2', label: 'silent', sourceKind: 'asset', assetId: 'g', srcUrl: '/g.mp3', startSec: 2, durationSec: 0.5, volume: 0 },
      { id: 'fx3', label: 'late', sourceKind: 'asset', assetId: 'h', srcUrl: '/h.mp3', startSec: 4.5, durationSec: 0.5, volume: 1 },
    ],
    overlays: [
      { id: 'o1', label: 'logo', sourceKind: 'asset', assetId: 'l', srcUrl: '/l.png', mediaKind: 'image', startSec: 0, endSec: 6, x: 0.8, y: 0.1, scale: 0.2, opacity: 1 },
      { id: 'o2', label: 'clip', sourceKind: 'asset', assetId: 'v', srcUrl: '/v.mp4', mediaKind: 'video', startSec: 0, endSec: 6, x: 0.5, y: 0.5, scale: 0.3, opacity: 1 },
      { id: 'o3', label: 'late', sourceKind: 'asset', assetId: 'm2', srcUrl: '/m2.png', mediaKind: 'image', startSec: 4.2, endSec: 5, x: 0.5, y: 0.5, scale: 0.3, opacity: 1 },
    ],
  }),
)!;

const names: GradeNames = { presets: getDictionary('ko').studioCompose.colorGrade.presets, reference: getDictionary('ko').studioCompose.colorGrade.activeRef };

describe('what the file of a real film carries', () => {
  const sequence = fromStored(FILM, MEASURED).sequence;

  it('names every part, counted the way the exporters draw and mix them', () => {
    expect(filmContents(sequence, FILM)).toEqual({
      cuts: 2,
      captions: 2, // the blank one is not drawn
      grade: { kind: 'preset', key: 'filmWarm' },
      music: 'Morning walk',
      effects: 2, // the one at volume 0 is not mixed
      stills: 2, // the video overlay is not a still
    });
  });

  it('a film that got shorter carries only what lands inside it', () => {
    const shorter = removeClips(sequence, ['c2']); // 3 s
    expect(filmContents(shorter, FILM)).toMatchObject({ cuts: 1, captions: 1, effects: 1, stills: 1 });
  });

  it('a grade scoped to a cut that is no longer in the film is not in the file', () => {
    const scoped = { ...FILM, colorGrade: { ...FILM.colorGrade!, scope: 'selected_clip' as const, clipId: 'c2', clipIndex: null } };
    expect(filmContents(sequence, scoped).grade).toEqual({ kind: 'preset', key: 'filmWarm' });
    expect(filmContents(removeClips(sequence, ['c2']), scoped).grade).toBeNull();
  });

  it('nothing stored: only the cuts; muted music is not mixed', () => {
    expect(filmContents(sequence, null)).toEqual({ cuts: 2, captions: 0, grade: null, music: null, effects: 0, stills: 0 });
    expect(filmContents(sequence, { ...FILM, bgm: { ...FILM.bgm!, volume: 0 } }).music).toBeNull();
  });

  it('the grade is named as the current editor names it', () => {
    expect(gradeName({ kind: 'preset', key: 'filmWarm' }, names, '?')).toBe('2383 필름 웜');
    expect(gradeName({ kind: 'reference', label: 'sunset.jpg' }, names, '?')).toBe('참조 색감: sunset.jpg');
    expect(gradeName({ kind: 'custom' }, names, 'fallback')).toBe('fallback');
    // Every preset the current editor offers has a name here.
    for (const id of COMPOSE_COLOR_PRESET_IDS) expect(names.presets[GRADE_PRESET_COPY_KEYS[id]], id).toBeTruthy();
  });
});
