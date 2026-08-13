import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { PromptRail } from '@/components/prompts/rails';
import { TypographicPoster, POSTER_RATIOS, posterRatio } from '@/components/prompts/poster';
import { PromptBody, PromptHeader, SubmitStrip } from '@/components/prompts/detail';
import { promptLabels, presentUseCases, useCaseLabel } from '@/components/prompts/labels';
import type { ShapedPrompt } from '@/lib/prompts/shape';
import type { UnlockPanel } from '@/lib/cookies/wallet';

/**
 * PLAN §13.2 — the gallery renders as STATIC HTML shared by every tier, so what it contains is a
 * disclosure question, not a styling one. These render the real components with `react-dom/server`
 * and assert on the markup: the card must never contain prompt text, the lock chip must appear
 * exactly when the projection says so, and the locked detail must be chrome + panel with nothing
 * behind it.
 */

const dict = getDictionary('en');
const labels = promptLabels(dict);
const useCaseLabels = Object.fromEntries(USE_CASES.map((v) => [v, useCaseLabel(dict, v)]));
const SENTINEL = 'SENTINEL_UI_PROMPT_TEXT';

function card(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    authorHandle: null,
    source: 'yagi',
    model: 'seedance-2.5',
    modelLabel: PROMPT_MODEL_LABEL,
    useCase: ['cinematic'],
    poster: { source: 'route', src: '/api/prompts/media/x%3Aposter', mime: 'image/png', w: 1280, h: 1600 },
    video: { source: 'route', src: '/api/prompts/media/x%3Avideo', mime: 'video/mp4' },
    hasLock: true,
    featured: true,
    publishedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  };
}

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const cardMarkup = (data: PromptCard, locale = 'en') =>
  render(
    <PromptCardView
      card={data}
      locale={locale}
      labels={labels}
      useCaseLabels={useCaseLabels}
      signinHref="/auth/signin?next=%2Fen%2Fprompts&locale=en"
      now={new Date('2026-08-13T00:00:00.000Z')}
    />,
  );

describe('prompt card (§13.2)', () => {
  it('renders media, credit, model chip and title — and no prompt text of any kind', () => {
    const html = cardMarkup(card());
    expect(html).toContain('data-prompt-card="neon-alley-dolly"');
    expect(html).toContain(PROMPT_MODEL_LABEL);
    expect(html).toContain('Neon alley dolly');
    expect(html).toContain(labels.byYagi);
    expect(html).not.toContain(SENTINEL);
    // There is no field the card could even read it from.
    expect(Object.hasOwn(card(), 'text')).toBe(false);
  });

  it('wears the lock chip exactly when the projection says the text is gated', () => {
    expect(cardMarkup(card({ hasLock: true }))).toContain('data-lock-chip');
    expect(cardMarkup(card({ hasLock: false }))).not.toContain('data-lock-chip');
  });

  it('credits a community submitter by @handle, and falls back honestly', () => {
    expect(cardMarkup(card({ source: 'community', authorHandle: 'hana' }))).toContain('by @hana');
    expect(cardMarkup(card({ source: 'community', authorHandle: null }))).toContain(
      labels.byAnonymous,
    );
  });

  it('shows the NEW badge inside the window and drops it outside', () => {
    expect(cardMarkup(card())).toContain('data-badge="new"');
    expect(cardMarkup(card({ publishedAt: '2026-01-01T00:00:00.000Z' }))).not.toContain(
      'data-badge="new"',
    );
  });

  it('uses the Korean title on the ko surface when there is one', () => {
    expect(cardMarkup(card(), 'ko')).toContain('네온 골목 달리');
    expect(cardMarkup(card({ titleKo: null }), 'ko')).toContain('Neon alley dolly');
  });

  /** A `<button>` inside an `<a>` is invalid and unusable; the card is a stretched link instead. */
  it('is a stretched link, so the copy button is a real sibling button', () => {
    const html = cardMarkup(card());
    expect(html).toContain('<article');
    expect(html).toContain('after:absolute');
    expect(html).toContain('data-copy-prompt=');
    // No `<button>` anywhere BETWEEN an `<a>` and its own `</a>`.
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
  });

  it('carries no media element when there is nothing published to show', () => {
    const html = cardMarkup(card({ poster: null, video: null }));
    expect(html).toContain('data-poster="typographic"');
    expect(html).not.toContain('<img');
  });
});

describe('typographic poster (§13.3-4)', () => {
  it('is deterministic per slug, so the masonry never reflows between renders', () => {
    expect(posterRatio('neon-alley-dolly')).toBe(posterRatio('neon-alley-dolly'));
    expect(POSTER_RATIOS).toContain(posterRatio('anything-at-all'));
  });

  it('sets the title in the display face with the model as its kicker', () => {
    const html = render(
      <TypographicPoster title="Talking head brand read" slug="talking-head" kicker={PROMPT_MODEL_LABEL} />,
    );
    expect(html).toContain('Talking');
    expect(html).toContain(PROMPT_MODEL_LABEL);
    expect(html).toContain('font-display');
  });
});

