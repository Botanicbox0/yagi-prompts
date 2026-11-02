import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { Hero, HeroLede } from '@/components/landing/sections';

/**
 * Design review F3 — on a 375×667 first screen the landing must show cards, so below lg the hero
 * keeps eyebrow + headline + the two doors ONLY. The lede moves into `HeroLede` after the first
 * rail. This pins the visibility classes (the contract is literally "which width sees what"), not
 * the pixel result — that is measured on the built site.
 *
 * docs/TEMPLATES-IA.md (2026-09-05): the doors are the two template tabs. The gallery anchor and
 * the prompt-submit link left with the prompt site.
 */

const dict = getDictionary('en');

describe('mobile-first hero (F3 · templates)', () => {
  const hero = renderToStaticMarkup(<Hero locale="en" dict={dict} />);

  it('keeps eyebrow, headline and the video door at every width', () => {
    expect(hero).toContain(dict.hero.eyebrow);
    expect(hero).toContain(dict.hero.line1);
    expect(hero).toMatch(/data-hero-video="true"[^>]*href="\/en\/video"|href="\/en\/video"[^>]*data-hero-video/);
    expect(hero).toContain(dict.templates.ctaVideo);
    // The door carries no width-gated visibility class.
    expect(hero).not.toMatch(/href="\/en\/video"[^>]*hidden/);
  });

  // Founder, 2026-09-11: a hero button that lands on "preparing" is a dead end dressed as a choice.
  it('offers the image door only once an image template exists behind it', () => {
    expect(hero).not.toContain('href="/en/image"');
    expect(hero).not.toContain(dict.templates.ctaImage);
    const withImages = renderToStaticMarkup(<Hero locale="en" dict={dict} showImage />);
    expect(withImages).toContain('href="/en/image"');
    expect(withImages).toContain(dict.templates.ctaImage);
    expect(withImages).not.toMatch(/href="\/en\/image"[^>]*hidden/);
  });

  it('hides the lede below lg — and only below lg', () => {
    const desktopLede = hero.match(/class="hidden [^"]*lg:block[^"]*"[^>]*>([^<]*)/);
    expect(desktopLede?.[1]).toBe(renderToStaticMarkup(<>{dict.hero.lede}</>));
  });

  it('no longer offers a prompt submission or a studio door', () => {
    expect(hero).not.toContain('/prompts/submit');
    expect(hero).not.toContain('/en/studio');
    expect(hero).not.toContain('/en/prompts');
  });

  it('tightens the mobile band while keeping the lg values', () => {
    expect(hero).toContain('pt-24 pb-8 lg:pt-36 lg:pb-20');
  });

  it('re-homes the lede below lg, once, after the first rail', () => {
    const lede = renderToStaticMarkup(<HeroLede dict={dict} />);
    expect(lede).toContain('data-hero-lede');
    expect(lede).toContain('lg:hidden');
    expect(lede).toContain(dict.hero.lede);
    expect(lede).not.toContain('/prompts/submit');
  });
});
