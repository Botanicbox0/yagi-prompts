import { afterEach, describe, expect, it } from 'vitest';
import type { PromptCard } from '@/lib/prompts/catalog';
import { cardFacets, cardVisible, facetsFromDataset, hiddenByLook, lookAttribute, matchesFilter, type CardFacets, type FilterState, type ViewerLook } from '@/lib/prompts/facets';
import { applyListFilter, applyRailVisibility, type FilterRail } from '@/components/prompts/filter-chips';
import { isTemplateLook, lookHides, parseLookBody, readLookCookie, toTemplateAudience } from '@/lib/template-look/look';
import {
  effectiveLook,
  lookQuestionSnoozed,
  lookSnapshot,
  publishLookSession,
  recordChosenLook,
  resetLookStore,
  revealAllLooks,
  serverLookSnapshot,
  setFirstRunPending,
  shouldAskLook,
  snoozeLookQuestion,
  viewerLookOf,
  LOOK_SNOOZE_MS,
} from '@/lib/template-look/store';
import { parseCreatorSession } from '@/lib/auth/observe-creator-session';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — ONE function decides whether a card is on screen: the chips and the viewer's
 * template style together (`cardVisible`). Unset, signed out, or the switch off → nothing is hidden; "다른 스타일도
 * 보기" brings the other style back for that page view; counts and the empty line follow what is on screen.
 */

const facets = (overrides: Partial<CardFacets> = {}): CardFacets => ({ new: false, length: 'mid', style: null, useCase: [], cast: 'solo', ...overrides });
const viewer = (look: ViewerLook['look'], showAll = false): ViewerLook => ({ look, showAll });

describe('the vocabulary', () => {
  it('knows two styles and reads anything else as "for anyone"', () => {
    expect(isTemplateLook('female')).toBe(true);
    expect(isTemplateLook('male')).toBe(true);
    for (const other of ['any', 'FEMALE', '', null, undefined, 1]) expect(isTemplateLook(other)).toBe(false);
    expect(toTemplateAudience('male')).toBe('male');
    expect(toTemplateAudience('other')).toBe('any');
  });

  it('reads the cookie from a header, ignoring other cookies and tampered values', () => {
    expect(readLookCookie('a=1; tw_look=female; b=2')).toBe('female');
    expect(readLookCookie('tw_look=male')).toBe('male');
    expect(readLookCookie('tw_look=<script>')).toBeNull();
    expect(readLookCookie('xtw_look=female')).toBeNull();
    expect(readLookCookie('')).toBeNull();
    expect(readLookCookie(null)).toBeNull();
  });

  it('hides only a template written for the OTHER style', () => {
    expect(lookHides('any', 'female')).toBe(false);
    expect(lookHides('female', 'female')).toBe(false);
    expect(lookHides('male', 'female')).toBe(true);
    expect(lookHides('female', 'male')).toBe(true);
    expect(lookHides('male', null)).toBe(false);
  });

  it('parses the route body: two styles or null, nothing else', () => {
    expect(parseLookBody({ look: 'female' })).toEqual({ ok: true, look: 'female' });
    expect(parseLookBody({ look: null })).toEqual({ ok: true, look: null });
    for (const bad of [{}, { look: 'any' }, { look: 'Male' }, { look: 1 }, null, 'female', []]) expect(parseLookBody(bad)).toEqual({ ok: false });
  });
});

describe('cardVisible — chips × the viewer style', () => {
  const female = facets({ look: 'female' });
  const male = facets({ look: 'male' });
  const any = facets();
  const table: Array<[string, CardFacets, FilterState, ViewerLook | null, boolean]> = [
    ['no viewer (switch off) shows a male card', male, {}, null, true],
    ['unset viewer shows a male card', male, {}, viewer(null), true],
    ['female viewer hides a male card', male, {}, viewer('female'), false],
    ['female viewer keeps a female card', female, {}, viewer('female'), true],
    ['female viewer keeps a card for anyone', any, {}, viewer('female'), true],
    ['male viewer hides a female card', female, {}, viewer('male'), false],
    ['"show all" brings the other style back', male, {}, viewer('female', true), true],
    ['the chips still apply to a card the style keeps', female, { length: 'short' }, viewer('female'), false],
    ['the chips and the style together', any, { length: 'mid' }, viewer('male'), true],
  ];
  for (const [name, card, filter, view, expected] of table) {
    it(name, () => expect(cardVisible(card, filter, view)).toBe(expected));
  }

  it('is exactly matchesFilter when no viewer is known', () => {
    for (const card of [female, male, any]) for (const filter of [{}, { length: 'mid' }, { new: '1' }] as FilterState[]) {
      expect(cardVisible(card, filter)).toBe(matchesFilter(card, filter));
      expect(cardVisible(card, filter, null)).toBe(matchesFilter(card, filter));
    }
  });

  it('separates what the style alone hides', () => {
    expect(hiddenByLook(male, viewer('female'))).toBe(true);
    expect(hiddenByLook(male, viewer('female', true))).toBe(false);
    expect(hiddenByLook(any, viewer('female'))).toBe(false);
    expect(hiddenByLook(male, null)).toBe(false);
  });
});

