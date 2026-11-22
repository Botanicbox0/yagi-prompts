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
import { LYRIC_STRUCTURES } from './sound/lyrics';
import type { LyricsModel } from './sound/lyrics-model';
import {
  ReviseQuestionSchema,
  ReviseSheetSchema,
  ReviseTurnSchema,
  SHEET_LIMITS,
  type ReviseQuestion,
  type ReviseSheet,
} from './revision/sheet';

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
/** `music` and `sound_effect`: the sound studio (docs/BRAND-SOUND-STUDIO.md §7.2, migration 0172). */
export const STUDIO_JOB_KINDS = ['image', 'region_edit', 'video', 'video_remix', 'video_final', 'music', 'sound_effect'] as const;
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
  /** A model picked for a run with several models is no longer offered (the screen was older than the list). */
  'model_unavailable',
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
  /**
   * The project this run goes into (`BRAND_STUDIO_PROJECTS`). Ignored while the feature is closed, and
   * for a run made from an earlier result, which always takes that result's project.
   */
  projectId: Id.optional(),
};

/**
 * The sentence the customer read in the prompt bar after "지금 설계하기" (they may have edited it). It is
 * sent as it is and never rewritten again; `prompt` stays the words they typed first. Plain image and video
 * runs only: a partial edit and a reference-video run always write their own sentence.
 */
const ReviewedPrompt = z.string().trim().min(1).max(STUDIO_LIMITS.promptMax).optional();

