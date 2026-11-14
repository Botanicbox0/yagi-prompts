/**
 * Silent Multimodal `Video-Creator` Director types (docs/STUDIO-PRO-SUITE-V4.md §1.3).
 *
 * Separates multimodal input inspection (`MediaAnalyzer`) from intent-triaged prompt compilation
 * (`PromptCompiler`) so `gemini-4-hydrogen` (default) and `Argon` share one deterministic contract.
 */
import type { FilmSheet, StudioAssetRole, StudioAudioMode } from '@/lib/brand-studio/contracts';
import type { EnhanceDeps, EnhanceInput, EnhanceReference, EnhanceResult, EnhanceVideo } from '@/lib/brand-studio/enhancer/types';
import type { SqlRunner } from '@/lib/db/sql-runner';

export type DirectorProviderId = 'gemini-4-hydrogen' | 'argon';

export type PromptIntentMode = 'passthrough' | 'slot_fill' | 'expand';

/** Supports Studio's `StudioAudioMode` (`native` | `ambient` | `silent`) plus normalized `on` | `sfx` | `off` aliases. */
export type DirectorAudioMode = StudioAudioMode | 'on' | 'sfx' | 'off';

export interface DirectorPlaybookRule {
  id: string;
  title: string;
  bodyMd: string;
  tags: string[];
}

export interface MediaAnalysisRefSummary {
  index: number;
  token: string | null;
  kind: 'image' | 'video' | 'audio';
  role: StudioAssetRole | null;
  visualNotes: string;
}

export interface MediaAnalysisDigest {
  provider: DirectorProviderId;
  fallbackUsed: boolean;
  paletteHex: string[];
  lightingNotes: string;
  textureNotes: string;
  subjectNotes: string;
  references: MediaAnalysisRefSummary[];
  filmSummary: {
    seconds: number;
    shotCount: number;
    look: FilmSheet['look'];
    audio: FilmSheet['audio'];
  } | null;
}

export interface MediaAnalyzeInput {
  locale: 'ko' | 'en';
  prompt: string;
  references: EnhanceReference[];
  sheet?: FilmSheet | null;
}

export interface MediaAnalyzeDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  onFallback?: (reason: string) => void;
}

export interface MediaAnalyzer {
  readonly provider: DirectorProviderId;
  analyze(input: MediaAnalyzeInput, deps: MediaAnalyzeDeps): Promise<MediaAnalysisDigest>;
}

export interface DirectorVideoInput extends Omit<EnhanceVideo, 'audio'> {
  audio: DirectorAudioMode;
}

export interface DirectorCompileInput extends Omit<EnhanceInput, 'video'> {
  video?: DirectorVideoInput | null;
}

export interface DirectorCompileDeps extends EnhanceDeps {
  sql?: SqlRunner;
  organizationId?: string;
  analyzer?: MediaAnalyzer;
}

export interface DirectorCompileResult extends EnhanceResult {
  intent: PromptIntentMode;
  provider: DirectorProviderId;
  analysis: MediaAnalysisDigest | null;
  playbooksApplied: number;
}

export interface PromptCompiler {
  classifyIntent(prompt: string, hasVideo?: boolean, refCount?: number): PromptIntentMode;
  compile(input: DirectorCompileInput, deps: DirectorCompileDeps): Promise<DirectorCompileResult>;
}
