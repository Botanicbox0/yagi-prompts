import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { KO_TERMS } from '@/messages/ko';
import { EN_TERMS } from '@/messages/en';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { CardPlaybackControl, shouldMountClip } from '@/components/prompts/card-media';
import { CARD_RATIO, cardAspect, cardAuthor, makerProfileRest, railOrder } from '@/components/prompts/card-frame';
import { PromptRail } from '@/components/prompts/rails';
import { MediumTabs, TemplatesListing } from '@/components/templates/listing';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';

/**
 * docs/PLATFORM-2.0.md §15.3-4·5 and §15.6 (founder 2026-10-28): every template sits in the same
 * 4:5 card, two columns on a phone and four from a tablet up, and the card says what the reader
 * gets (title · length · ratio · NEW) — not which engine made it or who at the studio did.
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
    origin: 'studio',
    makerProfile: false,
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

describe('card frame (founder 2026-10-28: one 4:5 frame for every card)', () => {
  const still = (w: number, h: number) => ({ source: 'route' as const, src: '/p', mime: 'image/png', w, h });
  const shapes = {
    '9:16': card(),
    '1:1': card({ poster: still(1080, 1080), aspectDefault: '1:1' }),
    '16:9': card({ poster: still(1600, 900), aspectDefault: '16:9' }),
    '4:3': card({ poster: still(1440, 1080), aspectDefault: '4:3' }),
    'no still': card({ poster: null, video: null, aspectDefault: '16:9' }),
  };

  it('gives tall, square and wide templates the same 4:5 window', () => {
    expect(CARD_RATIO).toBe('4 / 5');
    for (const [shape, data] of Object.entries(shapes)) {
      const html = markup(data);
      expect(html, shape).toContain(`aspect-ratio:${CARD_RATIO}`);
      expect(html, shape).toContain('data-frame="portrait"');
      expect(html, shape).not.toContain('data-frame="landscape"');
      expect(html, shape).not.toContain('16 / 9');
    }
  });

  it('crops to fill instead of letterboxing, a little above centre so heads stay in', () => {
    for (const data of [shapes['9:16'], shapes['16:9'], shapes['4:3']]) {
      const html = markup(data);
      expect(html).toContain('object-cover');
      expect(html).toContain('object-[50%_35%]');
      expect(html).not.toContain('object-contain');
    }
  });

  it('still tells the buyer the real output shape on the ratio chip', () => {
    expect(markup(shapes['16:9'])).toMatch(/data-card-aspect[^>]*>16:9</);
    expect(markup(shapes['4:3'])).toMatch(/data-card-aspect[^>]*>4:3</);
    expect(markup(shapes['9:16'])).toMatch(/data-card-aspect[^>]*>9:16</);
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

describe('maker credit (PLATFORM-2.0 §7.5·§14.1: only maker templates say who made them)', () => {
  it('stays silent on a studio template', () => {
    expect(cardAuthor(card())).toBeNull();
    expect(markup(card())).not.toContain('data-card-author');
  });

  it('credits "by @handle" on a maker template, and the maker label without a public handle', () => {
    const maker = card({ origin: 'maker', source: 'community', authorHandle: 'hana' });
    expect(cardAuthor(maker)).toEqual({ handle: 'hana' });
    expect(markup(maker, 'ko')).toContain(`>${KO_TERMS.creditPrefix} @hana<`);
    expect(markup(maker, 'en')).toContain(`>${EN_TERMS.creditPrefix} @hana<`);
    // A maker template is a `source='yagi'` row with an author (0046): origin decides, not source.
    expect(markup(card({ origin: 'maker', source: 'yagi', authorHandle: null }), 'ko')).toContain(dicts.ko.prompts.cardAuthorAnonymous);
    expect(dicts.ko.prompts.cardAuthorAnonymous).toContain(KO_TERMS.maker);
    expect(markup(card({ origin: 'studio', authorHandle: 'hana' }))).not.toContain('data-card-author');
  });

  it('links a profile only for a maker who opted in', () => {
    expect(makerProfileRest(card({ origin: 'maker', authorHandle: 'hana', makerProfile: true }))).toBe('/makers/hana');
    expect(makerProfileRest(card({ origin: 'maker', authorHandle: 'hana', makerProfile: false }))).toBeNull();
    expect(makerProfileRest(card({ origin: 'studio', authorHandle: 'hana', makerProfile: true }))).toBeNull();
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

describe('rails: NEW first, two columns on a phone, four from a tablet', () => {
  const old = (slug: string) => card({ slug, publishedAt: '2026-01-01T00:00:00.000Z' });

  it('moves NEW cards to the front and keeps the catalog order inside each group', () => {
    const ordered = railOrder([old('a'), card({ slug: 'n1' }), old('b'), card({ slug: 'n2' })], NOW);
    expect(ordered.map((c) => c.slug)).toEqual(['n1', 'n2', 'a', 'b']);
  });

  it('renders that order in a 2 → 4 column grid that never scrolls sideways', () => {
    const dict = dicts.en;
    const html = renderToStaticMarkup(
      <PromptRail
        id="video"
        heading="Video"
        lede=""
        cards={[old('a'), card({ slug: 'n1' })]}
        locale="en"
        labels={promptLabels(dict)}
        emptyLabel=""
        now={NOW}
      />,
    );
    expect(html.indexOf('data-prompt-card="n1"')).toBeLessThan(html.indexOf('data-prompt-card="a"'));
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('md:grid-cols-4');
    // No three-column step: a rail that fills a desktop row of four fills two phone rows too.
    expect(html).not.toContain('grid-cols-3');
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

  it('has no chip rows — however many use cases and origins the cards span (founder 2026-10-28)', () => {
    const maker = card({ slug: 'maker-one', origin: 'maker', source: 'yagi', authorHandle: 'hana', makerProfile: true, useCase: ['ugc'] });
    const html = listing([card(), card({ slug: 'second', useCase: ['mv'] }), maker]);
    for (const marker of ['data-use-case-filter', 'data-origin-filter', 'data-filter-count', 'data-use-case=', 'aria-pressed', 'role="group"']) {
      expect(html, marker).not.toContain(marker);
    }
    expect(html).toContain('data-medium-tabs');
    // Every card ships visible: nothing on this page hides one any more.
    expect(html).not.toMatch(/<(li|section)[^>]*\shidden/);
  });

  it('draws the medium switch as two text tabs on a hairline, not a pair of pills', () => {
    const tabs = renderToStaticMarkup(<MediumTabs locale="ko" dict={dicts.ko} active="video" />);
    expect(tabs).toMatch(/<nav[^>]*aria-label="결과물 종류"/);
    expect(tabs).toMatch(/data-medium-tab="video"[^>]*aria-current="page"/);
    expect(tabs).not.toMatch(/data-medium-tab="image"[^>]*aria-current/);
    expect(tabs).toContain('border-b border-hairline');
    expect(tabs).toContain('border-black text-black');
    expect(tabs).not.toContain('rounded-full');
    expect(tabs).not.toContain('bg-accent');
    expect(tabs).toContain(`>${dicts.ko.nav.video}<`);
    expect(tabs).toContain(`>${dicts.ko.nav.image}<`);
  });
});

describe('studio and maker collections (PLATFORM-2.0 §7.5·§14.1)', () => {
  const listing = (cards: PromptCard[], locale: 'ko' | 'en' = 'ko') =>
    renderToStaticMarkup(<TemplatesListing locale={locale} dict={dicts[locale]} medium="video" cards={cards} />);
  const maker = (slug: string, handle: string | null = 'hana') =>
    card({ slug, origin: 'maker', source: 'yagi', authorHandle: handle, makerProfile: handle !== null });

  it('with no maker template, there is no maker rail and no rail heading change', () => {
    const html = listing([card(), card({ slug: 'second' })]);
    expect(html).not.toContain('data-rail-origin="maker"');
    expect(html).not.toContain('data-origin-filter');
    expect(html).not.toContain(dicts.ko.templates.makerRail);
    expect(html).toContain('data-rail-origin="studio"');
  });

  it('puts the studio rail first and the maker rail second, with no origin chips over them', () => {
    const html = listing([card(), maker('maker-one')]);
    const studio = html.indexOf('data-rail-origin="studio"');
    const makers = html.indexOf('data-rail-origin="maker"');
    expect(studio).toBeGreaterThan(-1);
    expect(makers).toBeGreaterThan(studio);
    expect(html.indexOf('data-prompt-card="neon-alley-dolly"')).toBeLessThan(makers);
    expect(html.indexOf('data-prompt-card="maker-one"')).toBeGreaterThan(makers);
    // §15.6: the rails' own headings say where a template comes from; the chips are gone.
    expect(html).not.toContain('data-origin-filter');
    expect(html).not.toContain('<button');
    expect(html).toContain(`>${dicts.ko.templates.studioRail}<`);
    expect(html).toContain(`>${dicts.ko.templates.makerRail}<`);
    expect([dicts.ko.templates.studioRail, dicts.ko.templates.makerRail]).toEqual([KO_TERMS.studioCollection, KO_TERMS.makerCollection]);
    expect(listing([card(), maker('maker-one')], 'en')).toContain(`>${EN_TERMS.makerCollection}<`);
  });

  it('a maker-only catalogue still opens on its maker rail without an empty studio rail', () => {
    const html = listing([maker('maker-one')]);
    expect(html).toContain('data-rail-origin="maker"');
    expect(html).not.toContain('data-rail-origin="studio"');
  });
});
