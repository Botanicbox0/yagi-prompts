import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { Hero, HeroLede } from '@/components/landing/sections';

/**
 * Design review F3 — on a 375×667 first screen the landing must show cards, so below lg the
 * hero keeps eyebrow + headline + the gallery anchor ONLY. The lede and the submit link move
 * into `HeroLede` after the first rail. This pins the visibility classes (the contract is
 * literally "which width sees what"), not the pixel result — the pixel result is measured on
 * the built site with headless Chrome (see the F3 verification note in the review report).
 */

const dict = getDictionary('en');

describe('mobile-first hero (F3)', () => {
  const hero = renderToStaticMarkup(<Hero locale="en" dict={dict} />);

  it('keeps eyebrow, headline and the gallery anchor at every width', () => {
    expect(hero).toContain(dict.hero.eyebrow);
    expect(hero).toContain(dict.hero.line1);
    expect(hero).toContain('href="#gallery"');
    // The anchor CTA carries no width-gated visibility class.
    expect(hero).not.toMatch(/href="#gallery"[^>]*hidden/);
  });

  it('hides the lede and the submit link below lg — and only below lg', () => {
    expect(hero).toMatch(/class="hidden [^"]*lg:block[^"]*"[^>]*>[^<]*in-house/);
    expect(hero).toMatch(/href="\/prompts\/submit"[^>]*hidden[^>]*lg:inline-block/);
  });

  it('tightens the mobile band while keeping the lg values', () => {
    expect(hero).toContain('pt-24 pb-8 lg:pt-36 lg:pb-20');
  });

  it('re-homes the two below lg, once, after the first rail', () => {
    const lede = renderToStaticMarkup(<HeroLede dict={dict} />);
    expect(lede).toContain('data-hero-lede');
    expect(lede).toContain('lg:hidden');
    expect(lede).toContain(dict.hero.lede);
    expect(lede).toContain('href="/prompts/submit"');
    expect(lede).toContain(dict.prompts.submitCta);
  });
});
