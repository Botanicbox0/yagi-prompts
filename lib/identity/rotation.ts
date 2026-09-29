import { ArkOpenApiError, arkQuotaFromEnv, type ArkAssetsApi, type ArkQuota } from '@/lib/ark/assets';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  countResident,
  deleteIdentityAssetRow,
  evictIdentityGroup,
  loadResidentInventory,
  type ResidentAssetRow,
  type ResidentGroupRow,
} from './repo';

/**
 * Slot rotation — the free Entry tier (50 groups / 50 assets) serving more than fifty people.
 *
 * Founder decision (docs/TEMPLATES-IA.md §12, 2026-09-19; reconfirmed 2026-09-28: "무료 플랜에
 * 돌려쓰기를 붙여서 가자 … 필요한 얼굴 유저가 올릴 수 있게"). The paid tier buys CAPACITY, not a
 * waiver, so on the free tier the bank's copy of a face is a cache: the photo lives in our store,
 * and the bank's group/asset is made when a render needs it and deleted when someone newer does.
 *
 * Asked right before we create a group or an asset (lib/identity/service.ts). If that would cross
 * the limit, we delete at the bank, in this order:
 *   1. photo slots: Failed assets first (dead weight), then the least recently used photo;
 *   2. person slots: the least recently used PERSON — their photos first, then the group — and
 *      their row becomes `evicted`. Their next render makes a new group and registers again.
 * Never touched: the person being served, anyone with a render held / queued / running (their
 * asset may be inside a provider task right now), and LivenessFace groups (deleting one would send
 * the person back through the camera check).
 *
 * The limit keeps a fifth of the tier free (40 of 50), so two render passes racing each other or a
 * bank count that drifted from ours still land under the hard cap. If nobody can be moved, nothing
 * is deleted and the caller retries later — that state is the upgrade signal.
 *
 * Unconfirmed in writing (asked 2026-09-28): that the Entry cap counts RESIDENT groups/assets, not
 * cumulative creations. The 2026-09-19 API check (0 live after create/delete cycles) and openstory
 * PR #1515 both treat it as resident.
 */

export const ROTATION_HEADROOM_SHARE = 0.2;

export interface RotationPolicy {
  limitGroups: number;
  limitAssets: number;
}

export function rotationPolicy(quota: ArkQuota): RotationPolicy {
  const limit = (cap: number) => Math.max(1, cap - Math.ceil(cap * ROTATION_HEADROOM_SHARE));
  return { limitGroups: limit(quota.groups), limitAssets: limit(quota.assets) };
}

export interface RotationInventory {
  groups: ResidentGroupRow[];
  assets: ResidentAssetRow[];
}

export interface RotationNeed {
  groups: number;
  assets: number;
}

export type RotationAction =
  | { kind: 'delete-asset'; assetId: string; groupId: string; userId: string }
  | { kind: 'evict-group'; groupId: string; userId: string };

export interface RotationPlan {
  actions: RotationAction[];
  /** The need fits under the limit after the actions. False = nothing is deleted; wait or upgrade. */
  fits: boolean;
}

const byOldest = <T extends { lastUsedAt: string }>(a: T, b: T) => Date.parse(a.lastUsedAt) - Date.parse(b.lastUsedAt);

export function planRotation(inventory: RotationInventory, need: RotationNeed, policy: RotationPolicy, keepUserId: string): RotationPlan {
  const actions: RotationAction[] = [];
  const goneAssets = new Set<string>();
  const assetsLeft = () => inventory.assets.length - goneAssets.size;
  let groupsLeft = inventory.groups.length;
  const movable = (row: { groupType: string; busy: boolean; userId: string }) => row.groupType === 'AIGC' && !row.busy && row.userId !== keepUserId;
  const dropAsset = (asset: ResidentAssetRow) => {
    goneAssets.add(asset.assetId);
    actions.push({ kind: 'delete-asset', assetId: asset.assetId, groupId: asset.groupId, userId: asset.userId });
  };

  // 1. Photo slots: dead weight first, then least recently used.
  const assetCandidates = inventory.assets
    .filter(movable)
    .sort((a, b) => Number(b.status === 'Failed') - Number(a.status === 'Failed') || byOldest(a, b));
  for (const asset of assetCandidates) {
    if (assetsLeft() + need.assets <= policy.limitAssets) break;
    dropAsset(asset);
  }

  // 2. Person slots: least recently used person, their remaining photos first.
  for (const group of inventory.groups.filter(movable).sort(byOldest)) {
    if (groupsLeft + need.groups <= policy.limitGroups) break;
    for (const asset of inventory.assets) {
      if (asset.groupId === group.groupId && asset.userId === group.userId && !goneAssets.has(asset.assetId)) dropAsset(asset);
    }
    actions.push({ kind: 'evict-group', groupId: group.groupId, userId: group.userId });
    groupsLeft -= 1;
  }

  const fits = assetsLeft() + need.assets <= policy.limitAssets && groupsLeft + need.groups <= policy.limitGroups;
  return fits ? { actions, fits } : { actions: [], fits };
}

export type MakeRoomOutcome = { ok: true; evicted: number } | { ok: false; retryable: boolean };

export interface MakeRoomDeps {
  sql: SqlRunner;
  assets: ArkAssetsApi | null;
  quota?: ArkQuota;
  now?: Date;
}

/** The bank already forgot it: as good as deleted. */
function isGone(error: unknown): boolean {
  return error instanceof ArkOpenApiError && (error.httpStatus === 404 || /notfound|not.?exist/i.test(error.code));
}

/**
 * Makes room for `need` before a create, deleting at the bank and then here — a row is changed
 * only after the bank confirmed (or had already forgotten). A delete the bank refuses stops the
 * run: the create would be refused too, so the caller retries the whole render later.
 */
export async function makeRoom(deps: MakeRoomDeps, need: RotationNeed, keepUserId: string): Promise<MakeRoomOutcome> {
  if (deps.assets === null) return { ok: false, retryable: false };
  const policy = rotationPolicy(deps.quota ?? arkQuotaFromEnv());
  const resident = await countResident(deps.sql);
  if (resident.groups + need.groups <= policy.limitGroups && resident.assets + need.assets <= policy.limitAssets) return { ok: true, evicted: 0 };

  const plan = planRotation(await loadResidentInventory(deps.sql), need, policy, keepUserId);
  if (!plan.fits) {
    console.warn('[identity] rotation: no room — every resident person is busy or verified; upgrade or wait', { resident, need });
    return { ok: false, retryable: true };
  }
  const now = deps.now ?? new Date();
  let evicted = 0;
  for (const action of plan.actions) {
    try {
      if (action.kind === 'delete-asset') await deps.assets.deleteAsset(action.assetId);
      else await deps.assets.deleteAssetGroup(action.groupId);
    } catch (error) {
      if (!isGone(error)) {
        console.error('[identity] rotation delete failed', action, error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
        return { ok: false, retryable: true };
      }
    }
    if (action.kind === 'delete-asset') await deleteIdentityAssetRow(deps.sql, action.assetId);
    else {
      await evictIdentityGroup(deps.sql, { userId: action.userId, groupId: action.groupId, now });
      evicted += 1;
    }
  }
  return { ok: true, evicted };
}
