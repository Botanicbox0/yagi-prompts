/**
 * Contracts for the >30s Next-Scene Continuity Router (`+ 다음 씬 연장`).
 *
 * Client-safe schema & types shared by browser frame extraction and the server continuity planner.
 */
import { z } from 'zod';

export const CONTINUITY_PATHS = ['studio_lineage', 'external_keyframes'] as const;
export type ContinuityPath = (typeof CONTINUITY_PATHS)[number];

export const ContinuityKeyframeCandidateSchema = z.object({
  timestampSec: z.number().min(0).max(7200),
  dataUrl: z.string().max(400_000).optional(),
  width: z.number().int().min(1).max(4096).optional(),
  height: z.number().int().min(1).max(4096).optional(),
  sharpness: z.number().min(0).max(1),
  exposure: z.number().min(0).max(1),
  motionDelta: z.number().min(0).max(1),
  qualityScore: z.number().min(0).max(1).optional(),
});

export type ContinuityKeyframeCandidate = z.infer<typeof ContinuityKeyframeCandidateSchema>;

export const ContinuityPlanInputSchema = z.object({
  organizationId: z.string().uuid(),
  locale: z.enum(['ko', 'en']).default('ko'),
  clipLabel: z.string().trim().max(160).default(''),
  assetId: z.string().uuid().optional(),
  outputId: z.string().uuid().optional(),
  clipDurationSec: z.number().min(0.3).max(3600).default(5),
  sequenceDurationSec: z.number().min(0).max(7200).default(0),
  targetNextSeconds: z.number().int().min(4).max(15).default(6),
  userDirection: z.string().trim().max(500).optional(),
  keyframes: z.array(ContinuityKeyframeCandidateSchema).max(8).optional(),
});

export type ContinuityPlanInput = z.infer<typeof ContinuityPlanInputSchema>;

export interface ContinuityReferenceItem {
  kind: 'asset' | 'output';
  id: string;
  mediaKind: 'image' | 'video';
  name: string;
  role: 'start_frame' | 'product' | 'style' | 'subject';
}

export interface ContinuityPlan {
  path: ContinuityPath;
  recommendedPrompt: string;
  cameraTransition: string;
  continuityNotes: string;
  selectedFrameIndex: number;
  selectedFrameTimestampSec: number | null;
  selectedFrameDataUrl: string | null;
  referenceRefs: ContinuityReferenceItem[];
  filmSheetSummary: string | null;
  over30sSequence: boolean;
  creditsUsed: 0;
}
