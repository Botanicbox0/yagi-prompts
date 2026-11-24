import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL, USE_CASES } from '@/lib/prompts/schemas';
import { PromptRail } from '@/components/prompts/rails';
import { RelatedPrompts } from '@/components/prompts/detail';
import { TemplatesListing } from '@/components/templates/listing';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { FirstRunSheet } from '@/components/onboarding/first-run-sheet';
import { LookChoice, LookQuestion, TemplateLookIsland } from '@/components/template-look/look-island';
import { LookMismatch } from '@/components/template-look/look-mismatch';
import { LookSetting } from '@/components/template-look/look-setting';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the markup. With `TWINGS_TEMPLATE_LOOK` off nothing changes (no `data-look`, no
 * reveal button, no question, no style words); with it on every card says who it is written for and the rails carry a
 * hidden "다른 스타일도 보기". Everything that depends on the VIEWER is client-only: the server markup of the question,
 * the mismatch line and the "few so far" line is empty, so the cached HTML is the same for everyone.
 */

const NOW = new Date('2026-11-25T00:00:00.000Z');
const ko = getDictionary('ko');

function card(slug: string, look?: 'female' | 'male'): PromptCard {
  return {
    id: `9a000000-0000-4000-8000-0000000000${slug.length.toString().padStart(2, '0')}`,
    slug,
    title: slug,
    titleKo: slug,
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
    runtimeSeconds: 12,
    engine: null,
    aspectDefault: '9:16',
    poster: { source: 'route', src: '/p.png', mime: 'image/png', w: 1080, h: 1920 },
    video: null,
    lock: null,
    featured: false,
    publishedAt: '2026-10-01T00:00:00.000Z',
    ...(look ? { look } : {}),
  };
}

const cards = [card('for-anyone'), card('for-women', 'female'), card('for-men', 'male')];
const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(ko, value)]));
const rail = () =>
  renderToStaticMarkup(
    <PromptRail id="video" heading="h" lede="l" cards={cards} locale="ko" labels={promptLabels(ko)} useCaseLabels={useCaseLabels} emptyLabel="e" filteredEmptyLabel="f" now={NOW} />,
  );
const related = () => renderToStaticMarkup(<RelatedPrompts cards={cards} locale="ko" labels={{ ...promptLabels(ko), relatedHeading: 'r' }} useCaseLabels={useCaseLabels} signinHref="/s" />);
const listing = () => renderToStaticMarkup(<TemplatesListing locale="ko" dict={ko} medium="video" cards={cards} now={NOW} />);

afterEach(() => vi.unstubAllEnvs());

describe('switch off: the markup is what it was', () => {
  it('no card says who it is for, no reveal button, no question, no style words', () => {
    for (const html of [rail(), related(), listing()]) {
      expect(html).not.toContain('data-look');
      expect(html).not.toContain(ko.templateLook.reveal);
      expect(html).not.toContain(ko.templateLook.female);
      expect(html).not.toContain(ko.templateLook.few);
    }
  });

  it('the after-signup sheet has no style question without the words', () => {
    const html = renderToStaticMarkup(<FirstRunSheet copy={ko.firstRun} locale="ko" initialOpen initialAskLook />);
    expect(html).not.toContain('data-look-choice');
    expect(html).not.toContain(ko.templateLook.question);
  });
});

describe('switch on: the static markup carries the labels, never the viewer', () => {
  it('every rail card says who it is for, and the rail carries a hidden "다른 스타일도 보기"', () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    const html = rail();
    expect(html).toMatch(/data-look="any"[^>]*>[\s\S]*?for-anyone/);
    expect((html.match(/data-look="female"/g) ?? []).length).toBe(1);
    expect((html.match(/data-look="male"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<button type="button" data-look-reveal="true" hidden=""[^>]*>다른 스타일도 보기<\/button>/);
    // Nothing is hidden in the HTML itself: a crawler and a signed-out visitor see every card.
    expect(html).not.toMatch(/data-prompt-item="true"[^>]*hidden/);
  });

  it('the related templates say who they are for', () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    const html = related();
    expect((html.match(/data-related-item="true" data-look="/g) ?? []).length).toBe(3);
    expect(html).toContain('data-look="male"');
  });

  it('the list renders no question and no "few so far" line on the server', () => {
    vi.stubEnv('TWINGS_TEMPLATE_LOOK', 'on');
    const html = listing();
    expect(html).toContain('data-look="male"');
    expect(html).not.toContain('data-look-question');
    expect(html).not.toContain('data-look-few');
    expect(renderToStaticMarkup(<TemplateLookIsland copy={ko.templateLook} />)).toBe('');
    expect(renderToStaticMarkup(<LookQuestion copy={ko.templateLook} />)).toBe('');
    expect(renderToStaticMarkup(<LookMismatch template="male" note={ko.templateLook.mismatch} />)).toBe('');
  });
});

describe('the choice', () => {
  it('two large options, the women’s style first, and the one line', () => {
    const html = renderToStaticMarkup(<LookChoice copy={ko.templateLook} chosen={null} busy={false} onChoose={() => {}} lineId="line" />);
    expect(html.indexOf('data-look-option="female"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-look-option="female"')).toBeLessThan(html.indexOf('data-look-option="male"'));
    expect(html).toContain('여성 스타일');
    expect(html).toContain('남성 스타일');
    expect(html).toContain(ko.templateLook.question);
    expect(html).toContain('aria-labelledby="line"');
    expect(html).not.toMatch(/성별|gender/i);
  });

  it('is asked on the first card of the after-signup sheet when the account has none', () => {
    const html = renderToStaticMarkup(<FirstRunSheet copy={ko.firstRun} locale="ko" initialOpen initialAskLook look={ko.templateLook} />);
    expect(html).toContain('data-look-choice');
    expect(html.indexOf('data-look-choice')).toBeGreaterThan(html.indexOf(ko.firstRun.step1Body));
    // Not on the other cards, and not when the account already has one.
    expect(renderToStaticMarkup(<FirstRunSheet copy={ko.firstRun} locale="ko" initialOpen initialStep={1} initialAskLook look={ko.templateLook} />)).not.toContain('data-look-choice');
    expect(renderToStaticMarkup(<FirstRunSheet copy={ko.firstRun} locale="ko" initialOpen look={ko.templateLook} />)).not.toContain('data-look-choice');
  });
});

describe('the settings row', () => {
  it('three options in order, the stored one checked', () => {
    const html = renderToStaticMarkup(<LookSetting initial="female" copy={ko.templateLook} />);
    const order = ['female', 'male', 'unset'].map((value) => html.indexOf(`data-look-setting-option="${value}"`));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/aria-checked="true"[^>]*data-look-setting-option="female"/);
    expect(html).toMatch(/aria-checked="false"[^>]*data-look-setting-option="unset"/);
    expect(html).toContain('정하지 않음');
    expect(html).toContain('role="radiogroup"');
  });

  it('shows "정하지 않음" checked when nothing is stored', () => {
    expect(renderToStaticMarkup(<LookSetting initial={null} copy={ko.templateLook} />)).toMatch(/aria-checked="true"[^>]*data-look-setting-option="unset"/);
  });
});
