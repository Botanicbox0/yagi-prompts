import type { ArkAssetsApi, ArkQuota } from './assets';

/**
 * Slot reclaim — keeping the 50-person real-human library from refusing the 51st person.
 *
 * Founder direction (2026-09-02): "슬롯 회수: 오래 안 쓴 자산을 정리하는 로직을 워커에 넣자."
 *
 * The free tier is a hard cap, not a meter: when 50 groups or 50 assets exist, the next
 * CreateVisualValidateSession / CreateAsset is refused. Nothing bills, nothing upgrades itself.
 * This pass runs before that happens. It PLANS from our own inventory (the identity tables, which
 * record `last_used_at` on every render we create — the only reliable disuse signal, since the
 * bank-side `LastInferenceTime` is documented as unreliable before 2026-07-24), and it EXECUTES
 * against the Assets API through the interface in `assets.ts`.
 *
 * The plan is a pure function so its rules can be read in one place and tested without a key:
 *
 *   0. Failed assets go first, always. They hold a slot and can never be used.
 *   1. If asset headroom is below the reserve: delete the longest-idle ACTIVE assets that are older
 *      than `minAgeDays`, idle longer than `assetIdleDays`, and not attached to an in-flight
 *      render — until the reserve is restored.
 *   2. If group headroom is below the reserve: delete the longest-idle groups — a group is a
 *      PERSON, and deleting it means they pass liveness again, so the bar is higher
 *      (`groupIdleDays`) and a group with an in-flight render is untouchable. A group's remaining
 *      assets are deleted first, in the same plan.
 *   3. If the reserve still cannot be restored — everyone is recent — the plan says so
 *      (`headroomOk: false`). That is the upgrade signal, and it is a fact about the roster, not a
 *      reason to delete a live user.
 *
 * Reserve, not "until full": a pass that only reclaims at 50/50 races the person who is verifying
 * right now. Five slots of headroom is a minute's worth of the 3 QPM upload limit.
 */

export interface IdentityGroupRow {
  groupId: string;
  userId: string;
  createdAt: string;
  lastRenderAt: string | null;
}

export interface IdentityAssetRow {
  assetId: string;
  groupId: string;
  status: 'Processing' | 'Active' | 'Failed';
  createdAt: string;
  lastUsedAt: string | null;
  /** A render job referencing this asset is queued or running. */
  inFlight: boolean;
}

export interface ReclaimInventory {
  groups: IdentityGroupRow[];
  assets: IdentityAssetRow[];
}

export interface ReclaimPolicy {
  reserveGroups: number;
  reserveAssets: number;
  assetIdleDays: number;
  groupIdleDays: number;
  /** Never delete anything younger than this, whatever the idle clock says. */
  minAgeDays: number;
}

export const DEFAULT_RECLAIM_POLICY: ReclaimPolicy = {
  reserveGroups: 5,
  reserveAssets: 5,
  assetIdleDays: 30,
  groupIdleDays: 90,
  minAgeDays: 7,
};

export type ReclaimReason = 'failed' | 'idle-asset' | 'idle-group' | 'group-cascade';

export type ReclaimAction =
  | { kind: 'delete-asset'; assetId: string; groupId: string; reason: ReclaimReason }
  | { kind: 'delete-group'; groupId: string; userId: string; reason: ReclaimReason };

export interface ReclaimCount {
  groups: number;
  assets: number;
}

