import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArkOpenApiError, type ArkAsset, type ArkAssetsClient, type ArkAssetStatus } from '@/lib/ark/assets';
import { loadIdentityAssetByPhoto, loadIdentityGroup } from '@/lib/identity/repo';
import { planRotation, rotationPolicy, type RotationInventory } from '@/lib/identity/rotation';
import { ensureIdentityAsset, ensureVirtualGroup, photoSha256 as photoSha, type IdentityDeps } from '@/lib/identity/service';
import { loadPromptBySlug } from '@/lib/prompts/repo';
import { seedProfile } from '@/tests/helpers/billing';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

/**
 * Slot rotation (docs/TEMPLATES-IA.md §12, 2026-09-19, reconfirmed 2026-09-28): the free Entry tier
 * holds 50 groups / 50 assets, and the 51st person still gets their face in. The least recently
 * used AIGC person is deleted at the bank and marked `evicted` here; their photo stays in our
 * store, so their next render registers it again (about five seconds).
 */

const T0 = Date.parse('2026-09-20T00:00:00.000Z');
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

describe('planRotation', () => {
  const policy = { limitGroups: 4, limitAssets: 4 };

  function inventory(): RotationInventory {
    return {
      groups: [
        { userId: 'u1', groupId: 'g1', groupType: 'AIGC', lastUsedAt: at(1), busy: false },
        { userId: 'u2', groupId: 'g2', groupType: 'AIGC', lastUsedAt: at(2), busy: false },
        { userId: 'u3', groupId: 'g3', groupType: 'LivenessFace', lastUsedAt: at(0), busy: false },
        { userId: 'u4', groupId: 'g4', groupType: 'AIGC', lastUsedAt: at(4), busy: false },
      ],
      assets: [
        { assetId: 'a1', groupId: 'g1', userId: 'u1', groupType: 'AIGC', status: 'Active', lastUsedAt: at(1), busy: false },
        { assetId: 'a2', groupId: 'g2', userId: 'u2', groupType: 'AIGC', status: 'Active', lastUsedAt: at(2), busy: false },
        { assetId: 'a3', groupId: 'g3', userId: 'u3', groupType: 'LivenessFace', status: 'Active', lastUsedAt: at(0), busy: false },
        { assetId: 'a4', groupId: 'g4', userId: 'u4', groupType: 'AIGC', status: 'Failed', lastUsedAt: at(4), busy: false },
      ],
    };
  }

  it('does nothing while the roster fits under the limit', () => {
    const inv = inventory();
    inv.groups.pop();
    inv.assets.pop();
    expect(planRotation(inv, { groups: 1, assets: 1 }, policy, 'u9')).toEqual({ actions: [], fits: true });
  });

  it('frees a photo slot with the dead weight first, then the least recently used AIGC photo', () => {
    expect(planRotation(inventory(), { groups: 0, assets: 1 }, policy, 'u9')).toEqual({
      actions: [{ kind: 'delete-asset', assetId: 'a4', groupId: 'g4', userId: 'u4' }],
      fits: true,
    });
    const inv = inventory();
    inv.assets[3]!.status = 'Active';
    // a3 is older but belongs to a verified face: rotation never touches LivenessFace.
    expect(planRotation(inv, { groups: 0, assets: 1 }, policy, 'u9').actions).toEqual([{ kind: 'delete-asset', assetId: 'a1', groupId: 'g1', userId: 'u1' }]);
  });

  it('frees a person slot by evicting the least recently used AIGC person, photos first', () => {
    expect(planRotation(inventory(), { groups: 1, assets: 0 }, policy, 'u9')).toEqual({
      actions: [
        { kind: 'delete-asset', assetId: 'a1', groupId: 'g1', userId: 'u1' },
        { kind: 'evict-group', groupId: 'g1', userId: 'u1' },
      ],
      fits: true,
    });
  });

  it('never evicts the person being served, anyone with a render in flight, or a verified face', () => {
    const inv = inventory();
    inv.groups[1]!.busy = true;
    inv.assets[1]!.busy = true;
    // u1 is the person rendering now; u2 is busy; u3 is LivenessFace; u4 is next.
    expect(planRotation(inv, { groups: 1, assets: 0 }, policy, 'u1').actions).toEqual([
      { kind: 'delete-asset', assetId: 'a4', groupId: 'g4', userId: 'u4' },
      { kind: 'evict-group', groupId: 'g4', userId: 'u4' },
    ]);
  });

  it('says so when nobody can make room — the upgrade signal, not a reason to evict a live render', () => {
    const inv = inventory();
    for (const g of inv.groups) g.busy = true;
    for (const a of inv.assets) a.busy = true;
    expect(planRotation(inv, { groups: 1, assets: 1 }, policy, 'u9')).toEqual({ actions: [], fits: false });
  });

  it('keeps a fifth of the tier as headroom: 40 of the free 50, and a paid tier never rotates in practice', () => {
    expect(rotationPolicy({ groups: 50, assets: 50 })).toEqual({ limitGroups: 40, limitAssets: 40 });
    expect(rotationPolicy({ groups: 5, assets: 5 })).toEqual({ limitGroups: 4, limitAssets: 4 });
    expect(rotationPolicy({ groups: 1_000_000, assets: 1_000_000 }).limitGroups).toBe(800_000);
  });
});

interface FakeBank extends ArkAssetsClient {
  groupsMade: string[];
  assetsMade: Array<{ id: string; groupId: string }>;
  deletedAssets: string[];
  deletedGroups: string[];
  deleteError: Error | null;
}

