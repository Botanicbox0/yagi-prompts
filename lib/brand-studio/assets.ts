/**
 * The company library (docs/BRAND-STUDIO-V2.md §5.2, §6): `asset.reserve`, `asset.complete`,
 * `asset.update`, `asset.delete`, `asset.from_output`, `output.delete`.
 *
 * Upload: reserve -> the browser PUTs to a signed staging URL (or POSTs to the local gateway) ->
 * complete re-reads the bytes, checks magic bytes, size and type against the reservation, folds a
 * duplicate (same sha256 in the same organization) into the existing entry, measures, makes the 512 px
 * thumbnail and moves the file into the media store. Deletes are soft; the object goes when nothing
 * live still points at it.
 */
import { randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import { STAGING_BUCKET } from '@/lib/storage';
import {
  AssetCompleteSchema,
  AssetFromOutputSchema,
  AssetRefSchema,
  AssetReserveSchema,
  AssetUpdateSchema,
  OutputRefSchema,
  STUDIO_LIMITS,
  type StudioAssetReserved,
  type StudioAssetSaved,
  type StudioDone,
  type StudioFailure,
} from './contracts';
import { lockOrganization, requireCreate, studioSeat, StudioDenied } from './access';
import { bytesLimit, checkUpload, imageInfo, kindOfMime, sha256Hex, thumbnailWebp, videoInfo } from './files';
import { isStudioMediaKey } from './media-store';
import { failure, guarded } from './outcome';
import { assetView, keyStillUsed, readyOutput } from './repo';
import type { AssetRow, JobRow, StudioDeps } from './types';

/** Local mode only: the browser POSTs the file here (app/api/brand-studio/assets/[id]/route.ts). */
export const LOCAL_UPLOAD_ROUTE = '/api/brand-studio/assets';

async function liveAssetCount(sql: StudioDeps['sql'], organizationId: string): Promise<number> {
  return Number((await sql.query<{ n: number }>('select count(*)::int as n from brand_studio_assets where organization_id = $1 and deleted_at is null', [organizationId])).rows[0]?.n ?? 0);
}

async function bySha(sql: StudioDeps['sql'], organizationId: string, sha: string): Promise<AssetRow | null> {
  return (
    (await sql.query<AssetRow>("select * from brand_studio_assets where organization_id = $1 and sha256 = $2 and status = 'ready' and deleted_at is null", [organizationId, sha])).rows[0] ?? null
  );
}

async function dropKeys(deps: StudioDeps, keys: Array<string | null | undefined>, except: { assetId?: string; outputId?: string }): Promise<void> {
  for (const key of keys) {
    if (!key || !isStudioMediaKey(key)) continue;
    try {
      if (!(await keyStillUsed(deps.sql, key, except))) await deps.media.delete(key);
    } catch (error) {
      deps.log?.('studio_media_delete_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  }
}

export async function reserveStudioAsset(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioAssetReserved | StudioFailure> {
  const parsed = AssetReserveSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const kind = kindOfMime(v.mime);
  if (!kind) return failure('unsupported_file');
  if (v.sizeBytes > bytesLimit(kind)) return failure('file_too_large');
  const reserved = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      await lockOrganization(sql, v.organizationId);
      const prior = (await sql.query<AssetRow>('select * from brand_studio_assets where organization_id = $1 and created_by = $2 and request_id = $3', [v.organizationId, viewer.userId, v.requestId])).rows[0];
      if (prior) {
        if (prior.mime !== v.mime || Number(prior.size_bytes) !== v.sizeBytes || prior.name !== v.name) throw new StudioDenied('conflict');
        return { id: prior.id, key: prior.storage_key, pending: prior.status === 'pending' && !prior.deleted_at };
      }
      if ((await liveAssetCount(sql, v.organizationId)) >= STUDIO_LIMITS.assetsPerOrganization) throw new StudioDenied('asset_limit');
      const id = randomUUID();
      const key = `brand-studio/${v.organizationId}/${id}`;
      await sql.query(
        `insert into brand_studio_assets (id, organization_id, kind, role, name, mime, size_bytes, storage_key, source, status, created_by, request_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, 'upload', 'pending', $9, $10)`,
        [id, v.organizationId, kind, v.role ?? null, v.name, v.mime, v.sizeBytes, key, viewer.userId, v.requestId],
      );
      return { id, key, pending: true };
    }),
  );
  if ('ok' in reserved) return reserved;
  if (!reserved.pending) return { ok: true, id: reserved.id, direct: false };
  const url = await deps.staging.signedUploadUrl(reserved.key, v.mime);
  if (url) return { ok: true, id: reserved.id, direct: true, url };
  if (deps.staging.servesSignedUrls) return failure('failed');
  // Local: no service to PUT to; the browser POSTs the bytes to the studio's own gateway.
  return { ok: true, id: reserved.id, direct: false, url: `${LOCAL_UPLOAD_ROUTE}/${reserved.id}` };
}

/** The local gateway's question: may this viewer post bytes for this reservation? */
export async function pendingUpload(deps: StudioDeps, viewer: Viewer, assetId: string): Promise<{ key: string; mime: string; sizeBytes: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(assetId) || !viewer.userId) return null;
  const row = (await deps.sql.query<AssetRow>("select * from brand_studio_assets where id = $1 and status = 'pending' and deleted_at is null", [assetId])).rows[0];
  if (!row || row.created_by !== viewer.userId) return null;
  const seat = await guarded(() => studioSeat(deps.sql, viewer.userId, row.organization_id));
  if ('ok' in seat || !seat.canCreate) return null;
  return { key: row.storage_key, mime: row.mime, sizeBytes: Number(row.size_bytes) };
}

export function completeStudioAsset(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioAssetSaved | StudioFailure> {
  return completeOnce(deps, viewer, raw, 0);
}

async function completeOnce(deps: StudioDeps, viewer: Viewer, raw: unknown, attempt: number): Promise<StudioAssetSaved | StudioFailure> {
  const parsed = AssetCompleteSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const stored: string[] = [];
  let releasedStagingKey: string | null = null;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      // No organization lock here (the file may take a while to move): a same-bytes race is settled by
      // the unique (organization, sha256) index and the one retry below.
      const row = (await sql.query<AssetRow>('select * from brand_studio_assets where id = $1 and organization_id = $2 for update', [v.assetId, v.organizationId])).rows[0];
      if (!row || row.created_by !== viewer.userId) throw new StudioDenied('not_found');
      if (row.duplicate_of) {
        const target = (await sql.query<AssetRow>('select * from brand_studio_assets where id = $1 and deleted_at is null', [row.duplicate_of])).rows[0];
        if (!target) throw new StudioDenied('not_found');
        return target;
      }
      if (row.deleted_at) throw new StudioDenied('not_found');
      if (row.status === 'ready') return row;
      let bytes: Uint8Array;
      try {
        bytes = await deps.staging.read(STAGING_BUCKET, row.storage_key);
      } catch {
        throw new StudioDenied('invalid');
      }
      const verdict = checkUpload(bytes, { mime: row.mime, sizeBytes: Number(row.size_bytes) });
      if (!verdict.ok) throw new StudioDenied(verdict.code);
      const sha = sha256Hex(bytes);
      const same = await bySha(sql, v.organizationId, sha);
      if (same) {
        await sql.query('update brand_studio_assets set deleted_at = now(), duplicate_of = $2 where id = $1', [row.id, same.id]);
        releasedStagingKey = row.storage_key;
        return same;
      }
      let width: number | null = null, height: number | null = null, durationMs: number | null = null, thumbKey: string | null = null;
      if (verdict.kind === 'image') {
        const size = await imageInfo(bytes);
        if (!size) throw new StudioDenied('unsupported_file');
        ({ width, height } = size);
        thumbKey = (await deps.media.put(await thumbnailWebp(bytes), 'image/webp')).key;
        stored.push(thumbKey);
      } else if (verdict.kind === 'video') {
        const info = videoInfo(bytes);
        width = info?.width ?? v.width ?? null;
        height = info?.height ?? v.height ?? null;
        durationMs = info?.durationMs ?? (v.seconds ? Math.round(v.seconds * 1000) : null);
      } else {
        durationMs = v.seconds ? Math.round(v.seconds * 1000) : null;
      }
      if (durationMs !== null && durationMs > 600_000) throw new StudioDenied('unsupported_file');
      const { key } = await deps.media.put(bytes, verdict.mime);
      stored.push(key);
      releasedStagingKey = row.storage_key;
      return (
        await sql.query<AssetRow>(
          `update brand_studio_assets set status = 'ready', kind = $2, mime = $3, storage_key = $4, thumb_key = $5, sha256 = $6,
              width = $7, height = $8, duration_ms = $9 where id = $1 returning *`,
          [row.id, verdict.kind, verdict.mime, key, thumbKey, sha, width, height, durationMs],
        )
      ).rows[0]!;
    }),
  ).catch(async (error) => {
    for (const key of stored) await deps.media.delete(key).catch(() => undefined);
    throw error;
  });
  if ('ok' in outcome) {
    for (const key of stored) await deps.media.delete(key).catch(() => undefined);
    // Two uploads of the same bytes raced: the other one won; fold into it.
    if (outcome.code === 'conflict' && attempt === 0) return completeOnce(deps, viewer, raw, 1);
    return outcome;
  }
  if (releasedStagingKey && releasedStagingKey !== outcome.storage_key) {
    await deps.staging.releaseStaging?.(releasedStagingKey).catch(() => undefined);
  }
  return { ok: true, asset: assetView(outcome, deps.media) };
}

