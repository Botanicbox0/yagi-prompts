import { describe, expect, it } from 'vitest';
import { captionTextProblems, quotedSegments, restoreCaptionTexts } from '@/lib/brand-studio/edit-assist/caption-text';
import { deepFreeze } from './fixture';

const HASHTAG = "영상 내내 위쪽에 '#광고' 작게 넣어줘";
const reply = (...steps: Array<Record<string, unknown>>) => ({ kind: 'plan', steps });
const add = (text: string) => ({ do: 'caption_add', where: 'whole', text, position: 'top', size: 'sm' });

describe('quotedSegments', () => {
  it('reads every kind of quote pair, in order', () => {
    expect(quotedSegments(HASHTAG)).toEqual(['#광고']);
    expect(quotedSegments("'지금 20% 할인' 자막을 '오늘만 30% 할인'으로 바꿔줘")).toEqual(['지금 20% 할인', '오늘만 30% 할인']);
    expect(quotedSegments('“신상” 그리고 ‘한정’ 그리고 「봄」 그리고 『여름』 그리고 "가을"')).toEqual([
      '신상',
      '한정',
      '봄',
      '여름',
      '가을',
    ]);
    // Quote marks inside another kind belong to the text.
    expect(quotedSegments(`"'#광고'" 그대로 넣어줘`)).toEqual(["'#광고'"]);
  });

  it('does not take an English apostrophe for a quote mark', () => {
    expect(quotedSegments("Don't touch the cuts, just add 'Shop now' at the end")).toEqual(['Shop now']);
    expect(quotedSegments("Keep the users' clips and don't add anything")).toEqual([]);
    expect(quotedSegments('마지막에 구매를 부르는 짧은 문구 하나 넣어줘')).toEqual([]);
  });
});

describe('restoreCaptionTexts', () => {
  it('takes off the quote marks the model wrapped around the text (the live "#광고" answer)', () => {
    for (const text of ['"#광고"', '“#광고”', '‘#광고’', '「#광고」', '『#광고』']) {
      expect(restoreCaptionTexts(reply(add(text)), HASHTAG), text).toEqual(reply(add('#광고')));
    }
    // The user's own quote marks copied along with the text.
    expect(restoreCaptionTexts(reply(add("'#광고'")), HASHTAG)).toEqual(reply(add('#광고')));
  });

  it('decodes percent-encoded text when the decoded text is what the user wrote (the live %23광고 answer)', () => {
    expect(restoreCaptionTexts(reply(add('%23광고')), HASHTAG)).toEqual(reply(add('#광고')));
    expect(restoreCaptionTexts(reply(add('"%23광고"')), HASHTAG)).toEqual(reply(add('#광고')));
    // Not valid percent-encoding: left alone, nothing thrown.
    expect(restoreCaptionTexts(reply(add('오늘만 30%할인')), "할인 자막을 '오늘만 30% 할인'으로 바꿔줘")).toEqual(
      reply(add('오늘만 30%할인')),
    );
  });

  it('changes caption_edit text too, and nothing else', () => {
    const message = "할인 자막을 '오늘만 30% 할인'으로 바꿔줘";
    const raw = deepFreeze(
      reply(
        { do: 'caption_edit', caption: 't2', text: '"오늘만 30% 할인"' },
        { do: 'caption_edit', caption: 't1', position: 'top' },
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
      ),
    );
    expect(restoreCaptionTexts(raw, message)).toEqual(
      reply(
        { do: 'caption_edit', caption: 't2', text: '오늘만 30% 할인' },
        { do: 'caption_edit', caption: 't1', position: 'top' },
        { do: 'trim', clip: 'c1', keep: 'start', seconds: 2 },
      ),
    );
  });

  it('leaves text alone when no restored form is what the user wrote', () => {
    for (const text of ['#광고 중', '지금 만나보세요', '"지금 만나보세요"', '%EA%B4']) {
      expect(restoreCaptionTexts(reply(add(text)), HASHTAG), text).toEqual(reply(add(text)));
    }
    // Quote marks the user typed inside the quoted text stay.
    expect(restoreCaptionTexts(reply(add("'#광고'")), `"'#광고'" 그대로 넣어줘`)).toEqual(reply(add("'#광고'")));
    // Anything that is not a plan passes through.
    expect(restoreCaptionTexts({ kind: 'ask', about: 'which_clip', choices: ['c1', 'c2'] }, HASHTAG)).toEqual({
      kind: 'ask',
      about: 'which_clip',
      choices: ['c1', 'c2'],
    });
    expect(restoreCaptionTexts(null, HASHTAG)).toBeNull();
  });
});

