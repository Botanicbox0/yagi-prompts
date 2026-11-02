import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_REEL } from '@/lib/campaigns/showreel';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LOCALES } from '@/lib/i18n/config';

/**
 * The showreel is four static files and a caption each. What can break silently is a manifest entry
 * whose file was never committed (the tile would paint a black box) or a caption the dictionary lost
 * — so that is what is pinned.
 */
describe('the campaigns showreel', () => {
  it('lists the three approved format studies with both wide and tall work', () => {
    expect(CAMPAIGN_REEL.map((item) => item.id)).toEqual(['city', 'y2k', 'tea']);
    expect(new Set(CAMPAIGN_REEL.map((item) => item.id)).size).toBe(CAMPAIGN_REEL.length);
    expect(CAMPAIGN_REEL.some((item) => item.orientation === 'landscape')).toBe(true);
    expect(CAMPAIGN_REEL.some((item) => item.orientation === 'portrait')).toBe(true);
  });

  it('points every clip and poster at a file that exists under public/', () => {
    for (const item of CAMPAIGN_REEL) {
      for (const url of [item.src, item.poster]) {
        expect(url.startsWith('/reel/brands/'), url).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', url)), url).toBe(true);
      }
      expect(item.src).not.toContain('@');
      expect(item.poster).not.toContain('@');
    }
  });

  it('has a caption for every format study in both languages', () => {
    for (const locale of LOCALES) {
      const landing = getDictionary(locale).brandLanding;
      for (const item of CAMPAIGN_REEL) {
        expect(landing.formats[item.id].title.trim(), `${locale}.${item.id}`).not.toBe('');
        expect(landing.formats[item.id].line.trim(), `${locale}.${item.id}.line`).not.toBe('');
      }
    }
  });
});
