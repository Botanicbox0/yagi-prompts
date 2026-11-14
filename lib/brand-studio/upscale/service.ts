/**
 * SeedVR2 Upscale orchestration service (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * - Enforces `studioSeat` (`requireSelfStudio: true`), Morphic/sandbox 404 hardline, and `requireCreate`.
 * - Plans shot-boundary segments via `planUpscaleSegments` & `SeedVr2UpscaleConfigSchema`
 *   (`seedvr2_ema_7b_fp16.safetensors`, `batch_size: 21` 4n+1, `color_correction: 'lab'`, 4K `<= 8s` split).
 * - Reserves TWINGS credits under organization row lock (`reserveAllowance` + `brand_studio_jobs`
 *   `COMPOSE_FINAL_RENDER_MODEL`) and guarantees 100% automatic credit refund (`status = 'failed'`,
 *   `usage_krw = null`) whenever the provider is offline, rejects, or fails.
 */
import { createHash } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { COMPOSE_FINAL_RENDER_MODEL } from '@/lib/brand-studio/compose/credits';
import { creditsOf } from '@/lib/brand-studio/credits';
import { thumbnailWebp } from '@/lib/brand-studio/files';
import { readyAsset, readyOutput } from '@/lib/brand-studio/repo';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { allowanceView, loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import {
  planUpscaleSegments,
  SeedVr2UpscaleConfigSchema,
  type SeedVr2UpscaleConfig,
  type UpscaleSegment,
} from '@/lib/brands/finish/upscale-master';
import {
  UpscaleStatusInputSchema,
  UpscaleSubmitInputSchema,
  upscaleKrw,
  type UpscaleMediaKind,
  type UpscaleOperationResult,
  type UpscaleResolution,
} from './contracts';
import { selectUpscaleProvider, type EnvRecord, type UpscaleProvider } from './provider';

export interface UpscaleServiceOptions {
  env?: EnvRecord;
  fetchImpl?: typeof fetch;
  provider?: UpscaleProvider;
}

interface StoredUpscaleJobParams {
  source: 'upscale';
  postProdStatus: 'running' | 'succeeded' | 'failed';
  providerId: string;
  providerTaskId: string | null;
  kind: UpscaleMediaKind;
  resolution: UpscaleResolution;
  durationSec: number;
  requiresSplit: boolean;
  segments: UpscaleSegment[];
  seedVr2Config: SeedVr2UpscaleConfig;
  assetId: string | null;
  outputUrl: string | null;
  width: number | null;
  height: number | null;
}

async function storeUpscaledAsset(
  sql: SqlRunner,
  deps: StudioDeps,
  input: {
    organizationId: string;
    userId: string;
    kind: UpscaleMediaKind;
    resolution: UpscaleResolution;
    durationSec: number;
    bytes?: Uint8Array;
    remoteUrl?: string;
    mime: string;
    width: number;
    height: number;
    fetchImpl: typeof fetch;
  },
): Promise<{ assetId: string | null; outputUrl: string }> {
  let finalBytes = input.bytes;
  if (!finalBytes && input.remoteUrl) {
    try {
      const resp = await input.fetchImpl(input.remoteUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) {
        finalBytes = new Uint8Array(await resp.arrayBuffer());
      }
    } catch {
      // Keep remote URL when direct byte fetch is unavailable (e.g. external CDN URL in mock tests)
    }
  }

  if (!finalBytes || finalBytes.byteLength === 0) {
    return { assetId: null, outputUrl: input.remoteUrl ?? '' };
  }

  const stored = await deps.media.put(finalBytes, input.mime);
  const sha = createHash('sha256').update(finalBytes).digest('hex');
  const existing = (
    await sql.query<{ id: string; storage_key: string }>(
      `select id, storage_key from brand_studio_assets
        where organization_id = $1 and sha256 = $2 and deleted_at is null limit 1`,
      [input.organizationId, sha],
    )
  ).rows[0];

  if (existing) {
    return {
      assetId: existing.id,
      outputUrl: deps.media.url(existing.storage_key),
    };
  }

  const ext = input.kind === 'image' ? 'png' : 'mp4';
  const label = `HD ${input.resolution}p.${ext}`;
  const durationMs = input.kind === 'video' ? Math.max(100, Math.round(input.durationSec * 1000)) : null;
  let thumbKey: string | null = null;
  if (input.kind === 'image') {
    try {
      const thumbBytes = await thumbnailWebp(finalBytes);
      const storedThumb = await deps.media.put(thumbBytes, 'image/webp');
      thumbKey = storedThumb.key;
    } catch {
      thumbKey = null;
    }
  }

  const inserted = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_assets (
         organization_id, kind, name, mime, size_bytes, width, height, duration_ms,
         storage_key, thumb_key, sha256, source, status, created_by
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, 'generation', 'ready', $12
       ) returning id`,
      [
        input.organizationId,
        input.kind,
        label,
        input.mime,
        finalBytes.byteLength,
        input.width,
        input.height,
        durationMs,
        stored.key,
        thumbKey,
        sha,
        input.userId,
      ],
    )
  ).rows[0]!;

  return {
    assetId: inserted.id,
    outputUrl: deps.media.url(stored.key),
  };
}

async function refundUpscaleJob(
  deps: StudioDeps,
  organizationId: string,
  jobId: string,
  errorCode: 'provider_unavailable' | 'provider_rejected' | 'failed',
  now: Date,
) {
  return deps.sql.transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    await tx.query(
      `update brand_studio_jobs
          set status = 'failed', usage_krw = null, error_code = $3, finished_at = $4
        where id = $1 and organization_id = $2 and status <> 'failed'`,
      [jobId, organizationId, errorCode, now.toISOString()],
    );
    const updated = await loadAllowance(tx, organizationId, deps.env, now);
    return allowanceView(updated);
  });
}

export async function submitUpscaleJob(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: UpscaleServiceOptions,
): Promise<UpscaleOperationResult> {
  const parsed = UpscaleSubmitInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: 'invalid' };
  }
  const v = parsed.data;

  const configCheck = SeedVr2UpscaleConfigSchema.safeParse({
    resolution: v.resolution === 2160 ? 2160 : 1080,
    batchSize: v.batchSize,
    colorCorrection: v.colorCorrection,
  });
  if (!configCheck.success) {
    return { ok: false, code: 'invalid' };
  }
  const seedVr2Config = configCheck.data;

  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const provider = options?.provider ?? selectUpscaleProvider(env, { fetchImpl });

  let resolvedKind: UpscaleMediaKind = v.kind;
  let resolvedDurationSec = v.durationSec ?? (v.kind === 'image' ? 0 : 6);
  let resolvedSourceUrl: string | null = v.sourceUrl ?? null;

  // Step 1: Seat check + resolve source + reserve credits inside locked transaction
  let reserved:
    | {
        kind: 'existing';
        result: UpscaleOperationResult;
      }
    | {
        kind: 'created';
        jobId: string;
        userId: string;
        krw: number;
        requiresSplit: boolean;
        segments: UpscaleSegment[];
        allowance: ReturnType<typeof allowanceView>;
      };

  try {
    reserved = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      requireCreate(seat);

      if (v.assetId) {
        const asset = await readyAsset(tx, v.organizationId, v.assetId);
        if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) {
          throw new StudioDenied('reference_missing');
        }
        resolvedKind = asset.kind;
        if (asset.duration_ms != null && v.durationSec === undefined) {
          resolvedDurationSec = Math.max(0.5, asset.duration_ms / 1000);
        }
        resolvedSourceUrl = deps.media.url(asset.storage_key);
      } else if (v.outputId) {
        const out = await readyOutput(tx, v.organizationId, v.outputId);
        if (!out || !out.storage_key) {
          throw new StudioDenied('reference_missing');
        }
        resolvedKind = out.kind;
        if (out.duration_ms != null && v.durationSec === undefined) {
          resolvedDurationSec = Math.max(0.5, out.duration_ms / 1000);
        }
        resolvedSourceUrl = deps.media.url(out.storage_key);
      }

      await lockOrganization(tx, v.organizationId);
      const existing = (
        await tx.query<{
          id: string;
          status: string;
          estimate_krw: number;
          usage_krw: number | null;
          params: StoredUpscaleJobParams;
        }>(
          `select id, status, estimate_krw, usage_krw, params
             from brand_studio_jobs
            where organization_id = $1 and created_by = $2 and request_id = $3`,
          [v.organizationId, seat.userId, v.requestId],
        )
      ).rows[0];

      if (existing) {
        const allowance = allowanceView(await loadAllowance(tx, v.organizationId, deps.env, now));
        if (existing.status === 'succeeded' && existing.params?.source === 'upscale') {
          const p = existing.params;
          return {
            kind: 'existing' as const,
            result: {
              ok: true as const,
              jobId: existing.id,
              status: p.postProdStatus === 'running' ? ('running' as const) : ('succeeded' as const),
              kind: p.kind,
              resolution: p.resolution,
              requiresSplit: p.requiresSplit,
              segments: p.segments,
              seedVr2Config: p.seedVr2Config,
              creditsUsed: creditsOf(Number(existing.usage_krw ?? existing.estimate_krw ?? 0)),
              assetId: p.assetId,
              outputUrl: p.outputUrl,
              width: p.width,
              height: p.height,
              allowance,
            },
          };
        }
        return {
          kind: 'existing' as const,
          result: { ok: false as const, code: 'conflict' as const },
        };
      }

      const plan =
        resolvedKind === 'image'
          ? {
              requiresSplit: false,
              segments: [{ index: 0, startSec: 0, endSec: 0, durationSec: 0 }],
            }
          : planUpscaleSegments({
              durationSec: Math.max(0.5, resolvedDurationSec),
              resolution: v.resolution === 2160 ? 2160 : 1080,
              shotCutSeconds: v.shotCutSeconds,
            });

      const krw = upscaleKrw(v.resolution, resolvedDurationSec, resolvedKind);
      const verdict = await reserveAllowance(tx, v.organizationId, krw, deps.env, now);
      if (!verdict.ok) {
        return {
          kind: 'existing' as const,
          result: { ok: false as const, code: verdict.code },
        };
      }

      const initialParams: StoredUpscaleJobParams = {
        source: 'upscale',
        postProdStatus: 'running',
        providerId: provider.id,
        providerTaskId: null,
        kind: resolvedKind,
        resolution: v.resolution,
        durationSec: resolvedDurationSec,
        requiresSplit: plan.requiresSplit,
        segments: plan.segments,
        seedVr2Config,
        assetId: null,
        outputUrl: null,
        width: null,
        height: null,
      };

      const ts = now.toISOString();
      const inserted = await tx.query<{ id: string }>(
        `insert into brand_studio_jobs (
           organization_id, created_by, request_id, kind, status, lane, model,
           prompt, enhance, refs, params, estimate_krw, usage_krw, created_at, started_at, finished_at
         ) values (
           $1, $2, $3, 'video_final', 'succeeded', null, $4,
           $5, false, '[]'::jsonb, $6::jsonb, $7, $7, $8, $8, $8
         ) returning id`,
        [
          v.organizationId,
          seat.userId,
          v.requestId,
          COMPOSE_FINAL_RENDER_MODEL,
          `HD ${v.resolution}p upscale`,
          JSON.stringify(initialParams),
          krw,
          ts,
        ],
      );

      const allowance = allowanceView(await loadAllowance(tx, v.organizationId, deps.env, now));
      return {
        kind: 'created' as const,
        jobId: inserted.rows[0]!.id,
        userId: seat.userId,
        krw,
        requiresSplit: plan.requiresSplit,
        segments: plan.segments,
        allowance,
      };
    });
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }

  if (reserved.kind === 'existing') {
    return reserved.result;
  }

  // Step 2: Dispatch to provider; refund 100% automatically on any failure
  let outcome;
  try {
    outcome = await provider.submit({
      kind: resolvedKind,
      resolution: v.resolution,
      durationSec: resolvedDurationSec,
      sourceUrl: resolvedSourceUrl,
      config: seedVr2Config,
      segments: reserved.segments,
    });
  } catch {
    const refundedAllowance = await refundUpscaleJob(
      deps,
      v.organizationId,
      reserved.jobId,
      'provider_unavailable',
      now,
    );
    return {
      ok: false,
      code: 'provider_unavailable',
      refunded: true,
      allowance: refundedAllowance,
    };
  }

  if (!outcome.ok) {
    const safeCode =
      outcome.code === 'provider_rejected' || outcome.code === 'provider_unavailable'
        ? outcome.code
        : 'failed';
    const refundedAllowance = await refundUpscaleJob(
      deps,
      v.organizationId,
      reserved.jobId,
      safeCode,
      now,
    );
    return {
      ok: false,
      code: outcome.code,
      refunded: true,
      allowance: refundedAllowance,
    };
  }

  if (outcome.status === 'running') {
    const runningParams: StoredUpscaleJobParams = {
      source: 'upscale',
      postProdStatus: 'running',
      providerId: provider.id,
      providerTaskId: outcome.providerTaskId,
      kind: resolvedKind,
      resolution: v.resolution,
      durationSec: resolvedDurationSec,
      requiresSplit: reserved.requiresSplit,
      segments: reserved.segments,
      seedVr2Config,
      assetId: null,
      outputUrl: null,
      width: null,
      height: null,
    };
    await deps.sql.query(
      `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
      [reserved.jobId, v.organizationId, JSON.stringify(runningParams)],
    );
    return {
      ok: true,
      jobId: reserved.jobId,
      status: 'running',
      kind: resolvedKind,
      resolution: v.resolution,
      requiresSplit: reserved.requiresSplit,
      segments: reserved.segments,
      seedVr2Config,
      creditsUsed: creditsOf(reserved.krw),
      assetId: null,
      outputUrl: null,
      width: null,
      height: null,
      allowance: reserved.allowance,
    };
  }

  const stored = await deps.sql.transaction(async (tx) => {
    const saved = await storeUpscaledAsset(tx, deps, {
      organizationId: v.organizationId,
      userId: reserved.userId,
      kind: resolvedKind,
      resolution: v.resolution,
      durationSec: resolvedDurationSec,
      bytes: outcome.bytes,
      remoteUrl: outcome.outputUrl,
      mime: outcome.mime,
      width: outcome.width,
      height: outcome.height,
      fetchImpl,
    });
    const finalParams: StoredUpscaleJobParams = {
      source: 'upscale',
      postProdStatus: 'succeeded',
      providerId: provider.id,
      providerTaskId: null,
      kind: resolvedKind,
      resolution: v.resolution,
      durationSec: resolvedDurationSec,
      requiresSplit: reserved.requiresSplit,
      segments: reserved.segments,
      seedVr2Config,
      assetId: saved.assetId,
      outputUrl: saved.outputUrl,
      width: outcome.width,
      height: outcome.height,
    };
    await tx.query(
      `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
      [reserved.jobId, v.organizationId, JSON.stringify(finalParams)],
    );
    return saved;
  });

  return {
    ok: true,
    jobId: reserved.jobId,
    status: 'succeeded',
    kind: resolvedKind,
    resolution: v.resolution,
    requiresSplit: reserved.requiresSplit,
    segments: reserved.segments,
    seedVr2Config,
    creditsUsed: creditsOf(reserved.krw),
    assetId: stored.assetId,
    outputUrl: stored.outputUrl,
    width: outcome.width,
    height: outcome.height,
    allowance: reserved.allowance,
  };
}

export async function getUpscaleJobStatus(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: UpscaleServiceOptions,
): Promise<UpscaleOperationResult> {
  const parsed = UpscaleStatusInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  let loaded: {
    userId: string;
    status: string;
    krw: number;
    params: StoredUpscaleJobParams;
    allowance: ReturnType<typeof allowanceView>;
  };

  try {
    loaded = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');

      const row = (
        await tx.query<{
          id: string;
          status: string;
          estimate_krw: number;
          usage_krw: number | null;
          params: StoredUpscaleJobParams;
        }>(
          `select id, status, estimate_krw, usage_krw, params
             from brand_studio_jobs
            where id = $1 and organization_id = $2`,
          [v.jobId, v.organizationId],
        )
      ).rows[0];

      if (!row || row.params?.source !== 'upscale') {
        throw new StudioDenied('not_found');
      }
      const allowance = allowanceView(await loadAllowance(tx, v.organizationId, deps.env, now));
      return {
        userId: seat.userId,
        status: row.status,
        krw: Number(row.usage_krw ?? row.estimate_krw ?? 0),
        params: row.params,
        allowance,
      };
    });
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }

  if (loaded.status === 'failed' || loaded.params.postProdStatus === 'failed') {
    return {
      ok: false,
      code: 'failed',
      refunded: true,
      allowance: loaded.allowance,
    };
  }

  const p = loaded.params;
  if (p.postProdStatus === 'succeeded' || !p.providerTaskId) {
    return {
      ok: true,
      jobId: v.jobId,
      status: 'succeeded',
      kind: p.kind,
      resolution: p.resolution,
      requiresSplit: p.requiresSplit,
      segments: p.segments,
      seedVr2Config: p.seedVr2Config,
      creditsUsed: creditsOf(loaded.krw),
      assetId: p.assetId,
      outputUrl: p.outputUrl,
      width: p.width,
      height: p.height,
      allowance: loaded.allowance,
    };
  }

  const provider =
    options?.provider ??
    selectUpscaleProvider(
      { ...env, BRAND_STUDIO_UPSCALE_PROVIDER: p.providerId },
      { fetchImpl },
    );

  const pollOutcome = await provider.poll(p.providerTaskId, {
    kind: p.kind,
    resolution: p.resolution,
  });

  if (!pollOutcome.ok) {
    const refundedAllowance = await refundUpscaleJob(
      deps,
      v.organizationId,
      v.jobId,
      pollOutcome.code === 'provider_unavailable' ? 'provider_unavailable' : 'failed',
      now,
    );
    return {
      ok: false,
      code: pollOutcome.code,
      refunded: true,
      allowance: refundedAllowance,
    };
  }

  if (pollOutcome.status === 'running') {
    return {
      ok: true,
      jobId: v.jobId,
      status: 'running',
      kind: p.kind,
      resolution: p.resolution,
      requiresSplit: p.requiresSplit,
      segments: p.segments,
      seedVr2Config: p.seedVr2Config,
      creditsUsed: creditsOf(loaded.krw),
      assetId: null,
      outputUrl: null,
      width: null,
      height: null,
      allowance: loaded.allowance,
    };
  }

  const stored = await deps.sql.transaction(async (tx) => {
    const saved = await storeUpscaledAsset(tx, deps, {
      organizationId: v.organizationId,
      userId: loaded.userId,
      kind: p.kind,
      resolution: p.resolution,
      durationSec: p.durationSec,
      bytes: pollOutcome.bytes,
      remoteUrl: pollOutcome.outputUrl,
      mime: pollOutcome.mime,
      width: pollOutcome.width,
      height: pollOutcome.height,
      fetchImpl,
    });
    const nextParams: StoredUpscaleJobParams = {
      ...p,
      postProdStatus: 'succeeded',
      assetId: saved.assetId,
      outputUrl: saved.outputUrl,
      width: pollOutcome.width,
      height: pollOutcome.height,
    };
    await tx.query(
      `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
      [v.jobId, v.organizationId, JSON.stringify(nextParams)],
    );
    return saved;
  });

  return {
    ok: true,
    jobId: v.jobId,
    status: 'succeeded',
    kind: p.kind,
    resolution: p.resolution,
    requiresSplit: p.requiresSplit,
    segments: p.segments,
    seedVr2Config: p.seedVr2Config,
    creditsUsed: creditsOf(loaded.krw),
    assetId: stored.assetId,
    outputUrl: stored.outputUrl,
    width: pollOutcome.width,
    height: pollOutcome.height,
    allowance: loaded.allowance,
  };
}
