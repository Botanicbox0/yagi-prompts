import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArkOpenApiError, type ArkAsset, type ArkAssetsClient, type ArkAssetStatus } from '@/lib/ark/assets';
import { loadIdentityAssetByPhoto, loadIdentityGroup } from '@/lib/identity/repo';
import {
  assetLibraryMode,
  completeIdentityVerification,
  ensureIdentityAsset,
  ensureVirtualGroup,
  identityStatusFor,
  needsIdentity,
  needsLiveness,
  photoSha256,
  startIdentityVerification,
  type IdentityDeps,
} from '@/lib/identity/service';
import { billingDb, seedProfile, type BillingHarness } from '@/tests/helpers/billing';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';

/**
 * The real-person identity on a real database with the bank faked at its seam: a session opens,
 * the callback is exchanged for a group, a photo becomes an asset by content hash, and the
 * capacity check refuses the 51st person before liveness rather than after.
 */

const SITE = 'https://twings.test';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

interface FakeBank extends ArkAssetsClient {
  sessions: Array<{ callbackUrl: string }>;
  groups: Array<{ name: string; groupType: string | undefined }>;
  groupError: Error | null;
  created: Array<{ groupId: string; url: string; assetType: string; name?: string }>;
  assetStatus: ArkAssetStatus;
  resultGroupId: string;
}

function fakeBank(): FakeBank {
  const bank: FakeBank = {
    sessions: [],
    groups: [],
    groupError: null,
    created: [],
    assetStatus: 'Processing',
    resultGroupId: 'grp-1',
    async createVisualValidateSession(input) {
      bank.sessions.push({ callbackUrl: input.callbackUrl });
      return { bytedToken: `tok-${bank.sessions.length}`, h5Link: 'https://h5.bank.test/live?session=abc', callbackUrl: input.callbackUrl };
    },
    async getVisualValidateResult() {
      return { groupId: bank.resultGroupId };
    },
    async createAsset(input) {
      bank.created.push({ groupId: input.groupId, url: input.url, assetType: input.assetType, ...(input.name ? { name: input.name } : {}) });
      return { id: `asset-${bank.created.length}` };
    },
    async getAsset(input) {
      const id = typeof input === 'string' ? input : input.id;
      const asset: ArkAsset = {
        id,
        groupId: 'grp-1',
        status: bank.assetStatus,
        createdAt: '2026-09-10T00:00:00Z',
        lastInferenceAt: null,
        assetType: 'Image',
        name: '',
        url: 'https://store.test/photo.jpg',
        updatedAt: '2026-09-10T00:00:00Z',
        projectName: 'default',
        moderation: { strategy: 'Default' },
      };
      return asset;
    },
    async listAssets() {
      return [];
    },
    async listAssetGroups() {
      return [];
    },
    async deleteAsset() {},
    async createAssetGroup(input) {
      if (bank.groupError) throw bank.groupError;
      bank.groups.push({ name: input.name, groupType: input.groupType });
      return { id: `aigc-${bank.groups.length}` };
    },
    async deleteAssetGroup() {},
  };
  return bank;
}