describe('captionTextProblems', () => {
  const step = (text?: string) => ({ do: 'caption_add' as const, where: 'end' as const, ...(text !== undefined ? { text } : {}) });
  /** The captions on the shared timeline (`fixture.ts`). */
  const EXISTING = ['봄 신상 출시', '지금 20% 할인'];

  it('wants caption text to be one of the quoted words exactly', () => {
    expect(captionTextProblems([step('#광고')], HASHTAG, EXISTING)).toEqual([]);
    expect(captionTextProblems([step('"#광고"')], HASHTAG, EXISTING)).toEqual(['step 1: caption_text_not_verbatim']);
    expect(
      captionTextProblems(
        [{ do: 'trim', clip: 'c1', keep: 'start', seconds: 2 }, { do: 'caption_edit', caption: 't2', text: '오늘만 30%할인' }],
        "할인 자막을 '오늘만 30% 할인'으로 바꿔줘",
        EXISTING,
      ),
    ).toEqual(['step 2: caption_text_not_verbatim']);
  });

  it('accepts either of two quoted texts, a caption change without text, and anything when nothing is quoted', () => {
    const twoQuoted = "'지금 20% 할인' 자막을 '오늘만 30% 할인'으로 바꿔줘";
    expect(captionTextProblems([{ do: 'caption_edit', caption: 't2', text: '오늘만 30% 할인' }], twoQuoted, EXISTING)).toEqual([]);
    expect(
      captionTextProblems([{ do: 'caption_edit', caption: 't1', position: 'top' }], "'봄 신상 출시' 자막 위로", EXISTING),
    ).toEqual([]);
    expect(captionTextProblems([step('지금 만나보세요')], '마지막에 짧은 문구 하나 넣어줘', EXISTING)).toEqual([]);
  });

  it('does not compare when every quoted text only names a caption already on the timeline', () => {
    expect(captionTextProblems([step('지금 만나보세요')], "'봄 신상 출시' 지우고 마지막에 브랜드 문구 넣어줘", EXISTING)).toEqual([]);
    expect(
      captionTextProblems([{ do: 'caption_edit', caption: 't1', text: '봄 신상' }], "'봄 신상 출시' 자막을 더 짧게 고쳐줘", EXISTING),
    ).toEqual([]);
    // Both quoted texts name captions on the timeline.
    expect(
      captionTextProblems([step('여름 세일')], "'봄 신상 출시'랑 '지금 20% 할인' 지우고 마지막에 세일 문구 넣어줘", EXISTING),
    ).toEqual([]);
  });

  it('keeps the rule when at least one quoted text is new, and when the timeline has no such caption', () => {
    const oldAndNew = "'지금 20% 할인' 자막을 '오늘만 30% 할인'으로 바꿔줘";
    expect(captionTextProblems([{ do: 'caption_edit', caption: 't2', text: '오늘만 30%할인' }], oldAndNew, EXISTING)).toEqual([
      'step 1: caption_text_not_verbatim',
    ]);
    expect(captionTextProblems([step('지금 만나보세요')], "'봄 신상 출시' 지우고 마지막에 브랜드 문구 넣어줘", [])).toEqual([
      'step 1: caption_text_not_verbatim',
    ]);
  });
});
