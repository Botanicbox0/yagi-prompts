import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { CardPlaybackControl, shouldMountClip } from '@/components/prompts/card-media';
import { CARD_RATIOS, cardAspect, cardAuthor, cardFrame, railOrder } from '@/components/prompts/card-frame';
import { pillClassName } from '@/components/prompts/pill';
import { PromptRail } from '@/components/prompts/rails';
import { UseCaseFilter } from '@/components/prompts/filter-chips';
import { MediumTabs, TemplatesListing } from '@/components/templates/listing';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';

/**
 * docs/PLATFORM-2.0.md §15.3-4·5 and the founder's 2026-10-23 decision: a portrait template is a
 * 4:5 card in two columns, 16:9 is for landscape templates only, and the card says what the
 * reader gets (title · length · ratio · NEW) — not which engine made it or who at the studio did.
 */

const NOW = new Date('2026-10-23T00:00:00.000Z');

const dicts = { en: getDictionary('en'), ko: getDictionary('ko') } as const;

function card(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    authorHandle: null,
    source: 'yagi',
    models: ['seedance-2.5'],
    modelLabels: [PROMPT_MODEL_LABEL],
    useCase: ['cinematic'],
    medium: 'video',
    priceCents: 400,
    priceKrw: 0,
    price1080Cents: 0,
    price1080Krw: 0,
    runtimeSeconds: 15,
    engine: null,
    aspectDefault: '9:16',
    poster: { source: 'route', src: '/api/prompts/media/x%3Aposter', mime: 'image/png', w: 1080, h: 1920 },
    video: { source: 'route', src: '/api/prompts/media/x%3Avideo', mime: 'video/mp4' },
    lock: null,
    featured: true,
    publishedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

function markup(data: PromptCard, locale: 'en' | 'ko' = 'en') {
  const dict = dicts[locale];
  return renderToStaticMarkup(
    <PromptCardView
      card={data}
      locale={locale}
      labels={promptLabels(dict)}
      useCaseLabels={Object.fromEntries(USE_CASES.map((v) => [v, useCaseLabel(dict, v)]))}
      now={NOW}
    />,
  );
}

describe('card frame (founder 2026-10-23: portrait → 4:5, landscape → 16:9)', () => {
  it('frames a portrait or square example at 4:5 and a wide one at 16:9', () => {
    expect(cardFrame(card())).toBe('portrait');
    expect(cardFrame(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1080, h: 1080 } }))).toBe('portrait');
    expect(cardFrame(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1600, h: 900 } }))).toBe('landscape');
    expect(cardFrame(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1440, h: 1080 } }))).toBe('landscape');
  });

  it('trusts the measured example over the generation default, then the default, then the medium', () => {
    // The example is what sits in the frame; aspectDefault is what the studio opens with.
    expect(cardFrame(card({ aspectDefault: '16:9' }))).toBe('portrait');
    expect(cardFrame(card({ poster: null, video: null, aspectDefault: '16:9' }))).toBe('landscape');
    expect(cardFrame(card({ poster: null, video: null, aspectDefault: null }))).toBe('portrait');
    expect(cardFrame(card({ poster: null, video: null, aspectDefault: null, medium: 'image' }))).toBe('portrait');
  });

  it('renders the chosen ratio and crops a portrait clip to fill it', () => {
    const tall = markup(card());
    expect(tall).toContain(`aspect-ratio:${CARD_RATIOS.portrait}`);
    expect(tall).toContain('data-frame="portrait"');
    expect(tall).toContain('object-cover');
    const wide = markup(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1600, h: 900 }, aspectDefault: '16:9' }));
    expect(wide).toContain(`aspect-ratio:${CARD_RATIOS.landscape}`);
    expect(wide).toContain('data-frame="landscape"');
    expect(CARD_RATIOS).toEqual({ portrait: '4 / 5', landscape: '16 / 9' });
  });
});

