import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASE_STUDIES, formatCampaignMetric, type CampaignCaseStudy } from '@/lib/campaigns/case-studies';

describe('the approved public Morphic case manifest', () => {
  it('keeps the launch evidence separate from the September follow-up', () => {
    expect(CASE_STUDIES.map((study) => study.id)).toEqual([
      'morphic-90s-interview',
      'morphic-september-kr-jp',
    ]);
    expect(CASE_STUDIES[0]?.metrics).toEqual([
      { id: 'films', value: 9, relation: 'exact' },
      { id: 'views', value: 2_000_000, relation: 'at_least' },
      { id: 'organic', value: 300, relation: 'at_least' },
    ]);
    expect(CASE_STUDIES[1]?.metrics).toEqual([]);
    expect(CASE_STUDIES.map((study) => study.period)).toEqual(['2026-08', '2026-09']);
    expect(CASE_STUDIES.map((study) => study.copyKey)).toEqual(['morphic90s', 'morphicSeptember']);
    expect(CASE_STUDIES[0]?.sourceUrl).toBe('https://morphic.com/resources/how-to/make-90s-street-style-interview-video');
    expect(CASE_STUDIES[1]?.sourceUrl).toBeNull();
    expect(CASE_STUDIES[0]?.metrics.map((metric) => formatCampaignMetric(metric, 'ko'))).toEqual(['9편', '200만+', '300건+']);
    expect(CASE_STUDIES[0]?.metrics.map((metric) => formatCampaignMetric(metric, 'en'))).toEqual(['9', '2M+', '300+']);
  });

  it('ships only anonymised local filenames for the approved campaign films', () => {
    const media = CASE_STUDIES.flatMap<CampaignCaseStudy['media'][number]>((study) => study.media);
    expect(media).toHaveLength(4);
    for (const item of media) {
      for (const url of [item.src, item.poster]) {
        expect(url.startsWith('/reel/brands/morphic-'), url).toBe(true);
        expect(existsSync(join(process.cwd(), 'public', url)), url).toBe(true);
        expect(url).not.toContain('@');
        expect(url).toMatch(/^\/reel\/brands\/morphic-(?:august|september)-0[12]\.(?:mp4|jpg)$/);
      }
    }
  });
});
