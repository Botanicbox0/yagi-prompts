import { describe, expect, it } from 'vitest';
import {
  ApplySchema,
  CampaignFormSchema,
  PayoutRuleSchema,
  parsePayoutRule,
  parseRequirements,
  platformOfUrl,
  recruitBlockers,
} from '@/lib/campaigns/schemas';
import {
  acceptsApplications,
  acceptsPosts,
  applicationStep,
  canApplicationTransition,
  canCampaignTransition,
  computePayout,
  formatWon,
  holdUntil,
  holdsSlot,
  isApplicationTerminal,
  isCampaignPublic,
  needsMetrics,
  payoutReleasable,
} from '@/lib/campaigns/state';

/**
 * docs/CAMPAIGNS.md §3–§4 as tests. The money and the seven-day hold are the parts a founder will
 * be asked about by a creator, so they are pinned to the 원.
 */

const NOW = Date.parse('2026-09-10T00:00:00.000Z');

describe('the campaign lifecycle', () => {
  it('walks draft → recruiting → selecting → running → closed → archived, and no shortcuts', () => {
    expect(canCampaignTransition('draft', 'recruiting')).toBe(true);
    expect(canCampaignTransition('recruiting', 'selecting')).toBe(true);
    expect(canCampaignTransition('selecting', 'running')).toBe(true);
    expect(canCampaignTransition('running', 'closed')).toBe(true);
    expect(canCampaignTransition('closed', 'archived')).toBe(true);
    expect(canCampaignTransition('draft', 'running')).toBe(false);
    expect(canCampaignTransition('closed', 'recruiting')).toBe(false);
    expect(canCampaignTransition('archived', 'draft')).toBe(false);
  });

  it('shows recruiting, selecting and running publicly — not drafts, not the closed', () => {
    expect(isCampaignPublic('recruiting')).toBe(true);
    expect(isCampaignPublic('running')).toBe(true);
    expect(isCampaignPublic('draft')).toBe(false);
    expect(isCampaignPublic('closed')).toBe(false);
  });

  it('takes applications only while recruiting and before the deadline', () => {
    const open = { status: 'recruiting' as const, applicationsCloseAt: '2026-09-20T00:00:00.000Z' };
    expect(acceptsApplications(open, NOW)).toBe(true);
    expect(acceptsApplications(open, Date.parse('2026-09-21T00:00:00.000Z'))).toBe(false);
    expect(acceptsApplications({ ...open, status: 'selecting' }, NOW)).toBe(false);
    expect(acceptsApplications({ ...open, applicationsCloseAt: null }, NOW)).toBe(false);
  });

  it('takes posts while running (or still selecting) and before the post deadline', () => {
    const running = { status: 'running' as const, postDeadlineAt: '2026-10-01T00:00:00.000Z' };
    expect(acceptsPosts(running, NOW)).toBe(true);
    expect(acceptsPosts({ ...running, status: 'selecting' }, NOW)).toBe(true);
    expect(acceptsPosts({ ...running, status: 'closed' }, NOW)).toBe(false);
    expect(acceptsPosts(running, Date.parse('2026-10-02T00:00:00.000Z'))).toBe(false);
  });
});

describe('an application', () => {
  it('moves applied → selected → posted → verified → paid, with rejection as a loop back to posted', () => {
    expect(canApplicationTransition('applied', 'selected')).toBe(true);
    expect(canApplicationTransition('selected', 'posted')).toBe(true);
    expect(canApplicationTransition('posted', 'verified')).toBe(true);
    expect(canApplicationTransition('posted', 'rejected')).toBe(true);
    expect(canApplicationTransition('rejected', 'posted')).toBe(true);
    expect(canApplicationTransition('verified', 'paid')).toBe(true);
    // No skipping the review, no paying the unverified, no resurrecting the declined.
    expect(canApplicationTransition('selected', 'verified')).toBe(false);
    expect(canApplicationTransition('posted', 'paid')).toBe(false);
    expect(canApplicationTransition('declined', 'selected')).toBe(false);
    expect(canApplicationTransition('paid', 'verified')).toBe(false);
  });

  it('knows which statuses occupy a slot and which are the end of the road', () => {
    expect(holdsSlot('selected')).toBe(true);
    expect(holdsSlot('paid')).toBe(true);
    expect(holdsSlot('applied')).toBe(false);
    expect(holdsSlot('declined')).toBe(false);
    expect(isApplicationTerminal('paid')).toBe(true);
    expect(isApplicationTerminal('expired')).toBe(true);
    expect(isApplicationTerminal('rejected')).toBe(false);
  });

  it('maps to the five creator-facing steps', () => {
    expect(applicationStep('applied')).toBe(1);
    expect(applicationStep('rejected')).toBe(2); // back to "make and post it"
    expect(applicationStep('posted')).toBe(3);
    expect(applicationStep('paid')).toBe(5);
    expect(applicationStep('declined')).toBe(0);
  });
});

