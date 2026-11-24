import { describe, expect, it } from 'vitest';
import { ko } from '@/messages/ko';
import { en } from '@/messages/en';
import { lockedPartsOf } from '@/components/twings/edit-sheet-card';
import { parseVideoKeyframes, type VideoKeyframe } from '@/lib/prompts/keyframes';
import { DIRECTOR_EDITABLE_SLOTS } from '@/lib/template-director/schema';
import {
  TEMPLATE_LOCK_NAMED,
  parseTemplateLocks,
  publicLocks,
  renderLockBlock,
  type PublicTemplateLocks,
  type TemplateLock,
} from '@/lib/template-director/locks';
import { declaredPartKeys, declaredPartKeysOfPrompt, partLabel, templatePartsView } from '@/lib/template-director/parts-view';

/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — which parts a template declares (today: the `Template locks:` block, later
 * also `Template styling:`), and the view the template page shows: names from the public projection, descriptions
 * and ranges from the marks. A mark naming a part the prompt does not declare is dropped.
 */

const BODY = 'A woman walks through a neon alley at night while the camera dollies back slowly.';
const locksOf = (entries: TemplateLock[]): PublicTemplateLocks => publicLocks(parseTemplateLocks(`${BODY}\n\n${renderLockBlock(entries)}`))!;
const mark = (part: string, timeSeconds: number, endSeconds?: number, labels: Partial<VideoKeyframe> = {}): VideoKeyframe => ({
  index: 0,
  timeSeconds,
  ...(endSeconds === undefined ? {} : { endSeconds }),
  part,
  ...labels,
});

describe('declaredPartKeys', () => {
  it('is empty without a block, with a malformed block, and for null', () => {
    expect(declaredPartKeys({ locks: null })).toEqual([]);
    expect(declaredPartKeys({ locks: undefined, styling: null })).toEqual([]);
    expect(declaredPartKeys({ locks: publicLocks(parseTemplateLocks(BODY)) })).toEqual([]);
    const malformed = publicLocks(parseTemplateLocks(`${BODY}\n\nTemplate locks:\n- Keep exactly as in the template: the moon.`))!;
    expect(malformed.all).toBe(true);
    expect(declaredPartKeys({ locks: malformed })).toEqual([]);
  });

  it('names the parts in block order: named, slots (the product covers the prop), then shots', () => {
    const locks = locksOf([{ kind: 'shots', from: 2, to: 3 }, { kind: 'slot', slot: 'hair' }, { kind: 'product' }, { kind: 'sound' }]);
    expect(declaredPartKeys({ locks })).toEqual(['product', 'sound', 'hair', 'shots-2-3']);
    expect(declaredPartKeys({ locks: locksOf([{ kind: 'slot', slot: 'prop' }]) })).toEqual(['prop']);
  });

  it('agrees with the make card’s locked list for every single lock and for mixes', () => {
    const singles: TemplateLock[] = [
      ...TEMPLATE_LOCK_NAMED.map((kind) => ({ kind }) as TemplateLock),
      ...DIRECTOR_EDITABLE_SLOTS.map((slot) => ({ kind: 'slot', slot }) as TemplateLock),
      { kind: 'shots', from: 1, to: 1 },
      { kind: 'shots', from: 4, to: 6 },
    ];
    const cases: TemplateLock[][] = [...singles.map((s) => [s]), singles, singles.slice(0, 5), [singles[0]!, singles[6]!, singles[10]!], [singles[7]!, singles[9]!]];
    for (const entries of cases) {
      const locks = locksOf(entries);
      expect(declaredPartKeys({ locks }), JSON.stringify(entries)).toEqual(lockedPartsOf(locks, ko.editSheet).map((p) => p.key));
    }
  });

  it('adds declared styling parts once, after the locks (a locked part stays locked)', () => {
    const locks = locksOf([{ kind: 'slot', slot: 'hair' }]);
    expect(declaredPartKeys({ locks, styling: { styled: ['hair', 'makeup'], photo: ['outfit'] } })).toEqual(['hair', 'makeup', 'outfit']);
    expect(declaredPartKeys({ locks: null, styling: { styled: ['makeup'], photo: [] } })).toEqual(['makeup']);
  });

  it('reads the declaration from a prompt', () => {
    expect(declaredPartKeysOfPrompt(BODY)).toEqual([]);
    expect(declaredPartKeysOfPrompt(`${BODY}\n\n${renderLockBlock([{ kind: 'logo' }, { kind: 'slot', slot: 'makeup' }])}`)).toEqual(['logo', 'makeup']);
  });
});

