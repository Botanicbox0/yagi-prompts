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
import type { ReviseDialogueRecord } from './revision/sheet';

/* ------------------------------------------------------------ intelligence (S2) */

export interface EnhanceInput {
  kind: 'image' | 'region_edit' | 'video' | 'video_remix';
  profile: StudioPromptProfile;
  /** The studio model id; its own profile block is looked up by it (lib/brand-studio/enhancer/profiles). */
  model?: string;
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
  /** Region edit only: the enlarged cropped region sent as image 1 / Image 1 to the model. */
  editCropThumb?: { bytes: Uint8Array; mime: string } | null;
  /**
   * Region edit v2 (`BRAND_STUDIO_REGION_V2`): `editCropThumb` is then the wide window the engine gets as
   * Image 1, and this says where the customer's box sits in it (whole percentages of the window) with a
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
  /** Which rules wrote the prompt (lib/brand-studio/enhancer/types.ts `EnhanceMeta`). */
  meta?: import('./enhancer/types').EnhanceMeta;
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
  /**
   * Work that runs after the answer is sent (Next's `after()` in the runtime). Absent means such work is not
   * scheduled at all (tests, scripts): today only the upload's category check (asset-role.ts).
   */
  later?: (task: () => Promise<void>) => void;
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
  /** Music runs (docs/BRAND-SOUND-STUDIO.md §7.2): what the customer chose and the conditions it was made under. */
  music?: StudioMusicParams;
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
  /**
   * One request made on several image models at once (`job.create_group`): every run of it shares `id`,
   * and `models` is the group in the order they were picked. Absent on every other run.
   */
  group?: { id: string; models: string[] };
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
    /**
     * Made from the revise conversation (`revise.talk`, flag `BRAND_STUDIO_REVISE_V2`): the sheet is the
     * request (the job's `prompt` is its changes, one per line), with the questions and the transcript.
     */
    dialogue?: ReviseDialogueRecord;
  };
  /**
   * The reading of a result of this job, kept for the revise conversation (`revise.talk`), by
   * `<outputId>:<locale>`: what the clip shows, read once per output and reused on every turn.
   */
  clipSheets?: Record<string, FilmSheet>;
}

/** A provider (or worker) result waiting to be stored, per output slot. */
export interface StudioPendingResult {
  url: string;
  mime: string | null;
  seconds?: number | null;
  costUsd?: number | null;
  draftTaskId?: string | null;
  /**
   * Music: every version the one request returned, in order (the first is this result). Finishing gives each
   * further version its own result row (docs/BRAND-SOUND-STUDIO.md §7.2).
   */
  versions?: StudioPendingVersion[];
  /** Music: the engine's ids for this version (needed later to extend it) and its own title and lyrics. */
  meta?: Record<string, string>;
}

export interface StudioPendingVersion {
  url: string;
  mime: string | null;
  seconds?: number | null;
  meta?: Record<string, string>;
}

export interface StudioJobWork {
  prepared?: boolean;
  /** video_final: the lane its draft ran on (a draft id only finalizes on that account). */
  stickLane?: StudioLane | null;
  /** Lanes that could not pay for this job; it never goes back to one of them (no ping-pong). */
  triedLanes?: StudioLane[];
  /** Resolved input addresses as sent (also what the account-lane worker receives); a video keeps its stored type. */
  inputs?: Array<{ kind: StudioAssetKind; url: string; frame?: 'start' | 'end'; mime?: string }>;
  sheet?: FilmSheet | null;
  enhanceNotes?: string;
  /** Which rules wrote the sent prompt (lib/brand-studio/enhancer `EnhanceMeta`). Internal; never shown. */
  /** How the prompt was designed: the image/video Architect's record, or the music Architect's (sound/architect.ts). */
  enhancer?: import('./enhancer/types').EnhanceMeta | import('./sound/architect').MusicEnhanceMeta;
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
  kind: 'image' | 'video' | 'audio';
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
  /** Audio only (migration 0172): peaks the list draws; absent before the migration. */
  waveform?: unknown;
}

export interface AssetRow {
  id: string;
  organization_id: string;
  kind: StudioAssetKind;
  role: StudioAssetRole | null;
  /** Who set `role` (migration 0098): `user` = the customer, `auto` = the upload check (asset-role.ts), null = nobody yet. */
  role_source: 'auto' | 'user' | null;
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

/** A music run's settings (docs/BRAND-SOUND-STUDIO.md §7.2). Never sent to a screen as engine words. */
export interface StudioMusicParams {
  mode: 'describe' | 'custom';
  vocal: boolean;
  /** The language sung in when there are vocals and no lyrics. */
  language: 'ko' | 'en';
  /** The list name, made from the description. */
  title: string;
  /** "더 고르게 만들기" (custom mode only). */
  careful: boolean;
  lyrics?: string;
  /** How the lyrics are marked when sent (SA2, §12.3: 후크만 · 후크와 한 절 · 두 절과 후크). */
  structure?: 'hook' | 'hook-verse' | 'full';
  /**
   * Who wrote the lyrics (§12.3): the customer (`own`), or a text model from "가사 초안 만들기" (`topic`) or
   * "부르기 좋게 손보기" (`polish`), and which model, so the lyrics model can change without losing the record.
   */
  lyricsBy?: { flow: 'own' | 'topic' | 'polish'; model: string | null };
  /** The length the lyrics were sized for (가사 분량 맞추기): the closest version is listed first (§12.8). */
  targetSeconds?: number;
  /** SA4: the library video the music was fitted to (its length and cuts, read from what the library keeps). */
  video?: { assetId: string; seconds: number; cuts: number[] };
  /** The conditions snapshot: engine, endpoint, and our terms version. */
  made: { engine: string; endpoint: string; terms: string };
}
