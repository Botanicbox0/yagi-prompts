/**
 * Server-side shapes of the brand studio (rows, stored params, injected dependencies). The wire shapes
 * live in ./contracts.ts; nothing here is sent to a browser as is.
 *
 * The intelligence functions (prompt enhancement, film reading, region compositing) are written by
 * slice S2 in lib/brand-studio/{enhancer,film-sheet,region-edit}. Their signatures are copied here
 * from docs/BRAND-STUDIO-V2.md §12 so this slice type-checks and tests on its own; ./runtime.ts is the
 * one file that binds the real modules, and TypeScript checks the two agree there.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import type {
  FilmSheet,
  RegionBox,
  StudioAssetKind,
  StudioAssetRole,
  StudioAudioMode,
  StudioErrorCode,
  StudioJobKind,
  StudioJobStatus,
  StudioKeepKey,
  StudioReference,
  StudioRemixMethod,
} from './contracts';
import type { StudioEnv } from './env';
import type { StudioMediaStore } from './media-store';
import type { StudioLane, StudioPromptProfile } from './models';
import type { StudioProvider, StudioProviderFailure } from './provider/types';

/* ------------------------------------------------------------ intelligence (S2) */

export interface EnhanceInput {
  kind: 'image' | 'region_edit' | 'video' | 'video_remix';
  profile: StudioPromptProfile;
  locale: 'ko' | 'en';
  prompt: string;
  references: Array<{
    index: number;
    kind: 'image' | 'video' | 'audio';
    label: string;
    role?: StudioAssetRole;
    use?: string;
    avoid?: string;
    frame?: 'start' | 'end';
    thumb?: { bytes: Uint8Array; mime: string };
  }>;
  brand?: { name?: string; tone?: string; palette?: string[]; rules?: string[] } | null;
  video?: {
    seconds: number | null;
    aspect: string;
    audio: StudioAudioMode;
    method?: StudioRemixMethod;
    keep?: StudioKeepKey[];
    change?: string;
    sheet?: FilmSheet | null;
  } | null;
}
export interface EnhanceResult {
  prompt: string;
  notes: string;
  source: 'model' | 'fallback';
}
export interface RegionPlan {
  roi: { left: number; top: number; width: number; height: number };
  box: { left: number; top: number; width: number; height: number };
  aspect: string;
  work: { width: number; height: number };
}
export interface IntelDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}
export interface StudioIntel {
  enhancePrompt(input: EnhanceInput, deps: IntelDeps): Promise<EnhanceResult>;
  composeFallbackPrompt(input: EnhanceInput): EnhanceResult;
  readFilm(input: { video: { bytes: Uint8Array; mime: string } | { url: string }; locale: 'ko' | 'en' }, deps: IntelDeps): Promise<FilmSheet | null>;
  planRegion(image: { width: number; height: number }, box: RegionBox, aspects: readonly string[]): RegionPlan;
  cropForEdit(original: Uint8Array, plan: RegionPlan): Promise<{ bytes: Uint8Array; mime: 'image/png' }>;
  compositeRegion(input: { original: Uint8Array; edited: Uint8Array; plan: RegionPlan; feather?: number }): Promise<{
    bytes: Uint8Array;
    mime: 'image/png';
    width: number;
    height: number;
  }>;
}

/* ------------------------------------------------------------------- deps */

export type StudioStaging = Pick<StorageDriver, 'read' | 'putStaging' | 'signedUploadUrl' | 'servesSignedUrls'>;

export interface StudioDeps {
  sql: SqlRunner;
  env: StudioEnv;
  media: StudioMediaStore;
  /** The private staging bucket uploads land in before they are checked (lib/storage). */
  staging: StudioStaging;
  /** The API-lane provider (Sunra or fake); null when not configured. */
  provider: StudioProvider | null;
  intel: StudioIntel;
  /** Passed to the intelligence functions (Gemini calls). */
  intelDeps: IntelDeps;
  now?: () => Date;
  /** Server log line; never shown to a customer. */
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/* ------------------------------------------------------------------- rows */

export interface StudioJobParams {
  aspect: string | null;
  resolution: string | null;
  seconds: number | null;
  audio: StudioAudioMode | null;
  count: number;
  locale: 'ko' | 'en';
  method?: StudioRemixMethod;
  keep?: StudioKeepKey[];
  change?: string;
  box?: RegionBox;
  source?: { assetId?: string; outputId?: string };
  draftOutputId?: string;
  /** Seconds of the attached reference video (estimates, the film reader). */
  referenceVideoSeconds?: number;
}

/** A provider (or worker) result waiting to be stored, per output slot. */
export interface StudioPendingResult {
  url: string;
  mime: string | null;
  seconds?: number | null;
  costUsd?: number | null;
  draftTaskId?: string | null;
}

export interface StudioJobWork {
  prepared?: boolean;
  /** video_final: the lane its draft ran on (a draft id only finalizes on that account). */
  stickLane?: StudioLane | null;
  /** Lanes that could not pay for this job; it never goes back to one of them (no ping-pong). */
  triedLanes?: StudioLane[];
  /** Resolved input addresses as sent (also what the account-lane worker receives). */
  inputs?: Array<{ kind: StudioAssetKind; url: string; frame?: 'start' | 'end' }>;
  sheet?: FilmSheet | null;
  enhanceNotes?: string;
  region?: { plan: RegionPlan; cropKey: string; sourceKey: string };
  draftTaskId?: string;
  results?: Record<string, StudioPendingResult>;
  failures?: Record<string, { code: StudioProviderFailure; detail: string }>;
  /** How many times storing each result has failed; a paid result is retried before it is given up. */
  storeAttempts?: Record<string, number>;
}

export interface JobRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  request_id: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  lane: StudioLane | null;
  model: string;
  prompt: string;
  final_prompt: string | null;
  enhance: boolean;
  params: StudioJobParams;
  refs: StudioReference[];
  parent_output_id: string | null;
  estimate_usd: string | number;
  cost_usd: string | number | null;
  estimate_krw: number;
  usage_krw: number | null;
  error_code: StudioErrorCode | null;
  error_detail: string | null;
  work: StudioJobWork;
  claimed_at: Date | string | null;
  attempts: number;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
}

export interface OutputRow {
  id: string;
  job_id: string;
  organization_id: string;
  idx: number;
  kind: 'image' | 'video';
  status: 'pending' | 'ready' | 'failed';
  provider_task_id: string | null;
  draft_task_id: string | null;
  storage_key: string | null;
  thumb_key: string | null;
  mime: string | null;
  bytes: string | number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sha256: string | null;
  is_draft: boolean;
  saved_asset_id: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}

export interface AssetRow {
  id: string;
  organization_id: string;
  kind: StudioAssetKind;
  role: StudioAssetRole | null;
  name: string;
  tags: string[] | string;
  mime: string;
  size_bytes: string | number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  storage_key: string;
  thumb_key: string | null;
  sha256: string | null;
  source: 'upload' | 'generation';
  source_output_id: string | null;
  status: 'pending' | 'ready';
  duplicate_of: string | null;
  /** Readings of a reference video per language (migration 0077); absent before it. */
  film_sheets?: Partial<Record<'ko' | 'en', FilmSheet>> | null;
  created_by: string | null;
  request_id: string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
}
