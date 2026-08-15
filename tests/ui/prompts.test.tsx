import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { HOVER_HOST } from '@/components/prompts/card-media';
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
    models: ['seedance-2.5'],
    modelLabels: [PROMPT_MODEL_LABEL],
    useCase: ['cinematic'],
    poster: { source: 'route', src: '/api/prompts/media/x%3Aposter', mime: 'image/png', w: 1280, h: 1600 },
    video: { source: 'route', src: '/api/prompts/media/x%3Avideo', mime: 'video/mp4' },
    lock: 'cookie' as const,
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

  /**
   * Founder report (2026-08-15): "90s interview는 free인데 왜 cookie 요구?" The chip was hardcoded
   * to COOKIE for anything not public, so a free-gated prompt quoted a price the server refuses to
   * charge — `unlockPrompt` will not spend a cookie on one. The chip now names the ACTION.
   */
  it('names the action the gate actually asks for', () => {
    const cookie = cardMarkup(card({ lock: 'cookie' }));
    expect(cookie).toContain('data-lock-chip="cookie"');
    expect(cookie).toContain(dict.prompts.lockChip);

    const signin = cardMarkup(card({ lock: 'signin' }));
    expect(signin).toContain('data-lock-chip="signin"');
    expect(signin).toContain(dict.prompts.lockChipSignin);
    // …and never the word that means money on a prompt that costs none.
    expect(signin).not.toContain(dict.prompts.lockChip);

    expect(cardMarkup(card({ lock: null }))).not.toContain('data-lock-chip');
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

  /**
   * The counterpart of the stretched link (founder report, 2026-08-15): because `a::after` covers
   * the card, the pointer hit-tests to the anchor and enter/leave never reach the media element —
   * hover-to-play was dead on every card until the listeners moved to an ANCESTOR. This asserts the
   * one thing the client effect assumes: `HOVER_HOST` resolves, and it WRAPS the media.
   */
  it('hangs the hover host above the media, where the overlay link cannot mask it', () => {
    expect(HOVER_HOST).toBe('[data-prompt-card]');
    const html = cardMarkup(card());
    const host = html.indexOf('data-prompt-card=');
    const media = html.indexOf('class="card__media');
    expect(host).toBeGreaterThanOrEqual(0);
    expect(media).toBeGreaterThan(host);
    expect(html.slice(host).indexOf('</article>')).toBeGreaterThan(html.slice(host).indexOf('card__media'));
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
    models: ['seedance-2.5'],
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    useCase: ['cinematic'],
    featured: true,
    publishedAt: '2026-08-12T00:00:00.000Z',
    poster: null,
    video: null,
    audio: null,
    sourceUrl: null,
    visibility: 'pro' as const,
  };

  const locked: ShapedPrompt = { ...base, tier: 'anon', locked: true };
  const open: ShapedPrompt = {
    ...base,
    tier: 'pro',
    locked: false,
    text: `Slow dolly.\n:: ${SENTINEL}`,
    process: null,
    processKo: null,
  };

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

  /**
   * The making-of (founder direction, 2026-08-14). Two properties, and the second is the one that
   * matters: it renders as markdown for a reader who may see the text, and it is ABSENT — not
   * blurred, not truncated — from a locked payload, because `shapePrompt` never put it there.
   */
  it('renders the process write-up as markdown, and never on a locked prompt', () => {
    const PROCESS = 'SENTINEL_PROCESS_NOTE';
    const withProcess: ShapedPrompt = {
      ...open,
      process: `## Passes\n\n- three takes\n- ${PROCESS}`,
      processKo: null,
    };
    const html = body(withProcess);
    expect(html).toContain('data-prompt-process');
    expect(html).toContain(PROCESS);
    // Markdown, not a pre block: the heading and the list are real elements.
    expect(html).toContain('<h2');
    expect(html).toContain('<li');

    // Locked: the payload has no `process` key at all, so there is nothing to render.
    expect(body(locked, { state: 'signin' })).not.toContain('data-prompt-process');
    // And an unlocked prompt with no write-up renders no empty section.
    expect(body(open)).not.toContain('data-prompt-process');
  });

  /** The panel quotes the same price as the chip — one function decides both. */
  it('tells a FREE-gated reader to sign in, and never mentions a cookie', () => {
    const html = body({ ...locked, visibility: 'free' }, { state: 'signin' });
    expect(html).toContain('data-locked="signin"');
    expect(html).toContain(dict.cookies.signinOnlyHeading);
    expect(html).toContain(dict.cookies.signinOnlyHint);
    expect(html).not.toContain(dict.cookies.lockedHeading);
    // The signup sweetener is about cookies; on a free prompt it answers an unasked question.
    expect(html).not.toContain(interpolate(dict.cookies.signinHint, { count: '3' }));

    // A pro-gated prompt keeps the cookie copy — that one really does cost a cookie.
    const gated = body(locked, { state: 'signin' });
    expect(gated).toContain(dict.cookies.lockedHeading);
    expect(gated).not.toContain(dict.cookies.signinOnlyHeading);
  });

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
    expect(html).not.toContain('data-cookie-pack');
    expect(html).not.toContain('data-upgrade="checkout"');
  });

  /**
   * Design review F5 — wallet-unreadable is a factual panel: one sentence, and NONE of the
   * empty state's claims (no zero-balance headline, no weekly line, no pack pitch, no control).
   */
  it('renders wallet-unreadable as a fact, never as "you have 0 cookies"', () => {
    const html = body({ ...locked, tier: 'free' }, { state: 'unavailable' });
    expect(html).toContain('data-unlock-cta="unavailable"');
    expect(html).toContain(dict.cookies.unavailableBody);
    expect(html).not.toContain(dict.cookies.emptyTitle);
    expect(html).not.toContain(dict.cookies.weeklyLine);
    expect(html).not.toContain('data-billing="unavailable"');
    expect(html).not.toContain('$4');
    expect(html).not.toContain('data-unlock-cta="spend"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain(SENTINEL);
  });

  /**
   * The M8 seam, rendered ahead of the gateway that will flip it: with `packReady` the same panel
   * is a real one-press form. Testing the unreachable branch NOW is what keeps "plug in a
   * Paddle-class MoR later" a config change instead of a UI project.
   */
  it('renders the pack as a live form the moment a gateway reports ready (M8 seam)', () => {
    const html = render(
      <PromptBody
        prompt={{ ...locked, tier: 'free' }}
        locale="en"
        labels={labels}
        panel={{ state: 'empty' }}
        signinHref="/auth/signin"
        unlockAction={async () => {}}
        packReady
        packAction={async () => {}}
      />,
    );
    expect(html).toContain('data-cookie-pack');
    expect(html).toContain('Buy 5 cookies — $4');
    expect(html).toContain(`value="${base.id}"`);
    expect(html).not.toContain('data-billing="unavailable"');
  });

  /**
   * The founder asked "pro로 설정했는데 왜 프롬프트 다 공개되어있음?" while signed in as admin
   * (2026-08-15). Nothing was broken — an admin outranks every gate — but the page looked exactly
   * like a public one, so the only way to check your own paywall was a private window.
   */
  it('tells an ADMIN what a normal reader would meet, and says nothing to anyone else', () => {
    const gated = body({ ...open, tier: 'admin' });
    expect(gated).toContain('data-admin-view="pro"');
    expect(gated).toContain('Admin view');
    // …and the text is still there: a moderator has to read what they moderate.
    expect(gated).toContain('data-prompt-text');

    // A public prompt has no gate to explain.
    expect(body({ ...open, tier: 'admin', visibility: 'public' })).not.toContain('data-admin-view');
    // A pro reader is past the gate; telling them about it would be noise.
    expect(body(open)).not.toContain('data-admin-view');
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

  /**
   * Founder direction (2026-08-13) — the audio result. Public like the clip, playable inline,
   * and the download href must carry `?download=1`: that is what makes the route answer
   * `Content-Disposition: attachment`, and the anchor attribute alone is ignored cross-origin.
   */
  it('renders the audio result with a one-press download, gate or no gate', () => {
    const audio = {
      source: 'route' as const,
      src: '/api/prompts/media/9a000000-0000-4000-8000-000000000001%3Aaudio',
      mime: 'audio/mpeg',
    };
    for (const prompt of [
      { ...locked, audio },
      { ...open, audio },
    ] as ShapedPrompt[]) {
      const html = render(
        <PromptHeader prompt={prompt} labels={labels} useCaseLabels={useCaseLabels} />,
      );
      expect(html).toContain('data-prompt-audio');
      expect(html).toContain('<audio');
      expect(html).toContain('data-audio-download');
      expect(html).toContain('download=1');
      expect(html).not.toContain(SENTINEL);
    }
    // No audio ⇒ no row — the panel never renders empty chrome.
    const bare = render(
      <PromptHeader prompt={locked} labels={labels} useCaseLabels={useCaseLabels} />,
    );
    expect(bare).not.toContain('data-prompt-audio');
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
