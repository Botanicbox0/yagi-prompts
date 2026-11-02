import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { ArkOpenApiError, arkQuotaFromEnv, parseLivenessCallback, withH5Language, type ArkAssetStatus, type ArkAssetsClient, type ArkH5Language, type ArkQuota } from '@/lib/ark/assets';
import { hasCapacity } from '@/lib/ark/reclaim';
import { engineProvider, isVideoEngine, type EngineId } from '@/lib/images/engines';
import { ASSET_LIBRARY_MODE } from '@/lib/flags';
import { makeRoom } from './rotation';
import {
  activateIdentityGroup,
  countIdentity,
  failIdentityGroup,
  insertIdentityAsset,
  loadIdentityAssetByAssetId,
  loadIdentityAssetByPhoto,
  loadIdentityGroup,
  loadIdentityGroupByToken,
  touchIdentityAsset,
  touchIdentityRender,
  updateIdentityAssetStatus,
  upsertIdentitySession,
  upsertVirtualIdentityGroup,
  type IdentityGroup,
  type IdentityStatus,
} from './repo';

/**
 * The real-person identity (docs/TEMPLATES-IA.md §8.2): how a person's own face gets into a
 * ModelArk render without the bank refusing it.
 *
 *   1. verify — once per person. We open a liveness session at the bank, send the person to its
 *      H5 page (English; there is no Korean), the bank calls us back with a token, we exchange the
 *      token for a GROUP id and keep it on `identity_groups`.
 *   2. register — once per photo. The photo is offered to the bank by URL, the bank compares it
 *      with the verified face and, asynchronously, makes it an ASSET (Processing → Active | Failed).
 *   3. render — the film task references `asset://{id}`; never the bytes.
 *
 * Which engines need this: ModelArk's films (Seedance). Seedream images, OpenAI's GPT Image models,
 * Gemini and Kling take the photo itself. `needsIdentity` is the one place that rule lives.
 *
 * The bank's client is injected (tests use a fake; a deployment without AK/SK gets `null` and says
 * so), and the free tier's cap is checked BEFORE a session opens, so a person is told "잠시 후"
 * calmly instead of failing mid-liveness (lib/ark/reclaim.ts).
 */

export const ASSET_WAIT_HOURS = 24;

/**
 * Which library a photo goes through (lib/flags.ts ASSET_LIBRARY_MODE, env `ARK_ASSET_MODE` wins).
 *   virtual  — AIGC group per account, created on first use, no camera check (the product today)
 *   liveness — the H5 real-person check, then face-matched assets (kept whole; per-account escalation)
 */
export type AssetLibraryMode = 'virtual' | 'liveness';

export function assetLibraryMode(env: Record<string, string | undefined> = process.env): AssetLibraryMode {
  const raw = env.ARK_ASSET_MODE?.trim().toLowerCase();
  if (raw === 'virtual' || raw === 'liveness') return raw;
  return ASSET_LIBRARY_MODE;
}

export interface IdentityDeps {
  sql: SqlRunner;
  /** Pinned by tests; production reads the flag. */
  mode?: AssetLibraryMode;
  /** null = AK/SK not configured; every operation then answers `unavailable`. */
  assets: ArkAssetsClient | null;
  siteUrl: string;
  quota?: ArkQuota;
  now?: Date;
}

/** Engines whose provider refuses a real face in the bytes: the asset library is the only door. */
export function needsIdentity(engine: EngineId): boolean {
  // Seedance refuses a real face at input, so the person's photo reaches it only as a verified-library
  // asset. Seedream's image API takes URLs or base64 and refuses `asset://` as an invalid URL (live
  // Pro API, 2026-09-22), so a Seedream image takes the bytes like OpenAI, Google Gemini and Kling —
  // the provider's own moderation still runs on them, and a face it refuses fails as `face_policy`
  // (docs/PLATFORM-2.0.md §7.3 `needsIdentity` matrix; `npm run image:smoke -- --photo` records what
  // Seedream does with a real selfie, as the Kling and Gemini smokes do for theirs).
  return engineProvider(engine) === 'modelark' && isVideoEngine(engine);
}

/** Does this engine put the person through the camera check first? Only in liveness mode. */
export function needsLiveness(engine: EngineId, mode: AssetLibraryMode = assetLibraryMode()): boolean {
  return mode === 'liveness' && needsIdentity(engine);
}

export function photoSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function identityStatusFor(sql: SqlRunner, userId: string, mode: AssetLibraryMode = assetLibraryMode()): Promise<'none' | IdentityStatus> {
  const group = await loadIdentityGroup(sql, userId);
  if (group === null) return 'none';
  // In liveness mode an AIGC group is not a verified face: the person still has to pass the check.
  if (mode === 'liveness' && group.groupType === 'AIGC') return 'none';
  return group.status;
}