describe('the real-person identity', () => {
  let h: BillingHarness;
  let bank: FakeBank;
  const NOW = new Date('2026-09-10T12:00:00.000Z');

  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
    await seedProfile(h.sql, { id: viewerOf('free').userId!, email: 'free@playbook.test' });
    bank = fakeBank();
  });
  afterEach(async () => {
    await h.close();
  });

  const deps = (overrides: Partial<IdentityDeps> = {}): IdentityDeps => ({ sql: h.sql, assets: bank, siteUrl: SITE, now: NOW, mode: 'liveness', ...overrides });

  it('names the engines that need it: everything on ModelArk, nothing on OpenAI', () => {
    expect(needsIdentity('seedance-2.0')).toBe(true);
    expect(needsIdentity('seedance-2.5')).toBe(true);
    expect(needsIdentity('seedream-5.0-pro')).toBe(true);
    expect(needsIdentity('gpt-image-2')).toBe(false);
    expect(needsIdentity('gpt-image-2.5-flare')).toBe(false);
  });

  it('opens a liveness session with our callback and the English page, and records it as pending', async () => {
    expect(await startIdentityVerification(deps(), viewerOf('anon'), { nextPath: '/x', language: 'en' })).toEqual({ ok: false, code: 'sign_in_required' });
    expect(await startIdentityVerification(deps({ assets: null }), ADMIN_VIEWER, { nextPath: '/x', language: 'en' })).toEqual({ ok: false, code: 'unavailable' });

    const started = await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: '/ko/t/neon-alley-dolly#make', language: 'en' });
    expect(started).toEqual({ ok: true, h5Link: 'https://h5.bank.test/live?session=abc&lng=en' });
    expect(bank.sessions).toEqual([{ callbackUrl: `${SITE}/api/identity/callback` }]);
    const group = (await loadIdentityGroup(h.sql, ADMIN_VIEWER.userId!))!;
    expect(group).toMatchObject({ status: 'pending', bytedToken: 'tok-1', h5Link: 'https://h5.bank.test/live?session=abc&lng=en', nextPath: '/ko/t/neon-alley-dolly#make', groupId: null });
    expect(await identityStatusFor(h.sql, ADMIN_VIEWER.userId!)).toBe('pending');
  });

  it('exchanges the callback token for the group, and refuses an unknown or failed callback', async () => {
    await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: '/back', language: 'en' });

    expect(await completeIdentityVerification(deps(), new URLSearchParams('resultCode=10000&bytedToken=nope'))).toEqual({ status: 'unknown', userId: null, nextPath: null });
    expect(await completeIdentityVerification(deps(), new URLSearchParams('resultCode=10001&bytedToken=tok-1'))).toEqual({ status: 'failed', userId: ADMIN_VIEWER.userId, nextPath: '/back' });
    expect((await loadIdentityGroup(h.sql, ADMIN_VIEWER.userId!))!).toMatchObject({ status: 'failed', failureCode: '10001', bytedToken: null });

    await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: '/back', language: 'en' });
    const done = await completeIdentityVerification(deps(), new URLSearchParams('resultCode=10000&bytedToken=tok-2'));
    expect(done).toEqual({ status: 'active', userId: ADMIN_VIEWER.userId, nextPath: '/back' });
    const group = (await loadIdentityGroup(h.sql, ADMIN_VIEWER.userId!))!;
    expect(group).toMatchObject({ status: 'active', groupId: 'grp-1', bytedToken: null, verifiedAt: NOW.toISOString() });
    expect(await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: null, language: 'en' })).toEqual({ ok: false, code: 'already_active' });
  });

  it('refuses to open a session when the free tier has no room left', async () => {
    await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: null, language: 'en' });
    await completeIdentityVerification(deps(), new URLSearchParams('resultCode=10000&bytedToken=tok-1'));
    const tight = deps({ quota: { groups: 2, assets: 2 } }); // reserve is 1 of each in hasCapacity's default need; 2 − 1 active = 1 free group
    expect((await startIdentityVerification(tight, viewerOf('free'), { nextPath: null, language: 'en' })).ok).toBe(true);
    const full = deps({ quota: { groups: 1, assets: 1 } });
    expect(await startIdentityVerification(full, viewerOf('free'), { nextPath: null, language: 'en' })).toEqual({ ok: false, code: 'no_capacity' });
  });

  it('registers a photo once by content hash, follows it from Processing to Active, and names a bank refusal', async () => {
    await startIdentityVerification(deps(), ADMIN_VIEWER, { nextPath: null, language: 'en' });
    await completeIdentityVerification(deps(), new URLSearchParams('resultCode=10000&bytedToken=tok-1'));
    const group = (await loadIdentityGroup(h.sql, ADMIN_VIEWER.userId!))!;

    const first = await ensureIdentityAsset(deps(), { group, photo: PHOTO, photoUrl: 'https://store.test/photo.jpg' });
    expect(first).toEqual({ status: 'processing', assetId: 'asset-1' });
    expect(bank.created).toEqual([{ groupId: 'grp-1', url: 'https://store.test/photo.jpg', assetType: 'Image', name: expect.stringMatching(/^twings-/) }]);
    expect((await loadIdentityAssetByPhoto(h.sql, ADMIN_VIEWER.userId!, photoSha256(PHOTO)))!.status).toBe('Processing');

    // Same photo again: no second CreateAsset, just a poll — and the bank has finished.
    bank.assetStatus = 'Active';
    const second = await ensureIdentityAsset(deps(), { group, photo: PHOTO, photoUrl: 'https://store.test/photo.jpg' });
    expect(second).toEqual({ status: 'active', assetId: 'asset-1' });
    expect(bank.created).toHaveLength(1);
    expect((await loadIdentityAssetByPhoto(h.sql, ADMIN_VIEWER.userId!, photoSha256(PHOTO)))!).toMatchObject({ status: 'Active', activatedAt: NOW.toISOString() });

    // A different photo whose comparison the bank refuses.
    bank.assetStatus = 'Failed';
    const other = await ensureIdentityAsset(deps(), { group, photo: new Uint8Array([9, 9, 9]), photoUrl: 'https://store.test/other.jpg' });
    expect(other).toEqual({ status: 'failed', assetId: 'asset-2', reason: 'asset_failed' });

    // No URL to hand the bank (the local driver) is a configuration gap, not a photo problem.
    expect(await ensureIdentityAsset(deps(), { group, photo: new Uint8Array([7]), photoUrl: null })).toEqual({ status: 'failed', assetId: null, reason: 'identity_unavailable' });
    // And a person who has not verified cannot register anything.
    expect(await ensureIdentityAsset(deps(), { group: { ...group, status: 'pending', groupId: null }, photo: PHOTO, photoUrl: 'https://x' })).toEqual({ status: 'failed', assetId: null, reason: 'identity_required' });
  });
});