describe('the seven-day hold', () => {
  it('starts at verification and refuses payment before it ends', () => {
    const verifiedAt = '2026-09-10T09:00:00.000Z';
    const until = holdUntil(verifiedAt, 7);
    expect(until.toISOString()).toBe('2026-09-17T09:00:00.000Z');
    const app = { status: 'verified' as const, holdUntil: until.toISOString() };
    expect(payoutReleasable(app, Date.parse('2026-09-17T08:59:59.000Z'))).toBe(false);
    expect(payoutReleasable(app, Date.parse('2026-09-17T09:00:00.000Z'))).toBe(true);
    expect(payoutReleasable({ ...app, status: 'posted' }, Date.parse('2026-10-01T00:00:00.000Z'))).toBe(false);
    expect(payoutReleasable({ ...app, holdUntil: null }, Date.parse('2026-10-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('payout arithmetic — integer 원, floor and cap', () => {
  const flat = PayoutRuleSchema.parse({ model: 'flat', flatCents: 30_000 });
  const perView = PayoutRuleSchema.parse({ model: 'per_view', perThousandViewsCents: 500, minCents: 10_000, maxCents: 100_000 });
  const hybrid = PayoutRuleSchema.parse({ model: 'hybrid', flatCents: 20_000, perThousandViewsCents: 300, maxCents: 80_000 });

  it('pays a flat fee regardless of views, and needs no snapshot', () => {
    expect(computePayout(flat, { views: 0 }).cents).toBe(30_000);
    expect(computePayout(flat, { views: 1_000_000 }).cents).toBe(30_000);
    expect(needsMetrics(flat)).toBe(false);
  });

  it('pays per thousand views pro rata, floored and capped', () => {
    expect(needsMetrics(perView)).toBe(true);
    expect(computePayout(perView, { views: 1_500 })).toMatchObject({ cents: 10_000, floored: true }); // 750원 < floor
    expect(computePayout(perView, { views: 50_000 })).toMatchObject({ cents: 25_000, floored: false, capped: false });
    expect(computePayout(perView, { views: 1_000_000 })).toMatchObject({ cents: 100_000, capped: true });
    expect(computePayout(perView, { views: 7_811 }).cents).toBe(3_906 < 10_000 ? 10_000 : 3_906); // the Brandazine median, floored
  });

  it('adds the variable part on top of the flat fee in hybrid, and caps the total', () => {
    expect(computePayout(hybrid, { views: 0 })).toMatchObject({ cents: 20_000, flatCents: 20_000, variableCents: 0 });
    expect(computePayout(hybrid, { views: 100_000 })).toMatchObject({ cents: 50_000, variableCents: 30_000 });
    expect(computePayout(hybrid, { views: 1_000_000 })).toMatchObject({ cents: 80_000, capped: true, variableCents: 60_000 });
  });

  it('refuses a rule that cannot pay anyone', () => {
    expect(parsePayoutRule({ model: 'flat', flatCents: 0 })).toBeNull();
    expect(parsePayoutRule({ model: 'per_view', perThousandViewsCents: 0 })).toBeNull();
    expect(parsePayoutRule({ model: 'per_view', perThousandViewsCents: 500, minCents: 50_000, maxCents: 10_000 })).toBeNull();
    expect(parsePayoutRule({ model: 'hybrid', flatCents: 50_000, perThousandViewsCents: 100, maxCents: 10_000 })).toBeNull();
    expect(parsePayoutRule({ model: 'flat', flatCents: 30_000 })?.holdDays).toBe(7);
  });

  it('formats 원 for both locales', () => {
    expect(formatWon(30_000, 'ko')).toBe('30,000원');
    expect(formatWon(30_000, 'en')).toBe('₩30,000');
  });
});

describe('links, requirements and the recruit gate', () => {
  it('names the platform of a posted link by host, or null', () => {
    expect(platformOfUrl('https://www.instagram.com/reel/abc')).toBe('instagram');
    expect(platformOfUrl('https://vt.tiktok.com/ZS123/')).toBe('tiktok');
    expect(platformOfUrl('https://youtu.be/xyz')).toBe('youtube');
    expect(platformOfUrl('https://example.com/video')).toBeNull();
    expect(platformOfUrl('not a url')).toBeNull();
  });

  it('normalises hashtags and mentions and defaults the ad disclosure ON', () => {
    const req = parseRequirements({ hashtags: ['#twings', 'seoul94'], mentions: ['@twings.app'] });
    expect(req).toEqual({ hashtags: ['twings', 'seoul94'], mentions: ['twings.app'], disclosure: true });
    expect(parseRequirements(undefined).disclosure).toBe(true);
  });

  it('accepts a real application and refuses a thin one', () => {
    expect(
      ApplySchema.safeParse({ pitch: 'I make 90s-style edits weekly.', snsUrl: 'https://instagram.com/hana', followerCount: 1200, consent: true }).success,
    ).toBe(true);
    expect(ApplySchema.safeParse({ pitch: 'hi', snsUrl: 'https://instagram.com/hana', followerCount: 1200, consent: true }).success).toBe(false);
    expect(ApplySchema.safeParse({ pitch: 'I make 90s-style edits weekly.', snsUrl: 'https://instagram.com/hana', followerCount: 1200, consent: false }).success).toBe(false);
  });

  it('lists what a campaign still lacks before it can recruit', () => {
    const ready = {
      title: { en: 'Seoul 94', ko: '서울 94' },
      summary: { en: 'Be the interviewee.', ko: '인터뷰 주인공이 되어보세요.' },
      brief: null,
      applicationsCloseAt: '2026-09-20T00:00:00.000Z',
      postDeadlineAt: '2026-10-01T00:00:00.000Z',
      payout: PayoutRuleSchema.parse({ model: 'flat', flatCents: 30_000 }),
      slots: 10,
    };
    expect(recruitBlockers(ready)).toEqual([]);
    expect(recruitBlockers({ ...ready, title: { en: 'Seoul 94', ko: '' }, payout: null })).toEqual([
      'title (en + ko)',
      'payout rule',
    ]);
    expect(recruitBlockers({ ...ready, postDeadlineAt: '2026-09-19T00:00:00.000Z' })).toEqual([
      'a post deadline after the application deadline',
    ]);
  });

  it('parses the admin form shape with a payout rule and requirements inside', () => {
    const parsed = CampaignFormSchema.safeParse({
      slug: 'seoul-94-reel',
      title: { en: 'Seoul 94', ko: '서울 94' },
      summary: { en: 's', ko: '요' },
      brief: null,
      hostName: 'MORPHIC',
      hostKind: 'brand',
      hostUrl: null,
      styleSlug: '90s-seoul-interview',
      platforms: ['instagram'],
      deliverable: 'reel',
      slots: 15,
      applicationsCloseAt: '2026-09-20T00:00:00.000Z',
      postDeadlineAt: '2026-10-01T00:00:00.000Z',
      payout: { model: 'hybrid', flatCents: 20_000, perThousandViewsCents: 300, maxCents: 80_000 },
      requirements: { hashtags: ['#광고', 'twings'], mentions: [], disclosure: true },
      budgetCents: 1_500_000,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.requirements.hashtags).toEqual(['광고', 'twings']);
  });
});
