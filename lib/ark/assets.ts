/**
 * BytePlus ModelArk — the real-human asset library, as an INTERFACE.
 *
 * The Assets API (CreateVisualValidateSession, CreateAsset, ListAssets, DeleteAsset,
 * DeleteAssetGroup, …) is not the Bearer-key API the video tasks use: it is signed with an Access
 * Key pair (AK/SK, region ap-southeast-1, Action version 2024-01-01). There is no key pair on this
 * machine until the founder activates Advanced Creation Rights and issues one, so the signed
 * implementation lands with it. What lands NOW is the shape the reclaim worker programs against,
 * so the worker is finished and tested before the first signed call is possible.
 *
 * Vocabulary (docs.byteplus.com "Private real-human asset library guide", 2026-09-01):
 *   · Asset Group  = one verified real person (GroupType LivenessFace). Created by the person's own
 *                    liveness check; every later photo of them is face-matched against it.
 *   · Asset        = one photo/video/audio of that person. Status Processing → Active | Failed.
 *                    Only Active assets can be referenced (`asset://<id>`) in a render.
 *
 * The quota that makes reclaim necessary: the free "Entry" tier allows 50 asset groups AND 50
 * assets, and CreateAsset at 3 requests per minute. Over the limit, new groups and assets are
 * REFUSED — nothing upgrades itself and nothing is billed; existing assets keep working. The paid
 * tier ($1,400/month, 1M/1M, 120 QPM) is a manual console purchase. So the 51st verified person is
 * not a surprise invoice, it is a refusal — and the reclaim pass in `reclaim.ts` is what keeps
 * that refusal from happening while the roster has stale entries in it.
 */

export type ArkAssetStatus = 'Processing' | 'Active' | 'Failed';

export interface ArkAssetRecord {
  id: string;
  groupId: string;
  status: ArkAssetStatus;
  createdAt: string;
  /**
   * When the asset was last submitted to a render. The docs warn it is null for anything unused
   * since 2026-07-24 and must not be the ONLY evidence of disuse — the worker prefers its own
   * `last_used_at`, which is written on every render we create.
   */
  lastInferenceAt: string | null;
}

export interface ArkAssetsApi {
  listAssets(filter: { groupIds?: string[]; statuses?: ArkAssetStatus[] }): Promise<ArkAssetRecord[]>;
  /** Irreversible. */
  deleteAsset(id: string): Promise<void>;
  /** Irreversible; the person must pass liveness again to come back. */
  deleteAssetGroup(id: string): Promise<void>;
}

export interface ArkQuota {
  groups: number;
  assets: number;
}

/** Advanced Creation Rights — Entry (free). */
export const ARK_ENTRY_QUOTA: ArkQuota = { groups: 50, assets: 50 };

/** Advanced Creation Rights — $1,400/month. */
export const ARK_ADVANCED_QUOTA: ArkQuota = { groups: 1_000_000, assets: 1_000_000 };

/** `ARK_QUOTA_GROUPS` / `ARK_QUOTA_ASSETS` override the tier the account is actually on. */
export function arkQuotaFromEnv(env: Record<string, string | undefined> = process.env): ArkQuota {
  const groups = Number.parseInt(env.ARK_QUOTA_GROUPS ?? '', 10);
  const assets = Number.parseInt(env.ARK_QUOTA_ASSETS ?? '', 10);
  return {
    groups: Number.isFinite(groups) && groups > 0 ? groups : ARK_ENTRY_QUOTA.groups,
    assets: Number.isFinite(assets) && assets > 0 ? assets : ARK_ENTRY_QUOTA.assets,
  };
}
