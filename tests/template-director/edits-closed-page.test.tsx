import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';
import type { PromptCard } from '@/lib/prompts/catalog';
import type { PromptRow } from '@/lib/prompts/repo';

/**
 * Founder 2026-11-25 — a template whose text leaves no room for edits: the page hands the make card one line instead of
 * the edit panel. The harness is template-locks-page.test.tsx's: the card is built by the real `toPromptCard`, and the
 * studio (a client component) is replaced by a probe that records the props the page hands it. Filler text only.
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

const BODY = 'Timeline:\n[Shot 1 - Counter, 0.0-3.0s]:\n- @Image 1 picks up the serum bottle.';

function row(promptText: string): PromptRow {
  return {
    audience: 'public', id: 'tpl-page-edits', slug: 'serum-counter-locks', source: 'yagi', authorId: null, authorHandle: null,
    status: 'published', models: ['seedance-2.5'], title: 'Serum Counter', titleKo: '세럼 카운터', promptText,
    processMd: null, processMdKo: null, sourceUrl: null, textVisibility: 'hidden', media: null, useCase: [], featured: false,
    medium: 'video', cast: 'solo', priceCents: 2900, priceKrw: 39000, price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 10,
    engine: 'seedance-2.5', aspectDefault: '9:16', rejectReason: null, announcedAt: null, createdAt: null, publishedAt: null,
  };
}

const film = (chars: number) => `${BODY}\n${'x'.repeat(chars - BODY.length - 1)}`;

async function liveFor(chars: number, locale: 'ko' | 'en') {
  state.card = toPromptCard(row(film(chars)), { publicUrl: () => null });
  state.studio = [];
  renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: 'serum-counter-locks' }) }));
  return state.studio[0]!.live as Record<string, unknown>;
}

describe('the template page and a template with no room for edits', () => {
  beforeEach(() => { state.flag = false; state.keyframes = null; });

  it('hands the studio the one line, in each language, only for that template', async () => {
    expect((await liveFor(14_879, 'ko')).editsClosed).toBe(ko.templates.editsClosed);
    expect((await liveFor(14_879, 'en')).editsClosed).toBe(en.templates.editsClosed);
    expect(Object.hasOwn(await liveFor(9_000, 'ko'), 'editsClosed')).toBe(false);
  });
});
