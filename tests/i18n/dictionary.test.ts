import { describe, expect, it } from 'vitest';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

/**
 * PLAN §3.9 — "both locales required", "manual bilingual authoring in v1".
 *
 * `tests/i18n/locale.test.ts` already compares the two dictionaries structurally; this file is the
 * completeness gate M1 adds: every key present in both, every value a non-empty string, and every
 * `{placeholder}` in an English string matched by the same placeholder in the Korean one. Shipping
 * a landing page in one language and a half-translated one in the other is the failure mode.
 */

type Leaf = [string, string];

function flatten(value: unknown, prefix = ''): Leaf[] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [[prefix, String(value)]];
}

const enLeaves = flatten(en);
const koLeaves = flatten(ko);
const enMap = new Map(enLeaves);
const koMap = new Map(koLeaves);

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe('dictionary completeness (§3.9)', () => {
  it('has identical key sets — no fallbacks, no orphans', () => {
    const missingInKo = [...enMap.keys()].filter((key) => !koMap.has(key));
    const extraInKo = [...koMap.keys()].filter((key) => !enMap.has(key));
    expect(missingInKo).toEqual([]);
    expect(extraInKo).toEqual([]);
  });

  it('has a non-empty value for every key in both locales', () => {
    for (const [key, value] of enLeaves) expect(value.trim(), `en.${key}`).not.toBe('');
    for (const [key, value] of koLeaves) expect(value.trim(), `ko.${key}`).not.toBe('');
  });

  it('keeps interpolation placeholders in step across locales', () => {
    for (const [key, value] of enLeaves) {
      expect(placeholders(koMap.get(key) ?? ''), key).toEqual(placeholders(value));
    }
    /**
     * The count line is the one templated string M1 added; guard it explicitly.
     *
     * M6 changed WHAT it counts, not that it is guarded: the pivot (§13) made prompt counts the
     * honest headline number, so the placeholders moved from `{prompts}/{playbooks}` to
     * `{yagi}/{community}` — the two rails §13.2 actually renders.
     */
    expect(placeholders(en.pricing.countsLine)).toEqual(['community', 'yagi']);
  });

  it('actually translates the prose rather than copying English into ko', () => {
    // A handful of values are legitimately identical in both locales (brand, ad slate, prices).
    const sharedByDesign = new Set([
      'meta.siteName',
      'nav.localeEn',
      'nav.localeKo',
      'footer.rights',
      'ad.placeholder',
      'ad.contact',
      'pricing.freePrice',
      'pricing.proPrice',
      'howItReads.stepsIndex',
      'howItReads.blocksIndex',
      'howItReads.unlockIndex',
      // M6: the studio's own mark. "YAGI" is a name, and a transliteration ("야기") would read as
      // a different brand rather than a translation — the same reason `meta.siteName` is here.
      'featured.badge',
      'admin.sourceYagi',
      // M9: "SNS" is the ordinary Korean word for the thing (SNS 계정), borrowed wholesale from
      // English and used unchanged in Korean copy. "소셜 미디어" would be a translation of the
      // English phrase rather than the Korean term for it.
      'admin.colEntrySns',
      // Founder pass: the verified-share stat is a figure, and a figure is locale-invariant.
      'premise.statTestedValue',
      // M10 §15: the cookie table's three display slots are figures (3 / +1 / $4 = 5), and a
      // figure is locale-invariant — the sentences around them are the translated part.
      'pricing.cookieSignupValue',
      'pricing.cookieWeeklyValue',
      'pricing.cookiePackValue',
    ]);

    const untranslated = enLeaves
      .filter(([key, value]) => !sharedByDesign.has(key) && koMap.get(key) === value)
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  /**
   * M7 — the product is called YAGI PROMPTS. The repo, the npm package and every internal
   * identifier keep the `playbook` codename on purpose, so a blanket grep would be wrong; what
   * belongs in a test is the USER-FACING half, which is exactly the dictionaries.
   *
   * The allowlist below is the whole point of the test: `library.title` is the one remaining
   * uppercase "PLAYBOOK", and it is the CONTENT TYPE ("every playbook we have published"), not the
   * brand. Any new one has to be justified here before it can ship.
   */
  describe('brand (M7)', () => {
    const contentNoun = new Set(['library.title']);

    it('is YAGI PROMPTS in both locales', () => {
      expect(en.meta.siteName).toBe('YAGI PROMPTS');
      expect(ko.meta.siteName).toBe('YAGI PROMPTS');
      expect(en.admin.brand).toContain('YAGI PROMPTS');
      expect(ko.admin.brand).toContain('YAGI PROMPTS');
    });

    it('leaves no old brand token in any user-facing string', () => {
      const stragglers = [...enLeaves, ...koLeaves]
        .filter(([key, value]) => !contentNoun.has(key) && /\bPLAYBOOK\b/.test(value))
        .map(([key]) => key);
      expect(stragglers).toEqual([]);
    });

    it('keeps the brand identical across locales — it is a name, not a translation', () => {
      expect(koMap.get('meta.siteName')).toBe(enMap.get('meta.siteName'));
    });
  });

  it('covers every M1 surface', () => {
    for (const key of [
      'hero.line1',
      'premise.line1',
      'howItReads.unlockBody',
      'marquee.label',
      'featured.emptyTitle',
      'pricing.countsLine',
      'faq.q6',
      'footer.hireLede',
      'ad.pitch',
      'nav.skipToContent',
      'category.pipeline',
      'difficulty.advanced',
      // M10 §15 — the cookies surface.
      'cookies.signinCta',
      'cookies.spendCta',
      'cookies.emptyTitle',
      'cookies.weeklyLine',
      'pricing.cookieRule',
    ]) {
      expect(enMap.has(key), `en.${key}`).toBe(true);
      expect(koMap.has(key), `ko.${key}`).toBe(true);
    }
  });
});