function fakeBank(): FakeBank {
  const bank: FakeBank = {
    groupsMade: [],
    assetsMade: [],
    deletedAssets: [],
    deletedGroups: [],
    deleteError: null,
    async createVisualValidateSession() {
      throw new Error('not in virtual mode');
    },
    async getVisualValidateResult() {
      throw new Error('not in virtual mode');
    },
    async createAssetGroup() {
      const id = `aigc-${bank.groupsMade.length + 1}`;
      bank.groupsMade.push(id);
      return { id };
    },
    async createAsset(input) {
      const id = `asset-${bank.assetsMade.length + 1}`;
      bank.assetsMade.push({ id, groupId: input.groupId });
      return { id };
    },
    async getAsset(input) {
      const id = typeof input === 'string' ? input : input.id;
      const status: ArkAssetStatus = 'Active';
      const asset: ArkAsset = {
        id,
        groupId: bank.assetsMade.find((a) => a.id === id)?.groupId ?? 'unknown',
        status,
        createdAt: '2026-09-20T00:00:00Z',
        lastInferenceAt: null,
        assetType: 'Image',
        name: '',
        url: 'https://store.test/photo.jpg',
        updatedAt: '2026-09-20T00:00:00Z',
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
    async deleteAsset(id) {
      if (bank.deleteError) throw bank.deleteError;
      bank.deletedAssets.push(id);
    },
    async deleteAssetGroup(id) {
      if (bank.deleteError) throw bank.deleteError;
      bank.deletedGroups.push(id);
    },
  };
  return bank;
}

describe('rotation in the virtual library', () => {
  let h: PromptHarness;
  let bank: FakeBank;
  const USERS = ['1', '2', '3', '4', '5'].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
  const photo = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n]);

  beforeEach(async () => {
    h = await promptHarness();
    for (const id of USERS) await seedProfile(h.sql, { id });
    bank = fakeBank();
  });
  afterEach(async () => {
    await h.close();
  });

  // A free tier of five: rotation keeps one free, so four people fit.
  const deps = (minutes: number): IdentityDeps => ({ sql: h.sql, assets: bank, siteUrl: 'https://twings.test', now: new Date(at(minutes)), mode: 'virtual', quota: { groups: 5, assets: 5 } });

  async function render(userIndex: number, minutes: number) {
    const userId = USERS[userIndex]!;
    const group = await ensureVirtualGroup(deps(minutes), userId);
    if (!group.ok) return group;
    const asset = await ensureIdentityAsset(deps(minutes), { group: group.group, photo: photo(userIndex), photoUrl: `https://store.test/${userIndex}.jpg` });
    await h.sql.query(`update identity_groups set last_render_at = $2::timestamptz where user_id = $1`, [userId, at(minutes)]);
    return asset;
  }

  it('lets the fifth person in by evicting the person idle longest, who gets back in the same way', async () => {
    for (let i = 0; i < 4; i += 1) expect(await render(i, i)).toMatchObject({ status: 'active' });
    expect(bank.deletedGroups).toEqual([]);

    // Person 5 arrives: person 1 (idle longest) is deleted at the bank, photo first.
    expect(await render(4, 10)).toMatchObject({ status: 'active' });
    expect(bank.deletedAssets).toEqual(['asset-1']);
    expect(bank.deletedGroups).toEqual(['aigc-1']);
    expect(await loadIdentityGroup(h.sql, USERS[0]!)).toMatchObject({ status: 'evicted' });
    expect(await loadIdentityAssetByPhoto(h.sql, USERS[0]!, photoSha(photo(0)))).toBeNull();

    // Person 1 returns: a fresh group, the same photo registered again; person 2 makes room.
    expect(await render(0, 20)).toMatchObject({ status: 'active' });
    expect(await loadIdentityGroup(h.sql, USERS[0]!)).toMatchObject({ status: 'active', groupId: 'aigc-6' });
    expect(bank.deletedGroups).toEqual(['aigc-1', 'aigc-2']);
  });

  it('skips a person whose film is still with the provider', async () => {
    for (let i = 0; i < 4; i += 1) await render(i, i);
    const template = (await loadPromptBySlug(h.sql, 'neon-alley-dolly'))!;
    await h.sql.query(
      `insert into render_jobs (user_id, template_id, template_slug, medium, engine, aspect, status) values ($1, $2, $3, 'video', 'seedance-2.0', '9:16', 'running')`,
      [USERS[0], template.id, template.slug],
    );
    await render(4, 10);
    expect(bank.deletedGroups).toEqual(['aigc-2']);
    expect(await loadIdentityGroup(h.sql, USERS[0]!)).toMatchObject({ status: 'active' });
  });

  it('treats a bank that already forgot the group as done, and a throttled delete as try-again-later', async () => {
    for (let i = 0; i < 4; i += 1) await render(i, i);
    bank.deleteError = new ArkOpenApiError('RequestLimitExceeded', 'too many requests', 'req-1', 429);
    expect(await ensureVirtualGroup(deps(10), USERS[4]!)).toEqual({ ok: false, reason: 'identity_unavailable', retryable: true });
    expect(await loadIdentityGroup(h.sql, USERS[0]!)).toMatchObject({ status: 'active' });

    bank.deleteError = new ArkOpenApiError('NotFound', 'no such group', 'req-2', 404);
    expect(await ensureVirtualGroup(deps(11), USERS[4]!)).toMatchObject({ ok: true });
    expect(await loadIdentityGroup(h.sql, USERS[0]!)).toMatchObject({ status: 'evicted' });
  });
});
