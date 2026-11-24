/**
 * Reference-based Brand Studio Music Engine orchestration service (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * - Enforces `studioSeat` (`requireSelfStudio: true`), `sound` feature policy (`assertBrandFeature`),
 *   Morphic/sandbox 404 hardline, and `requireCreate`.
 * - Compiles dual-voice ABC score (`buildValidatedDualVoiceAbcScore`), `0ms` drop sync
 *   (`computeViralDropSlice`), and strict Commercial License Gate (`validateAudioLicenseGate`).
 * - Reserves TWINGS credits (`reserveAllowance`) and refunds 100% automatically on provider failure.
 * - `generateReferenceMusic` is closed unless `BRAND_STUDIO_MUSIC_GENERATION=on` (`deps.env.musicGeneration`,
 *   lib/flags.ts): closed, it answers `feature_unavailable` before any query or credit reservation.
 *   `getMusicJobStatus` stays open so jobs already running finish or refund.
 * - Customer strings are 100% sanitized — zero internal tool/model/server identifiers.
 */
import { createHash } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { computeViralDropSlice, type ViralDropSlicePlan } from '@/lib/brands/sound/director';
import {
  validateAudioLicenseGate,
  type AudioAssetLicenseSource,
  type AudioLicenseGateResult,
} from '@/lib/brands/sound/master';
import {
  BRAND_MUSIC_STUDIO_PRESETS,
  buildValidatedDualVoiceAbcScore,
  compileBrandMusicScore,
  type AbcScoreValidationReport,
} from '@/lib/brands/sound/music-studio';
import { lockOrganization, requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { COMPOSE_FINAL_RENDER_MODEL } from '@/lib/brand-studio/compose/credits';
import { creditsOf } from '@/lib/brand-studio/credits';
import { readyAsset } from '@/lib/brand-studio/repo';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { loadAllowanceViewWithRefill } from '@/lib/brand-studio/allowance-refill';
import { allowanceView, reserveAllowance } from '@/lib/brand-studio/usage';
import {
  COMMERCIAL_MUSIC_NOTICE_EN,
  COMMERCIAL_MUSIC_NOTICE_KO,
  MusicGenerateInputSchema,
  musicKrw,
  MusicStatusInputSchema,
  NON_COMMERCIAL_MUSIC_NOTICE_EN,
  NON_COMMERCIAL_MUSIC_NOTICE_KO,
  type MusicOperationResult,
} from './contracts';
import { selectMusicProvider, type EnvRecord, type MusicProvider } from './provider';
import { wavBytesToDataUrl } from './synth';

export interface MusicServiceOptions {
  env?: EnvRecord;
  fetchImpl?: typeof fetch;
  provider?: MusicProvider;
}

interface StoredMusicJobParams {
  source: 'music';
  postProdStatus: 'running' | 'succeeded' | 'failed';
  providerId: string;
  providerTaskId: string | null;
  bpm: number;
  keySignature: string;
  durationSec: number;
  revealSec: number;
  preDropHushMs: number;
  dropSync: ViralDropSlicePlan;
  abcScore: AbcScoreValidationReport;
  stylePrompt: string;
  hasReferenceAudio: boolean;
  nonCommercialOnly: boolean;
  commercialAllowed: boolean;
  licenseSource: AudioAssetLicenseSource;
  licenseGate: AudioLicenseGateResult;
  synthesizedPreview: boolean;
  assetId: string | null;
  audioUrl: string | null;
  dataUrl: string | null;
}

async function storeGeneratedMusicAsset(
  sql: SqlRunner,
  deps: StudioDeps,
  input: {
    organizationId: string;
    userId: string;
    bpm: number;
    durationSec: number;
    commercialAllowed: boolean;
    bytes?: Uint8Array;
    remoteUrl?: string;
    mime: 'audio/wav' | 'audio/mpeg';
    fetchImpl: typeof fetch;
  },
): Promise<{ assetId: string | null; audioUrl: string; dataUrl: string | null }> {
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
      // Keep remote URL when direct byte download is unavailable in mocked HTTP tests
    }
  }

  if (!finalBytes || finalBytes.byteLength === 0) {
    return {
      assetId: null,
      audioUrl: input.remoteUrl ?? '',
      dataUrl: null,
    };
  }

  const stored = await deps.media.put(finalBytes, input.mime);
  const sha = createHash('sha256').update(finalBytes).digest('hex');
  const dataUrl = input.mime === 'audio/wav' ? wavBytesToDataUrl(finalBytes) : null;

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
      audioUrl: deps.media.url(existing.storage_key),
      dataUrl,
    };
  }

  const ext = input.mime === 'audio/wav' ? 'wav' : 'mp3';
  const name = input.commercialAllowed
    ? `브랜드 라이선스 BGM (${input.bpm} BPM).${ext}`
    : `시안 가이드 BGM (${input.bpm} BPM).${ext}`;
  const durationMs = Math.max(1000, Math.round(input.durationSec * 1000));

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
        name,
        input.mime,
        finalBytes.byteLength,
        durationMs,
        stored.key,
        sha,
        input.userId,
      ],
    )
  ).rows[0]!;

  return {
    assetId: inserted.id,
    audioUrl: deps.media.url(stored.key),
    dataUrl,
  };
}

