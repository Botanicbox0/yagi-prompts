import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { PromptRow } from '@/lib/prompts/repo';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C2) — the template page hands the make card the template's locks as the public
 * projection, with the edit-sheet flag on or off, and never a word of the lock block (template prompt text can be
 * hidden from customers). The card is built by the real `toPromptCard` from a row whose prompt carries the block;
 * the studio (a client component) is replaced by a probe that records the props the page hands it, which is what
 * crosses to the browser.
 */

const state = vi.hoisted(() => ({
  card: null as PromptCard | null,
  flag: false,
  studio: [] as Array<Record<string, unknown>>,
  media: [] as Array<Record<string, unknown>>,
  keyframes: null as unknown,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_MODE: 'off', RENDER_PIPELINE_PUBLIC: false, personalEditSheetOpen: () => state.flag, templateLookOpen: () => false }));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({
  cachedSubscriptionAvailability: async () => ({ status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [state.card], image: [], makers: [] }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/lib/recipes/cached-public', () => ({ cachedPublicRecipe: async () => null }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/prompts/detail', () => ({ RelatedPrompts: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({
  PromptDetailMedia: (props: Record<string, unknown>) => {
    state.media.push(props);
    return null;
  },
}));
vi.mock('@/lib/prompts/keyframes-cached', () => ({ cachedPromptKeyframes: async () => state.keyframes }));
vi.mock('@/components/prompts/poster', () => ({ TypographicPoster: () => null, posterRatio: () => '9 / 16' }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));
vi.mock('@/components/twings/studio', () => ({
  TwingsStudio: (props: Record<string, unknown>) => {
    state.studio.push(props);
    return null;
  },
}));

import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';
import { toPromptCard } from '@/lib/prompts/catalog';
import { parseTemplateLocks, publicLocks, renderLockBlock } from '@/lib/template-director/locks';
import { renderStylingBlock } from '@/lib/template-director/styling';

const HAIR_TAIL = 'a bright pink chin-length bob PRIVATE-PAGE-TAIL';
const BLOCK = renderLockBlock([{ kind: 'product' }, { kind: 'slot', slot: 'hair', note: HAIR_TAIL }, { kind: 'shots', from: 2, to: 3 }]);
const BODY = 'Timeline:\n[Shot 1 - Counter, 0.0-3.0s]:\n- @Image 1 picks up the serum bottle.';

function row(promptText: string): PromptRow {
  return {
    audience: 'public', id: 'tpl-page-locks', slug: 'serum-counter-locks', source: 'yagi', authorId: null, authorHandle: null,
    status: 'published', models: ['seedance-2.5'], title: 'Serum Counter', titleKo: '세럼 카운터', promptText,
    processMd: null, processMdKo: null, sourceUrl: null, textVisibility: 'hidden', media: null, useCase: [], featured: false,
    medium: 'video', cast: 'solo', priceCents: 2900, priceKrw: 39000, price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 10,
    engine: 'seedance-2.5', aspectDefault: '9:16', rejectReason: null, announcedAt: null, createdAt: null, publishedAt: null,
  };
}

async function render(locale: 'ko' | 'en') {
  state.studio = [];
  state.media = [];
  const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: 'serum-counter-locks' }) }));
  expect(state.studio.length).toBeGreaterThan(0);
  expect(state.media.length).toBeGreaterThan(0);
  return { html, live: state.studio[0]!.live as Record<string, unknown>, props: state.studio, media: state.media[0]! };
}

const PRIVATE = ['Template locks', 'Keep exactly as in the template', 'PRIVATE-PAGE-TAIL', 'pink chin-length bob', 'its shape, colour, label', 'action, framing, timing'];

function expectNothingPrivate(value: unknown): void {
  const serialised = typeof value === 'string' ? value : JSON.stringify(value);
  for (const needle of PRIVATE) expect(serialised.includes(needle), needle).toBe(false);
}

beforeEach(() => {
  state.flag = false;
  state.keyframes = null;
  state.card = toPromptCard(row(`${BODY}\n\n${BLOCK}`), { publicUrl: () => null });
});

