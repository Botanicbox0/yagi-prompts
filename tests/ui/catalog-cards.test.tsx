import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { KO_TERMS } from '@/messages/ko';
import { EN_TERMS } from '@/messages/en';
import type { PromptCard } from '@/lib/prompts/catalog';
import { RECOMMENDED_IMAGE_ORDER, RECOMMENDED_LEAD, RECOMMENDED_VIDEO_ORDER } from '@/lib/prompts/recommended';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { CardPlaybackControl, shouldMountClip } from '@/components/prompts/card-media';
import { CARD_RATIOS, cardRatio, ORIGIN_RUN_MAX, cardAspect, cardAuthor, cardFrame, makerProfileRest, railOrder } from '@/components/prompts/card-frame';
import { pillClassName } from '@/components/prompts/pill';
import { PromptRail } from '@/components/prompts/rails';
import { applyListFilter, collapsedGroups, ListFilter } from '@/components/prompts/filter-chips';
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

describe('card frame (founder 2026-10-31: every card keeps the original ratio)', () => {
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
    expect(tall).toContain(`aspect-ratio:${cardRatio(card())}`);
    expect(tall).toContain('data-frame="portrait"');
    expect(tall).toContain('object-cover');
    const wide = markup(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1600, h: 900 }, aspectDefault: '16:9' }));
    expect(wide).toContain(`aspect-ratio:${16 / 9}`);
    expect(wide).toContain('data-frame="landscape"');
    expect(CARD_RATIOS).toEqual({ portrait: '4 / 5', landscape: '16 / 9' });
    expect(cardRatio(card({ poster: { source: 'route', src: '/p', mime: 'image/png', w: 1600, h: 900 } }))).toBeCloseTo(16 / 9);
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
    expect(markup(card())).toContain('data-card-origin="studio"');
  });

  it('credits "by @handle" on a maker template, and the maker label without a public handle', () => {
    const maker = card({ origin: 'maker', source: 'community', authorHandle: 'hana' });
    expect(cardAuthor(maker)).toEqual({ handle: 'hana' });
    expect(markup(maker, 'ko')).toContain(`>${KO_TERMS.creditPrefix} @hana<`);
    expect(markup(maker, 'en')).toContain(`>${EN_TERMS.creditPrefix} @hana<`);
    // A maker template is a `source='yagi'` row with an author (0046): origin decides, not source.
    expect(markup(card({ origin: 'maker', source: 'yagi', authorHandle: null }), 'ko')).toContain(dicts.ko.prompts.cardAuthorAnonymous);
    expect(dicts.ko.prompts.cardAuthorAnonymous).toContain(KO_TERMS.maker);
  });

  // Founder 2026-11-02: an original shows the handle an admin typed — plain text, no title, no link.
  it('credits "by @handle" as plain text on an original whose handle an admin filled in', () => {
    const original = card({ origin: 'studio', authorHandle: 'hana' });
    expect(cardAuthor(original)).toEqual({ handle: 'hana' });
    const html = markup(original, 'ko');
    expect(html).toContain(`>by @hana<`);
    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html).not.toContain('/makers/hana');
    expect(html).not.toContain(dicts.ko.prompts.cardAuthorAnonymous);
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

describe('rails: NEW first, two columns on a phone', () => {
  const old = (slug: string) => card({ slug, publishedAt: '2026-01-01T00:00:00.000Z' });

  it('moves NEW cards to the front and keeps the catalog order inside each group', () => {
    const ordered = railOrder([old('a'), card({ slug: 'n1' }), old('b'), card({ slug: 'n2' })], NOW);
    expect(ordered.map((c) => c.slug)).toEqual(['n1', 'n2', 'a', 'b']);
  });

  it('renders that order in film rows that never scroll sideways', () => {
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
    expect(html).toContain('film-rows');
    expect(html).toMatch(/<li[^>]*style="--r:/);
  });
});

/**
 * Founder 2026-11-02: the best-looking templates come first, in a hand-kept order, until likes or a
 * recommender can rank them. A new template still gets seen: it follows the lead instead of the end.
 */
describe('recommended order (founder 2026-11-02)', () => {
  const OLD = '2026-01-01T00:00:00.000Z';
  const NEW = '2026-10-20T00:00:00.000Z';
  const old = (slug: string) => card({ slug, publishedAt: OLD, featured: false });
  const slugs = (cards: PromptCard[]) => railOrder(cards, NOW).map((c) => c.slug);

  it('puts recommended templates in their set order, whatever the catalog order is', () => {
    const [first, second, third] = RECOMMENDED_VIDEO_ORDER;
    expect(slugs([old(third!), old('plain'), old(first!), old(second!)])).toEqual([first, second, third, 'plain']);
  });

  it('beats the NEW rule for a template that was already ranked lower', () => {
    const last = RECOMMENDED_VIDEO_ORDER[RECOMMENDED_VIDEO_ORDER.length - 1]!;
    const first = RECOMMENDED_VIDEO_ORDER[0]!;
    expect(slugs([card({ slug: last, publishedAt: NEW }), old(first)])).toEqual([first, last]);
  });

  it('shows an unranked NEW template right after the lead, ahead of the other recommended ones', () => {
    const lead = RECOMMENDED_VIDEO_ORDER[RECOMMENDED_LEAD - 1]!;
    const after = RECOMMENDED_VIDEO_ORDER[RECOMMENDED_LEAD]!;
    expect(slugs([old(after), card({ slug: 'brand-new', publishedAt: NEW }), old(lead)])).toEqual([lead, 'brand-new', after]);
  });

  it('keeps unranked older templates last, in catalog order', () => {
    const after = RECOMMENDED_VIDEO_ORDER[RECOMMENDED_LEAD]!;
    expect(slugs([old('plain-a'), old(after), old('plain-b')])).toEqual([after, 'plain-a', 'plain-b']);
  });

  it('ranks the image feed by its own list', () => {
    const [first, second] = RECOMMENDED_IMAGE_ORDER;
    expect(slugs([old(second!), old('plain'), old(first!)])).toEqual([first, second, 'plain']);
  });

  it('lists every slug once', () => {
    const all = [...RECOMMENDED_VIDEO_ORDER, ...RECOMMENDED_IMAGE_ORDER];
    expect(new Set(all).size).toBe(all.length);
  });

  it('still breaks a run of one origin inside the recommended order', () => {
    const [a, b, c, d] = RECOMMENDED_VIDEO_ORDER;
    const maker = card({ slug: RECOMMENDED_VIDEO_ORDER[4]!, publishedAt: OLD, featured: false, origin: 'maker', source: 'yagi', authorHandle: 'hana', makerProfile: true });
    expect(slugs([old(a!), old(b!), old(c!), old(d!), maker])).toEqual([a, b, c, maker.slug, d]);
  });
});

describe('catalog first screen (§15.3-5)', () => {
  const listing = (cards: PromptCard[], medium: 'video' | 'image' = 'video', locale: 'ko' | 'en' = 'ko') =>
    renderToStaticMarkup(<TemplatesListing locale={locale} dict={dicts[locale]} medium={medium} cards={cards} now={NOW} />);
  const image = (overrides: Partial<PromptCard> = {}) => card({ medium: 'image', runtimeSeconds: null, ...overrides });
  const OLD = '2026-01-01T00:00:00.000Z';
  const labels = { heading: 'Filter', all: 'All', count: '{count} templates', reset: 'Reset' };

  it('keeps the GEO definition in the HTML, but below the grid', () => {
    const html = listing([card(), card({ slug: 'second', useCase: ['mv'] })]);
    const definition = html.indexOf('data-service-definition');
    expect(definition).toBeGreaterThan(-1);
    expect(html).toContain(dicts.ko.seo.definition);
    expect(definition).toBeGreaterThan(html.lastIndexOf('data-prompt-card='));
  });

  it('image list: hides the chip row when every template shares one use case, and keeps the count line', () => {
    const one = listing([image(), image({ slug: 'second' })], 'image');
    expect(one).not.toContain('role="group"');
    expect(one).toContain('2개 템플릿');
    const two = listing([image(), image({ slug: 'second', useCase: ['mv'] })], 'image');
    expect(two).toContain('role="group"');
    expect(two).toContain('data-filter-facet="useCase"');
    expect(two).toContain('data-filter-option="useCase:mv"');
    expect(two).toContain(`>${useCaseLabel(dicts.ko, 'mv')}<`);
    expect(two).not.toContain('data-filter-facet="length"');
    expect(two).toContain('2개 템플릿');
  });

  /** Founder 2026-11-24, second time: genre chips on the video list mean nothing to a buyer. */
  it('video list: never offers genre chips, however mixed the genres are', () => {
    const html = listing([
      card({ runtimeSeconds: 15 }),
      card({ slug: 'second', useCase: ['mv'], runtimeSeconds: 15 }),
      card({ slug: 'third', useCase: ['brand-ad', 'ugc'], runtimeSeconds: 15 }),
    ]);
    expect(html).not.toContain('data-filter-facet="useCase"');
    expect(html).not.toContain('data-filter-option="useCase:');
    for (const value of ['mv', 'brand-ad', 'ugc', 'cinematic'] as const) expect(html).not.toContain(`>${useCaseLabel(dicts.ko, value)}<`);
  });

  it('video list: an 8 s and a 15 s template make two length chips, in plain words', () => {
    const html = listing([card({ runtimeSeconds: 8 }), card({ slug: 'second', runtimeSeconds: 15 })]);
    expect(html).toContain('data-list-filter=""');
    expect(html).toContain('data-filter-facet="length"');
    expect(html).toContain('data-filter-option="length:short"');
    expect(html).toContain('data-filter-option="length:mid"');
    expect(html).not.toContain('data-filter-option="length:long"');
    expect(html).toContain('>10초 이하<');
    expect(html).toContain('>11~15초<');
    expect(html).toContain('2개 템플릿');
    const en = listing([card({ runtimeSeconds: 8 }), card({ slug: 'second', runtimeSeconds: 30 })], 'video', 'en');
    expect(en).toContain('>Up to 10s<');
    expect(en).toContain('>16s and longer<');
  });

  it('video list: every template at 10 s renders the count only', () => {
    const html = listing([card({ runtimeSeconds: 10 }), card({ slug: 'second', runtimeSeconds: 10 })]);
    expect(html).toContain('data-list-filter="count-only"');
    expect(html).not.toContain('role="group"');
    expect(html).not.toContain('data-filter-option');
    expect(html).toContain('2개 템플릿');
  });

  it('video list: a NEW chip only while some — not all — templates are new, set off from the lengths by a line', () => {
    const html = listing([card({ runtimeSeconds: 8 }), card({ slug: 'old', publishedAt: OLD, runtimeSeconds: 15 })]);
    expect(html).toContain('data-filter-option="new:1"');
    expect(html).toContain('>새로 나온 것<');
    expect(html).toContain('data-filter-divider');
    expect(html.indexOf('data-filter-facet="new"')).toBeLessThan(html.indexOf('data-filter-facet="length"'));
    const allNew = listing([card({ runtimeSeconds: 8 }), card({ slug: 'second', runtimeSeconds: 15 })]);
    expect(allNew).not.toContain('data-filter-option="new:1"');
    expect(allNew).not.toContain('data-filter-divider');
  });

  it('video list: the empty-filter line is the one the filter owns', () => {
    const html = listing([card({ runtimeSeconds: 8 }), card({ slug: 'second', runtimeSeconds: 15 })]);
    expect(html).toContain(dicts.ko.prompts.filterNone);
    expect(dicts.ko.prompts.filterNone).toBe('이 조건에 맞는 템플릿이 아직 없어요.');
    expect(dicts.en.prompts.filterNone).toBe('Nothing matches yet.');
  });

  it('draws the medium segment and the filter chips as the same pill', () => {
    expect(pillClassName(true)).toContain('rounded-full');
    expect(pillClassName(true)).not.toBe(pillClassName(false));
    const tabs = renderToStaticMarkup(<MediumTabs locale="ko" dict={dicts.ko} active="video" />);
    expect(tabs).toContain(`class="${pillClassName(true)}"`);
    expect(tabs).toContain(`class="${pillClassName(false)}"`);
    const chips = renderToStaticMarkup(
      <ListFilter rail="video" total={2} labels={labels} facets={[{ group: 'length', label: 'Length', options: [{ value: 'short', label: 'Short' }, { value: 'mid', label: 'Mid' }] }]} />,
    );
    expect(chips).toContain(pillClassName(true));
    expect(chips).toContain(pillClassName(false));
    // Keyboard and screen readers: real buttons that say whether they are pressed.
    expect(chips).toContain('aria-pressed="true"');
    expect(chips).toContain('aria-pressed="false"');
    expect(chips).toMatch(/<button[^>]*type="button"[^>]*data-filter-option="length:short"/);
  });

  it('no facet renders the count but no chips', () => {
    const html = renderToStaticMarkup(<ListFilter rail="video" total={9} labels={labels} facets={[]} />);
    expect(html).not.toContain('<button');
    expect(html).toContain('9 templates');
  });

  it('folds a group into one labelled menu pill when the row would pass six chips', () => {
    const many = { group: 'useCase' as const, label: 'Use case', options: ['a', 'b', 'c', 'd', 'e', 'f'].map((value) => ({ value, label: value.toUpperCase() })) };
    const html = renderToStaticMarkup(<ListFilter rail="image" total={9} labels={labels} facets={[many]} />);
    expect(html).toContain('<select');
    expect(html).toContain('aria-label="Use case"');
    expect(html).toContain('data-filter-option="useCase:f"');
    expect(html).not.toMatch(/<button[^>]*data-filter-option=/);
    expect(collapsedGroups([many])).toEqual(new Set(['useCase']));
    // Today's video row (all + new + three lengths) stays as chips.
    expect(collapsedGroups([
      { group: 'new', label: '', options: [{ value: '1', label: '' }] },
      { group: 'length', label: '', options: ['short', 'mid', 'long'].map((value) => ({ value, label: value })) },
    ])).toEqual(new Set());
  });

  it('filters only the catalogue rail — the cast shelves under it keep every card', () => {
    const item = (length: string) => ({ dataset: { length, new: 'false', useCase: 'cinematic', cast: 'solo' } as Record<string, string>, hidden: false });
    const rail = (items: ReturnType<typeof item>[]) => {
      const empty = { hidden: true };
      return { items, empty, querySelectorAll: (selector: string) => (selector === '[data-prompt-item]' ? items : []), querySelector: (selector: string) => (selector === '[data-rail-filtered-empty]' ? empty : null) };
    };
    const rails: Record<string, ReturnType<typeof rail>> = { video: rail([item('short'), item('mid'), item('')]), 'cast-pet-video': rail([item('mid')]) };
    const root = { querySelector: (selector: string) => rails[/^\[data-rail="(.+)"\]$/.exec(selector)?.[1] ?? ''] ?? null };

    expect(applyListFilter(root, 'video', { length: 'short' })).toBe(1);
    expect(rails.video!.items.map((entry) => entry.hidden)).toEqual([false, true, true]);
    expect(rails.video!.empty.hidden).toBe(true);
    expect(rails['cast-pet-video']!.items[0]!.hidden).toBe(false);

    expect(applyListFilter(root, 'video', { length: 'long' })).toBe(0);
    expect(rails.video!.empty.hidden).toBe(false);

    expect(applyListFilter(root, 'video', {})).toBe(3);
    expect(rails.video!.items.every((entry) => !entry.hidden)).toBe(true);
  });
});

/**
 * Founder 2026-10-30 (PLATFORM-2.0 §7.5): originals and AI creatives' templates in ONE feed. One
 * ranking (these unranked slugs: NEW → featured → newest); inside it, never more than ORIGIN_RUN_MAX cards of one origin
 * in a row while the other origin still has cards. A creative's card says whose it is — nothing else.
 */
describe('one mixed feed (founder 2026-10-30)', () => {
  const OLD = '2026-01-01T00:00:00.000Z';
  const studio = (slug: string, publishedAt = OLD) => card({ slug, publishedAt, featured: false });
  const maker = (slug: string, publishedAt = OLD, handle: string | null = 'hana') =>
    card({ slug, publishedAt, featured: false, origin: 'maker', source: 'yagi', authorHandle: handle, makerProfile: handle !== null });
  const slugs = (cards: PromptCard[]) => railOrder(cards, NOW).map((c) => c.slug);
  const longestRun = (ordered: PromptCard[]) => {
    let longest = 0, run = 0, last: string | null = null;
    for (const c of ordered) { run = c.origin === last ? run + 1 : 1; last = c.origin; longest = Math.max(longest, run); }
    return longest;
  };

  it('keeps the ranking when the two origins already alternate', () => {
    expect(slugs([studio('s1'), maker('m1'), studio('s2'), maker('m2')])).toEqual(['s1', 'm1', 's2', 'm2']);
  });

  it('breaks a run of one origin after three cards, keeping each origin in its own order', () => {
    const ranked = [studio('s1'), studio('s2'), studio('s3'), studio('s4'), studio('s5'), maker('m1'), maker('m2')];
    expect(ORIGIN_RUN_MAX).toBe(3);
    expect(slugs(ranked)).toEqual(['s1', 's2', 's3', 'm1', 's4', 's5', 'm2']);
    // …and the same rule the other way round, when the creatives lead.
    expect(slugs([maker('m1'), maker('m2'), maker('m3'), maker('m4'), studio('s1')])).toEqual(['m1', 'm2', 'm3', 's1', 'm4']);
  });

  it('still leads with NEW cards, from either origin', () => {
    expect(slugs([studio('s1'), studio('s2'), maker('m-new', '2026-10-20T00:00:00.000Z')])[0]).toBe('m-new');
    expect(slugs([maker('m1'), studio('s-new', '2026-10-20T00:00:00.000Z')])).toEqual(['s-new', 'm1']);
  });

  it('never lets one origin clump while the other still has cards', () => {
    for (const [s, m] of [[12, 1], [12, 3], [3, 12], [7, 7], [20, 5]] as const) {
      const cards = [...Array.from({ length: s }, (_, i) => studio(`s${i}`)), ...Array.from({ length: m }, (_, i) => maker(`m${i}`))];
      const ordered = railOrder(cards, NOW);
      expect(ordered).toHaveLength(s + m);
      expect(new Set(ordered.map((c) => c.slug)).size).toBe(s + m);
      // The tail may run long only once one origin is used up.
      const origins = ordered.map((c) => c.origin);
      const firstExhausted = Math.min(origins.lastIndexOf('studio'), origins.lastIndexOf('maker'));
      expect(longestRun(ordered.slice(0, firstExhausted + 1))).toBeLessThanOrEqual(ORIGIN_RUN_MAX);
    }
  });

  it('leaves a single-origin list exactly as before (NEW first, then catalog order)', () => {
    expect(slugs([studio('a'), studio('n1', '2026-10-20T00:00:00.000Z'), studio('b')])).toEqual(['n1', 'a', 'b']);
  });

  const listing = (cards: PromptCard[], locale: 'ko' | 'en' = 'ko') =>
    renderToStaticMarkup(<TemplatesListing locale={locale} dict={dicts[locale]} medium="video" cards={cards} />);

  it('draws one grid with both origins in it — no origin rails, chips or collection headings', () => {
    const html = listing([studio('s1'), studio('s2'), studio('s3'), studio('s4'), maker('m1')]);
    expect(html.match(/data-rail="/g)).toHaveLength(1);
    expect(html).not.toContain('data-rail-origin');
    expect(html).not.toContain('data-origin-filter');
    expect(html).not.toContain(`>${KO_TERMS.studioCollection}<`);
    expect(html).not.toContain(`>${KO_TERMS.makerCollection}<`);
    expect(listing([studio('s1'), maker('m1')], 'en')).not.toContain(`>${EN_TERMS.makerCollection}<`);
    // The creative's card sits inside the originals, at the fourth place at the latest.
    const order = [...html.matchAll(/data-prompt-card="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['s1', 's2', 's3', 'm1', 's4']);
    // One count over everything.
    expect(html).toContain('5개 템플릿');
  });

  it('marks each card with its origin and credits only the creative', () => {
    const html = listing([studio('s1'), maker('m1')]);
    expect(html).toContain('data-card-origin="studio"');
    expect(html).toContain('data-card-origin="maker"');
    expect(html.match(/data-card-author/g)).toHaveLength(1);
    expect(html).toContain(`>${KO_TERMS.creditPrefix} @hana<`);
  });

  it('a creatives-only catalogue is the same single grid', () => {
    const html = listing([maker('m1'), maker('m2')]);
    expect(html.match(/data-rail="/g)).toHaveLength(1);
    expect(html).not.toContain('data-rail-origin');
  });
});
