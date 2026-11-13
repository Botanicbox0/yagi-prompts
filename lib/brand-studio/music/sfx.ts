/**
 * Dedicated Sound Effects (SFX) generation & polling service (`sfx.generate` / `sfx.status`).
 *
 * - Enforces `studioSeat` (`requireSelfStudio: true`), `sound` feature policy (`assertBrandFeature`),
 *   Morphic/sandbox 404 hardline, and `requireCreate`.
 * - Reserves TWINGS credits (`reserveAllowance`) and refunds 100% automatically on provider failure.
 * - Routes production calls through `elevenlabs/sound-effects/text-to-sound-effects`; only uses
 *   deterministic WAV synthesis when explicitly running in `'fake'` test/local mode.
 * - Customer strings are 100% sanitized — zero internal model/tool/server identifiers.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { assertBrandFeature } from '@/lib/brands/entitlements';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { COMPOSE_FINAL_RENDER_MODEL } from '@/lib/brand-studio/compose/credits';
import type { StudioAllowanceView, StudioErrorCode } from '@/lib/brand-studio/contracts';
import { creditsOf } from '@/lib/brand-studio/credits';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { allowanceView, loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { createSunraClient, SunraError } from '@/lib/sunra/client';
import {
  COMMERCIAL_MUSIC_NOTICE_EN,
  COMMERCIAL_MUSIC_NOTICE_KO,
  sfxCredits,
  sfxKrw,
} from './contracts';
import type { EnvRecord } from './provider';
import { synthesizePreviewMusicWav } from './synth';

export { sfxCredits, sfxKrw };

export const SfxGenerateInputSchema = z.object({
  organizationId: z.string().uuid(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  text: z.string().trim().min(2).max(400),
  durationSec: z.number().min(0.5).max(22).default(4),
  promptInfluence: z.number().min(0).max(1).default(0.45),
});
export type SfxGenerateInput = z.infer<typeof SfxGenerateInputSchema>;

export const SfxStatusInputSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid(),
});
export type SfxStatusInput = z.infer<typeof SfxStatusInputSchema>;

export interface SfxJobSuccess {
  ok: true;
  jobId: string;
  status: 'running' | 'succeeded';
  text: string;
  durationSec: number;
  commercialAllowed: boolean;
  licenseNoticeKo: string;
  licenseNoticeEn: string;
  creditsUsed: number;
  assetId: string | null;
  audioUrl: string | null;
  dataUrl: string | null;
  allowance: StudioAllowanceView;
}

export interface SfxJobFailed {
  ok: false;
  code: StudioErrorCode;
  refunded?: boolean;
  allowance?: StudioAllowanceView;
}

export type SfxOperationResult = SfxJobSuccess | SfxJobFailed;

interface StoredSfxJobParams {
  source: 'sfx';
  postProdStatus: 'running' | 'succeeded';
  providerMode: 'sunra' | 'fake';
  providerTaskId: string | null;
  text: string;
  durationSec: number;
  promptInfluence: number;
  commercialAllowed: boolean;
  assetId: string | null;
  audioUrl: string | null;
  dataUrl: string | null;
}

export interface SfxServiceOptions {
  env?: EnvRecord;
  fetchImpl?: typeof fetch;
}

function resolveSfxMode(env: EnvRecord): 'sunra' | 'fake' | 'unavailable' {
  const explicit = env.BRAND_STUDIO_MUSIC_PROVIDER?.trim();
  if (explicit === 'fake') return 'fake';
  if (env.SUNRA_API_KEY?.trim()) return 'sunra';
  if (explicit && explicit !== 'fake') return 'unavailable';
  if (env.BRAND_STUDIO_PROVIDER?.trim() === 'fake' || env.NODE_ENV === 'test') return 'fake';
  return 'unavailable';
}

async function storeSfxAudioAsset(
  sql: SqlRunner,
  deps: StudioDeps,
  input: {
    organizationId: string;
    userId: string;
    durationSec: number;
    bytes?: Uint8Array;
    remoteUrl?: string;
    mime: 'audio/wav' | 'audio/mpeg';
    fetchImpl: typeof fetch;
  },
): Promise<{ assetId: string | null; audioUrl: string }> {
  let finalBytes = input.bytes;
  if (!finalBytes && input.remoteUrl) {
    try {
      const resp = await input.fetchImpl(input.remoteUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(25_000),
      });
      if (resp.ok) {
        finalBytes = new Uint8Array(await resp.arrayBuffer());
      }
    } catch {
      // Keep remote URL when byte download is unavailable in mocked tests
    }
  }

  if (!finalBytes || finalBytes.byteLength === 0) {
    return { assetId: null, audioUrl: input.remoteUrl ?? '' };
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
    return { assetId: existing.id, audioUrl: deps.media.url(existing.storage_key) };
  }

  const ext = input.mime === 'audio/wav' ? 'wav' : 'mp3';
  const roundedSec = Math.round(input.durationSec * 10) / 10;
  const inserted = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_assets (
         organization_id, kind, name, mime, size_bytes, duration_ms,
         storage_key, sha256, source, status, created_by
       ) values (
         $1, 'audio', $2, $3, $4, $5,
         $6, $7, 'generation', 'ready', $8
       ) returning id`,
      [
        input.organizationId,
        `사운드 이펙트 (${roundedSec}s).${ext}`,
        input.mime,
        finalBytes.byteLength,
        Math.max(500, Math.round(input.durationSec * 1000)),
        stored.key,
        sha,
        input.userId,
      ],
    )
  ).rows[0]!;

  return { assetId: inserted.id, audioUrl: deps.media.url(stored.key) };
}

async function refundSfxJob(
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
    return allowanceView(await loadAllowance(tx, organizationId, deps.env, now));
  });
}

export async function generateSoundEffect(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: SfxServiceOptions,
): Promise<SfxOperationResult> {
  const parsed = SfxGenerateInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const mode = resolveSfxMode(env);
  if (mode === 'unavailable') {
    return { ok: false, code: 'provider_unavailable' };
  }

  let reserved;
  try {
    reserved = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      await assertBrandFeature(tx, v.organizationId, 'sound');
      requireCreate(seat);
      await lockOrganization(tx, v.organizationId);

      const existing = (
        await tx.query<{
          id: string;
          status: string;
          estimate_krw: number | null;
          usage_krw: number | null;
          params: StoredSfxJobParams | null;
        }>(
          `select id, status, estimate_krw, usage_krw, params from brand_studio_jobs
            where organization_id = $1 and created_by = $2 and request_id = $3`,
          [v.organizationId, seat.userId, v.requestId],
        )
      ).rows[0];

      if (existing) {
        const allowance = allowanceView(await loadAllowance(tx, v.organizationId, deps.env, now));
        if (existing.status === 'succeeded' && existing.params?.source === 'sfx') {
          const p = existing.params;
          return {
            kind: 'existing' as const,
            result: {
              ok: true as const,
              jobId: existing.id,
              status: p.postProdStatus,
              text: p.text,
              durationSec: p.durationSec,
              commercialAllowed: p.commercialAllowed,
              licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
              licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
              creditsUsed: creditsOf(Number(existing.usage_krw ?? existing.estimate_krw ?? 0)),
              assetId: p.assetId,
              audioUrl: p.audioUrl,
              dataUrl: p.dataUrl,
              allowance,
            },
          };
        }
        return { kind: 'existing' as const, result: { ok: false as const, code: 'conflict' as const } };
      }

      const krw = sfxKrw(v.durationSec);
      const verdict = await reserveAllowance(tx, v.organizationId, krw, deps.env, now);
      if (!verdict.ok) {
        return { kind: 'existing' as const, result: { ok: false as const, code: verdict.code } };
      }

      const initialParams: StoredSfxJobParams = {
        source: 'sfx',
        postProdStatus: 'running',
        providerMode: mode,
        providerTaskId: null,
        text: v.text,
        durationSec: v.durationSec,
        promptInfluence: v.promptInfluence,
        commercialAllowed: true,
        assetId: null,
        audioUrl: null,
        dataUrl: null,
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
          `SFX: ${v.text.slice(0, 120)}`,
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
        allowance,
      };
    });
  } catch (error) {
    if (error instanceof StudioDenied) return { ok: false, code: error.code };
    throw error;
  }

  if (reserved.kind === 'existing') return reserved.result;

  if (mode === 'sunra') {
    const apiKey = env.SUNRA_API_KEY?.trim() || '';
    const baseUrl = (env.SUNRA_BASE_URL?.trim() || 'https://api.sunra.ai').replace(/\/+$/, '');
    const client = createSunraClient({ apiKey, baseUrl }, { fetch: fetchImpl });
    try {
      const task = await client.submit('elevenlabs/sound-effects/text-to-sound-effects', {
        text: v.text,
        duration_seconds: v.durationSec,
        prompt_influence: v.promptInfluence,
      });
      const runningParams: StoredSfxJobParams = {
        source: 'sfx',
        postProdStatus: 'running',
        providerMode: 'sunra',
        providerTaskId: task.id,
        text: v.text,
        durationSec: v.durationSec,
        promptInfluence: v.promptInfluence,
        commercialAllowed: true,
        assetId: null,
        audioUrl: null,
        dataUrl: null,
      };
      await deps.sql.query(
        `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
        [reserved.jobId, v.organizationId, JSON.stringify(runningParams)],
      );
      return {
        ok: true,
        jobId: reserved.jobId,
        status: 'running',
        text: v.text,
        durationSec: v.durationSec,
        commercialAllowed: true,
        licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
        licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
        creditsUsed: creditsOf(reserved.krw),
        assetId: null,
        audioUrl: null,
        dataUrl: null,
        allowance: reserved.allowance,
      };
    } catch (error) {
      const code = error instanceof SunraError && error.status === 422 ? 'provider_rejected' : 'provider_unavailable';
      const refundedAllowance = await refundSfxJob(deps, v.organizationId, reserved.jobId, code, now);
      return { ok: false, code, refunded: true, allowance: refundedAllowance };
    }
  }

  // Deterministic fake synthesis strictly when resolved mode is 'fake'
  const synth = synthesizePreviewMusicWav({
    bpm: 120,
    keySignature: 'Dm',
    durationSec: v.durationSec,
    revealSec: Math.min(v.durationSec * 0.4, 1.5),
    preDropHushMs: 80,
  });
  const saved = await deps.sql.transaction(async (tx) => {
    const asset = await storeSfxAudioAsset(tx, deps, {
      organizationId: v.organizationId,
      userId: reserved.userId,
      durationSec: v.durationSec,
      bytes: synth.bytes,
      mime: 'audio/wav',
      fetchImpl,
    });
    const finalParams: StoredSfxJobParams = {
      source: 'sfx',
      postProdStatus: 'succeeded',
      providerMode: 'fake',
      providerTaskId: null,
      text: v.text,
      durationSec: v.durationSec,
      promptInfluence: v.promptInfluence,
      commercialAllowed: true,
      assetId: asset.assetId,
      audioUrl: asset.audioUrl,
      dataUrl: synth.dataUrl,
    };
    await tx.query(
      `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
      [reserved.jobId, v.organizationId, JSON.stringify(finalParams)],
    );
    return asset;
  });

  return {
    ok: true,
    jobId: reserved.jobId,
    status: 'succeeded',
    text: v.text,
    durationSec: v.durationSec,
    commercialAllowed: true,
    licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
    licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
    creditsUsed: creditsOf(reserved.krw),
    assetId: saved.assetId,
    audioUrl: saved.audioUrl,
    dataUrl: synth.dataUrl,
    allowance: reserved.allowance,
  };
}

export async function getSfxJobStatus(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: SfxServiceOptions,
): Promise<SfxOperationResult> {
  const parsed = SfxStatusInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  const job = await deps.sql.transaction(async (tx) => {
    const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
    if (seat.role === 'guest') throw new StudioDenied('not_found');
    await assertBrandFeature(tx, v.organizationId, 'sound');
    const row = (
      await tx.query<{
        id: string;
        created_by: string;
        status: string;
        error_code: string | null;
        estimate_krw: number | null;
        usage_krw: number | null;
        params: StoredSfxJobParams | null;
      }>(
        `select id, created_by, status, error_code, estimate_krw, usage_krw, params
           from brand_studio_jobs
          where organization_id = $1 and id = $2 limit 1`,
        [v.organizationId, v.jobId],
      )
    ).rows[0];
    if (!row || row.params?.source !== 'sfx') return null;
    const allowance = allowanceView(await loadAllowance(tx, v.organizationId, deps.env, now));
    return { row, allowance };
  });

  if (!job) return { ok: false, code: 'not_found' };
  const p = job.row.params!;
  if (job.row.status === 'failed') {
    const code = (job.row.error_code as StudioErrorCode) || 'failed';
    return { ok: false, code, refunded: true, allowance: job.allowance };
  }

  if (p.postProdStatus === 'running' && p.providerMode === 'sunra' && p.providerTaskId) {
    const apiKey = env.SUNRA_API_KEY?.trim() || '';
    const baseUrl = (env.SUNRA_BASE_URL?.trim() || 'https://api.sunra.ai').replace(/\/+$/, '');
    if (!apiKey) {
      const refunded = await refundSfxJob(deps, v.organizationId, job.row.id, 'provider_unavailable', now);
      return { ok: false, code: 'provider_unavailable', refunded: true, allowance: refunded };
    }
    const client = createSunraClient({ apiKey, baseUrl }, { fetch: fetchImpl });
    try {
      const task = await client.getTask(p.providerTaskId);
      if (task.status === 'IN_QUEUE' || task.status === 'IN_PROGRESS') {
        return {
          ok: true,
          jobId: job.row.id,
          status: 'running',
          text: p.text,
          durationSec: p.durationSec,
          commercialAllowed: true,
          licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
          licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
          creditsUsed: creditsOf(Number(job.row.usage_krw ?? job.row.estimate_krw ?? 0)),
          assetId: null,
          audioUrl: null,
          dataUrl: null,
          allowance: job.allowance,
        };
      }
      if (task.status === 'COMPLETED' && task.success !== false && task.url) {
        const stored = await deps.sql.transaction(async (tx) => {
          const asset = await storeSfxAudioAsset(tx, deps, {
            organizationId: v.organizationId,
            userId: job.row.created_by,
            durationSec: p.durationSec,
            remoteUrl: task.url!,
            mime: 'audio/mpeg',
            fetchImpl,
          });
          const nextParams: StoredSfxJobParams = {
            ...p,
            postProdStatus: 'succeeded',
            assetId: asset.assetId,
            audioUrl: asset.audioUrl,
          };
          await tx.query(
            `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
            [job.row.id, v.organizationId, JSON.stringify(nextParams)],
          );
          return asset;
        });
        return {
          ok: true,
          jobId: job.row.id,
          status: 'succeeded',
          text: p.text,
          durationSec: p.durationSec,
          commercialAllowed: true,
          licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
          licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
          creditsUsed: creditsOf(Number(job.row.usage_krw ?? job.row.estimate_krw ?? 0)),
          assetId: stored.assetId,
          audioUrl: stored.audioUrl,
          dataUrl: null,
          allowance: job.allowance,
        };
      }
      const refunded = await refundSfxJob(deps, v.organizationId, job.row.id, 'failed', now);
      return { ok: false, code: 'failed', refunded: true, allowance: refunded };
    } catch {
      const refunded = await refundSfxJob(deps, v.organizationId, job.row.id, 'provider_unavailable', now);
      return { ok: false, code: 'provider_unavailable', refunded: true, allowance: refunded };
    }
  }

  return {
    ok: true,
    jobId: job.row.id,
    status: p.postProdStatus,
    text: p.text,
    durationSec: p.durationSec,
    commercialAllowed: p.commercialAllowed,
    licenseNoticeKo: COMMERCIAL_MUSIC_NOTICE_KO,
    licenseNoticeEn: COMMERCIAL_MUSIC_NOTICE_EN,
    creditsUsed: creditsOf(Number(job.row.usage_krw ?? job.row.estimate_krw ?? 0)),
    assetId: p.assetId,
    audioUrl: p.audioUrl,
    dataUrl: p.dataUrl,
    allowance: job.allowance,
  };
}