describe('the template page with a locked template', () => {
  it('flag off: the studio gets the public locks and their words, and no word of the block reaches it or the page', async () => {
    const { html, live, props } = await render('ko');
    expect(live.locks).toEqual(publicLocks(parseTemplateLocks(`${BODY}\n\n${BLOCK}`)));
    expect(live.lockCopy).toEqual(ko.editSheet);
    expect(Object.hasOwn(live, 'editSheet')).toBe(false);
    expectNothingPrivate(props);
    expectNothingPrivate(html);
  });

  it('flag on: the same locks next to the sheet words', async () => {
    state.flag = true;
    const { live, props } = await render('en');
    expect(live.locks).toEqual(publicLocks(parseTemplateLocks(`${BODY}\n\n${BLOCK}`)));
    expect(live.editSheet).toEqual(en.editSheet);
    expectNothingPrivate(props);
  });

  it('a template without a block hands over no lock key, flag on or off', async () => {
    state.card = toPromptCard(row(BODY), { publicUrl: () => null });
    for (const flag of [false, true]) {
      state.flag = flag;
      const { live, media } = await render('ko');
      expect(Object.hasOwn(live, 'locks')).toBe(false);
      expect(Object.hasOwn(live, 'lockCopy')).toBe(false);
      expect(Object.hasOwn(live, 'editSheet')).toBe(flag);
      // docs/PERSONAL-STUDIO.md §3.4.4 (T1a): no declaration, no fixed row — the media block gets no new prop.
      expect(Object.hasOwn(media, 'fixed')).toBe(false);
    }
  });
});

