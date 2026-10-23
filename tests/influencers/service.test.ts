import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { billingDb, seedProfile, USER, type BillingHarness } from '@/tests/helpers/billing';
import { assertRenderKey, type RenderStore } from '@/lib/renders/store';
import type { Viewer } from '@/lib/auth/identity';
import { INFLUENCER_MIN_FOLLOWERS, isInfluencer, normalizeProfileUrl, parseFollowerCount } from '@/lib/influencers/rules';
import { cleanEvidence, socialEvidenceKey } from '@/lib/influencers/evidence';
import { deleteSocialAccount, listSocialAccounts, ownSocialEvidence, setPoolConsent, socialState, submitSocialAccount, type SocialDeps } from '@/lib/influencers/service';
import { countSocialQueue, loadSocialQueue, rejectSocialAccount, verifySocialAccount } from '@/lib/influencers/admin';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';

/**
 * docs/PLATFORM-2.0.md §17.1 — the member's side (link, screenshot, five a day, unlink), the
 * administrator's side (a typed number, a reason, `influencer_since` once) and the one rule every
 * gate asks: a verified account at 3,000+, not a sum, not expired.
 */
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const admin = { tier: 'free', userId: ADMIN, email: null, isAdmin: true, locale: 'ko' } as Viewer;
const member = { tier: 'free', userId: USER.buyer, email: null, isAdmin: false, locale: 'ko' } as Viewer;

describe('profile links and counts', () => {
  it('spells each platform one way and refuses other hosts, posts and odd input', () => {
    expect(normalizeProfileUrl('instagram', 'https://www.instagram.com/Hana.Kim/?igsh=abc')).toEqual({ handle: 'hana.kim', url: 'https://www.instagram.com/hana.kim/' });
    expect(normalizeProfileUrl('instagram', 'instagram.com/hana')).toEqual({ handle: 'hana', url: 'https://www.instagram.com/hana/' });
    expect(normalizeProfileUrl('instagram', '@hana_k')).toEqual({ handle: 'hana_k', url: 'https://www.instagram.com/hana_k/' });
    expect(normalizeProfileUrl('tiktok', 'https://m.tiktok.com/@Hana.K')).toEqual({ handle: 'hana.k', url: 'https://www.tiktok.com/@hana.k' });
    expect(normalizeProfileUrl('youtube', 'https://youtube.com/@HanaTV')).toEqual({ handle: 'hanatv', url: 'https://www.youtube.com/@hanatv' });
    for (const [platform, raw] of [
      ['instagram', 'https://www.tiktok.com/@hana'],
      ['tiktok', 'https://www.instagram.com/hana/'],
      ['instagram', 'https://www.instagram.com/p/Cabc123/'],
      ['instagram', 'https://instagram.com.evil.example/hana'],
      ['instagram', 'https://user:pw@instagram.com/hana'],
      ['instagram', 'https://instagram.com:8443/hana'],
      ['instagram', 'ftp://instagram.com/hana'],
      ['tiktok', 'https://www.tiktok.com/hana'],
      ['youtube', 'https://youtube.com/watch?v=abcdefghijk'],
      ['instagram', 'hana kim'],
      ['instagram', 'https://instagram.com/%2e%2e/hana'],
      ['instagram', `@${'a'.repeat(40)}`],
      ['instagram', ''],
    ] as const) expect(normalizeProfileUrl(platform, raw), raw).toBeNull();
  });

  it('reads follower counts with commas and refuses words and negatives', () => {
    expect(parseFollowerCount('12,345')).toBe(12345);
    expect(parseFollowerCount(' 3 000 ')).toBe(3000);
    expect(parseFollowerCount('')).toBeNull();
    expect(parseFollowerCount(null)).toBeNull();
    for (const bad of ['1.2K', '-5', '3천', '99999999999', 2.5]) expect(parseFollowerCount(bad)).toBeUndefined();
  });

  it('keeps the screenshot key inside the private renders bucket shape', () => {
    const key = socialEvidenceKey('11111111-1111-4111-8111-111111111111');
    expect(key).toBe('social/11111111-1111-4111-8111-111111111111/evidence.jpg');
    expect(() => assertRenderKey(key)).not.toThrow();
    expect(() => assertRenderKey('social/../11111111-1111-4111-8111-111111111111/evidence.jpg')).toThrow();
    expect(() => assertRenderKey('other/11111111-1111-4111-8111-111111111111/evidence.jpg')).toThrow();
  });
});