describe('rails (§13.2)', () => {
  const rail = (cards: PromptCard[]) =>
    render(
      <PromptRail
        id="yagi"
        heading={dict.prompts.railYagi}
        lede={dict.prompts.railYagiLede}
        cards={cards}
        locale="en"
        labels={labels}
        useCaseLabels={useCaseLabels}
        emptyLabel={dict.prompts.emptyYagi}
        filteredEmptyLabel={dict.prompts.filterEmpty}
        signinHref="/auth/signin"
      />,
    );

  it('renders the display-type header and tags each item with its use cases', () => {
    const html = rail([card(), card({ slug: 'second', useCase: ['mv', 'vlog'] })]);
    expect(html).toContain('ORIGINAL PROMPTS BY YAGI');
    expect(html).toContain('data-rail="yagi"');
    expect(html).toContain('data-use-case="cinematic"');
    expect(html).toContain('data-use-case="mv vlog"');
    expect(html).toContain('break-inside-avoid');
  });

  it('says so when a rail is empty rather than leaving a headline over a void', () => {
    expect(rail([])).toContain(dict.prompts.emptyYagi);
  });

  it('ships the filtered-empty line hidden, so JS-off readers never see it', () => {
    const html = rail([card()]);
    expect(html).toContain('data-rail-filtered-empty');
    expect(html).toMatch(/data-rail-filtered-empty[^>]*hidden/);
  });

  it('offers only the use cases that are present', () => {
    expect(presentUseCases(['mv', 'cinematic'])).toEqual(['cinematic', 'mv']);
    expect(presentUseCases(['not-a-use-case'])).toEqual([]);
  });
});

describe('prompt detail (§13.2 / §5.5 / §15.3)', () => {
  const base = {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    source: 'yagi' as const,
    authorHandle: null,
    model: 'seedance-2.5',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    useCase: ['cinematic'],
    featured: true,
    publishedAt: '2026-08-12T00:00:00.000Z',
    poster: null,
    video: null,
    visibility: 'pro' as const,
  };

  const locked: ShapedPrompt = { ...base, tier: 'anon', locked: true };
  const open: ShapedPrompt = { ...base, tier: 'pro', locked: false, text: `Slow dolly.\n:: ${SENTINEL}` };

  const body = (prompt: ShapedPrompt, panel: UnlockPanel | null = null) =>
    render(
      <PromptBody
        prompt={prompt}
        locale="en"
        labels={labels}
        panel={panel}
        signinHref="/auth/signin?next=%2Fen%2Fprompts%2Fneon-alley-dolly&locale=en"
        unlockAction={async () => {}}
      />,
    );

  it('renders the §5.5 lock panel with no text and no copy button', () => {
    const html = body(locked, { state: 'signin' });
    expect(html).toContain('data-lock-panel');
    expect(html).toContain('lock-panel');
    expect(html).not.toContain(SENTINEL);
    expect(html).not.toContain('data-copy-prompt');
  });

  it('funnels anon through sign-in and back to this prompt (§15.3)', () => {
    const html = body(locked, { state: 'signin' });
    expect(html).toContain('data-unlock-cta="signin"');
    expect(html).toContain(dict.cookies.signinCta);
    expect(html).toContain('%2Fen%2Fprompts%2Fneon-alley-dolly');
    // The funnel never renders a spend it cannot honor, nor a checkout.
    expect(html).not.toContain('data-unlock-cta="spend"');
    expect(html).not.toContain('data-upgrade="checkout"');
  });

  it('offers a funded reader the one-cookie spend with the real balance (§15.3)', () => {
    const html = body({ ...locked, tier: 'free' }, { state: 'spend', balance: 3 });
    expect(html).toContain('data-unlock-cta="spend"');
    expect(html).toContain('Open with 1 cookie · 3 left');
    // The server action receives the prompt id from a hidden field the server re-validates.
    expect(html).toContain(`value="${base.id}"`);
    expect(html).not.toContain(SENTINEL);
  });

  it('shows the wallet panel at zero: the weekly line and the $4 pack, honestly unavailable', () => {
    const html = body({ ...locked, tier: 'free' }, { state: 'empty' });
    expect(html).toContain('data-unlock-cta="empty"');
    expect(html).toContain(dict.cookies.emptyTitle);
    expect(html).toContain(dict.cookies.weeklyLine);
    // §15.1-5 — no gateway is connected, so the pack renders the designed unavailable state,
    // never a live buy button.
    expect(html).toContain('data-billing="unavailable"');
    expect(html).toContain('$4');
    expect(html).not.toContain('data-upgrade="checkout"');
  });

  it('renders the text in a monospace block with a copy button for an entitled reader', () => {
    const html = body(open);
    expect(html).toContain('data-prompt-text');
    expect(html).toContain(SENTINEL);
    expect(html).toContain('data-copy-prompt');
    expect(html).not.toContain('data-lock-panel');
    expect(html).not.toContain('data-unlock-cta');
  });

  it('shows the card surface for everyone — the header never depends on the gate', () => {
    for (const prompt of [locked, open]) {
      const html = render(
        <PromptHeader prompt={prompt} labels={labels} useCaseLabels={useCaseLabels} />,
      );
      expect(html).toContain('Neon alley dolly');
      expect(html).toContain('data-model-chip');
      expect(html).toContain('SEEDANCE 2.5');
      expect(html).not.toContain(SENTINEL);
    }
  });

  it('renders the submit strip pointing at the unprefixed form', () => {
    const html = render(
      <SubmitStrip
        title={dict.prompts.submitStripTitle}
        body={dict.prompts.submitStripBody}
        cta={dict.prompts.submitCta}
      />,
    );
    expect(html).toContain('data-submit-strip');
    expect(html).toContain('href="/prompts/submit"');
  });
});
