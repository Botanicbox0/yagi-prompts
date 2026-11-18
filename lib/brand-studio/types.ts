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
  FilmDepth,
  FilmSheet,
  FilmShot,
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
import type { BlockedInput, BlockedRewrite } from './enhancer/blocked';
import type { StudioEnv } from './env';
import type { StudioMediaStore } from './media-store';
import type { StudioImageBackground, StudioImageQuality, StudioLane, StudioPromptProfile } from './models';
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
  /** Region edit only: the enlarged cropped region sent as image 1 / Figure 1 to the model. */
  editCropThumb?: { bytes: Uint8Array; mime: string } | null;
  /**
   * Region edit v2 (`BRAND_STUDIO_REGION_V2`): `editCropThumb` is then the wide window the engine gets as
   * Figure 1, and this says where the customer's box sits in it (whole percentages of the window) with a
   * close-up of the box for the prompt writer's eyes only (not sent to the engine).
   */
  regionWindow?: {
    where: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    closeUp?: { bytes: Uint8Array; mime: string } | null;
  } | null;
  video?: {
    seconds: number | null;
    aspect: string;
    audio: StudioAudioMode;
    method?: StudioRemixMethod;
    keep?: StudioKeepKey[];
    change?: string;
    sheet?: FilmSheet | null;
  } | null;
  /** A new version of a generated clip (see lib/brand-studio/enhancer/types.ts). */
  revision?: {
    mode: 'edit' | 'reshoot';
    version: number;
    madeWith: string;
    history: string[];
    marks?: Array<{ n: number; time: number; what: string | null; x: number; y: number; w?: number; h?: number; label?: string | null }>;
    materials?: Array<{ n: number; kind: 'video'; notes: string }>;
    clarified?: { question: string; answer: string };
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
  /** Region edit v2 window plans (lib/brand-studio/region-edit/window.ts): the customer's box; `box` is the paste zone. */
  select?: { left: number; top: number; width: number; height: number };
  downscale?: number;
  output?: { width: number; height: number };
  stretched?: boolean;
}
export interface IntelDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  sql?: SqlRunner;
  organizationId?: string;
}
export interface StudioIntel {
  enhancePrompt(input: EnhanceInput, deps: IntelDeps): Promise<EnhanceResult>;
  composeFallbackPrompt(input: EnhanceInput): EnhanceResult;
  readFilm(input: { video: { bytes: Uint8Array; mime: string } | { url: string }; locale: 'ko' | 'en'; depth?: FilmDepth }, deps: IntelDeps): Promise<FilmSheet | null>;
  /** Optional so a test double may leave it out; without it attached material is simply not read. */
  readMaterial?(input: { video: { bytes: Uint8Array; mime: string } | { url: string }; request: string; madeWith: string }, deps: IntelDeps): Promise<string | null>;
  /** Optional so a test double may leave it out; without it a blocked run is simply not retried. */
  rewriteBlockedPrompt?(input: BlockedInput, deps: IntelDeps): Promise<BlockedRewrite>;
  planRegion(image: { width: number; height: number }, box: RegionBox, aspects: readonly string[]): RegionPlan;
  /** Region edit v2 window plan. Optional so a test double may leave it out; a v2 job then fails in prepare. */
  planRegionWindow?(image: { width: number; height: number }, box: RegionBox): RegionPlan;
  cropForEdit(original: Uint8Array, plan: RegionPlan): Promise<{ bytes: Uint8Array; mime: 'image/png' }>;
  compositeRegion(input: { original: Uint8Array; edited: Uint8Array; plan: RegionPlan; feather?: number }): Promise<{
    bytes: Uint8Array;
    mime: 'image/png';
    width: number;
    height: number;
    patchPng?: Buffer;
    maskPng?: Buffer;
    misaligned?: boolean;
    ringResidual?: number;
    transform?: { sx: number; sy: number; dx: number; dy: number };
    /** Region edit v2: the paste zone the patch and mask cover (may be wider than `plan.box`). */
    box?: { left: number; top: number; width: number; height: number };
  }>;
}

