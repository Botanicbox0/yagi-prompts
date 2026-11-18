import { describe, expect, it } from 'vitest';
import {
  askChoiceText,
  askQuestion,
  deltaLine,
  deltaText,
  formatSeconds,
  noteText,
  shortenText,
} from '@/components/brand-studio/compose/assist/delta-lines';
import type { AssistNoteCode } from '@/components/brand-studio/compose/assist/assist-model';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { studioComposeEn, studioComposeKo } from '@/messages/studio-compose';
import { assistFixture } from './fixture';

const ko = studioComposeKo;
const en = studioComposeEn;

describe('formatSeconds', () => {
  it('shows one decimal only when needed', () => {
    expect(formatSeconds(4)).toBe('4');
    expect(formatSeconds(4.0)).toBe('4');
    expect(formatSeconds(2.5)).toBe('2.5');
    expect(formatSeconds(2.04)).toBe('2');
    expect(formatSeconds(2.96)).toBe('3');
    expect(formatSeconds(17.25)).toBe('17.3');
    expect(formatSeconds(0)).toBe('0');
  });
});

describe('shortenText', () => {
  it('cuts long text by characters and marks the cut', () => {
    expect(shortenText('  짧은 자막 ', 10)).toBe('짧은 자막');
    expect(shortenText('지금 바로 만나보세요 봄 신상', 6)).toBe('지금 바로…');
  });
});

/** Every `EditDelta` kind (and each sound / look variant) with its Korean and English line. */
const TABLE: Array<[EditDelta, string, string]> = [
  [{ kind: 'clip_removed', cut: 3, label: '거리 달리기' }, '3번 컷 삭제', 'Remove cut 3'],
  [{ kind: 'clip_split', cut: 1, atSec: 2.5 }, '1번 컷 2.5초 지점 분할', 'Split cut 1 at 2.5s'],
  [{ kind: 'clip_split_many', cut: 2, pieces: 3 }, '2번 컷 3개로 분할', 'Split cut 2 into 3 parts'],
  [{ kind: 'clip_trimmed', cut: 2, beforeSec: 4, afterSec: 2 }, '2번 컷 길이 4초 → 2초', 'Cut 2: 4s → 2s'],
  [{ kind: 'clip_moved', cut: 4, toPosition: 1 }, '4번 컷 1번째로 이동', 'Move cut 4 to position 1'],
  [{ kind: 'clip_sound', cut: 2, muted: true }, '2번 컷 소리 끔', 'Mute cut 2'],
  [{ kind: 'clip_sound', cut: 2, muted: false }, '2번 컷 소리 켬', 'Unmute cut 2'],
  [{ kind: 'clip_sound', cut: 2, volumePct: 40 }, '2번 컷 소리 40%', 'Cut 2 volume: 40%'],
  [{ kind: 'clip_sound', cut: 2, muted: false, volumePct: 40 }, '2번 컷 소리 40%', 'Cut 2 volume: 40%'],
  [{ kind: 'clip_sound', cut: 'all', muted: true }, '모든 컷 소리 끔', 'Mute all cuts'],
  [{ kind: 'clip_sound', cut: 'all', muted: false }, '모든 컷 소리 켬', 'Unmute all cuts'],
  [{ kind: 'clip_sound', cut: 'all', volumePct: 50 }, '모든 컷 소리 50%', 'All cuts volume: 50%'],
  [
    { kind: 'caption_added', text: '지금 만나보세요', fromSec: 17.5, toSec: 20 },
    '자막 “지금 만나보세요” 추가 (17.5초~20초)',
    'Add caption “지금 만나보세요” (17.5–20s)',
  ],
  [{ kind: 'caption_removed', text: '봄 신상 출시' }, '자막 “봄 신상 출시” 삭제', 'Remove caption “봄 신상 출시”'],
  [
    { kind: 'caption_changed', text: '여름 신상', changed: ['text', 'position'] },
    '자막 “여름 신상” 수정',
    'Edit caption “여름 신상”',
  ],
  [{ kind: 'music_removed' }, '음악 삭제', 'Remove music'],
  [{ kind: 'music_volume', beforePct: 60, afterPct: 30 }, '음악 소리 60% → 30%', 'Music volume: 60% → 30%'],
  [{ kind: 'aspect', before: '9:16', after: '1:1' }, '화면 비율 9:16 → 1:1', 'Aspect ratio: 9:16 → 1:1'],
  [{ kind: 'look', preset: 'kodak-2383-warm' }, '색감 2383 필름 웜 적용', 'Look: 2383 Film Warm'],
  [{ kind: 'look', preset: 'kodak-2383-warm', strengthPct: 60 }, '색감 2383 필름 웜 적용 60%', 'Look: 2383 Film Warm at 60%'],
  [{ kind: 'look', preset: 'custom' }, '색감 레퍼런스 맞춤 적용', 'Look: Reference match'],
  [{ kind: 'look', preset: 'off' }, '색감 해제', 'Turn the look off'],
  [{ kind: 'other', count: 2 }, '그 외 변경 사항 2건', '2 more changes'],
  [{ kind: 'total', beforeSec: 20, afterSec: 15.5 }, '전체 길이 20초 → 15.5초', 'Total length: 20s → 15.5s'],
];

