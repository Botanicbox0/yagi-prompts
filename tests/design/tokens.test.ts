import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const globals = readFileSync(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8');

/**
 * PLAN §5.1 / §5.2 / §4 — `app/globals.css` is the single token source (Tailwind v4 CSS-first,
 * no tailwind.config.js). These assertions are the contract M1 builds against.
 */
/**
 * The full text of an at-rule block, matched by counting braces.
 *
 * A naive search for the next closing brace stops at the first NESTED rule, which quietly turns an
 * assertion about a whole media block into an assertion about two characters.
 */
function braceBlock(css: string, header: string): string {
  const start = css.indexOf(header);
  if (start === -1) throw new Error(`no such block: ${header}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated block: ${header}`);
}

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

  /**
   * M9 design review, finding 8. The contests surface set every display size as a raw
   * `text-[clamp(…)]` utility, which put those sizes outside the type system — and, the part that
   * shows, outside the §5.2 Korean downscale: `html:lang(ko) .text-display` cannot reach a size
   * that was never named, so Hangul rendered at the full English size with a latin leading and
   * collided line-to-line. Each contest slot is named once here, with its 0.85× twin.
   */
  it('names the §14.2 contest display slots, each with a KO twin (§5.2)', () => {
    const utilities = globals.slice(globals.indexOf('@layer utilities'));
    for (const slot of [
      '.text-contest-poster',
      '.text-contest-poster-prize',
      '.text-contest-card',
      '.text-contest-prize',
      '.text-contest-section',
    ]) {
      expect(utilities, slot).toContain(`${slot} {`);
      expect(utilities, `ko ${slot}`).toContain(`html:lang(ko) ${slot} {`);
    }

    // The three sizes finding 1 set on the hero poster, in the three steps its grid moves in.
    expect(utilities).toContain('font-size: clamp(4.75rem, 9vw, 8.5rem)');
    // …and the prize band's own slot (finding 3).
    expect(utilities).toContain('font-size: clamp(3.5rem, 8vw, 7rem)');
    // …and one size for every section heading (finding 7).
    expect(utilities).toContain('font-size: clamp(2rem, 4vw, 3rem)');

    // Every Korean twin buys back leading: Hangul fills its em box where latin does not. (The
    // per-breakpoint twins restate the size only; the leading is set once, on the base rule.)
    for (const slot of ['poster', 'poster-prize', 'card', 'prize', 'section']) {
      const rules = [
        ...utilities.matchAll(
          new RegExp(`html:lang\\(ko\\) \\.text-contest-${slot} \\{([^}]*)\\}`, 'g'),
        ),
      ];
      expect(rules.length, slot).toBeGreaterThan(0);
      expect(
        rules.some((rule) => rule[1]!.includes('line-height: 1')),
        `ko .text-contest-${slot} must buy back leading`,
      ).toBe(true);
    }
  });

  /**
   * Post-M9 production render-verify, second finding. The premise band's stat values were the last
   * display slot still set as a raw `text-[clamp(…)]`, i.e. outside the type system — the finding-8
   * failure mode, and it showed the same way: no KO twin can reach an unnamed size, and Pretendard
   * sets the latin token "SEEDANCE 2.5" ~30% wider than Big Shoulders, so under :lang(ko) the value
   * painted 49px past its own grid cell (measured on production). The slot is named with a 0.85×
   * twin like every contest slot above it.
   */
  it('names the premise stat slot with a KO twin (§5.2)', () => {
    const utilities = globals.slice(globals.indexOf('@layer utilities'));
    expect(utilities).toContain('.text-stat {');
    expect(utilities).toContain('html:lang(ko) .text-stat {');
    expect(utilities).toContain('font-size: clamp(1.9125rem, 3.4vw, 2.7625rem)');

    const sections = readFileSync(
      fileURLToPath(new URL('../../components/landing/sections.tsx', import.meta.url)),
      'utf8',
    );
    expect(sections).toContain('text-stat');
    expect(sections).not.toContain('text-[clamp(2.25rem,4vw,3.25rem)]');
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

  /**
   * Founder pass (2026-08-13, fonts). Two stack facts that each broke a real render:
   * Satoshi finally exists (the EN body was falling to system faces — "the strongest remaining
   * AI-template tell"), and the KO mono stack carries Pretendard right behind Geist Mono —
   * Geist has no Hangul, so mono-styled Korean sentences were rendering through the browser's
   * last-resort fallback.
   */
  it('loads Satoshi at the head of the EN body, and Hangul never falls out of the mono stack', () => {
    expect(globals).toMatch(/--stack-body:\s*var\(--font-satoshi\)/);
    const koBlock = globals.slice(globals.indexOf('html:lang(ko) {'));
    const koStacks = koBlock.slice(0, koBlock.indexOf('}'));
    // The alias must come FIRST: after the geist var it sits behind that variable's generic
    // `monospace` terminal and never matches anything (per-glyph fallback stops at a generic).
    expect(koStacks).toMatch(/--stack-mono:\s*'Pretendard Hangul',\s*var\(--font-geist-mono\)/);

    // The generated alias file: present, latin-free, linked from every root layout.
    const hangulMono = readFileSync(
      fileURLToPath(new URL('../../public/fonts/pretendard/pretendard-hangul-mono.css', import.meta.url)),
      'utf8',
    );
    expect(hangulMono).toContain("font-family: 'Pretendard Hangul';");
    expect(hangulMono).not.toMatch(/unicode-range:[^;]*U\+00/i);
    for (const layout of ['../../app/(marketing)/[locale]/layout.tsx', '../../app/(app)/layout.tsx', '../../app/(admin)/layout.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(layout, import.meta.url)), 'utf8');
      expect(source, layout).toContain('/fonts/pretendard/pretendard-hangul-mono.css');
    }

    const fonts = readFileSync(
      fileURLToPath(new URL('../../app/fonts.ts', import.meta.url)),
      'utf8',
    );
    expect(fonts).toContain("variable: '--font-satoshi'");
    expect(fonts).toContain('satoshi-400.woff2');
    expect(fonts).toContain('satoshi-500.woff2');
    expect(fonts).toMatch(/satoshi\.variable/);
  });

  /**
   * Post-M9 production render-verify. `footer.hireCta` — "스튜디오와 함께 작업하기" — wrapped as
   * "…작업하 / 기" on the live contests page: display type breaking INSIDE a Korean word. Latin
   * never does this (spaces are its only break points), so §5's manual-line-break doctrine was
   * silently doing double duty as the only thing keeping Hangul whole wherever a string shipped
   * without authored breaks. `keep-all` makes spaces the break points for Korean too;
   * `overflow-wrap` stays as the emergency valve so one long unspaced compound can never push a
   * phone column into horizontal scroll.
   */
  it('breaks Korean at spaces, never inside a word (§5.2)', () => {
    const koBlock = braceBlock(globals, 'html:lang(ko) {');
    expect(koBlock).toContain('word-break: keep-all');
    expect(koBlock).toContain('overflow-wrap: break-word');
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

  /**
   * §5.3-3, and the bug M9 render-verify found in it.
   *
   * `.text-swap` clips its duplicate with `overflow: hidden`, and the duplicate rested at `110%` of
   * its OWN height while the clip box is that height plus 0.2em of padding. At tight line-heights
   * (`leading-none`, the 1.2 of `text-eyebrow`) the duplicate's top edge landed a hair inside the
   * box and painted a sub-pixel ghost under every nav link and CTA on the site — visible as colour
   * fringing on the footer links in the M9 screenshots.
   *
   * Two rules now stop it, and the test pins both because they fail in different ways: the geometry
   * clears the box at ANY line-height, and with motion off the duplicate leaves the box model
   * entirely (a transform can be overridden or interrupted; `display: none` cannot).
   */
  it('never lets the text-swap duplicate paint at rest (§5.3-3)', () => {
    // Geometry: the offset is expressed against the padding, not as a bare percentage.
    expect(globals).toContain('transform: translate3d(0, calc(100% + 0.2em), 0)');
    expect(globals).toContain('transform: translate3d(0, calc(-100% - 0.2em), 0)');
    expect(globals).not.toContain('translate3d(0, 110%, 0)');
    expect(globals).not.toContain('translate3d(0, -110%, 0)');

    // Structure: inside the reduced-motion block, the duplicate is removed outright.
    const block = braceBlock(globals, '@media (prefers-reduced-motion: reduce)');
    expect(block).toContain('.text-swap__b');
    expect(block).toContain('display: none !important');
    expect(block).toContain('.text-swap__a');
  });
});