/**
 * The virtual library (2026-09-14, lib/flags.ts ASSET_LIBRARY_MODE): no camera check. The account's
 * AIGC group is made on first use and reused; a liveness-mode read never mistakes it for a verified
 * face; a quota refusal is the studio's problem (`identity_unavailable`), not the photo's.
 */
describe('the virtual library', () => {
  let h: BillingHarness;
  let bank: FakeBank;
  const NOW = new Date('2026-09-14T12:00:00.000Z');

  beforeEach(async () => {
    h = await billingDb();
    await seedProfile(h.sql, { id: ADMIN_VIEWER.userId!, email: ADMIN_VIEWER.email!, isAdmin: true });
    bank = fakeBank();
  });
  afterEach(async () => {
    await h.close();
  });

  const deps = (overrides: Partial<IdentityDeps> = {}): IdentityDeps => ({ sql: h.sql, assets: bank, siteUrl: SITE, now: NOW, mode: 'virtual', ...overrides });

  it('reads the mode from the env override, else the flag', () => {
    expect(assetLibraryMode({ ARK_ASSET_MODE: 'liveness' })).toBe('liveness');
    expect(assetLibraryMode({ ARK_ASSET_MODE: 'VIRTUAL' })).toBe('virtual');
    expect(assetLibraryMode({ ARK_ASSET_MODE: 'nonsense' })).toBe('virtual');
    expect(assetLibraryMode({})).toBe('virtual');
  });

  it('asks nobody to look into a camera: no engine needs liveness in virtual mode', () => {
    expect(needsIdentity('seedance-2.0')).toBe(true);
    expect(needsLiveness('seedance-2.0', 'virtual')).toBe(false);
    expect(needsLiveness('seedance-2.0', 'liveness')).toBe(true);
    expect(needsLiveness('gpt-image-2', 'liveness')).toBe(false);
  });

  it('makes one AIGC group per account on first use and reuses it after', async () => {
    const first = await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!);
    expect(first).toMatchObject({ ok: true, group: { groupId: 'aigc-1', status: 'active', groupType: 'AIGC', verifiedAt: NOW.toISOString() } });
    expect(bank.groups).toEqual([{ name: expect.stringMatching(/^twings-/), groupType: 'AIGC' }]);

    const again = await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!);
    expect(again).toMatchObject({ ok: true, group: { groupId: 'aigc-1' } });
    expect(bank.groups).toHaveLength(1);

    // The group is what the asset path needs — the same CreateAsset as the liveness route.
    if (!first.ok) throw new Error('unreachable');
    const asset = await ensureIdentityAsset(deps(), { group: first.group, photo: PHOTO, photoUrl: 'https://store.test/photo.jpg' });
    expect(asset).toEqual({ status: 'processing', assetId: 'asset-1' });
    expect(bank.created[0]).toMatchObject({ groupId: 'aigc-1' });
  });

  it('is not a verified face: a liveness-mode read still says none, and a verified face is reused as is', async () => {
    await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!);
    expect(await identityStatusFor(h.sql, ADMIN_VIEWER.userId!, 'virtual')).toBe('active');
    expect(await identityStatusFor(h.sql, ADMIN_VIEWER.userId!, 'liveness')).toBe('none');

    // Someone who already passed the camera check keeps that group in virtual mode too.
    await h.sql.query(`update identity_groups set group_id = 'grp-live', group_type = 'LivenessFace' where user_id = $1`, [ADMIN_VIEWER.userId]);
    const reused = await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!);
    expect(reused).toMatchObject({ ok: true, group: { groupId: 'grp-live', groupType: 'LivenessFace' } });
    expect(bank.groups).toHaveLength(1);
  });

  it('names a quota refusal as the studio’s problem, and no bank as unavailable', async () => {
    bank.groupError = new ArkOpenApiError('QuotaExceeded', 'asset group quota exceeded', 'req-1', 400, false);
    // Retryable since slot rotation (2026-09-28): a full tier or a throttled bank is "try again", not "never".
    expect(await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!)).toEqual({ ok: false, reason: 'identity_unavailable', retryable: true });
    bank.groupError = new ArkOpenApiError('InvalidParameter', 'bad name', 'req-2', 400, false);
    expect(await ensureVirtualGroup(deps(), ADMIN_VIEWER.userId!)).toEqual({ ok: false, reason: 'asset_failed' });
    expect(await ensureVirtualGroup(deps({ assets: null }), ADMIN_VIEWER.userId!)).toEqual({ ok: false, reason: 'identity_unavailable' });
    expect(await loadIdentityGroup(h.sql, ADMIN_VIEWER.userId!)).toBeNull();
  });
});
