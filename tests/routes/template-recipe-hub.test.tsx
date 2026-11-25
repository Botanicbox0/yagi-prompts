import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicRecipe } from '@/lib/recipes/public';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * `/[locale]/t/[slug]` for a creative's template with a public recipe (2026-10-29). Story-first: the
 * result, then how it was made, then "one selfie" with the make box — no cost ahead of the recipe.
 * Make-first: the copy-or-make fork sits under the title, ahead of the make card, both lead somewhere
 * real (`#recipe`, `#make`). The maker block speaks the page's language.
 */

const state = vi.hoisted(() => ({ recipe: null as PublicRecipe | null }));
const film = vi.hoisted(() => ({
  id: 'goldfish', slug: 'aquarium-goldfish-daydream', title: 'Aquarium Goldfish Daydream', titleKo: '어항 속 금붕어 백일몽', medium: 'video',
  engine: 'seedance-2.5', runtimeSeconds: 10, aspectDefault: '4:3', priceCents: 293, priceKrw: 4100, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', origin: 'maker', authorHandle: 'yunseolfromseoul', makerProfile: true, recipeOpen: true, models: [], modelLabels: [], useCase: [],
  poster: null, video: null, lock: null, featured: false, publishedAt: null,
}));
const makers = vi.hoisted(() => [{
  handle: 'yunseolfromseoul', bio: '서울의 AI 크리에이티브.', bioEn: 'Seoul-based AI creative.', displayName: 'Yunseol', headline: 'HEADLINE_STAYS_ON_PROFILE', country: 'KR', city: 'CITY_STAYS_ON_PROFILE',
  links: [], publicEmail: null, tools: [], openToBrands: true, avatar: null, cover: null, templateCount: 1, openRecipeCount: 1, latestPublishedAt: null,
}]);
vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', () => ({ RENDER_PIPELINE_MODE: 'off', RENDER_PIPELINE_PUBLIC: false, personalEditSheetOpen: () => false, templateLookOpen: () => false }));
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

