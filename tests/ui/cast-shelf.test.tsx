import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptCard } from '@/lib/prompts/catalog';
import { getDictionary } from '@/lib/i18n/dictionaries';

vi.mock('server-only', () => ({}));
const catalog = { video: [] as PromptCard[], image: [] as PromptCard[] };
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => catalog }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));

const { CastShelfSection, HOME_CAST_CARDS } = await import('@/components/templates/cast-shelf');
const { CastPage } = await import('@/components/templates/cast-page');

function card(slug: string, medium: 'video' | 'image', cast: 'solo' | 'pet' | 'couple'): PromptCard {
  return {
    id: slug, slug, title: slug, titleKo: null, authorHandle: null, origin: 'studio', makerProfile: false, source: 'yagi',
    models: [], modelLabels: [], useCase: ['vlog'], medium, cast, priceCents: 400, priceKrw: 5900, price1080Cents: 0, price1080Krw: 0,
    runtimeSeconds: medium === 'video' ? 10 : null, engine: null, aspectDefault: medium === 'video' ? '9:16' : '4:5',
    poster: null, video: null, lock: null, featured: false, publishedAt: '2026-11-10T00:00:00.000Z',
  } as PromptCard;
}

describe('cast shelves (docs/CAST-CATEGORIES.md §5)', () => {
  const dict = getDictionary('ko');
  afterEach(() => { vi.unstubAllEnvs(); catalog.video = []; catalog.image = []; });

  it('an empty cast draws nothing at all — no empty shelf', () => {
    expect(renderToStaticMarkup(<CastShelfSection locale="ko" dict={dict} cast="pet" shelf={{ video: [], image: [] }} mode="home" />)).toBe('');
  });

  it('the split is obvious: a labelled 영상 rail and a labelled 이미지 rail, no price on any card', () => {
    const shelf = { video: [card('pv1', 'video', 'pet')], image: [card('pi1', 'image', 'pet'), card('pi2', 'image', 'pet')] };
    const html = renderToStaticMarkup(<CastShelfSection locale="ko" dict={dict} cast="pet" shelf={shelf} mode="page" />);
    expect(html).toContain('data-cast-rail="pet-video"');
    expect(html).toContain('data-cast-rail="pet-image"');
    expect(html.indexOf('data-cast-rail="pet-video"')).toBeLessThan(html.indexOf('data-cast-rail="pet-image"'));
    expect(html).toContain('반려동물과 함께');
    expect(html).toContain('data-cast-jump');
    expect(html).not.toContain('5,900원');
    expect(html).not.toMatch(/AI 생성/);
  });

  it('a medium with no template draws no rail', () => {
    const html = renderToStaticMarkup(<CastShelfSection locale="ko" dict={dict} cast="pet" shelf={{ video: [], image: [card('pi1', 'image', 'pet')] }} mode="page" />);
    expect(html).not.toContain('data-cast-rail="pet-video"');
    expect(html).not.toContain('data-cast-jump');
  });

  it('home shows a few cards per medium and links to the cast page', () => {
    const many = Array.from({ length: HOME_CAST_CARDS + 3 }, (_, i) => card(`pv${i}`, 'video', 'pet'));
    const html = renderToStaticMarkup(<CastShelfSection locale="ko" dict={dict} cast="pet" shelf={{ video: many, image: [] }} mode="home" />);
    expect((html.match(/data-prompt-card="/g) ?? []).length).toBe(HOME_CAST_CARDS);
    expect(html).toContain('href="/ko/pet"');
  });

  it('a listing shows only its own medium', () => {
    const shelf = { video: [card('pv1', 'video', 'pet')], image: [card('pi1', 'image', 'pet')] };
    const html = renderToStaticMarkup(<CastShelfSection locale="en" dict={getDictionary('en')} cast="pet" shelf={shelf} mode="listing" medium="image" />);
    expect(html).toContain('data-cast-rail="pet-image"');
    expect(html).not.toContain('data-cast-rail="pet-video"');
  });

  it('the couple page is a 404 while the flag is off, even with couple templates in hand', async () => {
    vi.stubEnv('TWINGS_COUPLE_TEMPLATES', '');
    catalog.image = [card('ci1', 'image', 'couple')];
    await expect(CastPage({ locale: 'ko', cast: 'couple' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('the pet page is a 404 while the pet flag is off, even with pet templates in hand', async () => {
    vi.stubEnv('TWINGS_PET_TEMPLATES', '');
    catalog.video = [card('pv1', 'video', 'pet')];
    await expect(CastPage({ locale: 'ko', cast: 'pet' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('pets on: a 404 with no pet template; renders with one', async () => {
    vi.stubEnv('TWINGS_PET_TEMPLATES', 'on');
    await expect(CastPage({ locale: 'ko', cast: 'pet' })).rejects.toThrow('NEXT_NOT_FOUND');
    catalog.video = [card('pv1', 'video', 'pet')];
    const html = renderToStaticMarkup(await CastPage({ locale: 'ko', cast: 'pet' }));
    expect(html).toContain('data-cast-page="pet"');
    expect(html).toContain('"@type":"CollectionPage"');
  });

  it('with the flag on, the couple page renders its rails', async () => {
    vi.stubEnv('TWINGS_COUPLE_TEMPLATES', 'on');
    catalog.image = [card('ci1', 'image', 'couple')];
    const html = renderToStaticMarkup(await CastPage({ locale: 'ko', cast: 'couple' }));
    expect(html).toContain('data-cast-rail="couple-image"');
    expect(html).toContain('둘이서');
  });
});
