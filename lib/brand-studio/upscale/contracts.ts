/**
 * SeedVR2 Upscale wire contracts & credit schedule (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Architectural note (internal only — never surface vendor/server names in customer UI):
 * BytePlus ModelArk API does not expose a standalone SeedVR2 endpoint. We standardize on SeedVR2
 * (`seedvr2_ema_7b_fp16.safetensors`, `batch_size=21` 4n+1, `color_correction='lab'`, 4K shot-cut
 * boundary split) via a pluggable provider boundary (`local_comfyui`, `yagi_production`,
 * `comfyui_cloud`, `external_api`, `fake`) controlled by `COMFYUI_CLOUD_URL` /
 * `BRAND_STUDIO_UPSCALE_API_URL` / `BRAND_STUDIO_UPSCALE_PROVIDER`.
 *
 * Client-safe: zod + pure credit math only.
 */
import { z } from 'zod';
import type { StudioAllowanceView, StudioErrorCode } from '@/lib/brand-studio/contracts';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import type { SeedVr2UpscaleConfig, UpscaleSegment } from '@/lib/brands/finish/upscale-master';

export const UPSCALE_PROVIDERS = [
  'local_comfyui',
  'yagi_production',
  'comfyui_cloud',
  'external_api',
  'fake',
] as const;
export type UpscaleProviderId = (typeof UPSCALE_PROVIDERS)[number];

export const UPSCALE_RESOLUTIONS = [1080, 1440, 2160] as const;
export type UpscaleResolution = (typeof UPSCALE_RESOLUTIONS)[number];

export const UPSCALE_MEDIA_KINDS = ['image', 'video'] as const;
export type UpscaleMediaKind = (typeof UPSCALE_MEDIA_KINDS)[number];

/**
 * Customer-facing TWINGS credit schedule for high-definition upscaling:
 * - Image: `1080p -> 8`, `1440p -> 12`, `4K 2160p -> 18` credits
 * - Video: `1080p -> 15 + 2*sec`, `1440p -> 25 + 3*sec`, `4K 2160p -> 40 + 5*sec` credits
 */
export function upscaleCredits(
  resolution: UpscaleResolution,
  durationSec: number,
  kind: UpscaleMediaKind = 'video',
): number {
  if (kind === 'image') {
    switch (resolution) {
      case 1080:
        return 8;
      case 1440:
        return 12;
      case 2160:
        return 18;
    }
  }

  const wholeSec = Math.max(
    1,
    Math.min(600, Math.ceil(Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 1)),
  );
  switch (resolution) {
    case 1080:
      return 15 + 2 * wholeSec;
    case 1440:
      return 25 + 3 * wholeSec;
    case 2160:
      return 40 + 5 * wholeSec;
  }
}

/** Internal KRW allowance unit (`1 credit = 10 KRW`) reserved for one upscale job. */
export function upscaleKrw(
  resolution: UpscaleResolution,
  durationSec: number,
  kind: UpscaleMediaKind = 'video',
): number {
  return upscaleCredits(resolution, durationSec, kind) * STUDIO_CREDIT_KRW;
}

export const UpscaleSubmitInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
    kind: z.enum(UPSCALE_MEDIA_KINDS).default('video'),
    assetId: z.string().uuid().optional(),
    outputId: z.string().uuid().optional(),
    sourceUrl: z.string().trim().min(1).max(1000).optional(),
    resolution: z.union([z.literal(1080), z.literal(1440), z.literal(2160)]).default(1080),
    durationSec: z.number().min(0).max(600).optional(),
    shotCutSeconds: z.array(z.number().min(0).max(600)).max(120).optional(),
    batchSize: z.number().int().min(5).max(45).default(21),
    colorCorrection: z.enum(['lab', 'wavelet']).default('lab'),
  })
  .refine(
    (v) => Boolean(v.assetId || v.outputId || v.sourceUrl),
    { message: 'assetId, outputId, or sourceUrl is required', path: ['sourceUrl'] },
  );

export type UpscaleSubmitInput = z.infer<typeof UpscaleSubmitInputSchema>;

export const UpscaleStatusInputSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export type UpscaleStatusInput = z.infer<typeof UpscaleStatusInputSchema>;

export interface UpscaleJobSuccess {
  ok: true;
  jobId: string;
  status: 'running' | 'succeeded';
  kind: UpscaleMediaKind;
  resolution: UpscaleResolution;
  requiresSplit: boolean;
  segments: UpscaleSegment[];
  seedVr2Config: SeedVr2UpscaleConfig;
  creditsUsed: number;
  assetId: string | null;
  outputUrl: string | null;
  width: number | null;
  height: number | null;
  allowance: StudioAllowanceView;
}

export interface UpscaleJobFailed {
  ok: false;
  code: StudioErrorCode;
  refunded?: boolean;
  allowance?: StudioAllowanceView;
}

export type UpscaleOperationResult = UpscaleJobSuccess | UpscaleJobFailed;
