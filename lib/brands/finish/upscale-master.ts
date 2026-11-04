import { z } from 'zod';

/**
 * S4 SeedVR2 7B Upscale & Instagram Reels Master Specification (`knowhow-corpus.md` §8, `BRAND-PRODUCT.md` §7.1).
 * Encodes the exact verified parameters for RTX PRO 6000 96GB (`batch_size=21`, `temporal_overlap=2`,
 * `color_correction='lab'`, `bt709` colour-space lock, 4K shot-boundary split, and IG Reels CRF 13 master).
 */

export const SeedVr2UpscaleConfigSchema = z
  .object({
    ditModel: z
      .literal('seedvr2_ema_7b_fp16.safetensors')
      .default('seedvr2_ema_7b_fp16.safetensors'),
    vaeModel: z
      .literal('ema_vae_fp16.safetensors')
      .default('ema_vae_fp16.safetensors'),
    resolution: z.union([z.literal(1080), z.literal(2160)]).default(1080),
    batchSize: z.number().int().min(5).max(45).default(21),
    uniformBatchSize: z.literal(true).default(true),
    temporalOverlap: z.number().int().min(1).max(8).default(2),
    colorCorrection: z.enum(['lab', 'wavelet']).default('lab'),
    offloadDevice: z.literal('none').default('none'),
    colorSpaceTag: z.literal('bt709').default('bt709')
  })
  .superRefine((val, ctx) => {
    if ((val.batchSize - 1) % 4 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['batchSize'],
        message: 'SeedVR2 batchSize must follow the 4n + 1 rule (e.g. 5, 9, 13, 17, 21).'
      });
    }
  });

export type SeedVr2UpscaleConfig = z.infer<typeof SeedVr2UpscaleConfigSchema>;

export const DEFAULT_SEEDVR2_UPSCALE_CONFIG: SeedVr2UpscaleConfig =
  SeedVr2UpscaleConfigSchema.parse({});

export interface UpscaleSegment {
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
}

/**
 * Plans shot-boundary segments for SeedVR2 upscaling (`knowhow-corpus.md` §8.1, f13):
 * Full-clip 4K (`2160p`) upscaling exceeds RAM during `SaveVideo` on clips > 10s, so 4K jobs
 * are split at shot cut boundaries (`<= 8s` per segment) and concatenated after upscaling.
 */
export function planUpscaleSegments(input: {
  durationSec: number;
  resolution: 1080 | 2160;
  shotCutSeconds?: readonly number[];
  max4kSegmentSeconds?: number;
}): {
  requiresSplit: boolean;
  segments: UpscaleSegment[];
} {
  const maxSeg = input.max4kSegmentSeconds ?? 8;
  if (input.resolution === 1080 || input.durationSec <= maxSeg) {
    return {
      requiresSplit: false,
      segments: [
        {
          index: 0,
          startSec: 0,
          endSec: input.durationSec,
          durationSec: input.durationSec
        }
      ]
    };
  }

  const cuts = [...(input.shotCutSeconds ?? [])]
    .filter((t) => t > 0 && t < input.durationSec)
    .sort((a, b) => a - b);

  const boundaries: number[] = [0];
  for (const cut of cuts) {
    const last = boundaries[boundaries.length - 1]!;
    if (cut - last > maxSeg) {
      let cursor = last;
      while (cut - cursor > maxSeg) {
        cursor = Math.round((cursor + maxSeg) * 1000) / 1000;
        boundaries.push(cursor);
      }
    }
    boundaries.push(cut);
  }
  const lastBoundary = boundaries[boundaries.length - 1]!;
  if (input.durationSec - lastBoundary > maxSeg) {
    let cursor = lastBoundary;
    while (input.durationSec - cursor > maxSeg) {
      cursor = Math.round((cursor + maxSeg) * 1000) / 1000;
      boundaries.push(cursor);
    }
  }
  if (boundaries[boundaries.length - 1] !== input.durationSec) {
    boundaries.push(input.durationSec);
  }

  const segments: UpscaleSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startSec = boundaries[i]!;
    const endSec = boundaries[i + 1]!;
    segments.push({
      index: i,
      startSec,
      endSec,
      durationSec: Math.round((endSec - startSec) * 1000) / 1000
    });
  }

  return {
    requiresSplit: segments.length > 1,
    segments
  };
}

