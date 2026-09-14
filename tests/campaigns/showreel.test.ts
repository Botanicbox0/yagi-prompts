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
  it('lists four clips, two wide and two tall, in the grid order', () => {
    expect(CAMPAIGN_REEL.map((item) => item.orientation)).toEqual(['landscape', 'portrait', 'portrait', 'landscape']);
    expect(new Set(CAMPAIGN_REEL.map((item) => item.id)).size).toBe(4);
  });

  it('points every clip and poster at a file that exists under public/', () => {
    for (const item of CAMPAIGN_REEL) {
      for (const url of [item.src, item.poster]) {
        expect(url.startsWith('/reel/campaigns/'), url).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', url)), url).toBe(true);
      }
    }
  });

  it('has a caption for every clip in both languages, and the proof numbers the founder set', () => {
    for (const locale of LOCALES) {
      const landing = getDictionary(locale).campaigns.landing;
      for (const item of CAMPAIGN_REEL) {
        expect(landing.reel[item.id].title.trim(), `${locale}.${item.id}`).not.toBe('');
      }
      // 2026-09-13: "200만 뷰+", "파생 오가닉 콘텐츠 300+건", the platform unnamed.
      expect(landing.proofStat2Value).toMatch(/200만\+|2M\+/);
      expect(landing.proofStat3Value).toMatch(/^300(건)?\+$/);
      const text = Object.values(landing).filter((v): v is string => typeof v === 'string').join(' ');
      expect(text.toLowerCase()).not.toContain('morphic');
    }
  });
});