describe('card content (§15.3-4·5)', () => {
  it('carries the title, a length chip, a ratio chip and the NEW badge — and nothing else', () => {
    const html = markup(card());
    expect(html).toContain('Neon alley dolly');
    expect(html).toMatch(/data-card-duration[^>]*>15s</);
    expect(html).toMatch(/data-card-aspect[^>]*>9:16</);
    expect(html).toContain('data-badge="new"');
    expect(markup(card(), 'ko')).toMatch(/data-card-duration[^>]*>15초</);
  });

  it('names no engine, no studio credit, no use-case row and no "view template" button', () => {
    const html = markup(card());
    expect(html).not.toContain('data-model-chip');
    expect(html).not.toContain(PROMPT_MODEL_LABEL);
    expect(html).not.toContain('data-card-detail');
    expect(html).not.toContain(dicts.en.prompts.cardDetail);
    expect(html).not.toContain(dicts.en.prompts.byYagi);
    expect(markup(card(), 'ko')).not.toContain(dicts.ko.prompts.byYagi);
    expect(html).not.toContain(useCaseLabel(dicts.en, 'cinematic'));
    // The typographic fallback used the engine as its kicker; it does not any more.
    expect(markup(card({ poster: null, video: null }))).not.toContain(PROMPT_MODEL_LABEL);
  });

  it('is one link: a single anchor, stretched over the card, no secondary CTA', () => {
    const html = markup(card());
    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html).toContain('href="/en/t/neon-alley-dolly"');
    expect(html).toContain('after:absolute');
  });

  it('drops the length chip where a length means nothing', () => {
    expect(markup(card({ medium: 'image', runtimeSeconds: null, aspectDefault: '4:5' }))).not.toContain('data-card-duration');
    expect(markup(card({ runtimeSeconds: null }))).not.toContain('data-card-duration');
    expect(cardAspect(card({ aspectDefault: null }))).toBe('9:16');
    expect(cardAspect(card({ aspectDefault: null, medium: 'image' }))).toBe('4:5');
  });
});

describe('creator credit (PLATFORM-2.0 §7.5: only creator formats say who made them)', () => {
  it('stays silent on a studio format', () => {
    expect(cardAuthor(card())).toBeNull();
    expect(markup(card())).not.toContain('data-card-author');
  });

  it('credits @handle on a creator format, and says "creator format" when there is no handle', () => {
    expect(cardAuthor(card({ source: 'community', authorHandle: 'hana' }))).toEqual({ handle: 'hana' });
    expect(markup(card({ source: 'community', authorHandle: 'hana' }), 'ko')).toMatch(/data-card-author[^>]*>작가 @hana</);
    expect(markup(card({ source: 'yagi', authorHandle: 'hana' }))).toContain('data-card-author');
    expect(markup(card({ source: 'community', authorHandle: null }), 'ko')).toContain(dicts.ko.prompts.cardAuthorAnonymous);
  });
});

describe('card playback (viewport autoplay with a visible stop control)', () => {
  it('mounts the clip only in view, never against reduced motion, and never after the reader stopped it', () => {
    expect(shouldMountClip({ inView: true, intent: 'auto', autoplay: true })).toBe(true);
    expect(shouldMountClip({ inView: false, intent: 'auto', autoplay: true })).toBe(false);
    expect(shouldMountClip({ inView: true, intent: 'auto', autoplay: false })).toBe(false);
    expect(shouldMountClip({ inView: true, intent: 'pause', autoplay: true })).toBe(false);
    // Pressing play is a choice, so it plays even under reduced motion — while the card is on screen.
    expect(shouldMountClip({ inView: true, intent: 'play', autoplay: false })).toBe(true);
    expect(shouldMountClip({ inView: false, intent: 'play', autoplay: false })).toBe(false);
  });

  it('is a 44px button that says what it will do, above the stretched link', () => {
    const labels = { play: 'Play video', pause: 'Pause video' };
    const playing = renderToStaticMarkup(<CardPlaybackControl playing labels={labels} onToggle={() => {}} />);
    expect(playing).toContain('<button');
    expect(playing).toContain('type="button"');
    expect(playing).toContain('aria-label="Pause video"');
    expect(playing).toContain('data-card-control="pause"');
    expect(playing).toContain('min-h-11');
    expect(playing).toContain('min-w-11');
    expect(playing).toContain('z-10');
    const stopped = renderToStaticMarkup(<CardPlaybackControl playing={false} labels={labels} onToggle={() => {}} />);
    expect(stopped).toContain('aria-label="Play video"');
  });
});

