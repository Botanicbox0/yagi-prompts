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

const state = vi.hoisted(() => ({ card: null as PromptCard | null, flag: false, studio: [] as Array<Record<string, unknown>> }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_MODE: 'off', RENDER_PIPELINE_PUBLIC: false, personalEditSheetOpen: () => state.flag }));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({
  cachedSubscriptionAvailability: async () => ({ status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [state.card], image: [], makers: [] }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/lib/recipes/cached-public', () => ({ cachedPublicRecipe: async () => null }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/prompts/detail', () => ({ RelatedPrompts: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({ PromptDetailMedia: () => null }));
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
  const html = renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: 'serum-counter-locks' }) }));
  expect(state.studio.length).toBeGreaterThan(0);
  return { html, live: state.studio[0]!.live as Record<string, unknown>, props: state.studio };
}

const PRIVATE = ['Template locks', 'Keep exactly as in the template', 'PRIVATE-PAGE-TAIL', 'pink chin-length bob', 'its shape, colour, label', 'action, framing, timing'];

function expectNothingPrivate(value: unknown): void {
  const serialised = typeof value === 'string' ? value : JSON.stringify(value);
  for (const needle of PRIVATE) expect(serialised.includes(needle), needle).toBe(false);
}

beforeEach(() => {
  state.flag = false;
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
      const { live } = await render('ko');
      expect(Object.hasOwn(live, 'locks')).toBe(false);
      expect(Object.hasOwn(live, 'lockCopy')).toBe(false);
      expect(Object.hasOwn(live, 'editSheet')).toBe(flag);
    }
  });
});
