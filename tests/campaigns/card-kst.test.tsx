import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignCardView } from '@/components/campaigns/card';
import { campaignLabels } from '@/components/campaigns/labels';
import type { CampaignCard } from '@/lib/campaigns/catalog';
import { parseKstDateTimeLocal } from '@/lib/campaigns/dates';
import { getDictionary } from '@/lib/i18n/dictionaries';

// Audit P1-1: a deadline typed as 18:00 Korea time is shown to creators as 18:00 Korea time,
// not as the UTC calendar date (which would read a day early for late-night deadlines).
function card(closeAt: string): CampaignCard {
  return {
    id: '00000000-0000-4000-8000-000000000001', slug: 'kst-card', status: 'recruiting',
    title: { ko: '캠페인', en: 'Campaign' }, summary: { ko: '요약', en: 'Summary' }, brief: null,
    hostName: 'TWINGS', hostKind: 'studio', hostUrl: null, styleSlug: null, platforms: ['instagram'],
    deliverable: 'reel', slots: 3, slotsTaken: 0, applicationsCloseAt: closeAt, postDeadlineAt: null,
    requirements: {} as CampaignCard['requirements'], publishedAt: null,
  } as CampaignCard;
}

describe('campaign card deadline (KST)', () => {
  it('shows the Korea wall-clock the admin typed, in both languages', () => {
    const iso = parseKstDateTimeLocal('2026-10-01T00:30')!;
    expect(iso).toBe('2026-09-30T15:30:00.000Z');
    const now = new Date('2026-09-20T00:00:00Z');
    const ko = renderToStaticMarkup(<CampaignCardView card={card(iso)} style={null} locale="ko" labels={campaignLabels(getDictionary('ko'))} now={now} />);
    expect(ko).toContain('2026년 10월 1일');
    expect(ko).toContain('오전 12:30');
    const en = renderToStaticMarkup(<CampaignCardView card={card(iso)} style={null} locale="en" labels={campaignLabels(getDictionary('en'))} now={now} />);
    expect(en).toContain('Oct 1, 2026');
    expect(en).toContain('KST');
  });
});
