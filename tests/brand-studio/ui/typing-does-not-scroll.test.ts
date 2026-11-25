import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Production, 2026-11-25: every key typed in the image studio's prompt scrolled the page down by about 100 px.
 *
 * The studio stylesheet put `scroll-padding-bottom: calc(var(--bs-dock-h) + 24px)` on the page so that a
 * focused tile would not land behind the floating prompt bar. Scroll padding belongs to the scroller, so it
 * also applied to the bar itself, which is sticky inside that bottom band and can never leave it: on every
 * input the browser tried to bring the caret "into view", could not, and scrolled again (also on focus, and for
 * keyboard focus in the rails).
 *
 * The clearance is now a scroll margin on what actually scrolls under the bar. This suite has no browser, so
 * this is a rule test; the behaviour was measured in headless Chromium (scrollY before and after focus, 20
 * typed characters, a Korean composition, an inserted sentence, select-all + delete: equal on the image and the
 * video studio; a wall tile behind the bar still scrolls clear of it when focused).
 */
const css = readFileSync(resolve(process.cwd(), 'app/(brand)/studio-v2.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { declarations }` pair, media blocks flattened. */
function rules(source: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) out.push({ selector: m[1]!.trim(), body: m[2]!.trim() });
  return out;
}

describe('typing in the prompt bar does not scroll the page', () => {
  const all = rules(css);

  it('puts no scroll padding on the page for the floating bar', () => {
    const padded = all.filter((rule) => /scroll-padding(-bottom|-block-end|-block)?\s*:/.test(rule.body));
    // The page scroller is the root element: nothing in the studio sheet may pad it.
    expect(padded.filter((rule) => /(^|[\s,>+~])(html|:root|body)\b/.test(rule.selector) && !/\s/.test(rule.selector.replace(/:has\([^)]*\)/g, '').trim()))).toEqual([]);
    expect(padded.filter((rule) => rule.body.includes('--bs-dock-h'))).toEqual([]);
  });

  it('keeps the clearance as a scroll margin on what scrolls under the bar, never on the bar', () => {
    const margins = all.filter((rule) => /scroll-margin-bottom\s*:[^;]*--bs-dock-h/.test(rule.body));
    expect(margins.length).toBeGreaterThan(0);
    for (const rule of margins) {
      expect(rule.selector).toMatch(/\.bs-wall/);
      // Not the bar, its field, or anything unscoped (a bare `*` would bring the loop back for sticky parts).
      expect(rule.selector).not.toMatch(/\.bs-dock|\.bs-prompt|data-studio-dock\]\s*\*/);
      expect(rule.selector).not.toMatch(/^(html[^ ]*\s+)?\*$/);
    }
  });
});
