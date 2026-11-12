import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/viewer';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import {
  LookMatchSettingsSchema,
  PRESET_BRAND_LOOK_IDS,
  prepareBrandColorGradeSpec,
} from '@/lib/brands/finish/color-grading';
import { BRAND_MUSIC_STUDIO_PRESETS } from '@/lib/brands/sound/music-studio';
import { requireCreate, StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import {
  computeReinhardTransferMatrix,
  cssFilterForColorGrade,
  DEFAULT_COLOR_GRADE_SPEC,
  extractColorProfileFromRgba,
  findGradePreset,
  GRADE_PRESETS,
  presetToTargetProfile,
  type ColorGradeProfile,
  type ColorGradeSpec,
} from '@/lib/brand-studio/compose/color-grade';
import {
  detectSceneCutsFromFrameSamples,
  parseFfmpegScdetOutput,
} from '@/lib/brand-studio/compose/scene-detect';
import { STUDIO_HEADERS, studioJson, studioStatus } from '@/lib/brand-studio/http';
import { generateReferenceMusic, getMusicJobStatus } from '@/lib/brand-studio/music';
import { readyAsset, readyOutput } from '@/lib/brand-studio/repo';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';
import {
  getUpscaleJobStatus,
  submitUpscaleJob,
  UPSCALE_RESOLUTIONS,
} from '@/lib/brand-studio/upscale';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * Brand Studio Post-Production Gateway (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Operations (`POST`):
 * - `cuts.detect`: Automatic shot-cut boundary detection (`FrameHistogramSample[]` or FFmpeg `scdet`)
 * - `grade.analyze`: Reference RGBA / profile color transfer matrix + CSS filter + scoped `ColorGradeSpec`
 * - `grade.master`: Authorized 33^3 `.cube` / 5-stage FFmpeg active look master (`color_grading` policy)
 * - `upscale.submit` / `upscale.status`: SeedVR2 (`1080p` / `1440p` / `4K 2160p`) pluggable upscale + 100% refund on error
 * - `music.generate` / `music.status`: Reference-based BGM generation + `0ms` drop sync + CC BY-NC commercial gate
 *
 * Security & sandbox hardline (identical to `/api/brand-studio/compose`):
 * 1. `sameOriginMutation` (`403` on cross-origin `POST`)
 * 2. `brandStudioV2Open()` (`404` when `BRAND_STUDIO_V2` is off)
 * 3. `getViewer()` (`401` when signed out)
 * 4. `studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true })` + `seat.role === 'guest'` -> `404`
 *    (Morphic IDs `d425c3b1-...`, `deb648e9-...`, `Morphic`/`모픽` names, and `generative_media`/`self_studio`
 *    denied organizations receive `404` before any operation field is inspected).
 */
export const dynamic = 'force-dynamic';

export const POST_PRODUCTION_OPERATIONS = [
  'cuts.detect',
  'grade.analyze',
  'grade.master',
  'upscale.submit',
  'upscale.status',
  'music.generate',
  'music.status',
] as const;
export type PostProductionOperation = (typeof POST_PRODUCTION_OPERATIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_MAX = 262_144;

const CutsDetectInputSchema = z.object({
  organizationId: z.string().uuid(),
  samples: z
    .array(
      z.object({
        timeSec: z.number().min(0).max(3600),
        hist: z.array(z.number().min(0)).min(3).max(256),
        lumaMean: z.number().min(0).max(255),
        motionDelta: z.number().min(0).max(1).optional(),
      }),
    )
    .max(3600)
    .optional(),
  ffmpegStderr: z.string().max(120_000).optional(),
  threshold: z.number().min(0.05).max(0.95).optional(),
  minShotSec: z.number().min(0.1).max(30).optional(),
  assetId: z.string().uuid().optional(),
  outputId: z.string().uuid().optional(),
});

const ColorProfileSchema: z.ZodType<ColorGradeProfile> = z.object({
  lumaMean: z.number().min(0).max(1),
  lumaStd: z.number().min(0).max(1),
  rMean: z.number().min(0).max(1),
  gMean: z.number().min(0).max(1),
  bMean: z.number().min(0).max(1),
  rStd: z.number().min(0).max(1),
  gStd: z.number().min(0).max(1),
  bStd: z.number().min(0).max(1),
  warmth: z.number().min(-1).max(1),
  contrast: z.number().min(0).max(3),
  saturation: z.number().min(0).max(3),
});

const ColorRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
});

const GradeAnalyzeInputSchema = z.object({
  organizationId: z.string().uuid(),
  rgba: z.array(z.number().int().min(0).max(255)).max(65_536).optional(),
  sourceProfile: ColorProfileSchema.nullable().optional(),
  referenceProfile: ColorProfileSchema.nullable().optional(),
  referenceLabel: z.string().trim().max(120).nullable().optional(),
  presetId: z.string().trim().max(64).nullable().optional(),
  scope: z.enum(['full_timeline', 'selected_clip', 'region']).default('full_timeline'),
  targetClipId: z.string().trim().max(80).nullable().optional(),
  region: ColorRegionSchema.nullable().optional(),
  intensity: z.number().min(0).max(1).default(0.85),
  skinProtect: z.number().min(0).max(1).default(0.7),
  halation: z.number().min(0).max(0.2).default(0.04),
  grain: z.number().min(0).max(10).default(1.8),
});

const GradeMasterInputSchema = z.object({
  organizationId: z.string().uuid(),
  presetId: z.enum(PRESET_BRAND_LOOK_IDS).default('twings-french-blue'),
  settings: LookMatchSettingsSchema.partial().optional(),
  lumaSample: z
    .object({
      p1: z.number().min(0).max(100),
      p99: z.number().min(0).max(100),
    })
    .optional(),
  scope: z.enum(['full_timeline', 'selected_clip', 'region']).default('full_timeline'),
  targetClipId: z.string().trim().max(80).nullable().optional(),
  region: ColorRegionSchema.nullable().optional(),
  referenceProfile: ColorProfileSchema.nullable().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
  if (!UUID.test(organizationId)) return studioJson({ ok: false, code: 'not_found' }, 404);

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    const seat = await sql.transaction(async (tx) => {
      const s = await studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true });
      if (s.role === 'guest') throw new StudioDenied('not_found');
      return s;
    });
    return studioJson(
      {
        ok: true,
        canCreate: seat.canCreate,
        gradePresets: GRADE_PRESETS,
        upscaleResolutions: UPSCALE_RESOLUTIONS,
        musicPresets: BRAND_MUSIC_STUDIO_PRESETS.map((p) => ({
          id: p.id,
          labelKo: p.labelKo,
          summaryKo: p.summaryKo,
          bpm: p.score.bpm,
          keySignature: p.score.keySignature,
          leadInstrument: p.score.leadInstrument,
          videoDurationSec: p.videoDurationSec,
          videoRevealSec: p.videoRevealSec,
        })),
      },
      200,
    );
  } catch (error) {
    if (error instanceof StudioDenied) {
      return studioJson({ ok: false, code: error.code }, studioStatus(error.code));
    }
    studioLog('studio_post_production_get_failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return studioJson({ ok: false, code: 'invalid' }, 413);
  }

  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') {
      throw new Error('shape');
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const organizationId = (body.input as { organizationId?: unknown }).organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    const deps = await studioRuntimeDeps(sql);
    const operation = typeof body.operation === 'string' ? body.operation : '';
    const isStatusRead = operation === 'upscale.status' || operation === 'music.status';

    // Mandatory first-line seat + Morphic hardline + self_studio + guest exclusion BEFORE validating operation details
    await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true });
      if (seat.role === 'guest') throw new StudioDenied('not_found');
      if (!isStatusRead) {
        requireCreate(seat);
      }
    });

    if (!(POST_PRODUCTION_OPERATIONS as readonly string[]).includes(operation)) {
      return studioJson({ ok: false, code: 'invalid' }, 400);
    }

    if (operation === 'cuts.detect') {
      const parsed = CutsDetectInputSchema.safeParse(body.input);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const v = parsed.data;

      let mediaDurationSec: number | null = null;
      if (v.assetId || v.outputId) {
        mediaDurationSec = await deps.sql.transaction(async (tx) => {
          if (v.assetId) {
            const asset = await readyAsset(tx, v.organizationId, v.assetId);
            if (!asset || asset.kind !== 'video') throw new StudioDenied('reference_missing');
            return asset.duration_ms != null ? asset.duration_ms / 1000 : 6;
          }
          const out = await readyOutput(tx, v.organizationId, v.outputId!);
          if (!out || out.kind !== 'video') throw new StudioDenied('reference_missing');
          return out.duration_ms != null ? out.duration_ms / 1000 : 6;
        });
      }

      const cuts = v.ffmpegStderr
        ? parseFfmpegScdetOutput(v.ffmpegStderr, v.minShotSec)
        : v.samples
          ? detectSceneCutsFromFrameSamples(v.samples, {
              threshold: v.threshold,
              minShotSec: v.minShotSec,
            })
          : mediaDurationSec && mediaDurationSec >= 4
            ? [
                {
                  timeSec: Math.round((mediaDurationSec / 2) * 10) / 10,
                  confidence: 0.72,
                  delta: 0.35,
                },
              ]
            : [];

      return NextResponse.json(
        { ok: true, cuts, creditsUsed: 0 },
        { status: 200, headers: STUDIO_HEADERS },
      );
    }

    if (operation === 'grade.analyze') {
      const parsed = GradeAnalyzeInputSchema.safeParse(body.input);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const v = parsed.data;

      await deps.sql.transaction(async (tx) => {
        try {
          await assertBrandFeature(tx, v.organizationId, 'color_grading');
        } catch (err) {
          if (err instanceof BrandFeatureDenied) throw new StudioDenied('feature_unavailable');
          throw err;
        }
      });

      const preset = findGradePreset(v.presetId);
      const profile: ColorGradeProfile = v.rgba
        ? extractColorProfileFromRgba(Uint8Array.from(v.rgba))
        : v.referenceProfile ??
          (preset ? presetToTargetProfile(preset) : extractColorProfileFromRgba(new Uint8Array(0)));

      const spec: ColorGradeSpec = {
        ...DEFAULT_COLOR_GRADE_SPEC,
        enabled: true,
        scope: v.scope,
        targetClipId: v.targetClipId ?? null,
        region: v.region ?? null,
        presetId: preset?.id ?? v.presetId ?? null,
        referenceLabel: v.referenceLabel ?? null,
        referenceProfile: v.rgba || v.referenceProfile ? profile : null,
        intensity: v.intensity,
        skinProtect: v.skinProtect,
        halation: v.halation,
        grain: v.grain,
      };

      const transferMatrix = computeReinhardTransferMatrix(
        v.sourceProfile ?? null,
        profile,
        spec.intensity,
      );
      const cssFilter = cssFilterForColorGrade(spec);

      return studioJson(
        {
          ok: true,
          profile,
          spec,
          transferMatrix,
          cssFilter,
          presets: GRADE_PRESETS,
          creditsUsed: 0,
        },
        200,
      );
    }

    if (operation === 'grade.master') {
      const parsed = GradeMasterInputSchema.safeParse(body.input);
      if (!parsed.success) return studioJson({ ok: false, code: 'invalid' }, 400);
      const v = parsed.data;

      const outcome = await deps.sql.transaction(async (tx) =>
        prepareBrandColorGradeSpec(
          { sql: tx },
          viewer,
          {
            organizationId: v.organizationId,
            presetId: v.presetId,
            settings: v.settings ? LookMatchSettingsSchema.parse(v.settings) : undefined,
            lumaSample: v.lumaSample,
          },
        ),
      );

      if (!outcome.ok) {
        const mapped =
          outcome.code === 'feature_unavailable'
            ? 'feature_unavailable'
            : outcome.code === 'forbidden'
              ? 'forbidden'
              : 'invalid';
        return studioJson({ ok: false, code: mapped }, studioStatus(mapped));
      }

      const preset = findGradePreset(v.presetId);
      const targetProfile =
        v.referenceProfile ?? (preset ? presetToTargetProfile(preset) : extractColorProfileFromRgba(new Uint8Array(0)));
      const spec: ColorGradeSpec = {
        enabled: true,
        scope: v.scope,
        targetClipId: v.targetClipId ?? null,
        region: v.region ?? null,
        presetId: v.presetId,
        referenceLabel: null,
        referenceProfile: v.referenceProfile ?? null,
        intensity: outcome.spec.settings.intensity,
        skinProtect: outcome.spec.settings.skin_protect,
        halation: outcome.spec.settings.halation,
        grain: outcome.spec.settings.grain,
      };

      return studioJson(
        {
          ok: true,
          id: outcome.id,
          masterSpec: outcome.spec,
          spec,
          cssFilter: cssFilterForColorGrade(spec),
          transferMatrix: computeReinhardTransferMatrix(null, targetProfile, spec.intensity),
          creditsUsed: 0,
        },
        200,
      );
    }

    if (operation === 'upscale.submit') {
      const result = await submitUpscaleJob(deps, viewer, body.input);
      if (!result.ok) return studioJson(result, studioStatus(result.code));
      return studioJson(result, 200);
    }

    if (operation === 'upscale.status') {
      const result = await getUpscaleJobStatus(deps, viewer, body.input);
      if (!result.ok) return studioJson(result, studioStatus(result.code));
      return studioJson(result, 200);
    }

    if (operation === 'music.generate') {
      const result = await generateReferenceMusic(deps, viewer, body.input);
      if (!result.ok) return studioJson(result, studioStatus(result.code));
      return studioJson(result, 200);
    }

    const result = await getMusicJobStatus(deps, viewer, body.input);
    if (!result.ok) return studioJson(result, studioStatus(result.code));
    return studioJson(result, 200);
  } catch (error) {
    if (error instanceof StudioDenied) {
      return studioJson({ ok: false, code: error.code }, studioStatus(error.code));
    }
    studioLog('studio_post_production_post_failed', {
      operation: String(body.operation).slice(0, 40),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
