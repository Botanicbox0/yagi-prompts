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