export const IgReelsMasterConfigSchema = z.object({
  width: z.literal(1080).default(1080),
  height: z.literal(1920).default(1920),
  fps: z.literal(24).default(24),
  crf: z.number().int().min(12).max(18).default(13),
  unsharpAmount: z.number().min(0).max(1.5).default(0.55),
  casStrength: z.number().min(0).max(1).default(0.25),
  lumaGrainStrength: z.number().min(0).max(10).default(3.4),
  audioBitrateKbps: z.literal(320).default(320),
  audioSampleRateHz: z.literal(48000).default(48000)
});

export type IgReelsMasterConfig = z.infer<typeof IgReelsMasterConfigSchema>;

export const DEFAULT_IG_REELS_MASTER_CONFIG: IgReelsMasterConfig =
  IgReelsMasterConfigSchema.parse({});

/**
 * Builds the Instagram Reels anti-recompression master filter & FFmpeg args (`knowhow-corpus.md` §8.2):
 * - `scale=1080:1920:flags=lanczos`
 * - `unsharp=3:3:0.55:3:3:0.0` + `cas=0.25`
 * - S-curve `0/0 0.06/0.05 0.50/0.50 0.94/0.955 1/1`
 * - Luminance-only grain `noise=c0s=3.4:c0f=t+u` (prevents chroma noise & 8-bit gradient banding)
 * - `yuv420p`, `libx264 -preset slow -crf 13 -profile:v high -level 4.1`, `bt709`, `24fps CFR`, `+faststart`.
 */
export function buildIgReelsMasterArgs(
  raw?: Partial<IgReelsMasterConfig>
): {
  config: IgReelsMasterConfig;
  videoFilter: string;
  ffmpegArgs: string[];
} {
  const config = IgReelsMasterConfigSchema.parse(raw ?? {});
  const filterChain = [
    `scale=${config.width}:${config.height}:flags=lanczos`,
    `unsharp=3:3:${config.unsharpAmount}:3:3:0.0`,
    `cas=${config.casStrength}`,
    `curves=all='0/0 0.06/0.05 0.50/0.50 0.94/0.955 1/1'`,
    `noise=c0s=${config.lumaGrainStrength}:c0f=t+u`,
    'format=yuv420p'
  ].join(',');

  return {
    config,
    videoFilter: filterChain,
    ffmpegArgs: [
      '-vf',
      filterChain,
      '-r',
      String(config.fps),
      '-vsync',
      'cfr',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      String(config.crf),
      '-profile:v',
      'high',
      '-level',
      '4.1',
      '-pix_fmt',
      'yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-c:a',
      'aac',
      '-b:a',
      `${config.audioBitrateKbps}k`,
      '-ar',
      String(config.audioSampleRateHz),
      '-movflags',
      '+faststart'
    ]
  };
}

export const WEB_DELIVERY_PROFILES = {
  hero_4k: { maxBytes: 15_000_000, recommendedCrf: 20 },
  web_1080p: { maxBytes: 8_000_000, recommendedCrf: 21 },
  mobile_720p_vertical: { maxBytes: 3_000_000, recommendedCrf: 22 }
} as const;

export type WebDeliveryProfileId = keyof typeof WEB_DELIVERY_PROFILES;

export function checkWebDeliveryBudget(
  profile: WebDeliveryProfileId,
  sizeBytes: number
): {
  withinBudget: boolean;
  maxBytes: number;
  sizeBytes: number;
  recommendedCrf: number;
} {
  const spec = WEB_DELIVERY_PROFILES[profile];
  return {
    withinBudget: sizeBytes > 0 && sizeBytes <= spec.maxBytes,
    maxBytes: spec.maxBytes,
    sizeBytes,
    recommendedCrf: spec.recommendedCrf
  };
}
