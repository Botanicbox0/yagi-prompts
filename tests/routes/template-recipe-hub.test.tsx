import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecipe } from '@/lib/recipes/public';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * `/[locale]/t/[slug]` for a creative's template with a public recipe (2026-10-29): the copy-or-make
 * fork sits under the title, ahead of the make card, both lead somewhere real (`#recipe`, `#make`),
 * and the maker block speaks the page's language.
 */

const state = vi.hoisted(() => ({ recipe: null as PublicRecipe | null }));
const film = vi.hoisted(() => ({
  id: 'goldfish', slug: 'aquarium-goldfish-daydream', title: 'Aquarium Goldfish Daydream', titleKo: '어항 속 금붕어 백일몽', medium: 'video',
  engine: 'seedance-2.5', runtimeSeconds: 10, aspectDefault: '4:3', priceCents: 293, priceKrw: 4100, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', origin: 'maker', authorHandle: 'yunseolfromseoul', makerProfile: true, recipeOpen: true, models: [], modelLabels: [], useCase: [],
  poster: null, video: null, lock: null, featured: false, publishedAt: null,
}));
const makers = vi.hoisted(() => [{ handle: 'yunseolfromseoul', bio: '서울의 AI 크리에이티브.', bioEn: 'Seoul-based AI creative.', templateCount: 1, openRecipeCount: 1, latestPublishedAt: null }]);
vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_MODE: 'off', RENDER_PIPELINE_PUBLIC: false }));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({
  cachedSubscriptionAvailability: async () => ({ status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [film], image: [], makers }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/lib/recipes/cached-public', () => ({ cachedPublicRecipe: async () => state.recipe }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/prompts/detail', () => ({ RelatedPrompts: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({ PromptDetailMedia: () => null }));
vi.mock('@/components/prompts/poster', () => ({ TypographicPoster: () => null, posterRatio: () => '4 / 3' }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';

const page = async (locale: 'ko' | 'en') => renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));

beforeEach(() => {
  state.recipe = { presentation: 'story-first', intro: null, outro: null, steps: [{ n: 1, kind: 'video', engine: 'SEEDANCE 2.5', inputs: [{ kind: 'selfie' }], prompt: `[My photo] among goldfish. ${'Shot detail. '.repeat(30)}MEMBERS_ONLY_TAIL`, note: null }], files: null };
});

describe('a template with a public recipe', () => {
  it('puts copy-or-make under the title, before the make card, and anchors the recipe', async () => {
    const html = await page('en');
    const actions = html.indexOf('data-template-recipe-actions');
    expect(actions).toBeGreaterThan(html.indexOf('data-template-credit'));
    expect(actions).toBeLessThan(html.indexOf('id="make"'));
    expect(html).toContain('data-recipe-signin');
    expect(html).toContain('data-recipe-make');
    expect(html).toContain(en.makerRecipe.actions.makeClosed);
    expect(html).toContain('id="recipe"');
    expect(html).toContain('data-template-recipe="story-first"');
  });

  it('shows the maker block in the page language', async () => {
    expect(await page('en')).toContain('Seoul-based AI creative.');
    const korean = await page('ko');
    expect(korean).toContain('서울의 AI 크리에이티브.');
    expect(korean).toContain(ko.makerRecipe.actions.copySignedOut);
  });

  it("keeps the members' prompt out of the page: only the gate's teaser is in the HTML", async () => {
    const html = await page('en');
    expect(html).not.toContain('MEMBERS_ONLY_TAIL');
    expect(html).toContain('data-recipe-gate');
  });

  it('has no fork without a public prompt', async () => {
    state.recipe = null;
    const html = await page('en');
    expect(html).not.toContain('data-template-recipe-actions');
    expect(html).not.toContain('id="recipe"');
  });
});
