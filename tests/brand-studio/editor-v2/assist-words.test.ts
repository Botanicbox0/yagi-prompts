import { describe, expect, it } from 'vitest';
import { interpretUtterance, type AssistIntent } from '@/lib/brand-studio/editor-v2/model';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/** Every example sentence the assistant shows must be one it understands, in both languages. */
const EXPECTED: Record<keyof typeof studioEditorEn.assist.examples, AssistIntent> = {
  cut1: { kind: 'aspect', aspect: '9:16' },
  cut2: { kind: 'trim', clipNumber: 2, seconds: 2 },
  cut3: { kind: 'remove_last' },
  color1: { kind: 'auto_balance' },
  color2: { kind: 'match_first' },
  sound1: { kind: 'duck' },
  sound2: { kind: 'loudness' },
  sound3: { kind: 'speech_clear' },
  captions1: { kind: 'make_captions' },
  captions2: { kind: 'lift_captions' },
};

describe('interpretUtterance understands every example sentence', () => {
  for (const [locale, copy] of [
    ['ko', studioEditorKo],
    ['en', studioEditorEn],
  ] as const) {
    for (const [key, sentence] of Object.entries(copy.assist.examples)) {
      it(`${locale}.${key}: ${sentence}`, () => {
        const expected = EXPECTED[key as keyof typeof EXPECTED];
        expect(expected, `no expectation for example key ${key}`).toBeDefined();
        expect(interpretUtterance(sentence)).toEqual(expected);
      });
    }
  }

  it('covers every expected key in both languages', () => {
    expect(Object.keys(studioEditorKo.assist.examples).sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(Object.keys(studioEditorEn.assist.examples).sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('interpretUtterance otherwise', () => {
  it('returns null for empty or unrelated text', () => {
    expect(interpretUtterance('')).toBeNull();
    expect(interpretUtterance('   ')).toBeNull();
    expect(interpretUtterance('오늘 점심 뭐 먹지')).toBeNull();
    expect(interpretUtterance('What is the weather like tomorrow?')).toBeNull();
  });

  it('reads other aspect, trim and clip-number phrasings', () => {
    expect(interpretUtterance('정사각으로 바꿔 줘')).toEqual({ kind: 'aspect', aspect: '1:1' });
    expect(interpretUtterance('16:9로 바꿔')).toEqual({ kind: 'aspect', aspect: '16:9' });
    expect(interpretUtterance('3번 컷을 1.5초로 줄여 줘')).toEqual({ kind: 'trim', clipNumber: 3, seconds: 1.5 });
    expect(interpretUtterance('Trim clip 4 to 3 sec')).toEqual({ kind: 'trim', clipNumber: 4, seconds: 3 });
    // No cut named: nothing to trim.
    expect(interpretUtterance('2초로 줄여 줘')).toBeNull();
  });
});
