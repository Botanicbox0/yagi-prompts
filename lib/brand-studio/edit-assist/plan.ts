/**
 * "말로 편집" plan format (docs/BRAND-EDITING-STUDIO.md §4.3, §7 — E1).
 *
 * The model answers one of three ways:
 * - `plan`: 1..12 timeline steps that point at cuts and captions only by the refs the context gave it
 *   (`c1`…, `t1`…; `c2a`/`c2b` for the pieces of a cut split earlier in the same plan);
 * - `ask`: one question about a missing target or number, with structured choices (refs, seconds,
 *   places), never free prose;
 * - `cannot`: a reason code.
 *
 * Nothing here is prose the screen shows. The screen says what changed from the timeline diff
 * (`diff.ts`) and words every question and reason from the dictionary, so a model can never put its
 * own sentence in front of a customer. Client-safe: no server imports, no Node APIs.
 */
import { z } from 'zod';
import {
  COMPOSE_ASPECTS,
  COMPOSE_COLOR_PRESET_IDS,
  MIN_CLIP_PLAY_SEC,
  type CaptionPosition,
  type CaptionSize,
  type ComposeAspect,
  type ComposeColorPresetId,
} from '../compose/timeline';

export const EDIT_PLAN_MAX_STEPS = 12;
export const CAPTION_TEXT_MAX = 80;
/** Largest number of seconds a step may name (source clips are capped at 600 s). */
export const EDIT_SECONDS_MAX = 600;

export const EDIT_STEP_KINDS = [
  'trim',
  'split',
  'remove',
  'move',
  'sound',
  'caption_add',
  'caption_edit',
  'caption_remove',
  'aspect',
  'look',
  'fit_total',
  'even_pace',
] as const;
export type EditStepKind = (typeof EDIT_STEP_KINDS)[number];

export const ASK_ABOUT = ['which_clip', 'which_caption', 'how_long', 'where_caption'] as const;
export type AskAbout = (typeof ASK_ABOUT)[number];

export const CANNOT_REASONS = ['not_timeline_edit', 'nothing_to_edit', 'not_possible'] as const;
export type CannotReason = (typeof CANNOT_REASONS)[number];

export const KEEP_PARTS = ['start', 'end', 'middle', 'range'] as const;
export type KeepPart = (typeof KEEP_PARTS)[number];

export const CAPTION_POSITIONS = ['top', 'center', 'bottom'] as const satisfies readonly CaptionPosition[];
export const CAPTION_SIZES = ['sm', 'md', 'lg'] as const satisfies readonly CaptionSize[];
export const CAPTION_PLACES = ['start', 'end', 'whole'] as const;
export type CaptionPlace = (typeof CAPTION_PLACES)[number];

/** `c1`…`c999`: a cut as numbered in the context (timeline order from 1). */
export const CLIP_REF_PATTERN = /^c[1-9]\d{0,2}$/;
/** `c2a` / `c2b`: first / second piece of a cut that an earlier step of the same plan split. */
export const SPLIT_PIECE_REF_PATTERN = /^c[1-9]\d{0,2}[ab]$/;
/** `t1`…`t999`: a caption as numbered in the context (start-time order from 1). */
export const CAPTION_REF_PATTERN = /^t[1-9]\d{0,2}$/;

/** A clip target in a model plan: `cN`, or `cNa` / `cNb` after a split. */
export type ClipRef = string;
export type CaptionRef = string;

export type MoveDestination<Clip> = 'first' | 'last' | { before: Clip } | { after: Clip };
export type CaptionWhere<Clip> = CaptionPlace | { clip: Clip } | { from: number; to: number };

/**
 * The twelve timeline steps, generic over how a clip / caption is named: refs in a model plan
 * (`EditStep`), ids after resolution (`ResolvedStep` in `apply.ts`).
 *
 * Seconds inside a cut (`trim`, `split`) are measured on the cut as it currently plays, 0 = its current
 * in-point; timeline seconds (`caption_*` `from`/`to`, `fit_total`) are measured on the whole video.
 */
