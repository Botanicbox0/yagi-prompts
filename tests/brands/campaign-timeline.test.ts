import { describe, expect, it } from 'vitest';
import { campaignTimeline } from '@/lib/brands/workspace/timeline';
import type { CampaignParticipation } from '@/lib/campaigns/production';

/** docs/PLATFORM-2.0.md §16.4 — the stage a campaign is in, read from stored facts only. */
const base = { status: 'active' as const, productionMode: 'creator' as const, reports: [], posts: [], contents: [] };
const campaign = (over: Partial<CampaignParticipation>): CampaignParticipation => ({
  id: 'c', slug: 's', title: { en: 't', ko: 't' }, slots: 5, applied: 0, selected: 0, generated: 0, posted: 0, verified: 0, paid: 0, posts: [], status: 'recruiting', ...over,
});
const states = (t: ReturnType<typeof campaignTimeline>) => Object.fromEntries(t.stages.map((s) => [s.key, s.state]));

describe('campaign timeline', () => {
  it('puts a sent brief in TWINGS review', () => {
    const t = campaignTimeline({ ...base, status: 'requested' });
    expect(t.current).toBe('review');
    expect(states(t)).toMatchObject({ brief: 'done', review: 'current', recruiting: 'upcoming', settlement: 'upcoming' });
  });

  it('follows the linked campaign through recruiting, selection and production', () => {
    expect(campaignTimeline(base).current).toBe('recruiting');
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'recruiting', applied: 3 })] }).current).toBe('recruiting');
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'selecting', applied: 9 })] }).current).toBe('selection');
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'running', selected: 5 })] }).current).toBe('production');
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'selecting', posted: 1 })] }).current).toBe('production');
  });

  it('moves to report, then settlement while approved posts are unpaid', () => {
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'closed', verified: 5, paid: 5 })] }).current).toBe('report');
    expect(campaignTimeline({ ...base, participation: [campaign({ status: 'closed', verified: 5, paid: 2 })] }).current).toBe('settlement');
    expect(campaignTimeline({ ...base, status: 'completed', participation: [campaign({ status: 'closed', verified: 5, paid: 3 })] }).current).toBe('settlement');
    const done = campaignTimeline({ ...base, status: 'completed', reports: [{} as never], participation: [campaign({ status: 'closed', verified: 5, paid: 5 })] });
    expect(done.current).toBe('done');
    expect(done.stages.every((s) => s.state === 'done')).toBe(true);
  });

  it('skips recruiting, selection and settlement for a studio production', () => {
    const t = campaignTimeline({ ...base, productionMode: 'studio' });
    expect(t.current).toBe('production');
    expect(states(t)).toMatchObject({ review: 'done', recruiting: 'skipped', selection: 'skipped', production: 'current', settlement: 'skipped' });
    expect(campaignTimeline({ ...base, productionMode: 'studio', status: 'completed' }).current).toBe('report');
  });

  it('marks nothing current on a cancelled campaign', () => {
    const t = campaignTimeline({ ...base, status: 'cancelled' });
    expect(t.current).toBe('cancelled');
    expect(t.stages.some((s) => s.state === 'current')).toBe(false);
  });
});