describe('the linked accounts', () => {
  let h: BillingHarness, objects: Map<string, Uint8Array>;
  const now = new Date('2026-10-23T09:00:00Z');
  const shot = async (color = '#eeeeee', w = 750, ht = 1334, format: 'png' | 'jpeg' = 'png') => {
    const img = sharp({ create: { width: w, height: ht, channels: 3, background: color } }).withMetadata({ exif: { IFD0: { Make: 'SecretPhone' } } });
    return new Uint8Array(await (format === 'png' ? img.png() : img.jpeg()).toBuffer());
  };
  const store = (): RenderStore => ({
    name: 'local',
    put: async (k, b) => { objects.set(k, b); },
    read: async k => { const b = objects.get(k); if (!b) throw Error('missing'); return b; },
    delete: async k => { objects.delete(k); },
    url: async () => null,
  });
  const deps = (over: Partial<SocialDeps> = {}): SocialDeps => ({ sql: h.sql, store: store(), now, ...over });
  const submit = async (input: Partial<Parameters<typeof submitSocialAccount>[2]> = {}, userId: string | null = USER.buyer, over: Partial<SocialDeps> = {}) =>
    submitSocialAccount(deps(over), userId, { platform: 'instagram', profileUrl: '@hana', claimedCount: '4,200', poolConsent: false, bytes: await shot(), mime: 'image/png', ...input });
  const row = async (platform = 'instagram') => (await h.sql.query<Record<string, unknown>>('select * from social_accounts where user_id=$1 and platform=$2', [USER.buyer, platform])).rows[0]!;

  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: USER.buyer });
    await seedProfile(h.sql, { id: USER.other });
    await seedProfile(h.sql, { id: ADMIN, isAdmin: true });
    objects = new Map();
  });
  afterEach(async () => h.close());

  it('re-encodes the screenshot as a metadata-free JPEG at most 1600px and refuses other files', async () => {
    const clean = await cleanEvidence(await shot('#ffffff', 1170, 2532, 'jpeg'), 'image/jpeg');
    const meta = await sharp(clean).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
    await expect(cleanEvidence(await shot(), 'image/gif')).rejects.toThrow('bad_photo');
    await expect(cleanEvidence(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toThrow('bad_photo');
    await expect(cleanEvidence(await shot('#fff', 100, 100), 'image/png')).rejects.toThrow('bad_photo');
    await expect(cleanEvidence(new Uint8Array(5_000_001), 'image/png')).rejects.toThrow('bad_photo');
  });

  it('needs a session, a platform, a link on that platform, a readable count and a screenshot', async () => {
    expect(await submit({}, null)).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await submit({ platform: 'x' })).toEqual({ ok: false, code: 'bad_platform' });
    expect(await submit({ profileUrl: 'https://www.tiktok.com/@hana' })).toEqual({ ok: false, code: 'bad_url' });
    expect(await submit({ claimedCount: 'lots' })).toEqual({ ok: false, code: 'bad_count' });
    expect(await submit({ mime: 'image/webp' })).toEqual({ ok: false, code: 'bad_photo' });
    expect(objects.size).toBe(0);
    const ok = await submit({ poolConsent: true });
    expect(ok).toMatchObject({ ok: true });
    const stored = await row();
    expect(stored).toMatchObject({ status: 'submitted', source: 'manual', handle: 'hana', profile_url: 'https://www.instagram.com/hana/', claimed_count: 4200, follower_count: null, ai_state: 'queued' });
    expect(stored.pool_consent_at).not.toBeNull();
    expect([...objects.keys()]).toEqual([socialEvidenceKey(String(stored.id))]);
    const [view] = await listSocialAccounts(h.sql, USER.buyer, now);
    expect(view).toMatchObject({ platform: 'instagram', state: 'checking', followerCount: null, claimedCount: 4200, poolConsent: true, evidenceUrl: `/api/identity/social/${stored.id}/evidence` });
  });

  it('lets each member submit five times a day, counted across platforms and unlinks', async () => {
    for (let i = 0; i < 4; i++) expect(await submit({ profileUrl: `@hana${i}` })).toMatchObject({ ok: true });
    const tiktok = await submit({ platform: 'tiktok', profileUrl: '@hana' });
    expect(tiktok).toMatchObject({ ok: true });
    if (!tiktok.ok) throw Error();
    expect(await deleteSocialAccount(deps(), USER.buyer, tiktok.id)).toEqual({ ok: true });
    expect(await submit({ platform: 'youtube', profileUrl: '@hanatv' })).toEqual({ ok: false, code: 'rate_limited' });
    expect(await submit({ platform: 'youtube', profileUrl: '@hanatv' }, USER.other)).toMatchObject({ ok: true });
    expect(await submit({ platform: 'youtube', profileUrl: '@hanatv' }, USER.buyer, { now: new Date(now.getTime() + 86_400_001) })).toMatchObject({ ok: true });
  });

  it('shows the owner their screenshot, never a stranger, and unlinking removes row and file', async () => {
    const r = await submit();
    if (!r.ok) throw Error(r.code);
    expect(await ownSocialEvidence(h.sql, USER.buyer, r.id)).toBe(socialEvidenceKey(r.id));
    expect(await ownSocialEvidence(h.sql, USER.other, r.id)).toBeNull();
    expect(await ownSocialEvidence(h.sql, USER.buyer, 'not-a-uuid')).toBeNull();
    expect(await deleteSocialAccount(deps(), USER.other, r.id)).toEqual({ ok: false, code: 'not_found' });
    expect(await setPoolConsent(deps(), USER.other, r.id, true)).toEqual({ ok: false, code: 'not_found' });
    expect(await setPoolConsent(deps(), USER.buyer, r.id, true)).toEqual({ ok: true });
    expect((await row()).pool_consent_at).not.toBeNull();
    expect(await deleteSocialAccount(deps(), USER.buyer, r.id)).toEqual({ ok: true });
    expect(objects.size).toBe(0);
    expect(await listSocialAccounts(h.sql, USER.buyer)).toEqual([]);
  });

  it('counts one verified account at 3,000 or more — not 2,999, not a sum, not a submission, not expired', async () => {
    expect(INFLUENCER_MIN_FOLLOWERS).toBe(3000);
    const ig = await submit({ claimedCount: '50000' });
    const tt = await submit({ platform: 'tiktok', profileUrl: '@hana' });
    if (!ig.ok || !tt.ok) throw Error();
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(false);
    expect(await verifySocialAccount(h.sql, admin, { id: ig.id, followerCount: 2999 }, now)).toEqual({ ok: true, influencer: false });
    expect(await verifySocialAccount(h.sql, admin, { id: tt.id, followerCount: 2999 }, now)).toEqual({ ok: true, influencer: false });
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(false);
    await h.sql.query("update social_accounts set follower_count=3000 where id=$1", [ig.id]);
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(true);
    await h.sql.query("update social_accounts set status='expired' where id=$1", [ig.id]);
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(false);
    expect(await isInfluencer(h.sql, null)).toBe(false);
  });

  it('confirms only with a typed number from an administrator, and sets influencer_since once', async () => {
    const r = await submit();
    if (!r.ok) throw Error(r.code);
    expect(await verifySocialAccount(h.sql, member, { id: r.id, followerCount: 9000 }, now)).toEqual({ ok: false, code: 'forbidden' });
    expect(await verifySocialAccount(h.sql, { ...member, isAdmin: true }, { id: r.id, followerCount: 9000 }, now)).toEqual({ ok: false, code: 'forbidden' });
    expect(await verifySocialAccount(h.sql, admin, { id: r.id }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await verifySocialAccount(h.sql, admin, { id: r.id, followerCount: -1 }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await countSocialQueue(h.sql)).toBe(1);
    expect(await verifySocialAccount(h.sql, admin, { id: r.id, followerCount: 4100 }, now)).toEqual({ ok: true, influencer: true });
    expect(await row()).toMatchObject({ status: 'verified', follower_count: 4100, source: 'manual', reviewed_by: ADMIN, recheck_at: null });
    expect((await row()).measured_at).toEqual(now);
    const since = async () => (await h.sql.query<{ influencer_since: Date | null }>('select influencer_since from profiles where id=$1', [USER.buyer])).rows[0]!.influencer_since;
    expect(await since()).toEqual(now);
    expect(await countSocialQueue(h.sql)).toBe(0);
    expect(await verifySocialAccount(h.sql, admin, { id: r.id, followerCount: 5000 }, now)).toEqual({ ok: false, code: 'badTransition' });
    expect(await submit()).toEqual({ ok: false, code: 'already_verified' });

    // 90 days on: shown as expired, still counting; the new screenshot is a re-check that keeps the status.
    const later = new Date(now.getTime() + 91 * 86_400_000);
    expect((await listSocialAccounts(h.sql, USER.buyer, later))[0]).toMatchObject({ state: 'expired', followerCount: 4100 });
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(true);
    expect(await submit({}, USER.buyer, { now: later })).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ status: 'verified', follower_count: 4100, ai_state: 'queued' });
    expect((await listSocialAccounts(h.sql, USER.buyer, later))[0]).toMatchObject({ state: 'checking', recheck: true });
    expect(await isInfluencer(h.sql, USER.buyer)).toBe(true);
    expect(await verifySocialAccount(h.sql, admin, { id: r.id, followerCount: 6000 }, later)).toEqual({ ok: true, influencer: true });
    expect(await since()).toEqual(now);
  });

  it('declines with the reason the member reads, and a declined account submits again from scratch', async () => {
    const r = await submit();
    if (!r.ok) throw Error(r.code);
    expect(await rejectSocialAccount(h.sql, admin, { id: r.id, reason: '  ' }, now)).toEqual({ ok: false, code: 'invalid' });
    expect(await rejectSocialAccount(h.sql, member, { id: r.id, reason: '핸들이 보이지 않아요' }, now)).toEqual({ ok: false, code: 'forbidden' });
    expect(await rejectSocialAccount(h.sql, admin, { id: r.id, reason: '핸들이 보이지 않아요' }, now)).toEqual({ ok: true, influencer: false });
    expect((await listSocialAccounts(h.sql, USER.buyer, now))[0]).toMatchObject({ state: 'rejected', reason: '핸들이 보이지 않아요' });
    expect((await loadSocialQueue(h.sql))!.decided.map(i => i.id)).toEqual([r.id]);
    expect(await submit()).toMatchObject({ ok: true });
    expect(await row()).toMatchObject({ status: 'submitted', note: null, reviewed_by: null });
    expect(socialState({ status: 'verified', measured_at: now, recheck_at: null }, now)).toBe('verified');
  });

  it('runs both decisions through the admin registry, refusing an empty count or reason before the service', async () => {
    const r = await submit();
    if (!r.ok) throw Error(r.code);
    const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
    expect(ADMIN_OPERATIONS['social.verify'].parse(form({ id: r.id, followerCount: '' }))).toMatchObject({ ok: false });
    expect(ADMIN_OPERATIONS['social.reject'].parse(form({ id: r.id, reason: ' ' }))).toMatchObject({ ok: false });
    const parsed = ADMIN_OPERATIONS['social.verify'].parse(form({ id: r.id, followerCount: '12,000' }));
    expect(parsed).toEqual({ ok: true, value: { id: r.id, followerCount: 12000 } });
    if (!parsed.ok) throw Error();
    const ctx = { sql: h.sql, viewer: admin, storage: {} as never };
    expect(await ADMIN_OPERATIONS['social.verify'].run(ctx, parsed.value)).toMatchObject({ ok: true, code: 'saved', to: '/admin/community#social' });
  });
});
