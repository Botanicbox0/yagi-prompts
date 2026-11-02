import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminHarness, expectOk, type AdminHarness } from '@/tests/helpers/admin';
import { runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import { loadCampaignBySlug, loadApplication } from '@/lib/campaigns/repo';
import { applyToCampaign, loadApplyState, loadMyCampaigns, reportCampaignViews, submitCampaignPost } from '@/lib/campaigns/service';
import { loadCampaignCatalog } from '@/lib/campaigns/catalog';

/**
 * The creator's side of docs/CAMPAIGNS.md: apply (with the field-level refusal), the slot and
 * rate limits, the post link with its platform check, and the seven-day number.
 */

const CREATOR = 'f0000000-0000-4000-8000-000000000001';
const creator: Viewer = { tier: 'free', userId: CREATOR, email: 'free@playbook.test', isAdmin: false, locale: 'ko' };
const anon: Viewer = { tier: 'anon', userId: null, email: null, isAdmin: false, locale: null };

const FORM = {
  slug: 'seoul-94-reel',
  titleEn: 'Seoul 94',
  titleKo: '서울 94',
  summaryEn: 'Be the interviewee.',
  summaryKo: '인터뷰 주인공이 되어보세요.',
  hostName: 'MORPHIC',
  hostKind: 'brand',
  platforms: ['instagram'],
  deliverable: 'reel',
  slots: '1',
  applicationsCloseAt: '2027-01-01T00:00',
  postDeadlineAt: '2027-02-01T00:00',
  payoutModel: 'flat',
  payoutFlat: '30000',
  holdDays: '7',
  disclosure: 'on',
};

const GOOD = { pitch: 'I post 90s-style edits every week.', snsUrl: 'https://instagram.com/hana', followerCount: '1,200', consent: true };

describe('applying, posting and reporting as a creator', () => {
  let h: AdminHarness;
  let slug = '';
  beforeEach(async () => {
    h = await adminHarness();
    const sql = runner(h.db);
    await seedProfile(sql, { id: CREATOR, email: 'free@playbook.test' });
    expectOk(await h.run('campaign.create', FORM));
    const row = (await loadCampaignBySlug(sql, FORM.slug))!;
    expectOk(await h.run('campaign.status', { id: row.id, to: 'recruiting' }));
    slug = row.slug;
  });
  afterEach(async () => {
    await h.close();
  });

  it('refuses the anonymous, names the bad field, and accepts a real application once', async () => {
    const sql = runner(h.db);
    expect(await applyToCampaign({ sql }, anon, slug, GOOD)).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await applyToCampaign({ sql }, creator, slug, { ...GOOD, pitch: 'hi' })).toMatchObject({ ok: false, code: 'invalid', field: 'pitch' });
    expect(await applyToCampaign({ sql }, creator, slug, { ...GOOD, consent: false })).toMatchObject({ ok: false, code: 'invalid', field: 'consent' });
    expect(await applyToCampaign({ sql }, creator, slug, { ...GOOD, followerCount: 'lots' })).toMatchObject({ ok: false, code: 'invalid', field: 'followerCount' });

    const first = await applyToCampaign({ sql }, creator, slug, GOOD);
    expect(first).toMatchObject({ ok: true, resubmitted: false });
    // Editing while still `applied` replaces the pitch rather than adding a second row.
    const second = await applyToCampaign({ sql }, creator, slug, { ...GOOD, pitch: 'Updated: I also cut TikToks.' });
    expect(second).toMatchObject({ ok: true, resubmitted: true });
    const campaign = (await loadCampaignBySlug(sql, slug))!;
    const app = (await loadApplication(sql, campaign.id, CREATOR))!;
    expect(app.pitch).toBe('Updated: I also cut TikToks.');
    expect(app.followerCount).toBe(1200);

    const state = (await loadApplyState({ sql }, slug, CREATOR))!;
    expect(state.campaign).not.toHaveProperty('budgetCents');
    expect(state.campaign.payout).not.toBeNull(); // The applicant still sees their consent terms.
    const publicCatalog = await loadCampaignCatalog(sql);
    expect(publicCatalog.campaigns[0]).not.toHaveProperty('payout');
    expect(publicCatalog.campaigns[0]).not.toHaveProperty('budgetCents');
    expect(state.open).toBe(true);
    expect(state.existing?.status).toBe('applied');
    expect(state.slotsLeft).toBe(1); // applying does not take a slot; selection does
  });

  it('remembers SNS only when requested and prefills only the same creator application', async () => {
    const sql = runner(h.db);
    expect((await loadApplyState({ sql }, slug, CREATOR))?.snsPrefill).toBeNull();
    expect(await applyToCampaign({ sql }, creator, slug, GOOD)).toMatchObject({ ok: true });
    expect((await sql.query<{ sns_url: string | null }>('select sns_url from profiles where id=$1', [CREATOR])).rows[0]?.sns_url).toBeNull();
    expect(await applyToCampaign({ sql }, creator, slug, { ...GOOD, rememberSns: true })).toMatchObject({ ok: true });
    expect((await sql.query<{ sns_url: string | null }>('select sns_url from profiles where id=$1', [CREATOR])).rows[0]?.sns_url).toBe(GOOD.snsUrl);
    expect((await loadApplyState({ sql }, slug, CREATOR))?.snsPrefill).toBe(GOOD.snsUrl);
    expect((await loadApplyState({ sql }, slug, null))?.snsPrefill).toBeNull();
  });

  it('rolls back the application if remembering the SNS fails', async () => {
    const sql = runner(h.db);
    const broken = { ...sql, transaction: <T,>(fn: (tx: typeof sql) => Promise<T>) => sql.transaction(tx => fn({ ...tx, query: async (text, params) => {
      if (text.startsWith('update profiles set sns_url')) throw new Error('profile unavailable');
      return tx.query(text, params);
    } })) };
    await expect(applyToCampaign({ sql: broken }, creator, slug, { ...GOOD, rememberSns: true })).rejects.toThrow('profile unavailable');
    expect((await loadApplyState({ sql }, slug, CREATOR))?.existing).toBeNull();
    expect((await sql.query('select * from campaign_application_writes where creator_id=$1', [CREATOR])).rows).toHaveLength(0);
  });

  it('locks the pitch after selection and refuses a new applicant when the slots are gone', async () => {
    const sql = runner(h.db);
    await applyToCampaign({ sql }, creator, slug, GOOD);
    const campaign = (await loadCampaignBySlug(sql, slug))!;
    const app = (await loadApplication(sql, campaign.id, CREATOR))!;
    expectOk(await h.run('campaignApplication.select', { id: app.id, version: app.version }));

    expect(await applyToCampaign({ sql }, creator, slug, { ...GOOD, pitch: 'Trying to rewrite after selection.' })).toEqual({ ok: false, code: 'locked' });

    await seedProfile(sql, { id: 'f0000000-0000-4000-8000-000000000002', email: 'pro@playbook.test' });
    const other: Viewer = { ...creator, userId: 'f0000000-0000-4000-8000-000000000002' };
    expect(await applyToCampaign({ sql }, other, slug, GOOD)).toEqual({ ok: false, code: 'slots_full' });
  });

  it('takes the post link only from a selected creator, on a named platform, then the view count', async () => {
    const sql = runner(h.db);
    await applyToCampaign({ sql }, creator, slug, GOOD);
    const campaign = (await loadCampaignBySlug(sql, slug))!;
    let app = (await loadApplication(sql, campaign.id, CREATOR))!;

    // Not selected yet → no link.
    expect(await submitCampaignPost({ sql }, creator, app.id, { postUrl: 'https://www.instagram.com/reel/x' })).toEqual({ ok: false, code: 'not_selected' });
    expectOk(await h.run('campaignApplication.select', { id: app.id, version: app.version }));
    // Selected, but the campaign is still recruiting — posting opens when the admin moves it on.
    expect(await submitCampaignPost({ sql }, creator, app.id, { postUrl: 'https://www.instagram.com/reel/x' })).toEqual({ ok: false, code: 'not_open' });
    expectOk(await h.run('campaign.status', { id: campaign.id, to: 'selecting' }));

    expect(await submitCampaignPost({ sql }, creator, app.id, { postUrl: 'not a link' })).toMatchObject({ ok: false, code: 'invalid' });
    // TikTok link on an Instagram-only campaign.
    expect(await submitCampaignPost({ sql }, creator, app.id, { postUrl: 'https://www.tiktok.com/@hana/video/1' })).toEqual({ ok: false, code: 'wrong_platform' });
    // Someone else's application id is "not found" for this creator, never "forbidden".
    expect(await submitCampaignPost({ sql }, { ...creator, userId: 'f0000000-0000-4000-8000-000000000003' }, app.id, { postUrl: 'https://www.instagram.com/reel/x' })).toEqual({ ok: false, code: 'not_found' });

    expect(await submitCampaignPost({ sql }, creator, app.id, { postUrl: 'https://www.instagram.com/reel/x' })).toEqual({ ok: true });
    app = (await loadApplication(sql, campaign.id, CREATOR))!;
    expect(app.status).toBe('posted');
    expect(app.postPlatform).toBe('instagram');

    expect(await reportCampaignViews({ sql }, creator, app.id, { views: '7,811' })).toEqual({ ok: true });
    app = (await loadApplication(sql, campaign.id, CREATOR))!;
    expect(app.viewsSnapshot).toBe(7811);
    expect(app.metricsSource).toBe('self');

    const mine = await loadMyCampaigns({ sql }, CREATOR);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ canPost: false, canReportViews: true });
    expect(mine[0]!.campaign.slug).toBe(slug);
    expect(mine[0]!.campaign).not.toHaveProperty('budgetCents');
  });
});