describe('deltaText — every delta kind, both languages', () => {
  it('covers every kind the diff can produce', () => {
    const kinds = new Set(TABLE.map(([delta]) => delta.kind));
    expect([...kinds].sort()).toEqual(
      [
        'aspect',
        'caption_added',
        'caption_changed',
        'caption_removed',
        'clip_moved',
        'clip_removed',
        'clip_sound',
        'clip_split',
        'clip_split_many',
        'clip_trimmed',
        'look',
        'music_removed',
        'music_volume',
        'other',
        'total',
      ].sort(),
    );
  });

  it.each(TABLE)('%j', (delta, koLine, enLine) => {
    // The look name comes from the colour panel's own preset names, whatever they are today.
    const koExpected = koLine.replace('2383 필름 웜', ko.colorGrade.presets.filmWarm);
    const enExpected = enLine.replace('2383 Film Warm', en.colorGrade.presets.filmWarm);
    expect(deltaText(delta, ko)).toBe(koExpected);
    expect(deltaText(delta, en)).toBe(enExpected);
  });

  it('leaves no placeholder unfilled', () => {
    for (const [delta] of TABLE) {
      expect(deltaText(delta, ko)).not.toMatch(/\{\w+\}/);
      expect(deltaText(delta, en)).not.toMatch(/\{\w+\}/);
    }
  });

  it('keeps the values apart from the sentence, so wording can change without code', () => {
    expect(deltaLine({ kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2.04 }, ko)).toEqual({
      key: 'clipTrimmed',
      values: { n: 2, before: '5', after: '2' },
    });
  });

  it('shortens a long caption inside a line', () => {
    const line = deltaText({ kind: 'caption_removed', text: '가'.repeat(60) }, ko);
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(40);
  });
});

describe('questions, choices and notes', () => {
  it('words each question from the dictionary', () => {
    expect(askQuestion('which_clip', ko)).toBe(ko.assist.ask.whichClip);
    expect(askQuestion('which_caption', en)).toBe(en.assist.ask.whichCaption);
    expect(askQuestion('how_long', ko)).toBe(ko.assist.ask.howLong);
    expect(askQuestion('where_caption', en)).toBe(en.assist.ask.whereCaption);
  });

  it('names cuts by their current position and captions by their text, and drops what is gone', () => {
    const project = assistFixture();
    expect(askChoiceText({ clipId: 'clip-run' }, project, ko)).toBe('3번 컷');
    expect(askChoiceText({ clipId: 'clip-run' }, project, en)).toBe('Cut 3');
    expect(askChoiceText({ clipId: 'missing' }, project, ko)).toBeNull();
    expect(askChoiceText('all', project, ko)).toBe('전부');
    expect(askChoiceText(2.5, project, ko)).toBe('2.5초');
    expect(askChoiceText(3, project, en)).toBe('3s');
    expect(askChoiceText('start', project, ko)).toBe('영상 처음');
    expect(askChoiceText('end', project, ko)).toBe('영상 끝');
    expect(askChoiceText('whole', project, en)).toBe('Whole video');
    expect(askChoiceText({ captionId: 'cap-sale' }, project, ko)).toBe('자막 “지금 20% 할인”');
    expect(askChoiceText({ captionId: 'gone' }, project, ko)).toBeNull();
  });

  it('calls a cut what the timeline cards call it ("2번 컷" / "Cut 2")', () => {
    expect(ko.assist.ask.choiceClip).toBe(ko.timeline.clipBadge);
    expect(en.assist.ask.choiceClip).toBe(en.timeline.clipBadge);
    const cutLines = ['clipTrimmed', 'clipRemoved', 'clipMoved', 'clipSplit', 'clipMuted', 'clipUnmuted', 'clipVolume'] as const;
    for (const key of cutLines) {
      expect(ko.assist.lines[key].startsWith(ko.timeline.clipBadge), key).toBe(true);
      expect(en.assist.lines[key].toLowerCase()).toContain(en.timeline.clipBadge.toLowerCase());
    }
  });

  it('words every note, reusing the chat panel for undo and the timeline for "no scene change found"', () => {
    const codes: AssistNoteCode[] = [
      'no_change',
      'no_cuts_found',
      'stale',
      'not_timeline_edit',
      'nothing_to_edit',
      'not_possible',
      'could_not_plan',
      'unavailable',
      'rate_limited',
      'undone',
      'nothing_to_undo',
    ];
    for (const code of codes) {
      expect(noteText(code, ko, 9).trim(), code).not.toBe('');
      expect(noteText(code, en, 9).trim(), code).not.toBe('');
    }
    expect(noteText('no_change', ko)).toBe('이미 그렇게 되어 있어 바꿀 내용이 없어요.');
    // The panel is "AI 편집", so its rate-limit line does not say "채팅 편집".
    expect(noteText('rate_limited', ko, 9)).toBe('이번 분에 요청이 많았어요. 9초 뒤에 다시 시도해 주세요.');
    expect(noteText('rate_limited', en, 9)).toBe('Too many requests. Try again in 9s.');
    expect(ko.assist.notes.rateLimited).toBe(ko.chat.rateLimited.replace('채팅 편집 ', ''));
    expect(noteText('no_cuts_found', ko)).toBe(ko.timeline.noCutsDetected);
    expect(noteText('no_cuts_found', en)).toBe(en.timeline.noCutsDetected);
    expect(noteText('undone', en)).toBe(en.chat.undone);
    expect(noteText('nothing_to_undo', ko)).toBe(ko.chat.nothingToUndo);
  });
});
