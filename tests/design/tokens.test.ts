import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const globals = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/**
 * PLAN §5.1 / §5.2 / §4 — `app/globals.css` is the single token source (Tailwind v4 CSS-first,
 * no tailwind.config.js). These assertions are the contract M1 builds against.
 */
describe('design tokens (§5.1/§5.2/§4)', () => {
  it('declares the theme statically so no token is tree-shaken away', () => {
    expect(globals).toContain('@theme static');
    expect(globals).not.toContain('tailwind.config');
  });

  it('is two inks plus one accent — the classic hyperlink blue', () => {
    expect(globals).toContain('--color-black: #000000');
    expect(globals).toContain('--color-white: #ffffff');
    expect(globals).toContain('--color-blue: #0000ee');
    expect(globals).toContain('--color-line-light: rgba(0, 0, 0, 0.12)');
    expect(globals).toContain('--color-line-dark: rgba(255, 255, 255, 0.16)');
    // anti-slop: no gradients, no glass, no coloured shadows
    expect(globals).not.toMatch(/linear-gradient|backdrop-filter|box-shadow:\s*0 \d+px \d+px rgba\((?!0, 0, 0)/);
  });

  it('scales the display face 64px → 180px', () => {
    expect(globals).toContain('--text-display: clamp(4rem, 12vw, 11.25rem)');
    expect(globals).toContain('--text-display--line-height: 0.9');
    expect(globals).toContain('--text-display--font-weight: 900');
    // KO display runs ~0.85× at the same slot
    expect(globals).toContain('html:lang(ko) .text-display');
    // …and the rule has to OUTRANK the `text-display` utility, or Korean silently renders at the
    // full English size (M1 found it doing exactly that from `@layer base`).
    const utilities = globals.slice(globals.indexOf('@layer utilities'));
    expect(utilities).toContain('html:lang(ko) .text-display');
    expect(utilities).toContain('html:lang(ko) .text-title');
    expect(globals.slice(0, globals.indexOf('@layer utilities'))).not.toContain(
      'html:lang(ko) .text-display',
    );
  });

  it('carries the §4 layout math, including the 1440 rail tier', () => {
    expect(globals).toContain('--breakpoint-rail: 90rem');
    expect(globals).toContain('--container-rail: 18.75rem');
    expect(globals).toContain('--container-content: 62.5rem');
    expect(globals).toContain('--container-detail: 45rem');
    expect(globals).toContain('--container-stepindex: 13.75rem');
    expect(globals).toContain('--spacing-gutter: clamp(1.5rem, 3vw, 4rem)');
  });

  it('keeps the KO stacks free of latin-only display faces (§5.2)', () => {
    const koBlock = globals.slice(globals.indexOf('html:lang(ko) {'));
    const koStacks = koBlock.slice(0, koBlock.indexOf('}'));
    expect(koStacks).toContain('Pretendard Variable');
    expect(koStacks).not.toContain('big-shoulders');
    expect(koStacks).not.toContain('anton-sc');
  });

  it('drives section inversion from data-theme, never mix-blend-mode (§4)', () => {
    expect(globals).toContain("@custom-variant dark (&:where([data-theme='dark']");
    // the word appears in a comment explaining why it is NOT used; the declaration must not exist
    expect(globals).not.toMatch(/mix-blend-mode\s*:/);
  });

  /**
   * Regression guard (M1). Tailwind v4 flattens `@theme` variables that reference other custom
   * properties, so the generated `bg-surface` / `text-on-surface` / `border-hairline` utilities
   * bake in the LIGHT values and stop inverting — which reads as black-on-black chrome over the
   * dark hero. The utilities-layer override below is what keeps them live.
   */
  it('keeps the surface utilities pointed at the live theme variables', () => {
    const overrides = globals.slice(globals.indexOf('@layer utilities'));
    for (const [selector, declaration] of [
      ['.bg-surface', 'background-color: var(--surface)'],
      ['.text-on-surface', 'color: var(--on-surface)'],
      ['.border-hairline', 'border-color: var(--hairline)'],
      ['.bg-hairline', 'background-color: var(--hairline)'],
    ]) {
      expect(overrides, selector).toContain(selector!);
      expect(overrides, declaration).toContain(declaration!);
    }
    // and both inversion states must be declared, not just the dark one
    expect(globals).toContain("[data-theme='light']");
    expect(globals).toContain("[data-theme='dark']");
  });

  /**
   * §5.1 names one accent, #0000EE. It measures 2.23:1 on pure black, so every eyebrow, link and
   * lock glyph the design puts on an inverted section would fail WCAG AA. The dark surface gets
   * the same hue lifted into range; this pins that it stays in range.
   */
  it('keeps the accent legible on both inks (WCAG AA, 4.5:1)', () => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const n = parseInt(hex.replace('#', ''), 16);
      return (
        0.2126 * channel((n >> 16) & 255) +
        0.7152 * channel((n >> 8) & 255) +
        0.0722 * channel(n & 255)
      );
    };
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };

    const darkBlock = globals.slice(globals.indexOf("[data-theme='dark']"));
    const accent = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(darkBlock)?.[1];
    expect(accent, 'dark surfaces must declare a literal accent').toBeTruthy();

    expect(contrast(accent!, '#000000')).toBeGreaterThanOrEqual(4.5);
    // the light surface keeps the plan's exact hyperlink blue
    expect(globals).toContain('--accent: var(--color-blue)');
    expect(contrast('#0000ee', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('carries the §5.3 interaction inventory as real rules, not comments', () => {
    for (const marker of [
      '.text-swap__b', // 3 · text-swap hover
      '[data-reveal-line]', // 4 · giant type reveal
      '@keyframes playbook-marquee', // 5 · marquee
      'animation: playbook-marquee 40s linear infinite', // 5 · 40s loop
      '.marquee:hover .marquee__track', // 5 · pause on hover
      '.card:hover .card__media > *', // 6 · media zoom
      'transform: scale(1.03)', // 6 · 1.03
      'translate3d(0, -2px, 0)', // 6 · −2px lift
      ".wipe[data-anim='circle']", // 2 · circular wipe
      '.ad-rail-fixed', // 7 · rail, fixed variant
      '.ad-rail-sticky', // 7 · rail, reduced-motion variant
      '.panel', // 1 · sticky scenes
    ]) {
      expect(globals, marker).toContain(marker);
    }
    // §5.3-6 is explicit that the type must not scale with the media
    expect(globals).not.toMatch(/\.card:hover\s*\{[^}]*scale\(/);
  });

  it('treats prefers-reduced-motion as a kill switch (§5.3/§5.4)', () => {
    expect(globals).toContain('@media (prefers-reduced-motion: reduce)');
    const provider = readFileSync(
      fileURLToPath(new URL('../../components/motion/scroll-provider.tsx', import.meta.url)),
      'utf8',
    );
    // Lenis must not initialise at all, and ScrollTrigger must be wired exactly once.
    expect(provider).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(provider).toContain('if (query.matches)');
    expect(provider).toContain('ScrollTrigger.scrollerProxy');
    expect(provider).toContain('autoRaf: false');
    expect(provider).toContain("pinType: 'fixed'");
    expect(provider).toContain('gsap.ticker.lagSmoothing(0)');
  });
});
