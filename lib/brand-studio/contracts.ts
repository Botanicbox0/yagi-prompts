/**
 * Brand studio wire contract (docs/BRAND-STUDIO-V2.md §5).
 *
 * The one place the screen and the service agree on shapes. The route parses every request with
 * these schemas and answers with these types; the client imports the same file. Change a shape here
 * first, then both sides.
 *
 * Client-safe: zod and types only (no env, no db).
 */
import { z } from 'zod';
import type { StudioStorageQuotaView } from '@/lib/brands/storage-quota-format';
import { STUDIO_IMAGE_BACKGROUNDS, STUDIO_IMAGE_QUALITIES, type StudioImageQuality } from './models';

export type { StudioStorageQuotaView };

/* ---------------------------------------------------------------- vocab */

export const STUDIO_ASSET_KINDS = ['image', 'video', 'audio'] as const;
export type StudioAssetKind = (typeof STUDIO_ASSET_KINDS)[number];

/** What an asset usually is in a picture. A hint the customer can change per run, never a lock. */
export const STUDIO_ASSET_ROLES = ['product', 'person', 'logo', 'style', 'place', 'other'] as const;
export type StudioAssetRole = (typeof STUDIO_ASSET_ROLES)[number];

/** `delivery`: a file the YAGI team delivered into a project room (docs/BRAND-ROOMS.md §6). */
export const STUDIO_ASSET_SOURCES = ['upload', 'generation', 'delivery'] as const;
export type StudioAssetSource = (typeof STUDIO_ASSET_SOURCES)[number];

/**
 * `image`         prompt (+ reference images) -> images
 * `region_edit`   one existing image + a box + an instruction -> the same image with only that box changed
 * `video`         prompt (+ start/end frame, reference images) -> a video
 * `video_remix`   one reference video (+ images) + what to keep/change -> a video
 * `video_final`   a finished 480p draft -> its 1080p final
 */
export const STUDIO_JOB_KINDS = ['image', 'region_edit', 'video', 'video_remix', 'video_final'] as const;
export type StudioJobKind = (typeof STUDIO_JOB_KINDS)[number];

/**
 * `held`      accepted, waiting for a free slot on a lane
 * `queued`    has a lane, not sent to the provider yet (enhancing, or waiting for the lane worker)
 * `running`   the provider has it
 * `finishing` the provider is done; the studio is storing or compositing the result
 */
export const STUDIO_JOB_STATUSES = ['held', 'queued', 'running', 'finishing', 'succeeded', 'failed', 'canceled'] as const;
export type StudioJobStatus = (typeof STUDIO_JOB_STATUSES)[number];
export const STUDIO_JOB_OPEN_STATUSES: readonly StudioJobStatus[] = ['held', 'queued', 'running', 'finishing'];

/**
 * Sound for a video.
 * `native`   picture, sound and music generated together
 * `ambient`  location sound and effects only, no music (music is added afterwards)
 * `silent`   no audio track
 */
export const STUDIO_AUDIO_MODES = ['native', 'ambient', 'silent'] as const;
export type StudioAudioMode = (typeof STUDIO_AUDIO_MODES)[number];

/**
 * How a reference video is used.
 * `edit`       keeps the footage and changes what was asked (the video is sent to the provider)
 * `reference`  makes a new take that follows it (the video is sent to the provider)
 * `blueprint`  the video is only read: its shot table becomes the blueprint and the new take is made from
 *              that text (plus reference images) alone, so the video never reaches the provider
 *              (docs/BRAND-STUDIO-V3.md §6)
 */
export const STUDIO_REMIX_METHODS = ['edit', 'reference', 'blueprint'] as const;
export type StudioRemixMethod = (typeof STUDIO_REMIX_METHODS)[number];

/** What to carry over from a reference video. */
export const STUDIO_KEEP_KEYS = ['camera', 'timing', 'composition', 'motion', 'look'] as const;
export type StudioKeepKey = (typeof STUDIO_KEEP_KEYS)[number];

/**
 * How closely a reference video is read. `basic` is the sheet the remix panel always had; `blueprint`
 * adds what a remake from text needs (how each shot hands over, the camera split into travel / turn /
 * zoom, who and what is on screen and how many). Each depth is read and kept separately.
 */
