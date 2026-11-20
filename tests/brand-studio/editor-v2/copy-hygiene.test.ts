import { describe, expect, it } from 'vitest';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/** The editing studio copy names no vendor, tool, engine or reference product, and quotes no money. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

const VENDORS = [
  'gemini',
  'hydrogen',
  'argon',
  'whisper',
  'ffmpeg',
  'webcodecs',
  'opencut',
  'openchatcut',
  'morphic',
  '모픽',
  'sunra',
  'elevenlabs',
  'seedance',
  'seedream',
  'slack',
  '슬랙',
  'supabase',
];

const REFERENCE_PRODUCTS = [
  /capcut/i,
  /캡컷/,
  /premiere/i,
  /프리미어/,
  /davinci/i,
  /다빈치/,
  /final\s*cut/i,
  /파이널\s*컷/,
  /descript/i,
  /\bcanva\b/i,
  /캔바/,
  /imovie/i,
  /\bvrew\b/i,
  /브루/,
  /adobe/i,
  /어도비/,
  /\brunway\b/i,
  /frame\.io/i,
];

describe('studio editor copy hygiene', () => {
  for (const [locale, copy] of [
    ['ko', studioEditorKo],
    ['en', studioEditorEn],
  ] as const) {
    const all = leaves(copy);

    it(`${locale} has copy to check`, () => {
      expect(all.length).toBeGreaterThan(50);
    });

    it(`${locale} names no vendor, tool or engine`, () => {
      const hits = all.filter(([, text]) => VENDORS.some((v) => text.toLowerCase().includes(v)));
      expect(hits).toEqual([]);
    });

    it(`${locale} quotes no money`, () => {
      const hits = all.filter(([, text]) => /\d[\d,.]*\s*원/.test(text) || text.includes('$') || /₩|krw|usd/i.test(text));
      expect(hits).toEqual([]);
    });

    it(`${locale} names no reference product`, () => {
      const hits = all.filter(([, text]) => REFERENCE_PRODUCTS.some((p) => p.test(text)));
      expect(hits).toEqual([]);
    });
  }

  it('ko and en have the same keys', () => {
    expect(leaves(studioEditorKo).map(([k]) => k)).toEqual(leaves(studioEditorEn).map(([k]) => k));
  });
});