export async function updateStudioAsset(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioAssetSaved | StudioFailure> {
  const parsed = AssetUpdateSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const row = (
        await sql.query<AssetRow>(
          `update brand_studio_assets set name = coalesce($3, name), role = case when $4::boolean then $5 else role end,
              tags = coalesce($6::text[], tags)
            where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null returning *`,
          [v.assetId, v.organizationId, v.name ?? null, v.role !== undefined, v.role ?? null, v.tags ? [...new Set(v.tags)] : null],
        )
      ).rows[0];
      if (!row) throw new StudioDenied('not_found');
      return row;
    }),
  );
  return 'ok' in outcome ? outcome : { ok: true, asset: assetView(outcome, deps.media) };
}

const openRefsTo = (field: 'assetId' | 'outputId') =>
  `select 1 from brand_studio_jobs where organization_id = $1 and status in ('held','queued','running','finishing')
     and (refs @> jsonb_build_array(jsonb_build_object('${field}', $2::text))${field === 'outputId' ? ' or parent_output_id = $2::uuid' : ''}
       or params -> 'source' ->> '${field}' = $2::text) limit 1`;

export async function deleteStudioAsset(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioDone | StudioFailure> {
  const parsed = AssetRefSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const row = (await sql.query<AssetRow>('select * from brand_studio_assets where id = $1 and organization_id = $2 and deleted_at is null for update', [v.assetId, v.organizationId])).rows[0];
      if (!row) throw new StudioDenied('not_found');
      if ((await sql.query(openRefsTo('assetId'), [v.organizationId, v.assetId])).rows[0]) throw new StudioDenied('conflict');
      await sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [row.id]);
      await sql.query('update brand_studio_outputs set saved_asset_id = null where saved_asset_id = $1', [row.id]);
      return row;
    }),
  );
  if ('ok' in outcome) return outcome;
  await dropKeys(deps, [outcome.storage_key, outcome.thumb_key], { assetId: outcome.id });
  return { ok: true };
}