export const FILM_DEPTHS = ['basic', 'blueprint'] as const;
export type FilmDepth = (typeof FILM_DEPTHS)[number];

/** Bounds of a shot table a customer sends back (lib/brand-studio/reference-video.ts cleans it). */
export const STUDIO_SHOT_LIMITS = { shotsMax: 40, fieldMax: 200, secondsMax: 600 } as const;

/** Codes a customer can act on. Anything else surfaces as `failed`. */
export const STUDIO_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'feature_unavailable',
  'studio_closed',
  'invalid',
  'conflict',
  'allowance_closed',
  'allowance_exhausted',
  'too_many_running',
  'asset_limit',
  'storage_quota_exceeded',
  'unsupported_file',
  'file_too_large',
  'reference_missing',
  'provider_rejected',
  'provider_unavailable',
  'region_misaligned',
  'failed',
] as const;
export type StudioErrorCode = (typeof STUDIO_ERROR_CODES)[number];

/* --------------------------------------------------------------- limits */

export const STUDIO_LIMITS = {
  promptMax: 4000,
  noteMax: 200,
  imageCountMax: 4,
  /** References on one run, across kinds. */
  referencesMax: 10,
  assetsPerOrganization: 600,
  imageBytesMax: 15_000_000,
  videoBytesMax: 50_000_000,
  audioBytesMax: 15_000_000,
  /** Open (not finished) jobs one organization may have at once. */
  openJobsPerOrganization: 6,
  tagsMax: 8,
  tagMax: 24,
  nameMax: 80,
} as const;

export const STUDIO_UPLOAD_MIMES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/wav'],
} as const satisfies Record<StudioAssetKind, readonly string[]>;

/* -------------------------------------------------------------- helpers */

const Id = z.uuid();
const RequestId = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
const Note = z.string().trim().max(STUDIO_LIMITS.noteMax);

/** A box in fractions of the picture (0..1), origin at the top-left corner. */
export const RegionBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.02).max(1),
    h: z.number().min(0.02).max(1),
  })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, { error: 'box leaves the picture' });
export type RegionBox = z.infer<typeof RegionBoxSchema>;

/**
 * One reference on a run. Exactly one of `assetId` (the library) or `outputId` (an earlier result).
 * Order in the array is the number the customer sees ("이미지 1", "영상 1") and may write in the prompt.
 */
export const StudioReferenceSchema = z
  .object({
    assetId: Id.optional(),
    outputId: Id.optional(),
    role: z.enum(STUDIO_ASSET_ROLES).optional(),
    /** What to take from it ("병 모양과 라벨만"). */
    use: Note.optional(),
    /** What not to take from it ("배경, 조명"). */
    avoid: Note.optional(),
    /** Video only: the picture opens (`start`) or closes (`end`) the shot. */
    frame: z.enum(['start', 'end']).optional(),
  })
  .refine((r) => (r.assetId === undefined) !== (r.outputId === undefined), { error: 'assetId or outputId' });
export type StudioReference = z.infer<typeof StudioReferenceSchema>;

/* ------------------------------------------------------------- requests */

const JobBase = {
  organizationId: Id,
  /** Idempotency key: the same key from the same member returns the first job. */
  requestId: RequestId,
  model: z.string().min(1).max(60),
  prompt: z.string().trim().max(STUDIO_LIMITS.promptMax),
  /** Rewrite the prompt for the chosen model before sending. On by default in the UI. */
  enhance: z.boolean().default(true),
  references: z.array(StudioReferenceSchema).max(STUDIO_LIMITS.referencesMax).default([]),
};

export const ImageJobSchema = z.object({
  kind: z.literal('image'),
  ...JobBase,
  prompt: JobBase.prompt.min(1),
  aspect: z.string().max(8),
  resolution: z.string().max(8),
  count: z.number().int().min(1).max(STUDIO_LIMITS.imageCountMax).default(1),
  /** Only for models that declare `qualities` (GPT Image); the planner refuses it for any other. */
  quality: z.enum(STUDIO_IMAGE_QUALITIES).optional(),
  /** Only for models that declare `supportsTransparentBackground` (Seedream 5.5); refused otherwise. */
  background: z.enum(STUDIO_IMAGE_BACKGROUNDS).optional(),
});

