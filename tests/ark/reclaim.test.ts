import { describe, expect, it } from 'vitest';
import { ARK_ENTRY_QUOTA, arkQuotaFromEnv, type ArkAssetsApi } from '@/lib/ark/assets';
import {
  DEFAULT_RECLAIM_POLICY,
  formatReclaimReport,
  hasCapacity,
  planReclaim,
  runReclaim,
  type IdentityAssetRow,
  type IdentityGroupRow,
  type ReclaimInventory,
} from '@/lib/ark/reclaim';

/**
 * The 50-person cap, as rules. Every scenario is dated against one `now` so "idle 40 days" means
 * exactly that, and the plan is checked as a list of actions — the thing the worker will execute.
 */

const NOW = new Date('2026-10-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function group(i: number, over: Partial<IdentityGroupRow> = {}): IdentityGroupRow {
  return { groupId: `group-${i}`, userId: `user-${i}`, createdAt: daysAgo(120), lastRenderAt: daysAgo(1), ...over };
}

function asset(i: number, over: Partial<IdentityAssetRow> = {}): IdentityAssetRow {
  return {
    assetId: `asset-${i}`,
    groupId: `group-${i}`,
    status: 'Active',
    createdAt: daysAgo(120),
    lastUsedAt: daysAgo(1),
    inFlight: false,
    ...over,
  };
}

/** N people, each with one photo, all rendered yesterday. */
function fullRoster(n: number): ReclaimInventory {
  const groups: IdentityGroupRow[] = [];
  const assets: IdentityAssetRow[] = [];
  for (let i = 1; i <= n; i += 1) {
    groups.push(group(i));
    assets.push(asset(i));
  }
  return { groups, assets };
}

describe('quota', () => {
  it('defaults to the free Entry tier and honours an env override', () => {
    expect(arkQuotaFromEnv({})).toEqual({ groups: 50, assets: 50 });
    expect(arkQuotaFromEnv({ ARK_QUOTA_GROUPS: '1000000', ARK_QUOTA_ASSETS: '1000000' })).toEqual({
      groups: 1_000_000,
      assets: 1_000_000,
    });
    expect(arkQuotaFromEnv({ ARK_QUOTA_GROUPS: 'nope' }).groups).toBe(50);
  });

  it('answers whether one more person can verify right now', () => {
    expect(hasCapacity({ groups: 49, assets: 49 }, ARK_ENTRY_QUOTA)).toBe(true);
    expect(hasCapacity({ groups: 50, assets: 10 }, ARK_ENTRY_QUOTA)).toBe(false);
    expect(hasCapacity({ groups: 10, assets: 50 }, ARK_ENTRY_QUOTA)).toBe(false);
  });
});