describe('the fixed row under the example video (T1a)', () => {
  const HAIR_MARK = { index: 0, timeSeconds: 3, endSeconds: 6, part: 'hair', labelKo: '핑크 단발', labelEn: 'Pink bob' };
  const LOGO_MARK = { index: 1, timeSeconds: 1, endSeconds: 2, part: 'logo', labelKo: '선언되지 않은 부분' };
  const BEAT = { index: 2, timeSeconds: 8, labelKo: '피날레', labelEn: 'Finale' };

  it('hands the media block the declared parts by name, joined with their marks, and nothing of the block', async () => {
    state.keyframes = [HAIR_MARK, LOGO_MARK, BEAT];
    const { media, html } = await render('ko');
    const fixed = media.fixed as { parts: Array<Record<string, unknown>>; all: boolean; copy: Record<string, string> };
    expect(fixed.all).toBe(false);
    expect(fixed.parts.map((p) => [p.key, p.label, p.desc, p.from, p.to])).toEqual([
      ['product', ko.editSheet.locks.product, null, null, null],
      ['hair', ko.editSheet.slots.hair, '핑크 단발', 3, 6],
      ['shots-2-3', '2~3번째 컷', null, null, null],
    ]);
    expect(fixed.copy).toEqual({ ...ko.templates.fixed, lockedAll: ko.editSheet.lockedAll });
    // The beats strip gets the beats only; the marks never show up as beats.
    expect(media.keyframes).toEqual([{ index: 0, timeSeconds: 8, labelKo: '피날레', labelEn: 'Finale' }]);
    expectNothingPrivate(media);
    expectNothingPrivate(html);
    expect(JSON.stringify(media).includes('선언되지 않은 부분')).toBe(false);
  });

  it('in English, the English words and descriptions only', async () => {
    state.keyframes = [HAIR_MARK];
    const { media } = await render('en');
    const fixed = media.fixed as { parts: Array<Record<string, unknown>> };
    expect(fixed.parts.map((p) => p.desc)).toEqual([null, 'Pink bob', null]);
    expect(JSON.stringify(fixed)).not.toMatch(/[가-힣]/);
    expectNothingPrivate(media);
  });

  it('without marks the parts are still named, and the default beats stay', async () => {
    const { media } = await render('ko');
    const fixed = media.fixed as { parts: Array<Record<string, unknown>> };
    expect(fixed.parts.map((p) => p.key)).toEqual(['product', 'hair', 'shots-2-3']);
    expect((media.keyframes as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});

describe('a template that styles the hair and makeup (S2, docs/PERSONAL-STUDIO.md §3.4.9)', () => {
  const STYLE_TAIL = 'a sleek low bun PRIVATE-STYLE-TAIL';
  const STYLING = renderStylingBlock([
    { part: 'hair', from: 'template', note: STYLE_TAIL },
    { part: 'makeup', from: 'template', note: 'soft rosy cheeks PRIVATE-MAKEUP-TAIL' },
    { part: 'outfit', from: 'photo' },
  ]);
  const PROP_LOCK = renderLockBlock([{ kind: 'slot', slot: 'prop', note: 'a silver microphone PRIVATE-PROP-TAIL' }]);
  const STYLE_PRIVATE = ['Template styling', 'Styled by the template', 'Taken from the photo', 'PRIVATE-STYLE-TAIL', 'PRIVATE-MAKEUP-TAIL', 'PRIVATE-PROP-TAIL', 'sleek low bun', 'rosy cheeks', 'silver microphone'];
  const expectNoStyleWords = (value: unknown) => {
    const serialised = typeof value === 'string' ? value : JSON.stringify(value);
    for (const needle of STYLE_PRIVATE) expect(serialised.includes(needle), needle).toBe(false);
  };

  it('the card carries names only; the studio gets the styling and the parts with the choice, flag on or off', async () => {
    state.card = toPromptCard(row(`${BODY}\n\n${PROP_LOCK}\n\n${STYLING}`), { publicUrl: () => null });
    expect(state.card.styling).toEqual({ styled: ['hair', 'makeup'], photo: ['outfit'] });
    expect(Object.keys(state.card.styling!).sort()).toEqual(['photo', 'styled']);
    for (const flag of [false, true]) {
      state.flag = flag;
      state.keyframes = [{ index: 0, timeSeconds: 1, endSeconds: 2, part: 'hair', labelKo: '낮게 묶은 머리', labelEn: 'Low bun' }];
      const { html, live, props, media } = await render('ko');
      expect(live.styling).toEqual({ styled: ['hair', 'makeup'], photo: ['outfit'] });
      expect(live.lockCopy).toEqual(ko.editSheet);
      const parts = live.parts as { rows: Array<Record<string, unknown>>; all: boolean; copy: Record<string, string> };
      expect(parts.all).toBe(false);
      expect(parts.rows.map((r) => [r.key, r.state, r.choice, r.desc])).toEqual([
        ['prop', 'locked', false, null],
        ['hair', 'styled', true, '낮게 묶은 머리'],
        ['makeup', 'styled', true, null],
        ['outfit', 'photo', false, null],
      ]);
      expect(parts.copy).toMatchObject({ template: ko.editSheet.styleTemplate, mine: ko.editSheet.styleMine, templateNote: ko.editSheet.styleTemplateNote, styled: ko.templates.fixed.styled, photo: ko.templates.fixed.photo });
      const fixed = media.fixed as { parts: Array<Record<string, unknown>> };
      expect(fixed.parts.map((p) => [p.key, p.state])).toEqual([['prop', 'locked'], ['hair', 'styled'], ['makeup', 'styled'], ['outfit', 'photo']]);
      expectNoStyleWords(props);
      expectNoStyleWords(media);
      expectNoStyleWords(html);
    }
  });

  it('styling without locks: no lock key, the styling, the parts', async () => {
    state.card = toPromptCard(row(`${BODY}\n\n${STYLING}`), { publicUrl: () => null });
    const { live } = await render('en');
    expect(Object.hasOwn(live, 'locks')).toBe(false);
    expect(live.styling).toEqual({ styled: ['hair', 'makeup'], photo: ['outfit'] });
    expect((live.parts as { copy: Record<string, string> }).copy).toMatchObject({ template: 'Template style', mine: 'From my photo', photo: 'From your photo' });
    expectNoStyleWords(live);
  });

  it('a malformed styling block claims nothing: no styling, no parts', async () => {
    state.card = toPromptCard(row(`${BODY}\n\nTemplate styling:\n- Styled by the template: the eyebrows — arched.`), { publicUrl: () => null });
    expect(Object.hasOwn(state.card, 'styling')).toBe(false);
    const { live, media } = await render('ko');
    for (const key of ['styling', 'parts', 'lockCopy', 'locks']) expect(Object.hasOwn(live, key), key).toBe(false);
    expect(Object.hasOwn(media, 'fixed')).toBe(false);
  });

  it('a template without a declaration hands over no styling or parts key', async () => {
    state.card = toPromptCard(row(BODY), { publicUrl: () => null });
    for (const flag of [false, true]) {
      state.flag = flag;
      const { live } = await render('ko');
      expect(Object.hasOwn(live, 'styling')).toBe(false);
      expect(Object.hasOwn(live, 'parts')).toBe(false);
    }
  });
});

describe('the template page leftovers (2026-11-24)', () => {
  it('a video template prints no genre chips; an unknown length is no length, never "0초"', async () => {
    state.card = { ...toPromptCard(row(BODY), { publicUrl: () => null }), useCase: ['mv', 'brand-ad'], runtimeSeconds: null };
    const { html, props } = await render('ko');
    expect(html).not.toContain('data-template-use-case');
    const styles = props[0]!.styles as Array<{ runtime: string }>;
    expect(styles[0]!.runtime).toBe('');
    expect(html).not.toContain('0초');
  });

  it('an image template keeps its genre chips', async () => {
    state.card = { ...toPromptCard(row(BODY), { publicUrl: () => null }), medium: 'image', useCase: ['mv', 'brand-ad'], runtimeSeconds: null };
    state.studio = [];
    const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale: 'ko', slug: 'serum-counter-locks' }) }));
    expect(html).toContain('data-template-use-case="mv"');
    expect(html).toContain('data-template-use-case="brand-ad"');
  });

  it('a video with a length still says it', async () => {
    state.card = toPromptCard(row(BODY), { publicUrl: () => null });
    const { props } = await render('ko');
    expect((props[0]!.styles as Array<{ runtime: string }>)[0]!.runtime).toBe('10');
  });
});