describe('partLabel', () => {
  it('uses the make card’s words', () => {
    expect(partLabel('product', ko.editSheet)).toBe(ko.editSheet.locks.product);
    expect(partLabel('lighting_mood', en.editSheet)).toBe(en.editSheet.slots.lighting_mood);
    expect(partLabel('shots-2-3', ko.editSheet)).toBe('2~3번째 컷');
    expect(partLabel('shots-4-4', en.editSheet)).not.toBeNull();
    expect(partLabel('constructor', ko.editSheet)).toBeNull();
    expect(partLabel('moon', ko.editSheet)).toBeNull();
  });
});

describe('templatePartsView', () => {
  const locks = locksOf([{ kind: 'product' }, { kind: 'slot', slot: 'hair' }, { kind: 'shots', from: 2, to: 3 }]);

  it('is empty when nothing is declared, marks or not', () => {
    expect(templatePartsView({ locks: null, marks: [mark('hair', 1, 2)], copy: ko.editSheet, locale: 'ko' })).toEqual([]);
  });

  it('lists the declared parts by name and state when there are no marks', () => {
    const view = templatePartsView({ locks, marks: [], copy: ko.editSheet, locale: 'ko' });
    expect(view).toEqual([
      { id: 'product', key: 'product', state: 'locked', label: '제품', desc: null, from: null, to: null, choice: false },
      { id: 'hair', key: 'hair', state: 'locked', label: '헤어', desc: null, from: null, to: null, choice: false },
      { id: 'shots-2-3', key: 'shots-2-3', state: 'locked', label: '2~3번째 컷', desc: null, from: null, to: null, choice: false },
    ]);
  });

  it('joins marks: description in the page language, range, two per part at most, undeclared dropped', () => {
    const marks = parseVideoKeyframes([
      mark('hair', 3, 6, { labelKo: '핑크 단발', labelEn: 'Pink bob' }),
      mark('hair', 8, 9.5, { labelKo: '뒷모습' }),
      mark('hair', 10, 11),
      mark('logo', 1, 2, { labelKo: '로고' }),
      mark('product', 4, 4, { labelKo: '끝이 시작과 같음' }),
      { index: 9, timeSeconds: 0.5, labelKo: '오프닝' },
    ])!;
    const ko_ = templatePartsView({ locks, marks, copy: ko.editSheet, locale: 'ko' });
    expect(ko_.map((p) => [p.id, p.key, p.desc, p.from, p.to])).toEqual([
      ['product', 'product', '끝이 시작과 같음', 4, null],
      ['hair', 'hair', '핑크 단발', 3, 6],
      ['hair~2', 'hair', '뒷모습', 8, 9.5],
      ['shots-2-3', 'shots-2-3', null, null, null],
    ]);
    const en_ = templatePartsView({ locks, marks, copy: en.editSheet, locale: 'en' });
    expect(en_.map((p) => p.desc)).toEqual([null, 'Pink bob', null, null]);
    expect(en_.map((p) => p.label)).toEqual([en.editSheet.locks.product, en.editSheet.slots.hair, en.editSheet.slots.hair, expect.any(String)]);
  });

  it('a malformed block shows no parts (the page says everything is fixed in one line instead)', () => {
    const malformed = publicLocks(parseTemplateLocks(`${BODY}\n\nTemplate locks:\n- nonsense`))!;
    expect(templatePartsView({ locks: malformed, marks: [mark('hair', 1, 2)], copy: ko.editSheet, locale: 'ko' })).toEqual([]);
  });

  it('carries no word of the lock block', () => {
    const tail = 'a bright pink chin-length bob PRIVATE-TAIL';
    const prompt = `${BODY}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair', note: tail }])}`;
    const view = templatePartsView({ locks: publicLocks(parseTemplateLocks(prompt)), marks: [], copy: en.editSheet, locale: 'en' });
    const text = JSON.stringify(view);
    for (const needle of ['PRIVATE-TAIL', 'pink chin-length', 'Template locks', 'Keep exactly']) expect(text.includes(needle), needle).toBe(false);
  });
});