export const RegionEditJobSchema = z.object({
  kind: z.literal('region_edit'),
  ...JobBase,
  prompt: JobBase.prompt.min(1),
  /** The picture being edited: an earlier result or a library image. */
  source: z
    .object({ assetId: Id.optional(), outputId: Id.optional() })
    .refine((s) => (s.assetId === undefined) !== (s.outputId === undefined), { error: 'assetId or outputId' }),
  box: RegionBoxSchema,
  /** As on an image job: only for an edit model that declares `qualities`. */
  quality: z.enum(STUDIO_IMAGE_QUALITIES).optional(),
});

const VideoBase = {
  ...JobBase,
  aspect: z.string().max(8),
  /** `draft` is the 480p first pass a final is made from. */
  resolution: z.enum(['draft', '480p', '720p', '1080p']),
  audio: z.enum(STUDIO_AUDIO_MODES).default('native'),
};

export const VideoJobSchema = z.object({
  kind: z.literal('video'),
  ...VideoBase,
  prompt: JobBase.prompt.min(1),
  seconds: z.number().int().min(4).max(15),
});

const ShotText = z.string().trim().max(STUDIO_SHOT_LIMITS.fieldMax);
const ShotTime = z.number().min(0).max(STUDIO_SHOT_LIMITS.secondsMax);

/** One row of a reference video's shot table, in seconds of the reference. */
export const FilmShotSchema = z
  .object({
    start: ShotTime,
    end: ShotTime,
    framing: ShotText,
    camera: ShotText,
    action: ShotText,
    /** How this shot hands over to the next ("hard cut", "dissolve", "continuous"). */
    transition: ShotText.optional(),
    /** The camera split apart: body travel, pan/tilt/roll, lens zoom ("none" when it does not happen). */
    move: z.object({ travel: ShotText, turn: ShotText, zoom: ShotText }).optional(),
  })
  .refine((s) => s.end - s.start >= 0.1, { error: 'shot shorter than 0.1 s' });
export type FilmShot = z.infer<typeof FilmShotSchema>;

export const VideoRemixJobSchema = z.object({
  kind: z.literal('video_remix'),
  ...VideoBase,
  /** The reference video is `references[i]` whose asset kind is video; exactly one is required. */
  method: z.enum(STUDIO_REMIX_METHODS),
  keep: z.array(z.enum(STUDIO_KEEP_KEYS)).max(STUDIO_KEEP_KEYS.length).default([]),
  /** What should differ from the reference, in the customer's words. May be empty when `prompt` says it. */
  change: z.string().trim().max(STUDIO_LIMITS.promptMax).default(''),
  /** Ignored for `edit` (the result follows the source length). */
  seconds: z.number().int().min(4).max(15).optional(),
  /** The shot table as the customer left it (reference seconds). Used by `blueprint` and `reference`; ignored for `edit`. */
  shots: z.array(FilmShotSchema).min(1).max(STUDIO_SHOT_LIMITS.shotsMax).optional(),
});

export const VideoFinalJobSchema = z.object({
  kind: z.literal('video_final'),
  organizationId: Id,
  requestId: RequestId,
  /** The succeeded draft output to finish at 1080p. */
  draftOutputId: Id,
});

export const StudioJobCreateSchema = z.discriminatedUnion('kind', [
  ImageJobSchema,
  RegionEditJobSchema,
  VideoJobSchema,
  VideoRemixJobSchema,
  VideoFinalJobSchema,
]);
export type StudioJobCreate = z.infer<typeof StudioJobCreateSchema>;

/** `prompt.enhance`: what the enhancer would send, without spending anything on generation. */
export const PromptPreviewSchema = z.discriminatedUnion('kind', [
  ImageJobSchema.omit({ requestId: true }),
  RegionEditJobSchema.omit({ requestId: true }),
  VideoJobSchema.omit({ requestId: true }),
  VideoRemixJobSchema.omit({ requestId: true }),
]);