export type EditStepOf<Clip, Caption> =
  | { do: 'trim'; clip: Clip; keep: KeepPart; seconds?: number; from?: number; to?: number }
  | { do: 'split'; clip: Clip; at: number }
  | { do: 'remove'; clip: Clip }
  | { do: 'move'; clip: Clip; to: MoveDestination<Clip> }
  | { do: 'sound'; target: Clip | 'all_clips' | 'music'; volume?: number; muted?: boolean; remove?: boolean }
  | {
      do: 'caption_add';
      text: string;
      where: CaptionWhere<Clip>;
      seconds?: number;
      position?: CaptionPosition;
      size?: CaptionSize;
    }
  | {
      do: 'caption_edit';
      caption: Caption;
      text?: string;
      position?: CaptionPosition;
      size?: CaptionSize;
      from?: number;
      to?: number;
    }
  | { do: 'caption_remove'; caption: Caption | 'all' }
  | { do: 'aspect'; aspect: ComposeAspect }
  | { do: 'look'; preset: ComposeColorPresetId | 'off'; strength?: number }
  | { do: 'fit_total'; seconds: number; protect?: Clip[] }
  | { do: 'even_pace'; secondsPerClip: number };

export type EditStep = EditStepOf<ClipRef, CaptionRef>;

export type EditPlan =
  | { kind: 'plan'; steps: EditStep[] }
  | { kind: 'ask'; about: AskAbout; choices: string[] }
  | { kind: 'cannot'; reason: CannotReason };

/** What the refs in a context stand for: `c1` → clip id, `t1` → caption id (`context.ts`). */
export interface EditRefs {
  clips: Record<string, string>;
  captions: Record<string, string>;
}

/**
 * An `ask` choice in the form the screen uses (ids, not refs): a cut, a caption, every cut, a number
 * of seconds, or a caption place. The screen sends the picked one back as `answer.value`.
 */
export type AskChoice = { clipId: string } | { captionId: string } | 'all' | number | CaptionPlace;

/* ------------------------------------------------------------------ zod */

const clipTarget = z
  .string()
  .refine((v) => CLIP_REF_PATTERN.test(v) || SPLIT_PIECE_REF_PATTERN.test(v), { message: 'clip_ref' });
const captionRef = z.string().regex(CAPTION_REF_PATTERN, { message: 'caption_ref' });
const playedSeconds = z.number().finite().min(0).max(EDIT_SECONDS_MAX);
const positiveSeconds = z.number().finite().gt(0).max(EDIT_SECONDS_MAX);
const unit = z.number().finite().min(0).max(1);
const captionText = z.string().trim().min(1).max(CAPTION_TEXT_MAX);

const TrimStepSchema = z
  .strictObject({
    do: z.literal('trim'),
    clip: clipTarget,
    keep: z.enum(KEEP_PARTS),
    seconds: positiveSeconds.optional(),
    from: playedSeconds.optional(),
    to: positiveSeconds.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.keep === 'range') {
      if (step.from === undefined || step.to === undefined || step.seconds !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'range_needs_from_to', path: ['keep'] });
      } else if (step.from >= step.to) {
        ctx.addIssue({ code: 'custom', message: 'from_not_before_to', path: ['from'] });
      }
    } else if (step.seconds === undefined || step.from !== undefined || step.to !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'keep_needs_seconds', path: ['seconds'] });
    }
  });

const SplitStepSchema = z.strictObject({ do: z.literal('split'), clip: clipTarget, at: positiveSeconds });

const RemoveStepSchema = z.strictObject({ do: z.literal('remove'), clip: clipTarget });

const MoveStepSchema = z
  .strictObject({
    do: z.literal('move'),
    clip: clipTarget,
    to: z.union([
      z.enum(['first', 'last']),
      z.strictObject({ before: clipTarget }),
      z.strictObject({ after: clipTarget }),
    ]),
  })
  .superRefine((step, ctx) => {
    const anchor = typeof step.to === 'string' ? null : 'before' in step.to ? step.to.before : step.to.after;
    if (anchor !== null && anchor === step.clip) {
      ctx.addIssue({ code: 'custom', message: 'move_relative_to_itself', path: ['to'] });
    }
  });

