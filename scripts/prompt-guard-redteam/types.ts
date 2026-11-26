import type { GuardReason } from '@/lib/ai-guard';
import type { StudioAssetRole } from '@/lib/brand-studio/contracts';

export type BackendKind = 'fake' | 'local' | 'gemini';
export type FakeMode = 'auto' | 'echo' | 'benign';
export type SiteId = 'brand-studio.enhancer' | 'brand-studio.director';
export type GuardMode = 'off' | 'observe' | 'enforce';
export type InputClass = 'attack' | 'benign';

export type LeakSignal = 'canary' | 'guard_overlap' | 'verbatim_words' | 'verbatim_hangul';

export interface RedteamReferenceInput {
  label: string;
  role?: StudioAssetRole;
  use?: string;
  avoid?: string;
}

export interface RedteamBrandInput {
  name?: string;
  tone?: string;
  palette?: string[];
  rules?: string[];
}

export interface RedteamInputItem {
  id: string;
  inputClass: InputClass;
  category: string;
  locale: 'ko' | 'en';
  prompt: string;
  references?: RedteamReferenceInput[];
  brand?: RedteamBrandInput | null;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  thoughtsTokens?: number;
}

export interface GeminiPricing {
  maxKrw: number;
  usdKrw: number;
  priceInUsdPerMtok: number;
  priceOutUsdPerMtok: number;
}

export interface LeakScore {
  leaked: boolean;
  signals: LeakSignal[];
  guardReasons: GuardReason[];
  guardDetectors: string[];
  verbatimWordRun: number;
  verbatimHangulRun: number;
  leakMatchChars: number;
  leakMatchSha256: string | null;
  leakPrefix12: string | null;
  falsePositive: boolean;
}

export interface TrialResult {
  site: SiteId;
  mode: GuardMode;
  inputId: string;
  inputClass: InputClass;
  category: string;
  locale: 'ko' | 'en';
  status: 'ok' | 'unusable' | 'skipped';
  skipReason: string | null;
  source: 'model' | 'fallback' | 'skipped';
  fallbackReason: string | null;
  refusedByGuard: boolean;
  notesRefusedByGuard: boolean;
  guardObserved: boolean;
  guardObservedReasons: GuardReason[];
  rawChars: number;
  schemaValid: boolean;
  outputChars: number;
  internalChars: number;
  internalSha256: string;
  outputSha256: string;
  usage: TokenUsage | null;
  costKrw: number;
  durationMs: number;
  score: LeakScore;
}

export interface CellSummary {
  site: SiteId;
  mode: GuardMode;
  inputClass: InputClass;
  planned: number;
  calls: number;
  skipped: number;
  unusableAnswers: number;
  leaks: number;
  leaksBySignal: Record<LeakSignal, number>;
  refusals: number;
  notesRefusals: number;
  guardObserved: number;
  otherFallbacks: number;
  falsePositives: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costKrw: number;
}

export interface GuardThresholdsSnapshot {
  runWords: number;
  runLatinChars: number;
  runHangul: number;
  shareWordsN: number;
  shareWordsLimit: number;
  shareWordsCount: number;
  shareHangulN: number;
  shareHangulLimit: number;
  shareMinWindows: number;
  gappedMinWords: number;
  gappedMaxGap: number;
  gappedAnswerSkip: number;
  gappedMinContentWords: number;
  canaryFragment: number;
  canarySpread: number;
  canarySpreadGap: number;
  canaryPiece: number;
  unreadableBase64: number;
  unreadableTokens: number;
  unreadableOtherScript: number;
  verbatimMinWords: number;
  verbatimMinHangul: number;
}

export interface DryRunPlanCell {
  site: SiteId;
  mode: GuardMode;
  inputClass: InputClass;
  plannedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputCapTokens: number;
  estimatedWorstCaseKrw: number | null;
}

export interface DryRunPlan {
  backend: BackendKind;
  sites: SiteId[];
  modes: GuardMode[];
  classes: InputClass[];
  inputCounts: { attack: number; benign: number; total: number };
  totalPlannedCalls: number;
  cappedPlannedCalls: number;
  estimatedInputTokens: number;
  estimatedOutputCapTokens: number;
  estimatedTotalWorstCaseTokens: number;
  estimatedWorstCaseKrw: number | null;
  maxKrw: number | null;
  maxCalls: number | null;
  cells: DryRunPlanCell[];
}

export interface RedteamReport {
  version: 1;
  generatedAt: string;
  backend: BackendKind;
  fakeMode: FakeMode | null;
  models: Record<SiteId, string>;
  envKeyPresent: boolean;
  stoppedReason: string | null;
  plan: {
    sites: SiteId[];
    modes: GuardMode[];
    classes: InputClass[];
    plannedCalls: number;
    executedCalls: number;
    skippedCalls: number;
    maxCalls: number | null;
    maxKrw: number | null;
  };
  cost: {
    currency: 'KRW';
    pricing: GeminiPricing | null;
    spentKrw: number;
    estimatedWorstCasePlanKrw: number | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  thresholds: GuardThresholdsSnapshot;
  cells: CellSummary[];
  trials: TrialResult[];
}

export interface CliOptions {
  backend: BackendKind;
  fakeMode: FakeMode;
  sites: SiteId[];
  modes: GuardMode[];
  classes: InputClass[];
  localUrl: string;
  localModel: string;
  outDir: string;
  outDirExplicit: boolean;
  envFile: string | null;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  maxCalls: number | null;
  limit: number | null;
  dryRun: boolean;
  pricing: GeminiPricing | null;
}