/* ------------------------------------------------------------------- deps */

export type StudioStaging = Pick<
  StorageDriver,
  'read' | 'putStaging' | 'signedUploadUrl' | 'servesSignedUrls' | 'releaseStaging'
>;

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
  /** Image / region edit on a model with `qualities` (GPT Image): the quality asked for. */
  quality?: StudioImageQuality;
  /** Cutout background mode (`Seedream 5.5` only): `'auto' | 'transparent' | 'opaque'`. */
  background?: StudioImageBackground;
  seconds: number | null;
  audio: StudioAudioMode | null;
  count: number;
  locale: 'ko' | 'en';
  /**
   * The rewritten sentence the customer read in the prompt bar before sending (plain image and video runs).
   * It becomes `final_prompt` as it is; the row's `prompt` stays what they typed and `enhance` is false.
   */
  reviewedPrompt?: string;
  method?: StudioRemixMethod;
  keep?: StudioKeepKey[];
  change?: string;
  box?: RegionBox;
  source?: { assetId?: string; outputId?: string };
  /** Region edit: `fill` marks an internal "빈 곳 채우기" strip, left out of every list of runs and results. */
  purpose?: 'fill';
  /**
   * Region edit v2 (`BRAND_STUDIO_REGION_V2` was on when it was planned): the window plan
   * (lib/brand-studio/region-edit/window.ts) and the change-only paste. Absent: the crop plan.
   */
  regionWindow?: true;
  draftOutputId?: string;
  /** Seconds of the attached reference video (estimates, the film reader). Never set for `blueprint`: its video is not attached. */
  referenceVideoSeconds?: number;
  /** Remix (`blueprint`, `reference`): the shot table the customer sent, cleaned (lib/brand-studio/reference-video.ts). */
  shots?: FilmShot[];
  /**
   * A new version of an earlier clip (lib/brand-studio/revision). `rootJobId` is the run that made v1;
   * `baseJobId` / `baseOutputId` the version this one was made from; `added` how many trailing refs were
   * attached for this version. The request itself is the job's `prompt`.
   */
  revision?: {
    rootJobId: string;
    version: number;
    baseJobId: string;
    baseOutputId: string;
    mode: 'edit' | 'reshoot';
    added: number;
    /** Spots the request points at (①②③ in the prompt), as sent: geometry, the chip label and the description. */
    marks?: Array<{ time: number; x: number; y: number; w?: number; h?: number; label?: string; what?: string }>;
    /** Material read for this request (lib/brand-studio/revision/material.ts): videos, never sent to the video model. */
    materials?: Array<{ assetId?: string; outputId?: string }>;
    /** The one question asked about this request (revise.plan) and what the customer answered. */
    clarified?: { question: string; answer: string };
  };
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
  region?: {
    plan: RegionPlan;
    cropKey: string;
    sourceKey: string;
    alignAttempts?: Record<string, number>;
    misaligned?: boolean;
    patches?: Record<
      string,
      {
        patchKey: string;
        maskKey: string | null;
        box: { left: number; top: number; width: number; height: number };
      }
    >;
  };
  draftTaskId?: string;
  results?: Record<string, StudioPendingResult>;
  failures?: Record<string, { code: StudioProviderFailure | 'region_misaligned'; detail: string }>;
  /** How many times storing each result has failed; a paid result is retried before it is given up. */
  storeAttempts?: Record<string, number>;
  /** Set once a run was retried after a safety-review block; a run is never retried twice. */
  blockRetry?: { source: 'model' | 'same' };
  /** The text that was blocked, kept for support (internal). */
  blockedPrompt?: string;
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
  /** Set when a member removed this run from the wall (migration 0090); absent before it is applied. */
  deleted_at?: Date | string | null;
  /** The project this run belongs to (migration 0091); absent before it is applied. */
  project_id?: string | null;
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