export interface ReclaimPlan {
  actions: ReclaimAction[];
  before: ReclaimCount;
  after: ReclaimCount;
  free: ReclaimCount;
  /** Both reserves are met after the plan. False means: upgrade, or wait. */
  headroomOk: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(later: Date, earlier: string): number {
  return (later.getTime() - Date.parse(earlier)) / DAY_MS;
}

export function planReclaim(
  inventory: ReclaimInventory,
  quota: ArkQuota,
  policy: ReclaimPolicy,
  now: Date,
): ReclaimPlan {
  const actions: ReclaimAction[] = [];
  const deletedAssets = new Set<string>();
  const deletedGroups = new Set<string>();

  const before: ReclaimCount = { groups: inventory.groups.length, assets: inventory.assets.length };

  const assetsLeft = () => inventory.assets.filter((a) => !deletedAssets.has(a.assetId)).length;
  const groupsLeft = () => inventory.groups.filter((g) => !deletedGroups.has(g.groupId)).length;
  const dropAsset = (asset: IdentityAssetRow, reason: ReclaimReason) => {
    deletedAssets.add(asset.assetId);
    actions.push({ kind: 'delete-asset', assetId: asset.assetId, groupId: asset.groupId, reason });
  };

  // 0. Dead weight.
  for (const asset of inventory.assets) {
    if (asset.status === 'Failed' && !asset.inFlight) dropAsset(asset, 'failed');
  }

  // 1. Idle assets, longest-idle first, until the reserve is back.
  const idleAssets = inventory.assets
    .filter((a) => !deletedAssets.has(a.assetId))
    .filter((a) => a.status === 'Active' && !a.inFlight)
    .filter((a) => daysBetween(now, a.createdAt) >= policy.minAgeDays)
    .map((a) => ({ asset: a, idle: daysBetween(now, a.lastUsedAt ?? a.createdAt) }))
    .filter(({ idle }) => idle >= policy.assetIdleDays)
    .sort((x, y) => y.idle - x.idle);
  for (const { asset } of idleAssets) {
    if (quota.assets - assetsLeft() >= policy.reserveAssets) break;
    dropAsset(asset, 'idle-asset');
  }

  // 2. Idle people, longest-idle first, cascading their remaining assets.
  const inFlightGroups = new Set(inventory.assets.filter((a) => a.inFlight).map((a) => a.groupId));
  const idleGroups = inventory.groups
    .filter((g) => !inFlightGroups.has(g.groupId))
    .filter((g) => daysBetween(now, g.createdAt) >= policy.minAgeDays)
    .map((g) => ({ group: g, idle: daysBetween(now, g.lastRenderAt ?? g.createdAt) }))
    .filter(({ idle }) => idle >= policy.groupIdleDays)
    .sort((x, y) => y.idle - x.idle);
  for (const { group } of idleGroups) {
    if (quota.groups - groupsLeft() >= policy.reserveGroups) break;
    for (const asset of inventory.assets) {
      if (asset.groupId === group.groupId && !deletedAssets.has(asset.assetId)) {
        dropAsset(asset, 'group-cascade');
      }
    }
    deletedGroups.add(group.groupId);
    actions.push({ kind: 'delete-group', groupId: group.groupId, userId: group.userId, reason: 'idle-group' });
  }

  const after: ReclaimCount = { groups: groupsLeft(), assets: assetsLeft() };
  const free: ReclaimCount = { groups: quota.groups - after.groups, assets: quota.assets - after.assets };
  return {
    actions,
    before,
    after,
    free,
    headroomOk: free.groups >= policy.reserveGroups && free.assets >= policy.reserveAssets,
  };
}

/**
 * Can one more person verify and upload one photo right now? Asked at the top of the identity
 * flow, so the answer is a calm "잠시 후 다시" rather than a bank-side refusal mid-liveness.
 */
export function hasCapacity(count: ReclaimCount, quota: ArkQuota, need: ReclaimCount = { groups: 1, assets: 1 }): boolean {
  return quota.groups - count.groups >= need.groups && quota.assets - count.assets >= need.assets;
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

export type ReclaimOutcome =
  | { action: ReclaimAction; ok: true }
  | { action: ReclaimAction; ok: false; error: string };

export interface ReclaimRunReport {
  dryRun: boolean;
  outcomes: ReclaimOutcome[];
  deleted: ReclaimCount;
  failed: number;
}

/**
 * Executes a plan in order — assets before their group, as planned — and keeps going past a
 * failed delete: one asset the bank refuses to drop must not leave forty-nine others in place.
 * The caller reconciles its own rows from the outcomes, deleting only what the bank confirmed.
 */
export async function runReclaim(
  plan: ReclaimPlan,
  api: ArkAssetsApi,
  options: { dryRun?: boolean } = {},
): Promise<ReclaimRunReport> {
  const dryRun = options.dryRun ?? false;
  const outcomes: ReclaimOutcome[] = [];
  const deleted: ReclaimCount = { groups: 0, assets: 0 };
  let failed = 0;

  for (const action of plan.actions) {
    if (dryRun) {
      outcomes.push({ action, ok: true });
      continue;
    }
    try {
      if (action.kind === 'delete-asset') {
        await api.deleteAsset(action.assetId);
        deleted.assets += 1;
      } else {
        await api.deleteAssetGroup(action.groupId);
        deleted.groups += 1;
      }
      outcomes.push({ action, ok: true });
    } catch (cause) {
      failed += 1;
      outcomes.push({ action, ok: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  return { dryRun, outcomes, deleted, failed };
}

export function formatReclaimReport(plan: ReclaimPlan, report: ReclaimRunReport): string {
  const lines = [
    `reclaim ${report.dryRun ? '(dry run) ' : ''}— groups ${plan.before.groups}→${plan.after.groups}, assets ${plan.before.assets}→${plan.after.assets}, free ${plan.free.groups}/${plan.free.assets}, headroom ${plan.headroomOk ? 'ok' : 'INSUFFICIENT — upgrade tier or wait'}`,
  ];
  for (const outcome of report.outcomes) {
    const a = outcome.action;
    const target = a.kind === 'delete-asset' ? `asset ${a.assetId}` : `group ${a.groupId}`;
    lines.push(`  ${outcome.ok ? 'ok  ' : 'FAIL'} ${a.kind} ${target} (${a.reason})${outcome.ok ? '' : `: ${outcome.error}`}`);
  }
  return lines.join('\n');
}