describe('a story-first template with a public recipe', () => {
  it('reads result → how it was made → one selfie with the make box', async () => {
    const html = await page('en');
    const recipe = html.indexOf('data-template-recipe="story-first"');
    const launcher = html.indexOf('data-template-make-launcher');
    const strip = html.indexOf('data-template-transform');
    expect(recipe).toBeGreaterThan(html.indexOf('data-template-credit'));
    expect(html.indexOf('data-recipe-how')).toBeGreaterThan(recipe);
    expect(launcher).toBeGreaterThan(html.indexOf('data-recipe-how'));
    // The selfie promise left the stage: it opens the make box, under the recipe.
    expect(html.split('data-template-transform').length - 1).toBe(1);
    expect(strip).toBeGreaterThan(launcher);
    expect(strip).toBeLessThan(html.indexOf('id="make"'));
    expect(html.slice(launcher, strip)).toContain('data-make-lead');
    // The recipe is right there, so no fork pointing down to it.
    expect(html).not.toContain('data-template-recipe-actions');
    expect(html).toContain('id="recipe"');
  });

  // Founder 2026-10-30: "그 maker가 만든거라는 명시와 제작자 프로필 볼 수 있게 정도 간단하게".
  it('credits the creative in one line under the title — who made it and the way to their profile, nothing more', async () => {
    for (const [locale, dict] of [['en', en], ['ko', ko]] as const) {
      const html = await page(locale);
      const row = html.indexOf('data-template-maker="yunseolfromseoul"');
      expect(row).toBeGreaterThan(html.indexOf('<h1'));
      expect(row).toBeLessThan(html.indexOf('data-template-recipe="story-first"'));
      expect(html.split('data-template-maker=').length - 1).toBe(1);
      expect(html.split('data-template-credit').length - 1).toBe(1);
      const line = html.slice(row, html.indexOf('</a>', row));
      expect(line).toContain(dict.templates.makerBlockHeading);
      expect(line).toContain('Yunseol');
      expect(line).toContain('@yunseolfromseoul');
      expect(line).toContain(dict.templates.makerBlockCta);
      expect(html).toContain(`href="/${locale}/makers/yunseolfromseoul"`);
      // The bio, headline, place and the brand chip live on the profile page, not here.
      for (const profileOnly of ['Seoul-based AI creative.', '서울의 AI 크리에이티브.', 'HEADLINE_STAYS_ON_PROFILE', 'CITY_STAYS_ON_PROFILE', dict.makers.openToBrands]) {
        expect(html).not.toContain(profileOnly);
      }
    }
    expect(await page('ko')).toContain(ko.makerRecipe.how.gateCta);
  });

  // Founder 2026-11-02: an original shows the handle an admin typed — plain text, no title, no link.
  it('credits an original with "by @handle" as plain text, and keeps "TWINGS Original" without a handle', async () => {
    const saved = { origin: film.origin, makerProfile: film.makerProfile, authorHandle: film.authorHandle };
    try {
      Object.assign(film, { origin: 'studio', makerProfile: false, authorHandle: 'dana.original' });
      for (const [locale, dict] of [['en', en], ['ko', ko]] as const) {
        const html = await page(locale);
        expect(html).toMatch(/data-template-credit[^>]*>by @dana\.original</);
        expect(html).not.toContain('data-template-maker');
        expect(html).not.toContain('/makers/dana.original');
        expect(html).not.toContain('instagram.com');
        expect(html).not.toContain(dict.prompts.byYagi);
      }
      Object.assign(film, { authorHandle: null });
      expect(await page('ko')).toContain(ko.prompts.byYagi);
    } finally {
      Object.assign(film, saved);
    }
  });

  it("keeps the members' prompt out of the page: only the gate's teaser is in the HTML", async () => {
    const html = await page('en');
    expect(html).not.toContain('MEMBERS_ONLY_TAIL');
    expect(html).toContain('data-recipe-gate');
  });

  it('keeps the make-first order: the fork under the title, the strip under the stage, the recipe later', async () => {
    state.recipe = { ...state.recipe!, presentation: 'make-first' };
    const html = await page('en');
    const actions = html.indexOf('data-template-recipe-actions');
    expect(actions).toBeGreaterThan(html.indexOf('data-template-credit'));
    expect(actions).toBeLessThan(html.indexOf('id="make"'));
    expect(html).toContain('data-recipe-signin');
    expect(html).toContain('data-recipe-make');
    expect(html).toContain(en.makerRecipe.actions.makeClosed);
    expect(html).toContain(en.makerRecipe.actions.copySignedOut);
    expect(html.indexOf('data-template-transform')).toBeLessThan(html.indexOf('data-template-make-launcher'));
    expect(html).not.toContain('data-make-lead');
    expect(html.indexOf('data-template-recipe="make-first"')).toBeGreaterThan(html.indexOf('id="make"'));
  });

  it('has no fork without a public prompt', async () => {
    state.recipe = null;
    const html = await page('en');
    expect(html).not.toContain('data-template-recipe-actions');
    expect(html).not.toContain('id="recipe"');
  });

  // docs/PERSONAL-STUDIO.md §3.3–§3.4.9: the teaser shows the `[BGM …]` tail of step 1, where a declared template's
  // lock and styling blocks sit; neither is customer copy.
  it('shows the recipe teaser without the lock and styling blocks', async () => {
    const blocks = ['Template locks:', '- Keep exactly as in the template: the product.', '', 'Template styling:', '- Styled by the template: the hairstyle — a sleek low bun.'].join('\n');
    state.recipe = { ...state.recipe!, steps: [{ ...state.recipe!.steps![0]!, prompt: `${state.recipe!.steps![0]!.prompt}\n[BGM soft piano]\n\n${blocks}` }] };
    for (const locale of ['ko', 'en'] as const) {
      const html = await page(locale);
      expect(html).toContain('[BGM soft piano]');
      expect(html).not.toMatch(/Template (locks|styling):|Keep exactly as in the template|Styled by the template|sleek low bun/);
    }
  });
});
