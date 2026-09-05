import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminHarness, expectOk, type AdminHarness } from '@/tests/helpers/admin';
import { runner } from '@/tests/helpers/pglite';
import {
  loadApplication,
  loadApplicationById,
  loadCampaignBySlug,
  loadPublicCampaigns,
  upsertApplication,
  submitPost,
} from '@/lib/campaigns/repo';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';

/**
 * docs/CAMPAIGNS.md, end to end against the real schema (0013/0014 in PGlite): author a campaign,
 * open it, a creator applies, the admin selects, the creator posts, the admin verifies, the hold
 * refuses payment, the hold ends, the admin pays. The founder's whole promise to a creator, as a
 * test that fails if any step is loosened.
 */

const CREATOR = 'f0000000-0000-4000-8000-000000000001'; // the `free` fixture profile

const FORM = {
  slug: 'seoul-94-reel',
  titleEn: 'Seoul 94',
  titleKo: '서울 94',
  summaryEn: 'Be the interviewee in a 1994 news segment.',
  summaryKo: '1994년 뉴스 인터뷰의 주인공이 되어보세요.',
  hostName: 'MORPHIC',
  hostKind: 'brand',
  styleSlug: '90s-seoul-interview',
  platforms: ['instagram', 'tiktok'],
  deliverable: 'reel',
  slots: '2',
  applicationsCloseAt: '2026-09-20T00:00',
  postDeadlineAt: '2026-10-01T00:00',
  payoutModel: 'hybrid',
  payoutFlat: '20000',
  payoutPerK: '300',
  payoutMin: '0',
  payoutMax: '80000',
  holdDays: '7',
  hashtags: '#광고, twings seoul94',
  mentions: '@twings.app',
  disclosure: 'on',
  budgetCents: '1500000',
};