export type VirtualGroupOutcome =
  | { ok: true; group: IdentityGroup }
  | { ok: false; reason: 'identity_unavailable' | 'asset_failed'; retryable?: true };

/** A bank refusal about room or rate (quota, limit, throttling) passes; the render is tried again. */
function isRoomRefusal(error: unknown): boolean {
  if (!(error instanceof ArkOpenApiError)) return false;
  return error.retryable || /quota|limit|exceed/i.test(error.code);
}

/**
 * The virtual library's whole "verification": one AIGC group per account, made the first time the
 * person renders and reused after — or again after slot rotation evicted it (lib/identity/rotation.ts).
 * A LivenessFace group that is already active is reused too — a verified face is the stricter
 * thing. Room and rate refusals surface as a retryable `identity_unavailable`, which the result page
 * words as "the studio is looking into it" rather than blaming the photo.
 */
export async function ensureVirtualGroup(deps: IdentityDeps, userId: string): Promise<VirtualGroupOutcome> {
  if (deps.assets === null) return { ok: false, reason: 'identity_unavailable' };
  const existing = await loadIdentityGroup(deps.sql, userId);
  if (existing !== null && existing.status === 'active' && existing.groupId !== null) return { ok: true, group: existing };
  const now = deps.now ?? new Date();
  const room = await makeRoom(deps, { groups: 1, assets: 0 }, userId);
  if (!room.ok) return { ok: false, reason: 'identity_unavailable', retryable: true };
  try {
    const created = await deps.assets.createAssetGroup({ name: `twings-${userId.slice(0, 8)}`, description: 'TWINGS account — the person’s own consented likeness', groupType: 'AIGC' });
    await upsertVirtualIdentityGroup(deps.sql, { userId, groupId: created.id, now });
  } catch (error) {
    console.error('[identity] CreateAssetGroup(AIGC) failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    return isRoomRefusal(error) ? { ok: false, reason: 'identity_unavailable', retryable: true } : { ok: false, reason: 'asset_failed' };
  }
  const group = await loadIdentityGroup(deps.sql, userId);
  return group === null ? { ok: false, reason: 'asset_failed' } : { ok: true, group };
}

export { loadIdentityGroup };

// ---------------------------------------------------------------------------
// 1. verify
// ---------------------------------------------------------------------------

export type StartVerificationOutcome =
  | { ok: true; h5Link: string }
  | { ok: false; code: 'sign_in_required' | 'unavailable' | 'no_capacity' | 'already_active' | 'bank_error' };

export async function startIdentityVerification(
  deps: IdentityDeps,
  viewer: Viewer,
  input: { nextPath: string | null; language: ArkH5Language },
): Promise<StartVerificationOutcome> {
  if (viewer.userId === null) return { ok: false, code: 'sign_in_required' };
  if (deps.assets === null) return { ok: false, code: 'unavailable' };
  const now = deps.now ?? new Date();

  const existing = await loadIdentityGroup(deps.sql, viewer.userId);
  if (existing?.status === 'active') return { ok: false, code: 'already_active' };

  const counts = await countIdentity(deps.sql);
  if (!hasCapacity(counts, deps.quota ?? arkQuotaFromEnv())) return { ok: false, code: 'no_capacity' };

  let session;
  try {
    session = await deps.assets.createVisualValidateSession({ callbackUrl: `${deps.siteUrl.replace(/\/+$/, '')}/api/identity/callback` });
  } catch (error) {
    console.error('[identity] CreateVisualValidateSession failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    return { ok: false, code: 'bank_error' };
  }
  const h5Link = withH5Language(session.h5Link, input.language);
  await upsertIdentitySession(deps.sql, { userId: viewer.userId, bytedToken: session.bytedToken, h5Link, nextPath: input.nextPath, now });
  return { ok: true, h5Link };
}

export interface CallbackOutcome {
  status: 'active' | 'failed' | 'unknown';
  userId: string | null;
  nextPath: string | null;
}

/** The bank's redirect after liveness. The token is the only thing trusted; the result is READ from the bank. */
export async function completeIdentityVerification(deps: IdentityDeps, params: URLSearchParams): Promise<CallbackOutcome> {
  const parsed = parseLivenessCallback(params);
  if (parsed.bytedToken === null) return { status: 'unknown', userId: null, nextPath: null };
  const group = await loadIdentityGroupByToken(deps.sql, parsed.bytedToken);
  if (group === null) return { status: 'unknown', userId: null, nextPath: null };
  const now = deps.now ?? new Date();

  if (!parsed.ok) {
    await failIdentityGroup(deps.sql, group.userId, parsed.resultCode ?? 'liveness_failed');
    return { status: 'failed', userId: group.userId, nextPath: group.nextPath };
  }
  if (deps.assets === null) {
    await failIdentityGroup(deps.sql, group.userId, 'unavailable');
    return { status: 'failed', userId: group.userId, nextPath: group.nextPath };
  }
  try {
    const { groupId } = await deps.assets.getVisualValidateResult(parsed.bytedToken);
    await activateIdentityGroup(deps.sql, group.userId, { groupId, now });
    return { status: 'active', userId: group.userId, nextPath: group.nextPath };
  } catch (error) {
    console.error('[identity] GetVisualValidateResult failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    await failIdentityGroup(deps.sql, group.userId, error instanceof ArkOpenApiError ? error.code : 'result_unavailable');
    return { status: 'failed', userId: group.userId, nextPath: group.nextPath };
  }
}

// ---------------------------------------------------------------------------
// 2. register a photo
// ---------------------------------------------------------------------------

export type EnsureAssetOutcome =
  | { status: 'active'; assetId: string }
  | { status: 'processing'; assetId: string }
  | { status: 'failed'; assetId: string | null; reason: string; retryable?: true };

/**
 * The photo as an asset in the person's group: reused by content hash, registered once, and
 * polled while the bank is still comparing. `photoUrl` must be fetchable by the bank (a signed URL
 * from the render store) — the bytes never go over the OpenAPI call.
 */
export async function ensureIdentityAsset(
  deps: IdentityDeps,
  input: { group: IdentityGroup; photo: Uint8Array; photoUrl: string | null },
): Promise<EnsureAssetOutcome> {
  if (deps.assets === null) return { status: 'failed', assetId: null, reason: 'identity_unavailable' };
  if (input.group.status !== 'active' || input.group.groupId === null) return { status: 'failed', assetId: null, reason: 'identity_required' };
  const now = deps.now ?? new Date();
  const sha = photoSha256(input.photo);

  const existing = await loadIdentityAssetByPhoto(deps.sql, input.group.userId, sha);
  if (existing !== null && existing.status === 'Active') return { status: 'active', assetId: existing.assetId };
  if (existing !== null && existing.status === 'Processing') {
    const polled = await pollIdentityAsset(deps, existing.assetId);
    if (polled === 'Active') return { status: 'active', assetId: existing.assetId };
    if (polled === 'Failed') return { status: 'failed', assetId: existing.assetId, reason: 'asset_failed' };
    return { status: 'processing', assetId: existing.assetId };
  }

  if (input.photoUrl === null) return { status: 'failed', assetId: null, reason: 'identity_unavailable' };
  const room = await makeRoom(deps, { groups: 0, assets: 1 }, input.group.userId);
  if (!room.ok) return { status: 'failed', assetId: null, reason: 'identity_unavailable', retryable: true };
  let created: { id: string };
  try {
    created = await deps.assets.createAsset({
      groupId: input.group.groupId,
      url: input.photoUrl,
      assetType: 'Image',
      name: `twings-${input.group.userId.slice(0, 8)}-${sha.slice(0, 8)}`,
    });
  } catch (error) {
    console.error('[identity] CreateAsset failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    return isRoomRefusal(error) ? { status: 'failed', assetId: null, reason: 'identity_unavailable', retryable: true } : { status: 'failed', assetId: null, reason: 'asset_failed' };
  }
  await insertIdentityAsset(deps.sql, { userId: input.group.userId, groupId: input.group.groupId, assetId: created.id, photoSha256: sha, status: 'Processing' });
  const status = await pollIdentityAsset(deps, created.id);
  if (status === 'Active') return { status: 'active', assetId: created.id };
  if (status === 'Failed') return { status: 'failed', assetId: created.id, reason: 'asset_failed' };
  return { status: 'processing', assetId: created.id };
}

/** One GetAsset, mirrored onto our row. A bank error leaves the row as it was. */
export async function pollIdentityAsset(deps: IdentityDeps, assetId: string): Promise<ArkAssetStatus | 'unknown'> {
  if (deps.assets === null) return 'unknown';
  const now = deps.now ?? new Date();
  try {
    const asset = await deps.assets.getAsset(assetId);
    const known = await loadIdentityAssetByAssetId(deps.sql, assetId);
    if (known !== null && known.status !== asset.status) await updateIdentityAssetStatus(deps.sql, assetId, asset.status, now);
    return asset.status;
  } catch (error) {
    console.warn('[identity] GetAsset failed', error instanceof ArkOpenApiError ? `${error.code}: ${error.message}` : error);
    return 'unknown';
  }
}

/** Bookkeeping when a render actually referenced the asset — the disuse clock the reclaim reads. */
export async function recordIdentityUse(sql: SqlRunner, args: { userId: string; assetId: string; now: Date }): Promise<void> {
  await touchIdentityAsset(sql, args.assetId, args.now);
  await touchIdentityRender(sql, args.userId, args.now);
}

export function assetReference(assetId: string): string {
  return `asset://${assetId}`;
}