const SoundStepSchema = z
  .strictObject({
    do: z.literal('sound'),
    target: z.union([z.enum(['all_clips', 'music']), clipTarget]),
    volume: unit.optional(),
    muted: z.boolean().optional(),
    remove: z.boolean().optional(),
  })
  .superRefine((step, ctx) => {
    if (step.remove === true) {
      if (step.target !== 'music') ctx.addIssue({ code: 'custom', message: 'remove_is_music_only', path: ['remove'] });
      if (step.volume !== undefined || step.muted !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'remove_alone', path: ['remove'] });
      }
    } else if (step.volume === undefined && step.muted === undefined) {
      ctx.addIssue({ code: 'custom', message: 'sound_needs_volume_or_muted', path: ['volume'] });
    }
  });

const CaptionAddStepSchema = z
  .strictObject({
    do: z.literal('caption_add'),
    text: captionText,
    where: z.union([
      z.enum(CAPTION_PLACES),
      z.strictObject({ clip: clipTarget }),
      z.strictObject({ from: playedSeconds, to: positiveSeconds }),
    ]),
    seconds: z.number().finite().min(0.5).max(60).optional(),
    position: z.enum(CAPTION_POSITIONS).optional(),
    size: z.enum(CAPTION_SIZES).optional(),
  })
  .superRefine((step, ctx) => {
    if (typeof step.where === 'object' && 'from' in step.where) {
      if (step.where.from >= step.where.to) ctx.addIssue({ code: 'custom', message: 'from_not_before_to', path: ['where'] });
      if (step.seconds !== undefined) ctx.addIssue({ code: 'custom', message: 'seconds_with_range', path: ['seconds'] });
    }
    if (step.where === 'whole' && step.seconds !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'seconds_with_whole', path: ['seconds'] });
    }
  });

const CaptionEditStepSchema = z
  .strictObject({
    do: z.literal('caption_edit'),
    caption: captionRef,
    text: captionText.optional(),
    position: z.enum(CAPTION_POSITIONS).optional(),
    size: z.enum(CAPTION_SIZES).optional(),
    from: playedSeconds.optional(),
    to: positiveSeconds.optional(),
  })
  .superRefine((step, ctx) => {
    if (
      step.text === undefined &&
      step.position === undefined &&
      step.size === undefined &&
      step.from === undefined &&
      step.to === undefined
    ) {
      ctx.addIssue({ code: 'custom', message: 'caption_edit_needs_a_field', path: [] });
    }
    if (step.from !== undefined && step.to !== undefined && step.from >= step.to) {
      ctx.addIssue({ code: 'custom', message: 'from_not_before_to', path: ['from'] });
    }
  });

const CaptionRemoveStepSchema = z.strictObject({
  do: z.literal('caption_remove'),
  caption: z.union([z.literal('all'), captionRef]),
});

const AspectStepSchema = z.strictObject({ do: z.literal('aspect'), aspect: z.enum(COMPOSE_ASPECTS) });

const LookStepSchema = z
  .strictObject({
    do: z.literal('look'),
    preset: z.union([z.literal('off'), z.enum(COMPOSE_COLOR_PRESET_IDS)]),
    strength: unit.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.preset === 'off' && step.strength !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'strength_with_off', path: ['strength'] });
    }
  });

const FitTotalStepSchema = z.strictObject({
  do: z.literal('fit_total'),
  seconds: positiveSeconds,
  protect: z.array(clipTarget).max(24).optional(),
});

const EvenPaceStepSchema = z.strictObject({
  do: z.literal('even_pace'),
  secondsPerClip: z.number().finite().min(MIN_CLIP_PLAY_SEC).max(60),
});

export const EditStepSchema: z.ZodType<EditStep> = z.discriminatedUnion('do', [
  TrimStepSchema,
  SplitStepSchema,
  RemoveStepSchema,
  MoveStepSchema,
  SoundStepSchema,
  CaptionAddStepSchema,
  CaptionEditStepSchema,
  CaptionRemoveStepSchema,
  AspectStepSchema,
  LookStepSchema,
  FitTotalStepSchema,
  EvenPaceStepSchema,
]);

const SECONDS_CHOICE = /^\d{1,3}(?:\.\d)?$/;