async function refundMusicJob(
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
    return await loadAllowanceViewWithRefill(tx, organizationId, deps.env, now);
  });
}

function noticesFor(commercialAllowed: boolean): { ko: string; en: string } {
  return commercialAllowed
    ? { ko: COMMERCIAL_MUSIC_NOTICE_KO, en: COMMERCIAL_MUSIC_NOTICE_EN }
    : { ko: NON_COMMERCIAL_MUSIC_NOTICE_KO, en: NON_COMMERCIAL_MUSIC_NOTICE_EN };
}

export async function generateReferenceMusic(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: MusicServiceOptions,
): Promise<MusicOperationResult> {
  // Closed (no commercially cleared engine, docs/BRAND-EDITING-STUDIO.md §8-5): refuse before anything else.
  if (deps.env.musicGeneration !== true) {
    return { ok: false, code: 'feature_unavailable' };
  }
  const parsed = MusicGenerateInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, code: 'invalid' };
  }
  const v = parsed.data;

  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const provider = options?.provider ?? selectMusicProvider(env, { fetchImpl });

  const preset = v.presetId
    ? BRAND_MUSIC_STUDIO_PRESETS.find((p) => p.id === v.presetId)
    : undefined;

  const bpm = v.bpm ?? preset?.score.bpm ?? 122;
  const keySignature = v.keySignature ?? preset?.score.keySignature ?? 'Dm';
  const leadInstrument = v.leadInstrument ?? preset?.score.leadInstrument ?? 'mellow Rhodes lead melody';
  const durationSec = v.durationSec ?? preset?.videoDurationSec ?? 15;
  const revealSec = Math.min(
    durationSec - 0.2,
    Math.max(0.2, v.revealSec ?? v.videoRevealSec ?? preset?.videoRevealSec ?? Math.min(durationSec * 0.35, 3.8)),
  );
  const preDropHushMs = v.preDropHushMs ?? 180;

  const refInputAssetId =
    v.refAudioAssetId ??
    (typeof v.ref_audio === 'object' && v.ref_audio ? v.ref_audio.assetId : undefined);
  const refInputUrl =
    v.refAudioUrl ??
    (typeof v.ref_audio === 'string'
      ? v.ref_audio
      : typeof v.ref_audio === 'object' && v.ref_audio
        ? v.ref_audio.url
        : undefined);

  const initialLicenseSource: AudioAssetLicenseSource = provider.commercialAllowed
    ? 'commercial_licensed'
    : 'yue2_cc_by_nc';

  const compiledScore = compileBrandMusicScore({
    ...(preset?.score ?? {}),
    bpm,
    keySignature,
    leadInstrument,
    trackDurationSec: Math.max(8, durationSec),
    trackDropSec: Math.max(1.5, Math.min(45, revealSec)),
    licenseSource: initialLicenseSource,
    licenseCertificateRef: provider.commercialAllowed ? 'STUDIO-COMMERCIAL-MUSIC-API' : '',
    editBrief: {
      preserveHarmonyAndTempo: true,
      carveNarrationPocketHz: true,
      preDropHushWindowMs: preDropHushMs,
      highPassSubBelowHz: 32,
      arrangementNoteKo: '드롭 직전 진공 휴지(Pre-Drop Hush) 및 클라이맥스 컷 0ms 동기화',
    },
  });

  const abcScore = buildValidatedDualVoiceAbcScore({
    title: `Brand Score (${bpm} BPM)`,
    bpm,
    keySignature,
    bars: Math.max(4, Math.min(16, Math.round((durationSec * bpm) / 240) || 8)),
  });

  // Align trackDropSec === revealSec on a synthesized/generated track of `durationSec` so slice is [0, durationSec] with 0ms offset
  const dropSync = computeViralDropSlice({
    trackDurationSec: durationSec,
    trackDropSec: revealSec,
    videoRevealSec: revealSec,
    videoDurationSec: durationSec,
  });

  const stylePrompt = v.prompt
    ? `${compiledScore.styleTagPrompt}, ${v.prompt}`
    : compiledScore.styleTagPrompt;

  let resolvedRefAudioUrl: string | null = refInputUrl ?? null;

  let reserved:
    | { kind: 'existing'; result: MusicOperationResult }
    | {
        kind: 'created';
        jobId: string;
        userId: string;
        krw: number;
        allowance: ReturnType<typeof allowanceView>;
      };

  try {
    reserved = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(tx, v.organizationId, 'sound');
      } catch (err) {
        if (err instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw err;
      }
      requireCreate(seat);

      if (refInputAssetId) {
        const refAsset = await readyAsset(tx, v.organizationId, refInputAssetId);
        if (!refAsset || (refAsset.kind !== 'audio' && refAsset.kind !== 'video')) {
          throw new StudioDenied('reference_missing');
        }
        resolvedRefAudioUrl = deps.media.url(refAsset.storage_key);
      }

      await lockOrganization(tx, v.organizationId);
      const existing = (
        await tx.query<{
          id: string;
          status: string;
          estimate_krw: number;
          usage_krw: number | null;
          params: StoredMusicJobParams;
        }>(
          `select id, status, estimate_krw, usage_krw, params
             from brand_studio_jobs
            where organization_id = $1 and created_by = $2 and request_id = $3`,
          [v.organizationId, seat.userId, v.requestId],
        )
      ).rows[0];

      if (existing) {
        const allowance = await loadAllowanceViewWithRefill(tx, v.organizationId, deps.env, now);
        if (existing.status === 'succeeded' && existing.params?.source === 'music') {
          const p = existing.params;
          const notices = noticesFor(p.commercialAllowed);
          return {
            kind: 'existing' as const,
            result: {
              ok: true as const,
              jobId: existing.id,
              status: p.postProdStatus === 'running' ? ('running' as const) : ('succeeded' as const),
              bpm: p.bpm,
              keySignature: p.keySignature,
              durationSec: p.durationSec,
              revealSec: p.revealSec,
              preDropHushMs: p.preDropHushMs,
              dropSync: p.dropSync,
              abcScore: p.abcScore,
              stylePrompt: p.stylePrompt,
              hasReferenceAudio: p.hasReferenceAudio,
              nonCommercialOnly: p.nonCommercialOnly,
              commercialAllowed: p.commercialAllowed,
              licenseSource: p.licenseSource,
              licenseGate: p.licenseGate,
              licenseNoticeKo: notices.ko,
              licenseNoticeEn: notices.en,
              synthesizedPreview: p.synthesizedPreview,
              creditsUsed: creditsOf(Number(existing.usage_krw ?? existing.estimate_krw ?? 0)),
              assetId: p.assetId,
              audioUrl: p.audioUrl,
              dataUrl: p.dataUrl,
              allowance,
            },
          };
        }
        return {
          kind: 'existing' as const,
          result: { ok: false as const, code: 'conflict' as const },
        };
      }

      const krw = musicKrw(durationSec);
      const verdict = await reserveAllowance(tx, v.organizationId, krw, deps.env, now);
      if (!verdict.ok) {
        return {
          kind: 'existing' as const,
          result: { ok: false as const, code: verdict.code },
        };
      }

      const initialGate = validateAudioLicenseGate([
        {
          assetId: `bgm:${v.requestId}`,
          source: initialLicenseSource,
          ...(provider.commercialAllowed ? { licenseCertificateRef: 'STUDIO-COMMERCIAL-MUSIC-API' } : {}),
        },
      ]);

      const initialParams: StoredMusicJobParams = {
        source: 'music',
        postProdStatus: 'running',
        providerId: provider.id,
        providerTaskId: null,
        bpm,
        keySignature,
        durationSec,
        revealSec,
        preDropHushMs,
        dropSync,
        abcScore,
        stylePrompt,
        hasReferenceAudio: Boolean(resolvedRefAudioUrl),
        nonCommercialOnly: !initialGate.commercialAllowed,
        commercialAllowed: initialGate.commercialAllowed,
        licenseSource: initialLicenseSource,
        licenseGate: initialGate,
        synthesizedPreview: false,
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
          `BGM ${bpm} BPM (${keySignature})`,
          JSON.stringify(initialParams),
          krw,
          ts,
        ],
      );

      const allowance = await loadAllowanceViewWithRefill(tx, v.organizationId, deps.env, now);
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

  if (reserved.kind === 'existing') {
    return reserved.result;
  }

  let outcome;
  try {
    outcome = await provider.submit({
      stylePrompt,
      userPrompt: v.prompt,
      bpm,
      keySignature,
      durationSec,
      revealSec,
      preDropHushMs,
      abcNotation: abcScore.abcNotation,
      refAudioUrl: resolvedRefAudioUrl,
      ...(v.compositionPlan ? { compositionPlan: v.compositionPlan } : {}),
    });
  } catch {
    const refundedAllowance = await refundMusicJob(
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
    const refundedAllowance = await refundMusicJob(
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

  const licenseGate = validateAudioLicenseGate([
    {
      assetId: `bgm:${reserved.jobId}`,
      source: outcome.licenseSource,
      ...(outcome.licenseCertificateRef ? { licenseCertificateRef: outcome.licenseCertificateRef } : {}),
    },
  ]);
  const commercialAllowed = outcome.commercialAllowed && licenseGate.commercialAllowed;
  const nonCommercialOnly = !commercialAllowed;
  const notices = noticesFor(commercialAllowed);

  if (outcome.status === 'running') {
    const runningParams: StoredMusicJobParams = {
      source: 'music',
      postProdStatus: 'running',
      providerId: provider.id,
      providerTaskId: outcome.providerTaskId,
      bpm,
      keySignature,
      durationSec,
      revealSec,
      preDropHushMs,
      dropSync,
      abcScore,
      stylePrompt,
      hasReferenceAudio: Boolean(resolvedRefAudioUrl),
      nonCommercialOnly,
      commercialAllowed,
      licenseSource: outcome.licenseSource,
      licenseGate,
      synthesizedPreview: false,
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
      bpm,
      keySignature,
      durationSec,
      revealSec,
      preDropHushMs,
      dropSync,
      abcScore,
      stylePrompt,
      hasReferenceAudio: Boolean(resolvedRefAudioUrl),
      nonCommercialOnly,
      commercialAllowed,
      licenseSource: outcome.licenseSource,
      licenseGate,
      licenseNoticeKo: notices.ko,
      licenseNoticeEn: notices.en,
      synthesizedPreview: false,
      creditsUsed: creditsOf(reserved.krw),
      assetId: null,
      audioUrl: null,
      dataUrl: null,
      allowance: reserved.allowance,
    };
  }

  const stored = await deps.sql.transaction(async (tx) => {
    const saved = await storeGeneratedMusicAsset(tx, deps, {
      organizationId: v.organizationId,
      userId: reserved.userId,
      bpm,
      durationSec,
      commercialAllowed,
      bytes: outcome.bytes,
      remoteUrl: outcome.audioUrl,
      mime: outcome.mime,
      fetchImpl,
    });
    const finalDataUrl = outcome.dataUrl ?? saved.dataUrl;
    const finalParams: StoredMusicJobParams = {
      source: 'music',
      postProdStatus: 'succeeded',
      providerId: provider.id,
      providerTaskId: null,
      bpm,
      keySignature,
      durationSec,
      revealSec,
      preDropHushMs,
      dropSync,
      abcScore,
      stylePrompt,
      hasReferenceAudio: Boolean(resolvedRefAudioUrl),
      nonCommercialOnly,
      commercialAllowed,
      licenseSource: outcome.licenseSource,
      licenseGate,
      synthesizedPreview: outcome.synthesizedPreview,
      assetId: saved.assetId,
      audioUrl: saved.audioUrl,
      dataUrl: finalDataUrl,
    };
    await tx.query(
      `update brand_studio_jobs set params = $3::jsonb where id = $1 and organization_id = $2`,
      [reserved.jobId, v.organizationId, JSON.stringify(finalParams)],
    );
    return { ...saved, dataUrl: finalDataUrl };
  });

  return {
    ok: true,
    jobId: reserved.jobId,
    status: 'succeeded',
    bpm,
    keySignature,
    durationSec,
    revealSec,
    preDropHushMs,
    dropSync,
    abcScore,
    stylePrompt,
    hasReferenceAudio: Boolean(resolvedRefAudioUrl),
    nonCommercialOnly,
    commercialAllowed,
    licenseSource: outcome.licenseSource,
    licenseGate,
    licenseNoticeKo: notices.ko,
    licenseNoticeEn: notices.en,
    synthesizedPreview: outcome.synthesizedPreview,
    creditsUsed: creditsOf(reserved.krw),
    assetId: stored.assetId,
    audioUrl: stored.audioUrl,
    dataUrl: stored.dataUrl,
    allowance: reserved.allowance,
  };
}

export async function getMusicJobStatus(
  deps: StudioDeps,
  viewer: Viewer,
  rawInput: unknown,
  options?: MusicServiceOptions,
): Promise<MusicOperationResult> {
  const parsed = MusicStatusInputSchema.safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const v = parsed.data;
  const now = deps.now?.() ?? new Date();
  const env = options?.env ?? process.env;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;

  let loaded: {
    userId: string;
    status: string;
    krw: number;
    params: StoredMusicJobParams;
    allowance: ReturnType<typeof allowanceView>;
  };

  try {
    loaded = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, v.organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      try {
        await assertBrandFeature(tx, v.organizationId, 'sound');
      } catch (err) {
        if (err instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
        throw err;
      }

      const row = (
        await tx.query<{
          id: string;
          status: string;
          estimate_krw: number;
          usage_krw: number | null;
          params: StoredMusicJobParams;
        }>(
          `select id, status, estimate_krw, usage_krw, params
             from brand_studio_jobs
            where id = $1 and organization_id = $2`,
          [v.jobId, v.organizationId],
        )
      ).rows[0];

      if (!row || row.params?.source !== 'music') {
        throw new StudioDenied('not_found');
      }
      const allowance = await loadAllowanceViewWithRefill(tx, v.organizationId, deps.env, now);
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
  const notices = noticesFor(p.commercialAllowed);

  if (p.postProdStatus === 'succeeded' || !p.providerTaskId) {
    return {
      ok: true,
      jobId: v.jobId,
      status: 'succeeded',
      bpm: p.bpm,
      keySignature: p.keySignature,
      durationSec: p.durationSec,
      revealSec: p.revealSec,
      preDropHushMs: p.preDropHushMs,
      dropSync: p.dropSync,
      abcScore: p.abcScore,
      stylePrompt: p.stylePrompt,
      hasReferenceAudio: p.hasReferenceAudio,
      nonCommercialOnly: p.nonCommercialOnly,
      commercialAllowed: p.commercialAllowed,
      licenseSource: p.licenseSource,
      licenseGate: p.licenseGate,
      licenseNoticeKo: notices.ko,
      licenseNoticeEn: notices.en,
      synthesizedPreview: p.synthesizedPreview,
      creditsUsed: creditsOf(loaded.krw),
      assetId: p.assetId,
      audioUrl: p.audioUrl,
      dataUrl: p.dataUrl,
      allowance: loaded.allowance,
    };
  }

  const provider =
    options?.provider ??
    selectMusicProvider({ ...env, BRAND_STUDIO_MUSIC_PROVIDER: p.providerId }, { fetchImpl });

  const pollOutcome = await provider.poll(p.providerTaskId);
  if (!pollOutcome.ok) {
    const refundedAllowance = await refundMusicJob(
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
      bpm: p.bpm,
      keySignature: p.keySignature,
      durationSec: p.durationSec,
      revealSec: p.revealSec,
      preDropHushMs: p.preDropHushMs,
      dropSync: p.dropSync,
      abcScore: p.abcScore,
      stylePrompt: p.stylePrompt,
      hasReferenceAudio: p.hasReferenceAudio,
      nonCommercialOnly: p.nonCommercialOnly,
      commercialAllowed: p.commercialAllowed,
      licenseSource: p.licenseSource,
      licenseGate: p.licenseGate,
      licenseNoticeKo: notices.ko,
      licenseNoticeEn: notices.en,
      synthesizedPreview: p.synthesizedPreview,
      creditsUsed: creditsOf(loaded.krw),
      assetId: null,
      audioUrl: null,
      dataUrl: null,
      allowance: loaded.allowance,
    };
  }

  const stored = await deps.sql.transaction(async (tx) => {
    const saved = await storeGeneratedMusicAsset(tx, deps, {
      organizationId: v.organizationId,
      userId: loaded.userId,
      bpm: p.bpm,
      durationSec: p.durationSec,
      commercialAllowed: p.commercialAllowed,
      bytes: pollOutcome.bytes,
      remoteUrl: pollOutcome.audioUrl,
      mime: pollOutcome.mime,
      fetchImpl,
    });
    const nextParams: StoredMusicJobParams = {
      ...p,
      postProdStatus: 'succeeded',
      assetId: saved.assetId,
      audioUrl: saved.audioUrl,
      dataUrl: saved.dataUrl,
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
    bpm: p.bpm,
    keySignature: p.keySignature,
    durationSec: p.durationSec,
    revealSec: p.revealSec,
    preDropHushMs: p.preDropHushMs,
    dropSync: p.dropSync,
    abcScore: p.abcScore,
    stylePrompt: p.stylePrompt,
    hasReferenceAudio: p.hasReferenceAudio,
    nonCommercialOnly: p.nonCommercialOnly,
    commercialAllowed: p.commercialAllowed,
    licenseSource: p.licenseSource,
    licenseGate: p.licenseGate,
    licenseNoticeKo: notices.ko,
    licenseNoticeEn: notices.en,
    synthesizedPreview: p.synthesizedPreview,
    creditsUsed: creditsOf(loaded.krw),
    assetId: stored.assetId,
    audioUrl: stored.audioUrl,
    dataUrl: stored.dataUrl,
    allowance: loaded.allowance,
  };
}
