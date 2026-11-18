import { describe, expect, it } from 'vitest';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { buildEditContext, type EditContextOptions } from '@/lib/brand-studio/edit-assist/context';
import { assistFixture, FIXTURE_REFS } from './fixture';

describe('buildEditContext', () => {
  it('numbers cuts and captions in timeline order and shows played seconds', () => {
    const { context, refs } = buildEditContext(assistFixture());
    expect(refs).toEqual(FIXTURE_REFS);
    expect(context).toEqual({
      aspect: '9:16',
      totalSec: 20,
      limits: { minClipSec: 0.3, maxClips: 24, maxCaptions: 32, captionMaxChars: 80 },
      cuts: [
        { ref: 'c1', label: '오프닝 향수 클로즈업', playSec: 5, sourceSec: 6, trim: [0, 5], startsAt: 0, muted: false, volume: 1 },
        { ref: 'c2', label: '손에 든 제품', playSec: 5, sourceSec: 8, trim: [1, 6], startsAt: 5, muted: false, volume: 1 },
        { ref: 'c3', label: '거리 달리기', playSec: 6, sourceSec: 12, trim: [0, 12], startsAt: 10, muted: false, volume: 0.7, speed: 2 },
        { ref: 'c4', label: '로고 엔딩', playSec: 4, sourceSec: 4, trim: [0, 4], startsAt: 16, muted: true, volume: 1 },
      ],
      captions: [
        { ref: 't1', text: '봄 신상 출시', from: 0, to: 2.5, position: 'bottom' },
        { ref: 't2', text: '지금 20% 할인', from: 17, to: 20, position: 'center' },
      ],
      music: { label: 'Spring loop', volume: 0.6 },
      look: null,
    });
  });

  it('orders caption refs by start time, not by when they were added', () => {
    const base = assistFixture();
    const { context, refs } = buildEditContext({ ...base, captions: [base.captions[1]!, base.captions[0]!] });
    expect(context.captions.map((c) => c.text)).toEqual(['봄 신상 출시', '지금 20% 할인']);
    expect(refs.captions).toEqual({ t1: 'cap-hello', t2: 'cap-sale' });
  });

  it('adds the playhead cut and the seconds into it, and the selected cut', () => {
    const { context } = buildEditContext(assistFixture(), { playheadSec: 12, selectedClipId: 'clip-hand' });
    expect(context.playhead).toEqual({ sec: 12, cut: 'c3', inCut: 2 });
    expect(context.selected).toBe('c2');
    expect(buildEditContext(assistFixture(), { playheadSec: 20 }).context.playhead).toEqual({ sec: 20, cut: 'c4', inCut: 4 });
    expect(buildEditContext(assistFixture(), { playheadSec: 99 }).context.playhead).toEqual({ sec: 20, cut: 'c4', inCut: 4 });
    expect(buildEditContext(assistFixture(), { selectedClipId: 'gone' }).context.selected).toBeUndefined();
  });

  it('keeps the last three turns, shortened', () => {
    const turn = (n: number) => ({ said: `${n} ${'말'.repeat(300)}`, did: Array.from({ length: 9 }, (_, i) => `line ${i}`), kept: n % 2 === 0 });
    const { context } = buildEditContext(assistFixture(), { recent: [turn(1), turn(2), turn(3), turn(4), turn(5)] });
    expect(context.recent).toHaveLength(3);
    expect(context.recent?.[0]?.said.startsWith('3 ')).toBe(true);
    expect(context.recent?.[0]?.said.length).toBe(200);
    expect(context.recent?.[0]?.did).toHaveLength(6);
    expect(context.recent?.map((t) => t.kept)).toEqual([false, true, false]);
  });

  it('gives an earlier answer back in ref form, and drops one that no longer fits', () => {
    const answer = (value: NonNullable<EditContextOptions['answer']>) =>
      buildEditContext(assistFixture(), { answer: value }).context.answer;
    expect(answer({ about: 'which_clip', value: { clipId: 'clip-run' } })).toEqual({ about: 'which_clip', value: 'c3' });
    expect(answer({ about: 'which_clip', value: 'all' })).toEqual({ about: 'which_clip', value: 'all' });
    expect(answer({ about: 'which_caption', value: { captionId: 'cap-sale' } })).toEqual({ about: 'which_caption', value: 't2' });
    expect(answer({ about: 'how_long', value: 2.5 })).toEqual({ about: 'how_long', value: 2.5 });
    expect(answer({ about: 'where_caption', value: 'end' })).toEqual({ about: 'where_caption', value: 'end' });
    expect(answer({ about: 'which_clip', value: { clipId: 'removed-meanwhile' } })).toBeUndefined();
    expect(answer({ about: 'how_long', value: { clipId: 'clip-run' } })).toBeUndefined();
  });

  it('shortens long labels and reports a colour look', () => {
    const base = assistFixture();
    const project: ComposerProject = {
      ...base,
      clips: [{ ...base.clips[0]!, label: 'x'.repeat(100) }, ...base.clips.slice(1)],
      colorGrade: {
        enabled: true,
        scope: 'full_timeline',
        presetId: 'moody-teal-amber',
        intensity: 0.7,
        skinProtect: 0.7,
        grain: 2,
        halation: 0.04,
      },
    };
    const { context } = buildEditContext(project);
    expect(context.cuts[0]?.label).toHaveLength(60);
    expect(context.look).toEqual({ preset: 'moody-teal-amber', strength: 0.7 });
  });
});