/** Whether one `ask` choice is the structured value its `about` allows. */
export function askChoiceAllowed(about: AskAbout, choice: string): boolean {
  switch (about) {
    case 'which_clip':
      return choice === 'all' || CLIP_REF_PATTERN.test(choice);
    case 'which_caption':
      return CAPTION_REF_PATTERN.test(choice);
    case 'how_long':
      return SECONDS_CHOICE.test(choice) && Number(choice) > 0 && Number(choice) <= EDIT_SECONDS_MAX;
    case 'where_caption':
      return (CAPTION_PLACES as readonly string[]).includes(choice);
  }
}

const AskSchema = z
  .strictObject({
    kind: z.literal('ask'),
    about: z.enum(ASK_ABOUT),
    choices: z.array(z.string().max(8)).min(2).max(4),
  })
  .superRefine((ask, ctx) => {
    ask.choices.forEach((choice, index) => {
      if (!askChoiceAllowed(ask.about, choice)) {
        ctx.addIssue({ code: 'custom', message: 'choice_not_allowed', path: ['choices', index] });
      }
    });
    if (new Set(ask.choices).size !== ask.choices.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate_choice', path: ['choices'] });
    }
  });

export const EditPlanSchema: z.ZodType<EditPlan> = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('plan'),
    steps: z.array(EditStepSchema).min(1).max(EDIT_PLAN_MAX_STEPS),
  }),
  AskSchema,
  z.strictObject({ kind: z.literal('cannot'), reason: z.enum(CANNOT_REASONS) }),
]);

/* ------------------------------------------------------- model answers */

/**
 * The model's JSON schema (the dialect `callGeminiJson` sends as `responseJsonSchema`): one flat step
 * object with every field optional. Unions (`to`, `where`) stay open here and the system instruction
 * spells out their shapes; `EditPlanSchema` above does the real validation.
 */
export const EDIT_PLAN_MODEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['plan', 'ask', 'cannot'] },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: EDIT_PLAN_MAX_STEPS,
      items: {
        type: 'object',
        properties: {
          do: { type: 'string', enum: [...EDIT_STEP_KINDS] },
          clip: { type: 'string' },
          keep: { type: 'string', enum: [...KEEP_PARTS] },
          seconds: { type: 'number' },
          from: { type: 'number' },
          to: {},
          at: { type: 'number' },
          target: { type: 'string' },
          volume: { type: 'number' },
          muted: { type: 'boolean' },
          remove: { type: 'boolean' },
          text: { type: 'string' },
          where: {},
          position: { type: 'string', enum: [...CAPTION_POSITIONS] },
          size: { type: 'string', enum: [...CAPTION_SIZES] },
          caption: { type: 'string' },
          aspect: { type: 'string', enum: [...COMPOSE_ASPECTS] },
          preset: { type: 'string', enum: ['off', ...COMPOSE_COLOR_PRESET_IDS] },
          strength: { type: 'number' },
          protect: { type: 'array', items: { type: 'string' } },
          secondsPerClip: { type: 'number' },
        },
        required: ['do'],
      },
    },
    about: { type: 'string', enum: [...ASK_ABOUT] },
    choices: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' } },
    reason: { type: 'string', enum: [...CANNOT_REASONS] },
  },
  required: ['kind'],
};

function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner !== null) out[key] = withoutNulls(inner);
  }
  return out;
}

/**
 * A flat answer schema lets a model fill fields that belong to another kind with `null` or `[]`.
 * Those carry nothing, so they are dropped before validation; any other unknown key still fails.
 */
function tidyModelReply(raw: unknown): unknown {
  const tidy = withoutNulls(raw);
  if (!tidy || typeof tidy !== 'object' || Array.isArray(tidy)) return tidy;
  const reply = { ...(tidy as Record<string, unknown>) };
  for (const key of ['steps', 'choices'] as const) {
    if (Array.isArray(reply[key]) && (reply[key] as unknown[]).length === 0) delete reply[key];
  }
  return reply;
}

/** Short machine descriptions of what failed, for the one corrective model call (never shown). */
function schemaProblems(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.map(String).join('.') || 'reply';
    return `schema ${path}: ${issue.message.slice(0, 80)}`;
  });
}

export function parseEditPlan(raw: unknown): { ok: true; plan: EditPlan } | { ok: false; problems: string[] } {
  const parsed = EditPlanSchema.safeParse(tidyModelReply(raw));
  if (parsed.success) return { ok: true, plan: parsed.data };
  return { ok: false, problems: schemaProblems(parsed.error) };
}
