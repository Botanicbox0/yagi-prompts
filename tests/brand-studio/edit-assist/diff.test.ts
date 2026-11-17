import { describe, expect, it } from 'vitest';
import { applyTimelinePatches, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { applyEditSteps, resolveEditPlan } from '@/lib/brand-studio/edit-assist/apply';
import { diffTimelines, isInstantEdit, type EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import type { EditStep } from '@/lib/brand-studio/edit-assist/plan';
import { assistFixture, FIXTURE_REFS } from './fixture';

function after(steps: EditStep[], project: ComposerProject = assistFixture()): ComposerProject {
  const resolved = resolveEditPlan(steps, FIXTURE_REFS);
  if (!resolved.ok) throw new Error('unresolved');
  const result = applyEditSteps(project, resolved.steps);
  expect(result.problems).toEqual([]);
  return result.project;
}

function deltasOf(steps: EditStep[], project: ComposerProject = assistFixture()): EditDelta[] {
  return diffTimelines(project, after(steps, project));
}

describe('diffTimelines — cuts', () => {
  it('reports a trim with the cut position before the edit and the new total', () => {
    expect(deltasOf([{ do: 'trim', clip: 'c2', keep: 'start', seconds: 2 }])).toEqual([
      { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 },
      { kind: 'total', beforeSec: 20, afterSec: 17 },
    ]);
  });

  it('reports a removal with the label', () => {
    expect(deltasOf([{ do: 'remove', clip: 'c4' }])).toEqual([
      { kind: 'clip_removed', cut: 4, label: '로고 엔딩' },
      { kind: 'total', beforeSec: 20, afterSec: 16 },
    ]);
  });

  it('describes moves with the fewest moved cuts', () => {
    expect(deltasOf([{ do: 'move', clip: 'c1', to: 'last' }])).toEqual([{ kind: 'clip_moved', cut: 1, toPosition: 4 }]);
    expect(deltasOf([{ do: 'move', clip: 'c4', to: 'first' }])).toEqual([{ kind: 'clip_moved', cut: 4, toPosition: 1 }]);
  });

  it('describes a swap of neighbours as one move and a swap across a cut as two', () => {
    const base = assistFixture();
    const [c1, c2, c3, c4] = base.clips;
    expect(diffTimelines(base, { ...base, clips: [c2!, c1!, c3!, c4!] })).toEqual([
      { kind: 'clip_moved', cut: 1, toPosition: 2 },
    ]);
    // The cut in the middle stays where it was; the two ends trade places.
    expect(diffTimelines(base, { ...base, clips: [c3!, c2!, c1!, c4!] })).toEqual([
      { kind: 'clip_moved', cut: 1, toPosition: 3 },
      { kind: 'clip_moved', cut: 3, toPosition: 1 },
    ]);
  });

  it('reports a split at the played second inside the cut', () => {
    expect(deltasOf([{ do: 'split', clip: 'c3', at: 2 }])).toEqual([{ kind: 'clip_split', cut: 3, atSec: 2 }]);
  });

  it('reports a split whose piece was then trimmed as a split and a trim of the cut', () => {
    expect(
      deltasOf([
        { do: 'split', clip: 'c2', at: 2 },
        { do: 'trim', clip: 'c2b', keep: 'start', seconds: 1 },
      ]),
    ).toEqual([
      { kind: 'clip_split', cut: 2, atSec: 2 },
      { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 3 },
      { kind: 'total', beforeSec: 20, afterSec: 18 },
    ]);
  });

  it('reports a split that lost a piece as the trim it amounts to', () => {
    expect(
      deltasOf([
        { do: 'split', clip: 'c2', at: 2 },
        { do: 'remove', clip: 'c2b' },
      ]),
    ).toEqual([
      { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 },
      { kind: 'total', beforeSec: 20, afterSec: 17 },
    ]);
    expect(
      deltasOf([
        { do: 'split', clip: 'c2', at: 2 },
        { do: 'remove', clip: 'c2a' },
      ]),
    ).toEqual([
      { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 3 },
      { kind: 'total', beforeSec: 20, afterSec: 18 },
    ]);
  });

  it('falls back to other when a split piece went somewhere else on the timeline', () => {
    expect(
      deltasOf([
        { do: 'split', clip: 'c2', at: 2 },
        { do: 'move', clip: 'c2b', to: 'first' },
      ]),
    ).toEqual([
      { kind: 'clip_split', cut: 2, atSec: 2 },
      { kind: 'other', count: 1 },
    ]);
  });

  it('reports sound per cut, or once for every cut when they all end the same', () => {
    expect(deltasOf([{ do: 'sound', target: 'c2', muted: true }])).toEqual([{ kind: 'clip_sound', cut: 2, muted: true }]);
    expect(deltasOf([{ do: 'sound', target: 'c3', volume: 0.5 }])).toEqual([{ kind: 'clip_sound', cut: 3, volumePct: 50 }]);
    expect(deltasOf([{ do: 'sound', target: 'all_clips', muted: true }])).toEqual([
      { kind: 'clip_sound', cut: 'all', muted: true },
    ]);
    expect(deltasOf([{ do: 'sound', target: 'all_clips', volume: 0.4 }])).toEqual([
      { kind: 'clip_sound', cut: 'all', muted: false, volumePct: 40 },
    ]);
    expect(
      deltasOf([
        { do: 'sound', target: 'c1', muted: true },
        { do: 'sound', target: 'c3', volume: 0.2 },
      ]),
    ).toEqual([
      { kind: 'clip_sound', cut: 1, muted: true },
      { kind: 'clip_sound', cut: 3, volumePct: 20 },
    ]);
  });

  it('ignores the active take following a trim', () => {
    const base = assistFixture();
    const withTakes: ComposerProject = {
      ...base,
      clips: [
        {
          ...base.clips[0]!,
          takes: [
            { id: 'take-1', label: 'A', sourceKind: 'output', srcUrl: '/a.mp4', thumbUrl: null, durationSec: 6, trimStartSec: 0, trimEndSec: 6 },
            { id: 'take-2', label: 'B', sourceKind: 'output', srcUrl: '/media/open.mp4', thumbUrl: null, durationSec: 6, trimStartSec: 0, trimEndSec: 5 },
          ],
          activeTakeIndex: 1,
        },
        ...base.clips.slice(1),
      ],
    };
    expect(deltasOf([{ do: 'trim', clip: 'c1', keep: 'start', seconds: 2 }], withTakes)).toEqual([
      { kind: 'clip_trimmed', cut: 1, beforeSec: 5, afterSec: 2 },
      { kind: 'total', beforeSec: 20, afterSec: 17 },
    ]);
  });
});

describe('diffTimelines — captions, music, aspect, look', () => {
  it('reports captions added, removed and changed', () => {
    expect(deltasOf([{ do: 'caption_add', text: '지금 만나보세요', where: 'end' }])).toEqual([
      { kind: 'caption_added', text: '지금 만나보세요', fromSec: 17.5, toSec: 20 },
    ]);
    expect(deltasOf([{ do: 'caption_remove', caption: 't2' }])).toEqual([{ kind: 'caption_removed', text: '지금 20% 할인' }]);
    expect(deltasOf([{ do: 'caption_remove', caption: 'all' }])).toEqual([
      { kind: 'caption_removed', text: '봄 신상 출시' },
      { kind: 'caption_removed', text: '지금 20% 할인' },
    ]);
    expect(deltasOf([{ do: 'caption_edit', caption: 't1', position: 'top' }])).toEqual([
      { kind: 'caption_changed', text: '봄 신상 출시', changed: ['position'] },
    ]);
    expect(deltasOf([{ do: 'caption_edit', caption: 't2', text: '오늘만 30% 할인', from: 15, size: 'md' }])).toEqual([
      { kind: 'caption_changed', text: '오늘만 30% 할인', changed: ['text', 'time', 'size'] },
    ]);
  });

  it('reports music volume and removal', () => {
    expect(deltasOf([{ do: 'sound', target: 'music', volume: 0.3 }])).toEqual([{ kind: 'music_volume', beforePct: 60, afterPct: 30 }]);
    expect(deltasOf([{ do: 'sound', target: 'music', muted: true }])).toEqual([{ kind: 'music_volume', beforePct: 60, afterPct: 0 }]);
    expect(deltasOf([{ do: 'sound', target: 'music', remove: true }])).toEqual([{ kind: 'music_removed' }]);
  });

  it('reports the aspect and the look', () => {
    expect(deltasOf([{ do: 'aspect', aspect: '16:9' }])).toEqual([{ kind: 'aspect', before: '9:16', after: '16:9' }]);
    const warm = after([{ do: 'look', preset: 'kodak-2383-warm', strength: 0.6 }]);
    expect(diffTimelines(assistFixture(), warm)).toEqual([{ kind: 'look', preset: 'kodak-2383-warm' }]);
    expect(deltasOf([{ do: 'look', preset: 'kodak-2383-warm', strength: 0.9 }], warm)).toEqual([
      { kind: 'look', preset: 'kodak-2383-warm', strengthPct: 90 },
    ]);
    expect(deltasOf([{ do: 'look', preset: 'off' }], warm)).toEqual([{ kind: 'look', preset: 'off' }]);
  });

  it('lists deltas in a fixed order: cuts, captions, music, aspect, look, other, total', () => {
    expect(
      deltasOf([
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
        { do: 'remove', clip: 'c4' },
        { do: 'caption_add', text: '지금 만나보세요', where: 'end' },
        { do: 'sound', target: 'music', volume: 0.3 },
        { do: 'aspect', aspect: '1:1' },
      ]),
    ).toEqual([
      { kind: 'clip_removed', cut: 4, label: '로고 엔딩' },
      { kind: 'clip_trimmed', cut: 1, beforeSec: 5, afterSec: 2 },
      { kind: 'caption_added', text: '지금 만나보세요', fromSec: 10.5, toSec: 13 },
      { kind: 'music_volume', beforePct: 60, afterPct: 30 },
      { kind: 'aspect', before: '9:16', after: '1:1' },
      { kind: 'total', beforeSec: 20, afterSec: 13 },
    ]);
  });
});

describe('diffTimelines — nothing changes silently', () => {
  it('returns nothing for identical timelines, normalised or not', () => {
    const base = assistFixture();
    expect(diffTimelines(base, assistFixture())).toEqual([]);
    expect(diffTimelines(base, applyTimelinePatches(base, []).project)).toEqual([]);
  });

  it('counts changes no named kind covers as other', () => {
    const base = assistFixture();
    const relabelled = { ...base, clips: [{ ...base.clips[0]!, label: 'Renamed' }, ...base.clips.slice(1)] };
    expect(diffTimelines(base, relabelled)).toEqual([{ kind: 'other', count: 1 }]);

    const faster = { ...base, clips: [{ ...base.clips[0]!, playbackRate: 2 }, ...base.clips.slice(1)] };
    expect(diffTimelines(base, faster)).toEqual([
      { kind: 'other', count: 1 },
      { kind: 'total', beforeSec: 20, afterSec: 17.5 },
    ]);

    const withOverlay: ComposerProject = {
      ...base,
      overlays: [
        {
          id: 'ovl-1',
          label: 'Logo',
          sourceKind: 'asset',
          srcUrl: '/logo.png',
          mediaKind: 'image',
          startSec: 0,
          endSec: 2,
          x: 0.5,
          y: 0.5,
          scale: 0.4,
          opacity: 1,
        },
      ],
    };
    expect(diffTimelines(base, withOverlay)).toEqual([{ kind: 'other', count: 1 }]);

    const musicAdded = diffTimelines({ ...base, bgm: null }, base);
    expect(musicAdded).toEqual([{ kind: 'other', count: 1 }]);

    const newClip = { ...base, clips: [...base.clips, { ...base.clips[0]!, id: 'clip-new', srcUrl: '/new.mp4' }] };
    expect(diffTimelines(base, newClip)).toEqual([
      { kind: 'other', count: 1 },
      { kind: 'total', beforeSec: 20, afterSec: 25 },
    ]);
  });

  it('counts a colour look moving to another cut when its cut is removed', () => {
    const base: ComposerProject = {
      ...assistFixture(),
      colorGrade: {
        enabled: true,
        scope: 'selected_clip',
        clipId: 'clip-open',
        clipIndex: 0,
        presetId: 'clean-high-key',
        intensity: 0.8,
        skinProtect: 0.7,
        grain: 2,
        halation: 0.04,
      },
    };
    expect(deltasOf([{ do: 'remove', clip: 'c1' }], base)).toEqual([
      { kind: 'clip_removed', cut: 1, label: '오프닝 향수 클로즈업' },
      { kind: 'other', count: 1 },
      { kind: 'total', beforeSec: 20, afterSec: 15 },
    ]);
  });
});

describe('isInstantEdit', () => {
  const trimmed: EditDelta = { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 };
  const total: EditDelta = { kind: 'total', beforeSec: 20, afterSec: 17 };
  it.each<[string, EditDelta[], boolean]>([
    ['nothing', [], false],
    ['one trim and the total', [trimmed, total], true],
    ['one trim', [trimmed], true],
    ['two trims', [trimmed, { ...trimmed, cut: 3 }, total], false],
    ['a split', [{ kind: 'clip_split', cut: 3, atSec: 2 }], true],
    ['one move', [{ kind: 'clip_moved', cut: 1, toPosition: 4 }], true],
    ['a swap', [{ kind: 'clip_moved', cut: 1, toPosition: 3 }, { kind: 'clip_moved', cut: 3, toPosition: 1 }], false],
    ['every cut muted', [{ kind: 'clip_sound', cut: 'all', muted: true }], true],
    ['a caption added', [{ kind: 'caption_added', text: 'a', fromSec: 0, toSec: 2 }], true],
    ['a caption changed', [{ kind: 'caption_changed', text: 'a', changed: ['position'] }], true],
    ['music volume', [{ kind: 'music_volume', beforePct: 60, afterPct: 30 }], true],
    ['aspect', [{ kind: 'aspect', before: '9:16', after: '1:1' }], true],
    ['look', [{ kind: 'look', preset: 'off' }], true],
    ['a removed cut', [{ kind: 'clip_removed', cut: 4, label: 'x' }, total], false],
    ['a removed caption', [{ kind: 'caption_removed', text: 'a' }], false],
    ['removed music', [{ kind: 'music_removed' }], false],
    ['something else', [{ kind: 'other', count: 1 }], false],
    ['only the total', [total], false],
  ])('%s → %s', (_label, deltas, expected) => {
    expect(isInstantEdit(deltas)).toBe(expected);
  });
});