describe('card facets carry the style only when it is one style', () => {
  const card = (look?: 'female' | 'male') => ({ medium: 'video', runtimeSeconds: 12, publishedAt: null, useCase: [], ...(look ? { look } : {}) }) as unknown as PromptCard;

  it('leaves a card for anyone exactly as before (no `look` key)', () => {
    expect('look' in cardFacets(card())).toBe(false);
    expect('look' in facetsFromDataset({ length: 'mid' })).toBe(false);
    expect('look' in facetsFromDataset({ look: 'any' })).toBe(false);
    expect(lookAttribute(cardFacets(card()))).toBe('any');
  });

  it('round-trips a one-style card through the attribute', () => {
    expect(cardFacets(card('male')).look).toBe('male');
    expect(lookAttribute(cardFacets(card('female')))).toBe('female');
    expect(facetsFromDataset({ look: 'female' }).look).toBe('female');
    expect(facetsFromDataset({ look: 'nonsense' }).look).toBeUndefined();
  });
});

describe('applyRailVisibility — one pass sets hidden, the count, the empty line and the reveal button', () => {
  type Item = { dataset: Record<string, string>; hidden: boolean };
  const rail = (looks: string[], withReveal = true) => {
    const items: Item[] = looks.map((look) => ({ dataset: { length: 'mid', ...(look ? { look } : {}) }, hidden: false }));
    const empty = { hidden: true };
    const reveal = withReveal ? { hidden: true } : null;
    const scope: FilterRail = {
      querySelectorAll: () => items as unknown as ReturnType<FilterRail['querySelectorAll']>,
      querySelector: (selector: string) => (selector === '[data-rail-filtered-empty]' ? empty : selector === '[data-look-reveal]' ? reveal : null),
    };
    return { scope, items, empty, reveal };
  };

  it('hides nothing for an unset viewer or without the switch', () => {
    const r = rail(['female', 'male', 'any']);
    expect(applyRailVisibility(r.scope, {}, viewer(null))).toEqual({ visible: 3, lookHidden: 0, lookShown: 3 });
    expect(applyRailVisibility(r.scope, {}, null)).toEqual({ visible: 3, lookHidden: 0, lookShown: 3 });
    expect(r.items.every((item) => !item.hidden)).toBe(true);
    expect(r.empty.hidden).toBe(true);
    expect(r.reveal!.hidden).toBe(true);
  });

  it('hides the other style and counts it', () => {
    const r = rail(['female', 'male', 'any']);
    expect(applyRailVisibility(r.scope, {}, viewer('female'))).toEqual({ visible: 2, lookHidden: 1, lookShown: 2 });
    expect(r.items.map((item) => item.hidden)).toEqual([false, true, false]);
    expect(r.empty.hidden).toBe(true);
    expect(r.reveal!.hidden).toBe(true);
  });

  it('shows the empty line AND "다른 스타일도 보기" when the style alone empties the rail', () => {
    const r = rail(['male', 'male']);
    expect(applyRailVisibility(r.scope, {}, viewer('female'))).toEqual({ visible: 0, lookHidden: 2, lookShown: 0 });
    expect(r.empty.hidden).toBe(false);
    expect(r.reveal!.hidden).toBe(false);
    // …and "show all" brings every card back for this page view.
    expect(applyRailVisibility(r.scope, {}, viewer('female', true)).visible).toBe(2);
    expect(r.empty.hidden).toBe(true);
    expect(r.reveal!.hidden).toBe(true);
  });

  it('offers no reveal when the chips emptied the rail (the other style would not help)', () => {
    const r = rail(['female', 'male']);
    expect(applyRailVisibility(r.scope, { length: 'short' }, viewer('female'))).toEqual({ visible: 0, lookHidden: 0, lookShown: 1 });
    expect(r.empty.hidden).toBe(false);
    expect(r.reveal!.hidden).toBe(true);
  });

  it('applyListFilter keeps its old contract and takes the viewer as one more input', () => {
    const r = rail(['female', 'male', 'any'], false);
    const root = { querySelector: (selector: string) => (selector === '[data-rail="video"]' ? r.scope : null) };
    expect(applyListFilter(root, 'video', {})).toBe(3);
    expect(applyListFilter(root, 'video', {}, viewer('male'))).toBe(2);
    expect(applyListFilter(root, 'missing', {}, viewer('male'))).toBe(0);
  });
});

