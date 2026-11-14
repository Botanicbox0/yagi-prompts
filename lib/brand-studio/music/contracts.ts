/**
 * Reference-based Brand Studio Music Engine wire contracts & license rules (`STUDIO-PRO-SUITE-V4.md` §2.3).
 *
 * Customer wording hygiene:
 * NEVER expose internal model/tool/server identifiers (`YuE2`, `SheetSage`, `YAGI-SERVER`, `gpu-arbiter`,
 * `ComfyUI`) in customer-visible strings (`licenseNoticeKo`, `licenseNoticeEn`, asset names, or errors).
 */
import { z } from 'zod';
import type { StudioAllowanceView, StudioErrorCode } from '@/lib/brand-studio/contracts';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import type { ViralDropSlicePlan } from '@/lib/brands/sound/director';
import type { AudioAssetLicenseSource, AudioLicenseGateResult } from '@/lib/brands/sound/master';
import {
  LEAD_INSTRUMENT_ARCHETYPES,
  type AbcScoreValidationReport,
} from '@/lib/brands/sound/music-studio';

export const MUSIC_PROVIDERS = [
  'sunra_elevenlabs',
  'local_yue2',
  'yagi_production',
  'suno',
  'elevenlabs',
  'fake',
] as const;
export type MusicProviderId = (typeof MUSIC_PROVIDERS)[number];

export const NON_COMMERCIAL_MUSIC_NOTICE_KO =
  '비상업 시안·가이드 전용 음원이에요 (상업 광고 집행 시 라이선스 음원으로 교체해 주세요)';
export const NON_COMMERCIAL_MUSIC_NOTICE_EN =
  'For non-commercial drafts and timing guides only (replace with a licensed track before running commercial ads).';

export const COMMERCIAL_MUSIC_NOTICE_KO =
  '상업 캠페인에 바로 사용할 수 있는 라이선스 음원이에요.';
export const COMMERCIAL_MUSIC_NOTICE_EN =
  'Licensed track cleared for commercial campaigns.';

/** Customer-facing TWINGS credit estimate for reference music generation. */
export function musicCredits(durationSec: number): number {
  const sec = Math.max(
    3,
    Math.min(60, Math.ceil(Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 15)),
  );
  return 12 + Math.ceil(sec / 5) * 2;
}

/** Internal KRW allowance unit (`1 credit = 10 KRW`) reserved for one music generation run. */
export function musicKrw(durationSec: number): number {
  return musicCredits(durationSec) * STUDIO_CREDIT_KRW;
}

/** Customer-facing TWINGS credit estimate for sound-effect generation. */
export function sfxCredits(durationSec: number): number {
  const sec = Math.max(0.5, Math.min(22, Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 4));
  return 4 + Math.ceil(sec / 5) * 2;
}

/** Internal KRW allowance unit (`1 credit = 10 KRW`) reserved for one SFX generation run. */
export function sfxKrw(durationSec: number): number {
  return sfxCredits(durationSec) * STUDIO_CREDIT_KRW;
}

const RefAudioObjectSchema = z.object({
  assetId: z.string().uuid().optional(),
  url: z.string().trim().min(1).max(1000).optional(),
  label: z.string().trim().max(160).optional(),
});

export const MusicCompositionSectionSchema = z.object({
  sectionName: z.string().trim().min(1).max(80),
  positiveLocalStyles: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  negativeLocalStyles: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
  durationMs: z.number().int().min(1000).max(60_000),
  lines: z.array(z.string().trim().max(240)).max(24).default([]),
});

export const MusicCompositionPlanSchema = z.object({
  positiveGlobalStyles: z.array(z.string().trim().min(1).max(120)).max(16).default([]),
  negativeGlobalStyles: z.array(z.string().trim().min(1).max(120)).max(16).default([]),
  sections: z.array(MusicCompositionSectionSchema).min(1).max(8),
});

export type MusicCompositionPlan = z.infer<typeof MusicCompositionPlanSchema>;

export const MusicGenerateInputSchema = z.object({
  organizationId: z.string().uuid(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  presetId: z.string().trim().min(1).max(64).optional(),
  prompt: z.string().trim().max(500).default(''),
  compositionPlan: MusicCompositionPlanSchema.optional(),
  bpm: z.number().int().min(60).max(180).default(122),
  keySignature: z.enum(['Dm', 'Am', 'Fm', 'Cm', 'Em', 'Gm', 'C', 'F']).default('Dm'),
  leadInstrument: z.enum(LEAD_INSTRUMENT_ARCHETYPES).default('mellow Rhodes lead melody'),
  durationSec: z.number().min(3).max(60).default(15),
  revealSec: z.number().min(0.2).max(59.5).optional(),
  videoRevealSec: z.number().min(0.2).max(59.5).optional(),
  preDropHushMs: z.number().int().min(0).max(600).default(180),
  refAudioAssetId: z.string().uuid().optional(),
  refAudioUrl: z.string().trim().min(1).max(1000).optional(),
  ref_audio: z.union([z.string().trim().min(1).max(1000), RefAudioObjectSchema]).optional(),
});

export type MusicGenerateInput = z.infer<typeof MusicGenerateInputSchema>;

export const MusicStatusInputSchema = z.object({
  organizationId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export type MusicStatusInput = z.infer<typeof MusicStatusInputSchema>;

export interface MusicJobSuccess {
  ok: true;
  jobId: string;
  status: 'running' | 'succeeded';
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
  licenseNoticeKo: string;
  licenseNoticeEn: string;
  synthesizedPreview: boolean;
  creditsUsed: number;
  assetId: string | null;
  audioUrl: string | null;
  dataUrl: string | null;
  allowance: StudioAllowanceView;
}

export interface MusicJobFailed {
  ok: false;
  code: StudioErrorCode;
  refunded?: boolean;
  allowance?: StudioAllowanceView;
}

export type MusicOperationResult = MusicJobSuccess | MusicJobFailed;