describe('rails: NEW first, two columns on a phone', () => {
  const old = (slug: string) => card({ slug, publishedAt: '2026-01-01T00:00:00.000Z' });

  it('moves NEW cards to the front and keeps the catalog order inside each group', () => {
    const ordered = railOrder([old('a'), card({ slug: 'n1' }), old('b'), card({ slug: 'n2' })], NOW);
    expect(ordered.map((c) => c.slug)).toEqual(['n1', 'n2', 'a', 'b']);
  });

  it('renders that order in a two-column grid that never scrolls sideways', () => {
    const dict = dicts.en;
    const html = renderToStaticMarkup(
      <PromptRail
        id="video"
        heading="Video"
        lede=""
        cards={[old('a'), card({ slug: 'n1' })]}
        locale="en"
        labels={promptLabels(dict)}
        useCaseLabels={{}}
        emptyLabel=""
        filteredEmptyLabel=""
        now={NOW}
      />,
    );
    expect(html.indexOf('data-prompt-card="n1"')).toBeLessThan(html.indexOf('data-prompt-card="a"'));
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('lg:grid-cols-4');
    expect(html).toMatch(/<li[^>]*class="[^"]*min-w-0/);
  });
});

describe('catalog first screen (§15.3-5)', () => {
  const listing = (cards: PromptCard[]) =>
    renderToStaticMarkup(<TemplatesListing locale="ko" dict={dicts.ko} medium="video" cards={cards} />);

  it('keeps the GEO definition in the HTML, but below the grid', () => {
    const html = listing([card(), card({ slug: 'second', useCase: ['mv'] })]);
    const definition = html.indexOf('data-service-definition');
    expect(definition).toBeGreaterThan(-1);
    expect(html).toContain(dicts.ko.seo.definition);
    expect(definition).toBeGreaterThan(html.lastIndexOf('data-prompt-card='));
  });

  it('hides the chip row when every template shares one use case, and keeps the count line', () => {
    const one = listing([card(), card({ slug: 'second' })]);
    expect(one).not.toContain('role="group"');
    expect(one).toContain('2개 템플릿');
    const two = listing([card(), card({ slug: 'second', useCase: ['mv'] })]);
    expect(two).toContain('role="group"');
    expect(two).toContain('2개 템플릿');
  });

  it('draws the medium segment and the use-case chips as the same pill', () => {
    expect(pillClassName(true)).toContain('rounded-full');
    expect(pillClassName(true)).not.toBe(pillClassName(false));
    const tabs = renderToStaticMarkup(<MediumTabs locale="ko" dict={dicts.ko} active="video" />);
    expect(tabs).toContain(`class="${pillClassName(true)}"`);
    expect(tabs).toContain(`class="${pillClassName(false)}"`);
    const chips = renderToStaticMarkup(
      <UseCaseFilter options={[['cinematic', 'Cinematic'], ['mv', 'MV']]} total={2} labels={{ heading: 'Use', all: 'All', count: '{count} templates', reset: 'Reset' }} />,
    );
    expect(chips).toContain(pillClassName(true));
    expect(chips).toContain(pillClassName(false));
  });

  it('a single option renders the count but no chips', () => {
    const html = renderToStaticMarkup(
      <UseCaseFilter options={[['cinematic', 'Cinematic']]} total={9} labels={{ heading: 'Use', all: 'All', count: '{count} templates', reset: 'Reset' }} />,
    );
    expect(html).not.toContain('<button');
    expect(html).toContain('9 templates');
  });
});