export async function assetFromOutput(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioAssetSaved | StudioFailure> {
  const parsed = AssetFromOutputSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      await lockOrganization(sql, v.organizationId);
      const output = await readyOutput(sql, v.organizationId, v.outputId);
      if (!output?.storage_key) throw new StudioDenied('not_found');
      if (output.saved_asset_id) {
        const saved = (await sql.query<AssetRow>("select * from brand_studio_assets where id = $1 and deleted_at is null and status = 'ready'", [output.saved_asset_id])).rows[0];
        if (saved) return saved;
      }
      const same = output.sha256 ? await bySha(sql, v.organizationId, output.sha256) : null;
      if (same) {
        await sql.query('update brand_studio_outputs set saved_asset_id = $2 where id = $1', [output.id, same.id]);
        return same;
      }
      if ((await liveAssetCount(sql, v.organizationId)) >= STUDIO_LIMITS.assetsPerOrganization) throw new StudioDenied('asset_limit');
      const job = (await sql.query<Pick<JobRow, 'prompt' | 'created_at'>>('select prompt, created_at from brand_studio_jobs where id = $1', [output.job_id])).rows[0];
      const fallback = (job?.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || `${output.kind} ${new Date().toISOString().slice(0, 10)}`;
      const asset = (
        await sql.query<AssetRow>(
          `insert into brand_studio_assets (organization_id, kind, role, name, mime, size_bytes, width, height, duration_ms, storage_key,
              thumb_key, sha256, source, source_output_id, status, created_by)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'generation', $13, 'ready', $14) returning *`,
          [
            v.organizationId, output.kind, v.role ?? null, v.name ?? fallback, output.mime ?? 'image/png', Number(output.bytes ?? 1),
            output.width, output.height, output.duration_ms, output.storage_key, output.thumb_key, output.sha256, output.id, viewer.userId,
          ],
        )
      ).rows[0]!;
      await sql.query('update brand_studio_outputs set saved_asset_id = $2 where id = $1', [output.id, asset.id]);
      return asset;
    }),
  );
  return 'ok' in outcome ? outcome : { ok: true, asset: assetView(outcome, deps.media) };
}

export async function deleteStudioOutput(deps: StudioDeps, viewer: Viewer, raw: unknown): Promise<StudioDone | StudioFailure> {
  const parsed = OutputRefSchema.safeParse(raw);
  if (!parsed.success) return failure('invalid');
  const v = parsed.data;
  const outcome = await guarded(() =>
    deps.sql.transaction(async (sql) => {
      requireCreate(await studioSeat(sql, viewer.userId, v.organizationId));
      const row = (
        await sql.query<{ id: string; job_id: string; idx: number; storage_key: string | null; thumb_key: string | null }>(
          'select id, job_id, idx, storage_key, thumb_key from brand_studio_outputs where id = $1 and organization_id = $2 and deleted_at is null for update',
          [v.outputId, v.organizationId],
        )
      ).rows[0];
      if (!row) throw new StudioDenied('not_found');
      if ((await sql.query(openRefsTo('outputId'), [v.organizationId, v.outputId])).rows[0]) throw new StudioDenied('conflict');
      const job = (await sql.query<Pick<JobRow, 'work'>>('select work from brand_studio_jobs where id = $1', [row.job_id])).rows[0];
      const patch = job?.work?.region?.patches?.[String(row.idx)];
      await sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [row.id]);
      return { ...row, patch_key: patch?.patchKey ?? null, mask_key: patch?.maskKey ?? null };
    }),
  );
  if ('ok' in outcome) return outcome;
  await dropKeys(deps, [outcome.storage_key, outcome.thumb_key, outcome.patch_key, outcome.mask_key], { outputId: outcome.id });
  return { ok: true };
}