describe('campaigns — the whole lifecycle through the dispatcher', () => {
  let h: AdminHarness;
  beforeEach(async () => {
    h = await adminHarness();
    // Applications carry a creator FK; a fresh PGlite has no profiles until a test seeds them.
    const sql = runner(h.db);
    await seedProfile(sql, { id: CREATOR, email: 'free@playbook.test' });
    await seedProfile(sql, { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
  });
  afterEach(async () => {
    await h.close();
  });

  it('authors a draft with a hybrid payout rule and normalised requirements', async () => {
    const outcome = expectOk(await h.run('campaign.create', FORM));
    expect(outcome.code).toBe('created');
    const row = await loadCampaignBySlug(runner(h.db), 'seoul-94-reel');
    expect(row?.status).toBe('draft');
    expect(row?.payout).toMatchObject({ model: 'hybrid', flatCents: 20_000, perThousandViewsCents: 300, maxCents: 80_000, holdDays: 7 });
    expect(row?.requirements).toEqual({ hashtags: ['광고', 'twings', 'seoul94'], mentions: ['twings.app'], disclosure: true });
    expect(row?.platforms).toEqual(['instagram', 'tiktok']);
    expect(row?.budgetCents).toBe(1_500_000);
    // Drafts are invisible.
    expect(await loadPublicCampaigns(runner(h.db))).toEqual([]);
    expect(h.campaignsRevalidated).toBe(0);
  });

  it('refuses a duplicate slug and a rule that cannot pay', async () => {
    expectOk(await h.run('campaign.create', FORM));
    expect(await h.run('campaign.create', FORM)).toMatchObject({ ok: false, code: 'duplicateSlug' });
    expect(await h.run('campaign.create', { ...FORM, slug: 'other', payoutModel: 'flat', payoutFlat: '0' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });

  it('opens recruiting only through the gate, and the listing sees it', async () => {
    expectOk(await h.run('campaign.create', { ...FORM, titleKo: '' }));
    const draft = await loadCampaignBySlug(runner(h.db), 'seoul-94-reel');
    const blocked = await h.run('campaign.status', { id: draft!.id, to: 'recruiting' });
    expect(blocked).toMatchObject({ ok: false, code: 'notPublishable' });
    expect(blocked.detail).toContain('title (en + ko)');

    expectOk(await h.run('campaign.update', { ...FORM, id: draft!.id }));
    expect(await h.run('campaign.status', { id: draft!.id, to: 'running' })).toMatchObject({ ok: false, code: 'badTransition' });
    expectOk(await h.run('campaign.status', { id: draft!.id, to: 'recruiting' }));
    const live = await loadPublicCampaigns(runner(h.db));
    expect(live.map((c) => c.slug)).toEqual(['seoul-94-reel']);
    expect(live[0]?.publishedAt).not.toBeNull();
    expect(h.campaignsRevalidated).toBe(1);
  });

  it('walks a creator from application to payout, holding the money for seven days', async () => {
    const sql = runner(h.db);
    expectOk(await h.run('campaign.create', FORM));
    const campaign = (await loadCampaignBySlug(sql, 'seoul-94-reel'))!;
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'recruiting' }));

    // The creator applies (the same repo call the apply action makes).
    const { created } = await upsertApplication(sql, {
      campaignId: campaign.id,
      creatorId: CREATOR,
      pitch: 'I post 90s-style edits every week.',
      snsUrl: 'https://instagram.com/hana',
      followerCount: 1200,
    });
    expect(created).toBe(true);
    let app = (await loadApplication(sql, campaign.id, CREATOR))!;
    expect(app.status).toBe('applied');

    // Paying an applicant, or verifying one, is refused by the state machine.
    expect(await h.run('campaignApplication.pay', { id: app.id, version: app.version })).toMatchObject({ ok: false, code: 'badTransition' });
    expect(await h.run('campaignApplication.verify', { id: app.id, version: app.version })).toMatchObject({ ok: false, code: 'badTransition' });

    // Selected — with the fresh version token; a stale one is a stale review.
    expect(await h.run('campaignApplication.select', { id: app.id, version: 'stale' })).toMatchObject({ ok: false, code: 'staleReview' });
    expect(expectOk(await h.run('campaignApplication.select', { id: app.id, version: app.version })).code).toBe('selected');
    app = (await loadApplicationById(sql, app.id))!;
    expect(app.status).toBe('selected');
    expect(app.selectedAt).not.toBeNull();

    // The creator posts the link (the repo call the post action makes); the platform is derived.
    expect(await submitPost(sql, app.id, { postUrl: 'https://www.instagram.com/reel/abc123/', postPlatform: 'instagram' })).toBe(true);
    app = (await loadApplicationById(sql, app.id))!;
    expect(app.status).toBe('posted');

    // Verified: the hold starts, and a hybrid rule has no amount yet (it needs the snapshot).
    expect(expectOk(await h.run('campaignApplication.verify', { id: app.id, version: app.version })).code).toBe('verified');
    app = (await loadApplicationById(sql, app.id))!;
    expect(app.status).toBe('verified');
    expect(app.holdUntil).not.toBeNull();
    expect(Date.parse(app.holdUntil!) - Date.parse(app.verifiedAt!)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(app.payoutCents).toBeNull();

    // Paying inside the hold is refused by code.
    expect(await h.run('campaignApplication.pay', { id: app.id, version: app.version })).toMatchObject({ ok: false, code: 'notReleasable' });

    // End the hold (the clock moves; the row's token changes with the update, so re-read).
    await sql.query(`update campaign_applications set hold_until = now() - interval '1 minute' where id = $1`, [app.id]);
    app = (await loadApplicationById(sql, app.id))!;
    // …still refused without the snapshot a view-based rule needs.
    expect(await h.run('campaignApplication.pay', { id: app.id, version: app.version })).toMatchObject({ ok: false, code: 'metricsRequired' });

    // The admin records the seven-day number, then pays: 20,000 + 300 × 7.811 = 22,343원.
    expectOk(await h.run('campaignApplication.metrics', { id: app.id, version: app.version, views: '7811' }));
    app = (await loadApplicationById(sql, app.id))!;
    expect(app.viewsSnapshot).toBe(7811);
    expect(app.metricsSource).toBe('admin');
    const paid = expectOk(await h.run('campaignApplication.pay', { id: app.id, version: app.version, payoutRef: 'KB-20260917-001' }));
    expect(paid.code).toBe('paid');
    expect(paid.detail).toBe('22343');
    app = (await loadApplicationById(sql, app.id))!;
    expect(app.status).toBe('paid');
    expect(app.payoutCents).toBe(22_343);
    expect(app.payoutRef).toBe('KB-20260917-001');
    expect(app.paidAt).not.toBeNull();

    // Paid is terminal.
    expect(await h.run('campaignApplication.reject', { id: app.id, version: app.version, reason: 'nope nope' })).toMatchObject({ ok: false, code: 'badTransition' });
  });

  it('refuses the selection past the slot count, and lets a rejected post be resubmitted', async () => {
    const sql = runner(h.db);
    expectOk(await h.run('campaign.create', { ...FORM, slots: '1' }));
    const campaign = (await loadCampaignBySlug(sql, 'seoul-94-reel'))!;
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'recruiting' }));

    await upsertApplication(sql, { campaignId: campaign.id, creatorId: CREATOR, pitch: 'First applicant here.', snsUrl: 'https://instagram.com/a', followerCount: 10 });
    await upsertApplication(sql, { campaignId: campaign.id, creatorId: ADMIN_VIEWER.userId!, pitch: 'Second applicant here.', snsUrl: 'https://instagram.com/b', followerCount: 20 });
    const first = (await loadApplication(sql, campaign.id, CREATOR))!;
    const second = (await loadApplication(sql, campaign.id, ADMIN_VIEWER.userId!))!;

    expectOk(await h.run('campaignApplication.select', { id: first.id, version: first.version }));
    expect(await h.run('campaignApplication.select', { id: second.id, version: second.version })).toMatchObject({ ok: false, code: 'slotsFull' });
    expect(expectOk(await h.run('campaignApplication.decline', { id: second.id, version: second.version })).code).toBe('declined');

    // The selected creator posts something wrong; the reviewer rejects with a reason; they post again.
    expect(await submitPost(sql, first.id, { postUrl: 'https://instagram.com/p/wrong', postPlatform: 'instagram' })).toBe(true);
    let app = (await loadApplicationById(sql, first.id))!;
    expect(await h.run('campaignApplication.reject', { id: app.id, version: app.version, reason: 'no' })).toMatchObject({ ok: false, code: 'invalid' });
    expectOk(await h.run('campaignApplication.reject', { id: app.id, version: app.version, reason: 'Missing #광고 in the caption.' }));
    app = (await loadApplicationById(sql, first.id))!;
    expect(app.status).toBe('rejected');
    expect(app.rejectReason).toContain('#광고');
    expect(await submitPost(sql, app.id, { postUrl: 'https://instagram.com/p/right', postPlatform: 'instagram' })).toBe(true);
    app = (await loadApplicationById(sql, first.id))!;
    expect(app.status).toBe('posted');
    expect(app.rejectReason).toBeNull();
  });

  it('is refused, every operation, for a non-admin', async () => {
    for (const op of ['campaign.create', 'campaign.status', 'campaignApplication.select', 'campaignApplication.pay']) {
      const outcome = await h.run(op, FORM, { tier: 'free', userId: CREATOR, email: 'free@playbook.test', isAdmin: false, locale: 'en' });
      expect(outcome, op).toMatchObject({ ok: false, code: 'forbidden' });
    }
  });
});