describe('the shared style state (no request of its own)', () => {
  afterEach(() => resetLookStore());

  it('starts knowing nothing, on the server and before the session answers', () => {
    expect(effectiveLook(serverLookSnapshot())).toBeNull();
    expect(shouldAskLook(serverLookSnapshot(), false)).toBe(false);
  });

  it('lets a signed-out answer show everything, whatever the cookie said', () => {
    recordChosenLook('female');
    publishLookSession({ signedIn: false });
    expect(effectiveLook(lookSnapshot())).toBeNull();
  });

  it('takes the stored choice from the session over the cookie, and asks only when it is known to be unset', () => {
    publishLookSession(parseCreatorSession({ signedIn: true, displayName: 'A', look: 'male' }));
    expect(effectiveLook(lookSnapshot())).toBe('male');
    expect(shouldAskLook(lookSnapshot(), false)).toBe(false);
    publishLookSession(parseCreatorSession({ signedIn: true, displayName: 'A', look: null }));
    expect(effectiveLook(lookSnapshot())).toBeNull();
    expect(shouldAskLook(lookSnapshot(), false)).toBe(true);
    expect(shouldAskLook(lookSnapshot(), true)).toBe(false);
  });

  it('asks nothing when the server did not say (the switch off, or 0190 missing)', () => {
    publishLookSession(parseCreatorSession({ signedIn: true, displayName: 'A' }));
    expect(lookSnapshot().session).toEqual({ status: 'member', look: undefined });
    expect(shouldAskLook(lookSnapshot(), false)).toBe(false);
  });

  it('waits while the after-signup sheet decides', () => {
    publishLookSession({ signedIn: true, look: null });
    setFirstRunPending(true);
    expect(shouldAskLook(lookSnapshot(), false)).toBe(false);
    setFirstRunPending(false);
    expect(shouldAskLook(lookSnapshot(), false)).toBe(true);
  });

  it('stops asking once a style is chosen, and "show all" is for one page only', () => {
    publishLookSession({ signedIn: true, look: null });
    recordChosenLook('female');
    expect(shouldAskLook(lookSnapshot(), false)).toBe(false);
    expect(viewerLookOf(lookSnapshot(), '/ko/video')).toEqual({ look: 'female', showAll: false });
    revealAllLooks('/ko/video');
    expect(viewerLookOf(lookSnapshot(), '/ko/video')).toEqual({ look: 'female', showAll: true });
    expect(viewerLookOf(lookSnapshot(), '/ko/image')).toEqual({ look: 'female', showAll: false });
  });

  it('snoozes the question for a day, and survives storage that throws', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const t0 = 1_800_000_000_000;
    expect(lookQuestionSnoozed(t0, storage)).toBe(false);
    snoozeLookQuestion(t0, storage);
    expect(lookQuestionSnoozed(t0 + 1000, storage)).toBe(true);
    expect(lookQuestionSnoozed(t0 + LOOK_SNOOZE_MS + 1, storage)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(() => snoozeLookQuestion(t0, broken)).not.toThrow();
    expect(lookQuestionSnoozed(t0, broken)).toBe(false);
    expect(lookQuestionSnoozed(t0, null)).toBe(false);
  });
});

describe('the session projection', () => {
  it('keeps its old shape when the endpoint sends no style', () => {
    expect(parseCreatorSession({ signedIn: true, displayName: 'A' })).toEqual({ signedIn: true, displayName: 'A' });
  });
  it('carries the style when sent, and reads anything else as "not chosen"', () => {
    expect(parseCreatorSession({ signedIn: true, displayName: 'A', look: 'female' })).toEqual({ signedIn: true, displayName: 'A', look: 'female' });
    expect(parseCreatorSession({ signedIn: true, displayName: 'A', look: 'x' })).toEqual({ signedIn: true, displayName: 'A', look: null });
    expect(parseCreatorSession({ signedIn: false, look: 'female' })).toEqual({ signedIn: false });
  });
});
