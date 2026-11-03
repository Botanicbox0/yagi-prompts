import { z } from 'zod';
import {
  MAX_LRA_LU,
  MAX_TRUE_PEAK_DBTP,
  MIN_LRA_LU,
  TARGET_LOUDNESS_LUFS
} from './director';

/**
 * S5 Commercial Audio License Gate & Deterministic Sound Master (`BRAND-PRODUCT.md` §5.2, §8.3, `knowhow-corpus.md` §9).
 */

export const AUDIO_ASSET_LICENSE_SOURCES = [
  'cc0_freesound',
  'mixkit_royalty_free',
  'pixabay_licensed',
  'brand_owned',
  'commercial_licensed',
  'yue2_cc_by_nc',
  'sheetsage_cc_by_nc',
  'viral_reference_unlicensed',
  'unknown'
] as const;

export type AudioAssetLicenseSource =
  (typeof AUDIO_ASSET_LICENSE_SOURCES)[number];

export const AudioAssetLicenseItemSchema = z.object({
  assetId: z.string().trim().min(1).max(200),
  source: z.enum(AUDIO_ASSET_LICENSE_SOURCES),
  licenseCertificateRef: z.string().trim().max(240).optional()
});

export type AudioAssetLicenseItem = z.infer<typeof AudioAssetLicenseItemSchema>;

export interface AudioLicenseGateResult {
  commercialAllowed: boolean;
  blockedAssets: Array<{
    assetId: string;
    source: AudioAssetLicenseSource;
    reason: string;
  }>;
}

/**
 * Enforces the commercial audio license gate (`BRAND-PRODUCT.md` §5.2, `argon-sound-assembly.md` §4):
 * - Blocks `CC BY-NC` weights (`yue2_cc_by_nc`, `sheetsage_cc_by_nc`).
 * - Blocks unlicensed viral reference tracks (`viral_reference_unlicensed`, `knowhow-corpus.md` f14).
 * - Blocks `unknown` provenance or `commercial_licensed` tracks missing a license reference.
 */
export function validateAudioLicenseGate(
  items: readonly AudioAssetLicenseItem[]
): AudioLicenseGateResult {
  const blockedAssets: AudioLicenseGateResult['blockedAssets'] = [];

  for (const raw of items) {
    const item = AudioAssetLicenseItemSchema.parse(raw);
    if (
      item.source === 'yue2_cc_by_nc' ||
      item.source === 'sheetsage_cc_by_nc'
    ) {
      blockedAssets.push({
        assetId: item.assetId,
        source: item.source,
        reason:
          'Non-commercial (CC BY-NC) model weights cannot be exported in commercial brand deliverables.'
      });
    } else if (item.source === 'viral_reference_unlicensed') {
      blockedAssets.push({
        assetId: item.assetId,
        source: item.source,
        reason:
          'Unlicensed viral/commercial catalog audio is restricted to internal timing reference and cannot be shipped to customers (knowhow-corpus f14).'
      });
    } else if (item.source === 'unknown') {
      blockedAssets.push({
        assetId: item.assetId,
        source: item.source,
        reason: 'Audio asset has unverified license provenance.'
      });
    } else if (
      item.source === 'commercial_licensed' &&
      !item.licenseCertificateRef?.trim()
    ) {
      blockedAssets.push({
        assetId: item.assetId,
        source: item.source,
        reason:
          'Commercial licensed track requires a verified licenseCertificateRef.'
      });
    }
  }

  return {
    commercialAllowed: blockedAssets.length === 0,
    blockedAssets
  };
}

export const SoundMasterConfigSchema = z.object({
  targetLufs: z.number().default(TARGET_LOUDNESS_LUFS),
  maxTruePeakDbtp: z.number().default(MAX_TRUE_PEAK_DBTP),
  targetLraLu: z.number().min(MIN_LRA_LU).max(MAX_LRA_LU).default(7.0),
  stripNativeVideoCrackleAboveHz: z.number().int().min(4000).max(8000).default(5500),
  replaceNativeAudioCompletely: z.boolean().default(true),
  act1FoleyDuckDb: z.number().min(-12).max(0).default(-3)
});

export type SoundMasterConfig = z.infer<typeof SoundMasterConfigSchema>;

/**
 * Builds the deterministic audio master specification (`knowhow-corpus.md` §9.2, §9.4, f8):
 * - Strips or replaces native video model audio (`> 5.5 kHz` digital crackle).
 * - Applies EBU R128 `loudnorm=I=-14.0:TP=-1.0:LRA=7.0` + true-peak limiter.
 */
export function buildDeterministicSoundMasterSpec(
  raw?: Partial<SoundMasterConfig>
): {
  config: SoundMasterConfig;
  nativeStemCleanFilter: string;
  masterFilter: string;
} {
  const config = SoundMasterConfigSchema.parse(raw ?? {});
  const nativeStemCleanFilter = config.replaceNativeAudioCompletely
    ? 'anullsrc=r=48000:cl=stereo'
    : `highpass=f=65,lowpass=f=${config.stripNativeVideoCrackleAboveHz}`;

  const masterFilter = [
    `loudnorm=I=${config.targetLufs.toFixed(1)}:TP=${config.maxTruePeakDbtp.toFixed(1)}:LRA=${config.targetLraLu.toFixed(1)}`,
    `alimiter=limit=${config.maxTruePeakDbtp.toFixed(1)}dB:level=false`
  ].join(',');

  return {
    config,
    nativeStemCleanFilter,
    masterFilter
  };
}