export const AssetReserveSchema = z.object({
  organizationId: Id,
  requestId: RequestId,
  name: z.string().trim().min(1).max(STUDIO_LIMITS.nameMax),
  mime: z.string().max(40),
  sizeBytes: z.number().int().positive(),
  role: z.enum(STUDIO_ASSET_ROLES).optional(),
});

export const AssetUpdateSchema = z.object({
  organizationId: Id,
  assetId: Id,
  name: z.string().trim().min(1).max(STUDIO_LIMITS.nameMax).optional(),
  role: z.enum(STUDIO_ASSET_ROLES).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(STUDIO_LIMITS.tagMax)).max(STUDIO_LIMITS.tagsMax).optional(),
});

/** Finish an upload. Sizes are measured in the browser; the server re-reads what it can and clamps the rest. */
export const AssetCompleteSchema = z.object({
  organizationId: Id,
  assetId: Id,
  width: z.number().int().positive().max(12_000).optional(),
  height: z.number().int().positive().max(12_000).optional(),
  seconds: z.number().positive().max(600).optional(),
});

/** Read a reference video already in the library. `depth` defaults to `basic`. */
export const FilmAnalyzeSchema = z.object({ organizationId: Id, assetId: Id, depth: z.enum(FILM_DEPTHS).optional() });

export const AssetRefSchema = z.object({ organizationId: Id, assetId: Id });
export const OutputRefSchema = z.object({ organizationId: Id, outputId: Id });
export const JobRefSchema = z.object({ organizationId: Id, jobId: Id });

/** Save a result into the library. Same bytes twice returns the existing asset. */
export const AssetFromOutputSchema = z.object({
  organizationId: Id,
  outputId: Id,
  role: z.enum(STUDIO_ASSET_ROLES).optional(),
  name: z.string().trim().min(1).max(STUDIO_LIMITS.nameMax).optional(),
});

/** Send one result or asset to a campaign: an existing one, or a new request with just a title and a goal. */
export const CampaignHandoffSchema = z
  .object({
    organizationId: Id,
    requestId: RequestId,
    assetId: Id.optional(),
    outputId: Id.optional(),
    projectId: Id.optional(),
    newProject: z
      .object({ title: z.string().trim().min(3).max(120), objective: z.string().trim().min(3).max(2000) })
      .optional(),
    /** Tell the studio this file is the format creators should follow, not just a reference. */
    asFormat: z.boolean().default(false),
  })
  .refine((v) => (v.assetId === undefined) !== (v.outputId === undefined), { error: 'assetId or outputId' })
  .refine((v) => (v.projectId === undefined) !== (v.newProject === undefined), { error: 'projectId or newProject' });

/** `POST /api/brand-studio` body: `{ operation, input }`. */
export const STUDIO_OPERATIONS = [
  'job.create',
  'job.cancel',
  'prompt.enhance',
  'film.analyze',
  'asset.reserve',
  'asset.complete',
  'asset.update',
  'asset.delete',
  'asset.from_output',
  'output.delete',
  'handoff.campaign',
] as const;
export type StudioOperation = (typeof STUDIO_OPERATIONS)[number];

/* ------------------------------------------------------------ responses */

export interface StudioFailure {
  ok: false;
  code: StudioErrorCode;
}

/** A library entry as the panel shows it. */
export interface StudioAssetView {
  id: string;
  kind: StudioAssetKind;
  role: StudioAssetRole | null;
  name: string;
  tags: string[];
  /** Displayable address (full size for images, the file for video and audio). */
  url: string;
  /** A small still for the grid; for audio, null. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Seconds, for video and audio. */
  seconds: number | null;
  source: StudioAssetSource;
  createdAt: string;
}