export const ImageJobSchema = z.object({
  kind: z.literal('image'),
  ...JobBase,
  prompt: JobBase.prompt.min(1),
  reviewedPrompt: ReviewedPrompt,
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
  /**
   * `fill`: one strip of the layer editor's "빈 곳 채우기" (flag `BRAND_STUDIO_OUTPAINT`). An internal run:
   * never in a list of runs or results, still returned by id to the editor that started it.
   */
  purpose: z.literal('fill').optional(),
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
  reviewedPrompt: ReviewedPrompt,
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

/**
 * How a new version of a generated clip is made (docs/BRAND-STUDIO-V6-PLAN.md §4).
 * `edit`     the clip itself is sent back and only what was asked changes (motion, camera, timing stay)
 * `reshoot`  the run the clip came from is made again, with every request so far written into its prompt
 */
export const STUDIO_REVISE_MODES = ['edit', 'reshoot'] as const;
export type StudioReviseMode = (typeof STUDIO_REVISE_MODES)[number];

/** How many spots one revision may point at. */
export const STUDIO_REVISE_MARKS_MAX = 3;

/**
 * How many pieces of material one revision may carry: videos the customer attaches to show what they
 * mean (a texture, a movement, a look). They are read and written into the request; the video model
 * never receives them (lib/brand-studio/revision/material.ts).
 */
export const STUDIO_REVISE_MATERIALS_MAX = 2;

/**
 * One question back when a revision request reads two ways (docs/BRAND-STUDIO-V6-PLAN.md §4.6): its
 * length limits. The question and its 2–3 choices come from the `revise.plan` reading itself, in the
 * customer's language; the customer picks one or has it made as written.
 */
export const STUDIO_REVISE_CLARIFY = { questionMax: 140, optionMax: 60, optionsMin: 2, optionsMax: 3 } as const;

/** What the customer said they meant, as it travels with a version. */
export const ReviseClarifiedSchema = z.object({
  question: z.string().trim().min(1).max(STUDIO_REVISE_CLARIFY.questionMax),
  answer: z.string().trim().min(1).max(STUDIO_REVISE_CLARIFY.optionMax),
});
export type ReviseClarified = z.infer<typeof ReviseClarifiedSchema>;

/**
 * A spot the customer pointed at on the clip (docs/BRAND-STUDIO-V6-PLAN.md §4.5): a pin (a click) or a
 * box (a drag) on the frame at `time`, in fractions of the picture (0..1, origin top-left). A pin has
 * `x`/`y` only (its centre); a box adds `w`/`h` and `x`/`y` are its top-left corner. In the request text
 * mark n is written ①, ② or ③.
 */
const MarkGeometry = {
  time: z.number().min(0).max(STUDIO_SHOT_LIMITS.secondsMax),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.02).max(1).optional(),
  h: z.number().min(0.02).max(1).optional(),
};
const boxInPicture = (m: { x: number; y: number; w?: number; h?: number }) =>
  (m.w === undefined) === (m.h === undefined) && (m.w === undefined || (m.x + m.w <= 1.0001 && m.y + m.h! <= 1.0001));

/**
 * A mark as it travels with a revision. `label` and `what` come from `revise.mark` (what the spot is
 * on): `label` is the short name the customer saw on the chip, in their language; `what` the precise
 * description the prompt writer uses instead of the mark. Both are absent when the spot could not be read.
 */
export const ReviseMarkSchema = z
  .object({
    ...MarkGeometry,
    label: z.string().trim().min(1).max(60).optional(),
    what: z.string().trim().min(1).max(240).optional(),
  })
  .refine(boxInPicture, { error: 'mark leaves the picture' });
export type ReviseMark = z.infer<typeof ReviseMarkSchema>;

/**
 * `revise.mark`: read what one spot is on, without spending anything. `frame` is the frame at `time`
 * with the mark drawn on it (the browser draws it): a JPEG data URL, long side at most 768 px.
 */
export const ReviseMarkReadSchema = z
  .object({
    organizationId: Id,
    outputId: Id,
    ...MarkGeometry,
    frame: z.string().max(400_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
  })
  .refine(boxInPicture, { error: 'mark leaves the picture' });

/**
 * A new version of a clip the studio generated. The customer sends only what should change and any
 * pictures added for it; model, size, length, sound and the earlier references come from the clip's own
 * history on the server. It is stored as a `video_remix` (edit) or as the kind of the run it re-makes
 * (reshoot): `video_revise` is a request shape, never a stored kind.
 */
export const VideoReviseJobSchema = z.object({
  kind: z.literal('video_revise'),
  organizationId: Id,
  requestId: RequestId,
  /** The ready video result being revised: any version of a clip. */
  outputId: Id,
  mode: z.enum(STUDIO_REVISE_MODES),
  /** What to change, in the customer's words. */
  prompt: z.string().trim().min(1).max(STUDIO_LIMITS.promptMax),
  /** Pictures added for this revision only (images; `frame` is not allowed). */
  references: z.array(StudioReferenceSchema).max(STUDIO_LIMITS.referencesMax - 1).default([]),
  /** Spots the request points at (①②③ in `prompt`), in order. */
  marks: z.array(ReviseMarkSchema).max(STUDIO_REVISE_MARKS_MAX).default([]),
  /** Material to read for this request (videos of this organization; `frame` is not allowed). Never sent to the video model. */
  materials: z.array(StudioReferenceSchema).max(STUDIO_REVISE_MATERIALS_MAX).default([]),
  /** The customer's answer to the one question `revise.plan` asked about this request. Absent: none was asked, or it was made as written. */
  clarified: ReviseClarifiedSchema.optional(),
  /**
   * Made from the revise conversation (`revise.talk`, flag `BRAND_STUDIO_REVISE_V2` only; ignored when the
   * flag is off): the sheet is the request, the way follows from it, and the questions and the transcript
   * travel with the version. Read with `ReviseDialogueRecordSchema` only while the flag is on, so with the
   * flag off any value here is ignored exactly as an unknown key always was.
   */
  dialogue: z.unknown().optional(),
});

/**
 * One request on two or three image models at once (founder 2026-11-19: "이미지 모델을 2개 이상을 동시 선택해서
 * 만드는 것도"). The same words, references and settings go to every model; each model is one ordinary
 * image job of its own, with its own prompt design. `count` is per model.
 */
export const STUDIO_GROUP_MODELS = { min: 2, max: 3 } as const;

/**
 * The group's idempotency key. Each model's job is keyed `groupRunRequestId(requestId, model)`, which must
 * still fit the 80 characters of a job's key (`RequestId`), so the group's own key is shorter.
 */
const GroupRequestId = z.string().min(8).max(56).regex(/^[A-Za-z0-9_-]+$/);

/** The idempotency key of one model's job inside a group: the group's key and the model, in the key's alphabet. */
export function groupRunRequestId(groupRequestId: string, model: string): string {
  return `${groupRequestId}-${model.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 80);
}

/** One model of a group: its own quality (models with qualities only) and its own reviewed sentence. */
export const ImageGroupRunSchema = z.object({
  model: z.string().min(1).max(60),
  /** As on an image job: only for a model that declares `qualities`. */
  quality: z.enum(STUDIO_IMAGE_QUALITIES).optional(),
  /** The sentence the customer read for THIS model after "설계하기" (sent as it is, with `enhance` off for this model). */
  reviewedPrompt: ReviewedPrompt,
});

export const ImageJobGroupSchema = z
  .object({
    kind: z.literal('image'),
    organizationId: Id,
    requestId: GroupRequestId,
    /** What the customer typed; every model's job keeps it as its `prompt`. */
    prompt: JobBase.prompt.min(1),
    /** Prompt Architect at send for every model that has no reviewed sentence. */
    enhance: z.boolean().default(true),
    references: JobBase.references,
    projectId: JobBase.projectId,
    aspect: z.string().max(8),
    resolution: z.string().max(8),
    /** Pictures per model. */
    count: z.number().int().min(1).max(STUDIO_LIMITS.imageCountMax).default(1),
    background: z.enum(STUDIO_IMAGE_BACKGROUNDS).optional(),
    runs: z.array(ImageGroupRunSchema).min(STUDIO_GROUP_MODELS.min).max(STUDIO_GROUP_MODELS.max),
  })
  .refine((v) => new Set(v.runs.map((r) => r.model)).size === v.runs.length, { error: 'each model once' });
export type StudioJobGroupCreate = z.infer<typeof ImageJobGroupSchema>;

export const StudioJobCreateSchema = z.discriminatedUnion('kind', [
  ImageJobSchema,
  RegionEditJobSchema,
  VideoJobSchema,
  VideoRemixJobSchema,
  VideoFinalJobSchema,
  VideoReviseJobSchema,
]);
export type StudioJobCreate = z.infer<typeof StudioJobCreateSchema>;

/**
 * `revise.plan`: what a revision of this clip would be, without spending anything. With an empty
 * `prompt` it answers which ways are open and what each would use; with a request it also says which
 * way fits it.
 */
export const RevisePlanSchema = z.object({
  organizationId: Id,
  outputId: Id,
  prompt: z.string().trim().max(STUDIO_LIMITS.promptMax).default(''),
  references: z.array(StudioReferenceSchema).max(STUDIO_LIMITS.referencesMax - 1).default([]),
  /** The spots the request points at, so the fit is judged on what they are on. */
  marks: z.array(ReviseMarkSchema).max(STUDIO_REVISE_MARKS_MAX).default([]),
  /** Material attached to the request (counted only: the reading may ask which one is meant). */
  materials: z.number().int().min(0).max(STUDIO_REVISE_MATERIALS_MAX).default(0),
  /**
   * The question was already asked for this request: `answer` is the choice, null when the customer had it
   * made as written. With this the reading never asks again.
   */
  clarified: z
    .object({
      question: z.string().trim().min(1).max(STUDIO_REVISE_CLARIFY.questionMax),
      answer: z.string().trim().min(1).max(STUDIO_REVISE_CLARIFY.optionMax).nullable(),
    })
    .optional(),
});

/**
 * `revise.talk` (flag `BRAND_STUDIO_REVISE_V2`, docs/BRAND-STUDIO-VIDEO-REMIX.md §3): one turn of the revise
 * conversation. The screen keeps the conversation and sends it whole every turn: the turns so far, the
 * standing sheet and the questions asked. `message` is the customer's new message; empty, the call only
 * gets the clip ready to talk about (its reading is kept per output) and answers the ways and credits.
 * Nothing is spent here; `job.create` with `video_revise` and `dialogue` makes the version.
 */
export const ReviseTalkSchema = z.object({
  organizationId: Id,
  outputId: Id,
  message: z.string().trim().max(STUDIO_LIMITS.promptMax).default(''),
  turns: z.array(ReviseTurnSchema).max(SHEET_LIMITS.transcriptMax).default([]),
  sheet: ReviseSheetSchema.default({ change: [], keep: [], exclude: [] }),
  questions: z.array(ReviseQuestionSchema).max(SHEET_LIMITS.questionsMax).default([]),
  /**
   * The message answers the open question: `option` is the pressed choice (its index), `decide` the
   * "decide for me" choice; neither when the customer typed the answer under the question.
   */
  answering: z.object({ option: z.number().int().min(0).max(SHEET_LIMITS.optionsMax - 1).optional(), decide: z.boolean().optional() }).optional(),
  /** Pictures attached so far in this conversation (numbered from 1 in that order). */
  references: z.array(StudioReferenceSchema).max(STUDIO_LIMITS.referencesMax - 1).default([]),
  marks: z.array(ReviseMarkSchema).max(STUDIO_REVISE_MARKS_MAX).default([]),
  materials: z.number().int().min(0).max(STUDIO_REVISE_MATERIALS_MAX).default(0),
  /** What the customer saw last turn (so a change of way or credits is explained). */
  shown: z.object({ way: z.enum(STUDIO_REVISE_MODES).nullable(), estimateKrw: z.number().int().min(0) }).nullable().default(null),
  /** A line's remove control: take out `sheet.change[remove]` (the server settles it; nothing is read). */
  remove: z.number().int().min(0).max(SHEET_LIMITS.changeMax - 1).optional(),
});

/** Why a way is closed. The screen has one short line per code. */
export const STUDIO_REVISE_PROBLEMS = ['too_short', 'too_long', 'unsupported', 'references_gone', 'too_many_references'] as const;
export type StudioReviseProblem = (typeof STUDIO_REVISE_PROBLEMS)[number];

/**
 * Why one way fits a request better. `surface` (look, product, colour, background, text) points at
 * `edit`; `motion` (camera, action), `structure` (shots, framing, order) and `length` point at `reshoot`.
 */
export const STUDIO_REVISE_REASONS = ['surface', 'motion', 'structure', 'length'] as const;
export type StudioReviseReason = (typeof STUDIO_REVISE_REASONS)[number];

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
  /**
   * A picture made for one run and deleted when its runs settle ("빈 곳 채우기"'s whole-canvas source): it is
   * hidden from the library, so its role is not recognised (asset-role.ts). Skipping is all it does.
   */
  transient: z.boolean().optional(),
});

/** Read a reference video already in the library. `depth` defaults to `basic`. */
export const FilmAnalyzeSchema = z.object({ organizationId: Id, assetId: Id, depth: z.enum(FILM_DEPTHS).optional() });

export const AssetRefSchema = z.object({ organizationId: Id, assetId: Id });
export const OutputRefSchema = z.object({ organizationId: Id, outputId: Id });
/**
 * `lyrics.draft`: lyrics for the sound studio (docs/BRAND-SOUND-STUDIO.md §7.5, §12.3). Free, rate-limited.
 * `topic` writes new lyrics from the description ("가사 초안 만들기"); `polish` returns the customer's lyrics made
 * easier to sing ("부르기 좋게 손보기"), shown next to the original and used only if the customer accepts it.
 */
export const LyricsDraftSchema = z
  .object({
    organizationId: Id,
    flow: z.enum(['topic', 'polish']).default('topic'),
    /** The description (what the music is for). Required to write from a topic; context for a polish. */
    topic: z.string().trim().max(1000).default(''),
    /** `polish`: the customer's lyrics. */
    lyrics: z.string().max(3000).optional(),
    language: z.enum(['ko', 'en', 'mixed']),
    /** 가사 길이: 15, 30, 60 s or a video's length. */
    seconds: z.number().int().min(5).max(240).optional(),
    structure: z.enum(LYRIC_STRUCTURES).optional(),
    tone: z.enum(['haeyo', 'banmal']).optional(),
    /** The brand or product name as the brief writes it, and how to write it in Korean lyrics (e.g. 에코핀). */
    brand: z.object({ name: z.string().trim().min(1).max(60), readAs: z.string().trim().max(60).optional() }).strict().optional(),
    mustInclude: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
    /** SA4 "영상 길이": the lyrics are sized to this library video's length (overrides `seconds`). */
    videoAssetId: Id.optional(),
  })
  .strict()
  .refine((v) => (v.flow === 'topic' ? v.topic.length > 0 : Boolean(v.lyrics?.trim())));
export type StudioLyricsDraft = {
  ok: true;
  flow: 'topic' | 'polish';
  /** Plain stanzas (no marks), as the lyrics box shows them. */
  lyrics: string;
  /** Which model wrote them, sent back with the music request so the run records it (`params.music.lyricsBy`). */
  model: LyricsModel | 'local';
  /** The tempo the lyrics were planned at (§12.11): sent back with the music request so the design keeps it. */
  bpm: number;
};
/** `music.design`: "지금 설계하기" in the music dock (docs/BRAND-SOUND-STUDIO.md §12.2). Free, rate-limited. */
export const MusicDesignSchema = z
  .object({
    organizationId: Id,
    prompt: z.string().trim().min(1).max(1000),
    vocal: z.boolean().default(false),
    lyrics: z.string().max(3000).optional(),
    careful: z.boolean().optional(),
    language: z.enum(['ko', 'en']).optional(),
    structure: z.enum(LYRIC_STRUCTURES).optional(),
    /** "다르게 설계하기" after the engine refused (§12.5). */
    avoid: z.boolean().optional(),
    /** The brand name and words to include from the lyrics options (sung with no lyrics, they reach the engine). */
    words: z
      .object({
        brand: z.object({ name: z.string().trim().min(1).max(60), readAs: z.string().trim().max(60).optional() }).strict().optional(),
        mustInclude: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
      })
      .strict()
      .optional(),
    /** SA4: the library video the music goes under. */
    videoAssetId: Id.optional(),
    /** The length plan's inputs (§12.11): the length, the drafted tempo, and whether the lyrics were drafted. */
    targetSeconds: z.number().int().min(5).max(240).optional(),
    bpm: z.number().int().min(60).max(160).optional(),
    lyricsBy: z.object({ flow: z.enum(['topic', 'polish']), model: z.string().max(40) }).strict().optional(),
  })
  .strict();
export type StudioMusicDesign = {
  ok: true;
  design: { mode: 'describe' | 'custom'; style: string; title: string; notes: string | null; source: 'model' | 'fallback' };
};
/** `output.waveform`: the first browser that decodes an audio result keeps its peaks (docs/BRAND-SOUND-STUDIO.md §7.4). */
export const OutputWaveformSchema = z
  .object({ organizationId: Id, outputId: Id, peaks: z.array(z.number().min(0).max(1)).min(1).max(1000) })
  .strict();
export const JobRefSchema = z.object({ organizationId: Id, jobId: Id });

/** `job.assign_project`: put a run (and everything made from it) in a project; `null` takes it out. */
export const JobAssignProjectSchema = z.object({ organizationId: Id, jobId: Id, projectId: Id.nullable() });

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
  'job.create_group',
  'job.cancel',
  'prompt.enhance',
  'film.analyze',
  'revise.plan',
  'revise.mark',
  'revise.talk',
  'asset.reserve',
  'asset.complete',
  'asset.update',
  'asset.delete',
  'asset.from_output',
  'output.delete',
  'job.delete',
  'job.assign_project',
  'handoff.campaign',
  'output.waveform',
  'lyrics.draft',
  'music.design',
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
  /**
   * Who set `role`: `auto` = the upload check (with a role: recognised automatically; without: it was not sure
   * and will not ask again), `user` = the customer. Absent while nobody has, e.g. while the check runs.
   */
  roleSource?: 'auto' | 'user';
  name: string;
  tags: string[];
  /** Displayable address (full size for images, the file for video and audio). */
  url: string;
  /** A small still for the grid; for audio, null. */
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Seconds, for video and audio, in tenths: what a screen shows. */
  seconds: number | null;
  /**
   * The exact stored length in whole milliseconds, absent when unknown. Never shown; a run that follows
   * this file is priced from it (usage-rate.ts `remixRunUsd` `referenceMs`), exactly as the server reserves.
   */
  durationMs?: number;
  source: StudioAssetSource;
  createdAt: string;
}

export interface StudioOutputView {
  id: string;
  jobId: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Seconds in tenths, as a screen shows them. */
  seconds: number | null;
  /** The exact stored length in whole milliseconds, absent when unknown; for pricing only (see `StudioAssetView`). */
  durationMs?: number;
  /** True for a 480p draft that can still be finished at 1080p. */
  draft: boolean;
  /**
   * Present only on a `draft` of a finished clip whose model makes finals: what its 1080p final takes from
   * the allowance, in KRW. The same figure `job.create` with `video_final` reserves (lib/brand-studio/final-price.ts).
   */
  finalEstimateKrw?: number;
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
  /** Audio results: the peaks the list draws (0..1), or null until a browser has saved them. */
  waveform?: number[] | null;
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
  /** Set on a run made by a preset workflow (id only). Such a run's sent text is never shown and it cannot be re-run from the gallery. */
  preset?: string;
  /** True when `finalPrompt` is the sentence the customer read (and may have edited) before sending. */
  reviewed?: boolean;
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
  /** The project this run belongs to. Present only while `BRAND_STUDIO_PROJECTS` is on and the run has one. */
  projectId?: string;
  /** For a region edit of a library picture: that picture (an edit of a result uses `parentOutputId`). */
  parentAssetId: string | null;
  /** Region edit only: the box that was changed, so the same edit can be set up again. */
  box: RegionBox | null;
  /** `fill`: an internal "빈 곳 채우기" strip. Screens that list runs or results skip it. */
  purpose?: 'fill';
  /** Music only (docs/BRAND-SOUND-STUDIO.md §7.2): the list name and what the customer chose. */
  music?: { title: string; vocal: boolean; mode: 'describe' | 'custom'; careful: boolean; lyrics: string | null; targetSeconds?: number | null };
  /** Remix only: how the reference video was used, what was kept and what was changed. */
  method: StudioRemixMethod | null;
  keep: StudioKeepKey[];
  change: string | null;
  /** Remix only: the shot table the customer sent, so the reference-video panel can be set up again. */
  shots?: FilmShot[];
  /**
   * Set on a new version of an earlier clip. Every version of one clip shares `rootJobId` (the id of the
   * run that made v1, which itself carries no `revision`); `prompt` is the change that was asked for.
   * `added` is how many of the trailing `references` were attached for this version.
   */
  revision?: {
    rootJobId: string;
    version: number;
    /** The result this version was made from; null once that result is deleted. */
    baseOutputId: string | null;
    mode: StudioReviseMode;
    added: number;
    /** The spots this version's request pointed at (①②③ in `prompt`). */
    marks?: ReviseMark[];
    /** The material read for this version's request (videos; never among `references`). */
    materials?: Array<{ assetId?: string; outputId?: string }>;
    /** The question asked about this version's request and the customer's answer. */
    clarified?: ReviseClarified;
    /** Made from the revise conversation (`BRAND_STUDIO_REVISE_V2`): the sheet it was asked with. */
    sheet?: ReviseSheet;
  } | null;
  /**
   * Set on a run made with others in one request on several image models (`job.create_group`): the group
   * and its models in the order they were picked. Every run of the group carries the same value.
   */
  group?: { id: string; models: string[] };
  outputs: StudioOutputView[];
  /** Usage this run is expected to take from the monthly allowance, in KRW (the settled amount once finished). */
  estimateKrw: number;
  /** Results `estimateKrw` covers: every result made, including ones deleted since. Absent reads as `outputs.length`. */
  countedOutputs?: number;
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
  /** True when a run that ended with no result can be removed from the wall (`job.delete`). */
  canRemoveRuns?: boolean;
  /** Present (true) only when `BRAND_STUDIO_OUTPAINT=on` and the member can create: the layer editor may offer "빈 곳 채우기". */
  canFillEmpty?: boolean;
  /**
   * Present (true) only when `BRAND_STUDIO_REGION_V2=on` and the member can create: every partial edit
   * runs on one engine, so the edit forms show no model or quality choice.
   */
  regionV2?: boolean;
  /**
   * Present (true) only when `BRAND_STUDIO_REVISE_V2=on` and the member can create: the clip edit panel
   * is a conversation (we pick the way and say why), and drafts and finals are named on version cards.
   */
  reviseV2?: boolean;
  /**
   * Present only while runs can belong to a project (`BRAND_STUDIO_PROJECTS=on` and migration 0091
   * applied): the projects a run can be put in, newest first. Absent means the feature is closed.
   */
  projects?: StudioProjectRef[];
}

/** A studio project, as much as a picker needs. */
export interface StudioProjectRef {
  id: string;
  title: string;
}

/** `job.assign_project`: every run that moved (the run and its family) and where they are now. */
export interface StudioJobProjectAssigned {
  ok: true;
  jobIds: string[];
  projectId: string | null;
}

/** `GET /api/brand-studio?organizationId=…&jobs=a,b` — the poll; also moves open jobs forward. */
export interface StudioJobsPoll {
  ok: true;
  jobs: StudioJobView[];
  allowance: StudioAllowanceView;
}

export type StudioJobCreated = { ok: true; job: StudioJobView };
/** `job.create_group`: one run per model, in the order the models were sent. */
export type StudioJobGroupCreated = { ok: true; groupId: string; jobs: StudioJobView[] };
export type StudioPromptPreview = { ok: true; prompt: string; notes: string };
export type StudioFilmAnalysis = { ok: true; sheet: FilmSheet | null };
/**
 * `revise.mark` answer: what the spot is on. `label` is a short name in the customer's language for the
 * chip; `what` a precise description for the prompt writer. Both null when it could not be read (the
 * mark still works, by position).
 */
export type StudioReviseMarkRead = { ok: true; label: string | null; what: string | null };
/** `revise.plan` answer. `reason` is null when no request was sent or it could not be read; `recommended` is then the default way. */
export interface StudioRevisePlan {
  ok: true;
  /** The version number the next revision of this clip gets. */
  version: number;
  methods: Record<StudioReviseMode, { available: boolean; estimateKrw: number; problem?: StudioReviseProblem }>;
  recommended: StudioReviseMode | null;
  reason: StudioReviseReason | null;
  /**
   * Present only when the request reads two ways that would give visibly different videos and nothing sent
   * with it settles which: one question and 2–3 short choices, in the customer's language. Never present
   * when `clarified` was sent.
   */
  clarify?: { question: string; options: string[] };
}

/** What a revise-conversation message was read as (`revise.talk`). */
export const STUDIO_TALK_KINDS = ['change', 'correction', 'answer', 'confirm', 'withdraw', 'tool_question', 'unreadable', 'not_possible'] as const;
export type StudioTalkKind = (typeof STUDIO_TALK_KINDS)[number];

/**
 * `revise.talk` answer. The reply and the sheet come from the reading; everything about spending is the
 * server's: the way (from the sheet), its credits, and whether a make button may exist. `failed`: the
 * message could not be read (the screen says so and offers to send it again; no button).
 */
export interface StudioReviseTalk {
  ok: true;
  /** The version number the next revision of this clip gets. */
  version: number;
  /** Null on the opening call (no message) and when the reading failed. */
  kind: StudioTalkKind | null;
  /** The studio's turn, in the customer's language. Null on the opening call and when the reading failed. */
  reply: string | null;
  /** The standing request after this message (unchanged when the message changed nothing or failed). */
  sheet: ReviseSheet;
  /** Every question asked in this conversation, answered or not, in order. */
  questions: ReviseQuestion[];
  /** The question now open (its index in `questions`), or null. While one is open there is no button. */
  open: number | null;
  /** How the sheet would be made, and what that takes (KRW; the screen shows credits). Null way: nothing to make. */
  way: StudioReviseMode | null;
  estimateKrw: number;
  /** A longer clip asked for and accepted: its new length in seconds. */
  seconds: number | null;
  /** The only thing that may show "이대로 만들기". */
  canMake: boolean;
  /** Part of the message cannot be done here (a real person, music, a length out of range). */
  impossible: boolean;
  /** The message asked for a shorter clip: that is done in the editing studio (free); offer the way there. */
  editStudio: boolean;
  /** The way or the credits differ from what the customer saw last turn (`shown`). */
  changed: { way: boolean; credits: boolean };
  /** Whether the clip's own reading was available to this turn (the opening call prepares it). */
  clipKnown: boolean;
  failed?: true;
}
export type StudioAssetReserved = { ok: true; id: string; direct: boolean; url?: string };
/** `roleCheck`: an upload whose category is being recognised now; the screen reads the library again shortly. */
export type StudioAssetSaved = { ok: true; asset: StudioAssetView; roleCheck?: true };
export type StudioHandoffDone = { ok: true; projectId: string; href: string };
export type StudioDone = { ok: true };
