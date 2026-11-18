import { describe, expect, it } from 'vitest';
import { answerLine } from '@/components/brand-studio/revise-form';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * The one-line answer in the edit dialogue (docs/BRAND-STUDIO-VIDEO-REMIX.md §2.3, §3):
 * how it will be made, then the one thing the customer should know about the result.
 */
describe.each([
  ['ko', ko.brandStudio.revise.talk],
  ['en', en.brandStudio.revise.talk],
] as const)('answer line (%s)', (_locale, talk) => {
  it('on a version that is not a draft, says the new one comes out at the same quality', () => {
    for (const mode of ['edit', 'reshoot'] as const) {
      expect(answerLine(talk, { mode, reason: null }, true)).toBe(`${talk.answer[mode]} ${talk.sameQuality}`);
    }
    expect(answerLine(talk, { mode: 'edit', reason: 'surface' }, true)).toBe(`${talk.answer.surface} ${talk.sameQuality}`);
  });

  it('on a draft edited in place, says that result cannot go on to a final and which order does', () => {
    expect(answerLine(talk, { mode: 'edit', reason: null }, false)).toBe(`${talk.answer.edit} ${talk.draftEditNote}`);
    expect(answerLine(talk, { mode: 'edit', reason: 'surface' }, false)).toBe(`${talk.answer.surface} ${talk.draftEditNote}`);
  });

  it('on a draft made again, adds nothing: that result is a draft and can still go to a final', () => {
    expect(answerLine(talk, { mode: 'reshoot', reason: 'motion' }, false)).toBe(talk.answer.motion);
    expect(answerLine(talk, { mode: 'reshoot', reason: null }, false)).toBe(talk.answer.reshoot);
  });

  it('outside the dialogue (no base known), says only how', () => {
    expect(answerLine(talk, { mode: 'edit', reason: null }, undefined)).toBe(talk.answer.edit);
  });

  it('never names a resolution, an engine or the upscaler', () => {
    const all = [talk.sameQuality, talk.draftEditNote, talk.make, talk.reading, talk.placeholderMore, ...Object.values(talk.answer)].join(' ');
    expect(all).not.toMatch(/480|720|1080|upscal|업스케일|Seedance|Sunra|모델|엔진|프롬프트|prompt|engine|model/i);
  });
});