export interface StudioOutputView {
  id: string;
  jobId: string;
  kind: 'image' | 'video';
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  /** True for a 480p draft that can still be finished at 1080p. */
  draft: boolean;
  /** The library asset this result was saved as, if any. */
  savedAssetId: string | null;
  /** Region edit only: aligned unmasked patch PNG + initial soft mask PNG over `box` (0..1 fractions). */
  regionPatch?: {
    url: string;
    maskUrl: string | null;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  /** Region edit only: the source asset or output this result was cut from. */
  sourceRef?: { assetId?: string; outputId?: string } | null;
  createdAt: string;
}

export interface StudioJobView {
  id: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  model: string;
  /** What the customer typed. */
  prompt: string;
  /** What was sent after enhancement; null until the enhancer has run or when it was off. */
  finalPrompt: string | null;
  /** How many results this job is expected to produce (drives the pending cards). */
  expected: number;
  aspect: string | null;
  resolution: string | null;
  /** Image and partial-edit runs on a model with qualities: the quality it ran at, so "설정 다시 쓰기" restores it. */
  quality?: StudioImageQuality | null;
  seconds: number | null;
  audio: StudioAudioMode | null;
  /** References as sent, so "use these settings again" can rebuild the tray. */
  references: StudioReference[];
  /** For a region edit or a final: the result it was made from. */
  parentOutputId: string | null;
  /** For a region edit of a library picture: that picture (an edit of a result uses `parentOutputId`). */
  parentAssetId: string | null;
  /** Region edit only: the box that was changed, so the same edit can be set up again. */
  box: RegionBox | null;
  /** Remix only: how the reference video was used, what was kept and what was changed. */
  method: StudioRemixMethod | null;
  keep: StudioKeepKey[];
  change: string | null;
  /** Remix only: the shot table the customer sent, so the reference-video panel can be set up again. */
  shots?: FilmShot[];
  outputs: StudioOutputView[];
  /** Usage this run is expected to take from the monthly allowance, in KRW. */
  estimateKrw: number;
  /** A customer-safe reason when `failed`. Never a provider message. */
  errorCode: StudioErrorCode | null;
  createdAt: string;
  finishedAt: string | null;
}

/** The reading of a reference video the remix panel shows (lib/brand-studio/film-sheet). */
export interface FilmSheet {
  seconds: number;
  aspect: string;
  /** `transition` and `move` are filled by a `blueprint` reading only. */
  shots: Array<{
    start: number;
    end: number;
    framing: string;
    camera: string;
    action: string;
    transition?: string;
    move?: { travel: string; turn: string; zoom: string };
  }>;
  look: { lighting: string; palette: string; texture: string };
  audio: { music: boolean; speech: boolean; effects: string };
  /** Two or three plain sentences in the viewer's language. */
  summary: string;
  /** `blueprint` reading only: every person and object that matters, with how many appear (ids "A", "B", …). */
  subjects?: Array<{ id: string; what: string; count: number }>;
  /** `blueprint` reading only: where it happens, one sentence. */
  setting?: string;
}

export interface StudioAllowanceView {
  /** Monthly allowance in KRW; 0 means generation is not open for this organization yet. */
  capKrw: number;
  usedKrw: number;
  /** ISO time the month rolls over (Asia/Seoul). */
  resetsAt: string;
}

/** `GET /api/brand-studio?organizationId=…` */
export interface StudioState {
  ok: true;
  /** False for viewers and guests: they see the board and the library, and cannot run or upload. */
  canCreate: boolean;
  allowance: StudioAllowanceView;
  storage?: StudioStorageQuotaView;
  assets: StudioAssetView[];
  /** Newest first. */
  jobs: StudioJobView[];
  /** Campaigns a result can be sent to. */
  campaigns: Array<{ id: string; title: string }>;
}

/** `GET /api/brand-studio?organizationId=…&jobs=a,b` — the poll; also moves open jobs forward. */
export interface StudioJobsPoll {
  ok: true;
  jobs: StudioJobView[];
  allowance: StudioAllowanceView;
}

export type StudioJobCreated = { ok: true; job: StudioJobView };
export type StudioPromptPreview = { ok: true; prompt: string; notes: string };
export type StudioFilmAnalysis = { ok: true; sheet: FilmSheet | null };
export type StudioAssetReserved = { ok: true; id: string; direct: boolean; url?: string };
export type StudioAssetSaved = { ok: true; asset: StudioAssetView };
export type StudioHandoffDone = { ok: true; projectId: string; href: string };
export type StudioDone = { ok: true };
