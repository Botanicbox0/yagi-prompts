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
    // The count line is the one templated string M1 adds; guard it explicitly.
    expect(placeholders(en.pricing.countsLine)).toEqual(['playbooks', 'prompts']);
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
    ]);

    const untranslated = enLeaves
      .filter(([key, value]) => !sharedByDesign.has(key) && koMap.get(key) === value)
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
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
    ]) {
      expect(enMap.has(key), `en.${key}`).toBe(true);
      expect(koMap.has(key), `ko.${key}`).toBe(true);
    }
  });
});