describe('the reclaim plan', () => {
  it('does nothing when there is headroom', () => {
    const plan = planReclaim(fullRoster(20), ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions).toEqual([]);
    expect(plan.headroomOk).toBe(true);
    expect(plan.free).toEqual({ groups: 30, assets: 30 });
  });

  it('always purges failed assets — they hold a slot and can never be used', () => {
    const inv = fullRoster(3);
    inv.assets.push(asset(99, { groupId: 'group-1', status: 'Failed', createdAt: daysAgo(0), lastUsedAt: null }));
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions).toEqual([{ kind: 'delete-asset', assetId: 'asset-99', groupId: 'group-1', reason: 'failed' }]);
  });

  it('reclaims the longest-idle assets first, only until the reserve is restored', () => {
    // 30 people, 48 photos (18 of them second photos): asset reserve 5 means 3 photos must go,
    // while group headroom (20) is fine. Four second photos are idle (40/60/80/100 days).
    const inv = fullRoster(30);
    for (let i = 1; i <= 18; i += 1) inv.assets.push(asset(100 + i, { groupId: `group-${i}` }));
    inv.assets[30]!.lastUsedAt = daysAgo(40); // asset-101
    inv.assets[31]!.lastUsedAt = daysAgo(100); // asset-102
    inv.assets[32]!.lastUsedAt = daysAgo(60); // asset-103
    inv.assets[33]!.lastUsedAt = daysAgo(80); // asset-104
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions.map((a) => (a.kind === 'delete-asset' ? a.assetId : a.groupId))).toEqual([
      'asset-102', // 100 days
      'asset-104', // 80
      'asset-103', // 60
    ]);
    expect(plan.after.assets).toBe(45);
    expect(plan.headroomOk).toBe(true);
    // Groups were untouched: nobody re-verifies because of a photo clean-up.
    expect(plan.actions.some((a) => a.kind === 'delete-group')).toBe(false);
  });

  it('never touches an in-flight asset, a young asset, or a recently used one', () => {
    const inv = fullRoster(50);
    inv.assets[0]!.lastUsedAt = daysAgo(200);
    inv.assets[0]!.inFlight = true; // rendering right now
    inv.assets[1]!.lastUsedAt = null;
    inv.assets[1]!.createdAt = daysAgo(2); // uploaded two days ago, never used yet
    inv.assets[2]!.lastUsedAt = daysAgo(10); // idle, but not 30 days idle
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions).toEqual([]);
    // Full, and nothing reclaimable: this is the upgrade signal, not a reason to delete a live user.
    expect(plan.headroomOk).toBe(false);
    expect(plan.free).toEqual({ groups: 0, assets: 0 });
  });

  it('reclaims an idle PERSON only at the higher bar, deleting their photos first', () => {
    // 47 groups, reserve 5 → 2 must go. Two people have not rendered in 100+ days.
    const inv = fullRoster(47);
    inv.groups[4]!.lastRenderAt = daysAgo(100);
    inv.assets[4]!.lastUsedAt = daysAgo(100);
    inv.groups[9]!.lastRenderAt = daysAgo(400);
    inv.assets[9]!.lastUsedAt = daysAgo(400);
    // Give the 400-day person a second photo, to prove the cascade takes both.
    inv.assets.push(asset(910, { groupId: 'group-10', lastUsedAt: daysAgo(400) }));
    // …and a 60-day-idle person who must NOT be deleted (below groupIdleDays).
    inv.groups[19]!.lastRenderAt = daysAgo(60);
    inv.assets[19]!.lastUsedAt = daysAgo(60);

    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    const groupsDeleted = plan.actions.filter((a) => a.kind === 'delete-group').map((a) => a.groupId);
    expect(groupsDeleted).toEqual(['group-10', 'group-5']);
    expect(plan.actions.find((a) => a.kind === 'delete-group' && a.groupId === 'group-20')).toBeUndefined();

    // Photos of a deleted person go first, in the same plan, before the group itself.
    const order = plan.actions.map((a) => `${a.kind}:${a.kind === 'delete-asset' ? a.assetId : a.groupId}`);
    expect(order.indexOf('delete-asset:asset-910')).toBeLessThan(order.indexOf('delete-group:group-10'));
    expect(order.indexOf('delete-asset:asset-10')).toBeLessThan(order.indexOf('delete-group:group-10'));
    expect(plan.after.groups).toBe(45);
    expect(plan.headroomOk).toBe(true);
  });

  it('will not delete a person who has a render in flight, however idle the group looks', () => {
    const inv = fullRoster(50);
    inv.groups[0]!.lastRenderAt = daysAgo(500);
    inv.assets[0]!.lastUsedAt = daysAgo(500);
    inv.assets[0]!.inFlight = true;
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions.filter((a) => a.kind === 'delete-group')).toEqual([]);
  });
});

describe('executing a plan', () => {
  function fakeApi(failOn: string[] = []) {
    const deleted: string[] = [];
    const api: ArkAssetsApi = {
      async listAssets() {
        return [];
      },
      async deleteAsset(id) {
        if (failOn.includes(id)) throw new Error(`bank refused ${id}`);
        deleted.push(id);
      },
      async deleteAssetGroup(id) {
        if (failOn.includes(id)) throw new Error(`bank refused ${id}`);
        deleted.push(id);
      },
    };
    return { api, deleted };
  }

  it('executes in plan order and keeps going past a refused delete', async () => {
    const inv = fullRoster(47);
    inv.groups[0]!.lastRenderAt = daysAgo(400);
    inv.assets[0]!.lastUsedAt = daysAgo(400);
    inv.groups[1]!.lastRenderAt = daysAgo(300);
    inv.assets[1]!.lastUsedAt = daysAgo(300);
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    expect(plan.actions).toHaveLength(4); // asset-1, group-1, asset-2, group-2

    const { api, deleted } = fakeApi(['group-1']);
    const report = await runReclaim(plan, api);
    expect(deleted).toEqual(['asset-1', 'asset-2', 'group-2']);
    expect(report.failed).toBe(1);
    expect(report.deleted).toEqual({ groups: 1, assets: 2 });
    expect(report.outcomes.find((o) => !o.ok)).toMatchObject({ action: { groupId: 'group-1' }, error: 'bank refused group-1' });

    const text = formatReclaimReport(plan, report);
    expect(text).toContain('groups 47→45');
    expect(text).toContain('FAIL delete-group group group-1');
  });

  it('a dry run touches nothing and reports every action as it would happen', async () => {
    const inv = fullRoster(48);
    inv.assets[0]!.lastUsedAt = daysAgo(90);
    const plan = planReclaim(inv, ARK_ENTRY_QUOTA, DEFAULT_RECLAIM_POLICY, NOW);
    const { api, deleted } = fakeApi();
    const report = await runReclaim(plan, api, { dryRun: true });
    expect(deleted).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.outcomes.every((o) => o.ok)).toBe(true);
    expect(formatReclaimReport(plan, report)).toContain('(dry run)');
  });
});
