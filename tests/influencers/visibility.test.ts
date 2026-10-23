import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import { applyToCampaign, loadApplyState } from '@/lib/campaigns/service';
import { audienceAccess, campaignAccess, loadVisibleCampaigns } from '@/lib/influencers/visibility';

/**
 * docs/PLATFORM-2.0.md §17.2 — one rule for the signed-in list, apply and acceptance:
 * public → everyone; influencers → a verified 3,000+ account (or a named target); invited → named
 * targets only. TWINGS_INFLUENCERS off → members see `public` only.
 */
const INFLUENCER = USER.buyer;
const MEMBER = USER.other;
const TARGET = 'a0000000-0000-4000-8000-00000000b003';
const viewer = (userId: string): Viewer => ({ tier: 'free', userId, email: null, isAdmin: false, locale: 'ko' });
const GOOD = { pitch: 'I post 90s-style edits every week.', snsUrl: 'https://instagram.com/hana', followerCount: '4,200', consent: true };

let h: BillingHarness;
const ids: Record<string, string> = {};
beforeAll(async () => {
  h = await billingDb();
  for (const id of [INFLUENCER, MEMBER, TARGET]) await seedProfile(h.sql, { id });
  for (const [slug, audience] of [['open-to-all', 'public'], ['for-influencers', 'influencers'], ['by-invitation', 'invited']] as const) {
    const { rows } = await h.sql.query<{ id: string }>(
      `insert into campaigns (slug, status, title, summary, host_name, host_kind, platforms, deliverable, slots, applications_close_at, post_deadline_at, published_at, payout, audience)
       values ($1, 'recruiting', '{"en":"t","ko":"t"}', '{"en":"s","ko":"s"}', 'Brand', 'brand', '{instagram}', 'reel', 3, '2027-11-01', '2027-11-15', now(), '{"model":"flat","flatCents":30000,"currency":"KRW","holdDays":7}', $2) returning id`,
      [slug, audience],
    );
    ids[slug] = rows[0]!.id;
  }
  await h.sql.query(
    "insert into social_accounts(user_id,platform,handle,profile_url,status,follower_count,measured_at) values($1,'instagram','hana','https://www.instagram.com/hana/','verified',3000,now()),($2,'tiktok','mina','https://www.tiktok.com/@mina','verified',2999,now())",
    [INFLUENCER, MEMBER],
  );
  await h.sql.query('insert into campaign_targets(campaign_id,user_id) values($1,$2)', [ids['by-invitation'], TARGET]);
});
afterAll(async () => h?.close());
afterEach(() => vi.unstubAllEnvs());

describe('who sees which campaign', () => {
  it('states the rule once', () => {
    const on = { open: true, influencer: false, targeted: false };
    expect(audienceAccess('public', { ...on, open: false })).toBe('ok');
    expect(audienceAccess('influencers', on)).toBe('influencer_required');
    expect(audienceAccess('influencers', { ...on, influencer: true })).toBe('ok');
    expect(audienceAccess('influencers', { ...on, targeted: true })).toBe('ok');
    expect(audienceAccess('invited', { ...on, influencer: true })).toBe('hidden');
    expect(audienceAccess('invited', { ...on, targeted: true })).toBe('ok');
    expect(audienceAccess('influencers', { open: false, influencer: true, targeted: true })).toBe('hidden');
  });

  it('lists per viewer with the flag on: influencer campaigns first, invited only for targets', async () => {
    vi.stubEnv('TWINGS_INFLUENCERS', 'on');
    const slugs = async (userId: string) => {
      const list = await loadVisibleCampaigns(h.sql, userId);
      return { influencer: list.influencer, forYou: list.forYou.map(c => c.row.slug), public: list.public.map(c => c.row.slug) };
    };
    expect(await slugs(INFLUENCER)).toEqual({ influencer: true, forYou: ['for-influencers'], public: ['open-to-all'] });
    expect(await slugs(MEMBER)).toEqual({ influencer: false, forYou: [], public: ['open-to-all'] });
    expect(await slugs(TARGET)).toEqual({ influencer: false, forYou: ['by-invitation'], public: ['open-to-all'] });
  });

  it('shows members public campaigns only while the flag is off', async () => {
    vi.stubEnv('TWINGS_INFLUENCERS', 'off');
    for (const userId of [INFLUENCER, MEMBER, TARGET]) {
      const list = await loadVisibleCampaigns(h.sql, userId);
      expect(list.forYou).toEqual([]);
      expect(list.public.map(c => c.row.slug)).toEqual(['open-to-all']);
    }
    expect(await campaignAccess(h.sql, ids['for-influencers']!, INFLUENCER)).toBe('hidden');
  });

  it('refuses on the server: apply page and apply action say influencer_required, invited is not found', async () => {
    vi.stubEnv('TWINGS_INFLUENCERS', 'on');
    const sql = h.sql;
    expect((await loadApplyState({ sql }, 'for-influencers', MEMBER))?.audienceBlock).toBe('influencer_required');
    expect(await applyToCampaign({ sql }, viewer(MEMBER), 'for-influencers', GOOD)).toEqual({ ok: false, code: 'influencer_required' });
    expect(await loadApplyState({ sql }, 'by-invitation', MEMBER)).toBeNull();
    expect(await applyToCampaign({ sql }, viewer(INFLUENCER), 'by-invitation', GOOD)).toEqual({ ok: false, code: 'not_found' });
    expect((await loadApplyState({ sql }, 'for-influencers', INFLUENCER))?.audienceBlock).toBeNull();
    expect(await applyToCampaign({ sql }, viewer(INFLUENCER), 'for-influencers', GOOD)).toMatchObject({ ok: true });
    expect(await applyToCampaign({ sql }, viewer(TARGET), 'by-invitation', GOOD)).toMatchObject({ ok: true });
    expect(await applyToCampaign({ sql }, viewer(MEMBER), 'open-to-all', GOOD)).toMatchObject({ ok: true });
    // Already on the campaign: a later change of status does not lock the member out of their own row.
    await sql.query("update social_accounts set status='expired' where user_id=$1", [INFLUENCER]);
    expect((await loadApplyState({ sql }, 'for-influencers', INFLUENCER))?.existing?.status).toBe('applied');
    expect((await loadApplyState({ sql }, 'for-influencers', INFLUENCER))?.audienceBlock).toBeNull();
    vi.stubEnv('TWINGS_INFLUENCERS', 'off');
    expect(await loadApplyState({ sql }, 'for-influencers', MEMBER)).toBeNull();
    expect(await loadApplyState({ sql }, 'open-to-all', null)).not.toBeNull();
  });
});
