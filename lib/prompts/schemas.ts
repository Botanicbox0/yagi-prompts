import { z } from 'zod';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { VISIBILITY_ORDER, type Visibility } from '@/lib/content/visibility';

/**
 * PLAN §13.1 — the prompt content contracts.
 *
 * Same doctrine as `lib/content/schemas.ts` (§6.1): these schemas are the SINGLE source — the
 * submission form fields, the admin authoring fields, the renderer props and the moderation
 * validation all derive from here, and nothing downstream invents a field.
 *
 * The one structural difference from blocks: a prompt has no revision, so an AssetRef here is
 * keyed on the PROMPT id rather than a revision id (`content/prompt/{id}/{uuid}.{ext}`). The
 * lifecycle is otherwise identical — private staging, content-addressed public copy at
 * publish/approve, `upsert:false`.
 */

// ---------------------------------------------------------------------------
// vocabulary (§13.3 — locked defaults)
// ---------------------------------------------------------------------------

/** §13.3-3: "Single model chip SEEDANCE 2.5 (schema keeps `model` text for later)." */
export const DEFAULT_PROMPT_MODEL = 'seedance-2.5';
export const PROMPT_MODEL_LABEL = 'SEEDANCE 2.5';

/**
 * The use-case vocabulary: eight, fixed, bilingual at the UI layer.
 *
 * Small on purpose. A free-text tag field on a community submission is a moderation queue that
 * grows forever and a filter rail that never converges; eight chips cover what Seedance is used
 * for and can be extended by a migration when the tenth one earns its place.
 */
export const USE_CASES = [
  'cinematic',
  'short-film',
  'mv',
  'vlog',
  'brand-ad',
  'ugc',
  'tutorial',
  'game',
] as const;
export type UseCase = (typeof USE_CASES)[number];

export function isUseCase(value: unknown): value is UseCase {
  return typeof value === 'string' && (USE_CASES as readonly string[]).includes(value);
}

export const PROMPT_SOURCES = ['yagi', 'community'] as const;
export type PromptSource = (typeof PROMPT_SOURCES)[number];

export const PROMPT_STATUSES = ['pending', 'published', 'rejected', 'archived'] as const;
export type PromptStatus = (typeof PROMPT_STATUSES)[number];

// ---------------------------------------------------------------------------
// caps (§13.1 moderation limits)
// ---------------------------------------------------------------------------

/** "text ≤ 2,000 chars" — enforced by zod at the server boundary, not by a maxlength attribute. */
export const PROMPT_TEXT_MAX = 2000;
/**
 * The "how it was made" write-up (founder direction, 2026-08-14). Ten times the prompt's own cap,
 * because this is where the references, the failed passes and the settings go — a Notion page's
 * worth — while still being a bound a moderator can read in one sitting.
 */
export const PROCESS_MAX = 20000;
/**
 * Empty textarea → NULL, never an empty string: "no write-up" is an absence, not blank content.
 * `nullish` so an ABSENT field reads the same as an empty one — a form that predates this field
 * (or a caller that never had one) is a prompt without a making-of, not an invalid payload.
 */
export const ProcessSchema = z
  .string()
  .trim()
  .max(PROCESS_MAX)
  .transform((value) => (value === '' ? null : value))
  .nullish()
  .transform((value) => value ?? null);

/**
 * Where the creator already posted it (founder direction, 2026-08-15) — the EASY submission path:
 * paste your Instagram/TikTok/YouTube link instead of re-exporting and uploading a file.
 *
 * `http(s)` only, matched by the same rule the DB CHECK enforces, because this value is rendered as
 * an anchor: a `javascript:` or `data:` URL in an href is the one way a submitted string could
 * become code. Blank → null, so an untouched field is an absence rather than an invalid URL.
 */
export const SOURCE_URL_MAX = 500;
export const SourceUrlSchema = z
  .string()
  .trim()
  .max(SOURCE_URL_MAX)
  .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), 'must start with http:// or https://')
  .transform((value) => (value === '' ? null : value))
  .nullish()
  .transform((value) => value ?? null);
export const PROMPT_TITLE_MAX = 160;
export const PROMPT_HANDLE_MAX = 40;
/** "video ≤ 60s/32MB". Size is measured over the received bytes; see `lib/prompts/media.ts`. */
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;
export const VIDEO_MAX_SECONDS = 60;
/** Founder direction (2026-08-13): audio results are uploadable and freely downloadable. */
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** "Rate limit 3 submissions/day/user" — the 4th inside 24h is refused. */
export const SUBMISSIONS_PER_DAY = 3;
export const RATE_WINDOW_HOURS = 24;
/** At least one chip so the filter rail means something; three keeps a card readable. */
export const USE_CASE_MIN = 1;
export const USE_CASE_MAX = 3;

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

/**
 * §13.1: `media jsonb` — `{ video?: AssetRef, poster?: AssetRef, audio?: AssetRef }`.
 *
 * All optional at the schema level because §13.3-4 makes community media optional entirely; the
 * *authoring* schema below is what makes it required for YAGI items, which is where the rule
 * belongs (it is an editorial standard, not a data-integrity one). `audio` (founder direction,
 * 2026-08-13) is the result of a music/voice prompt — public like the poster and the clip, and
 * additionally offered as a plain DOWNLOAD on the detail page.
 */
export const PromptMediaSchema = z.object({
  video: AssetRefSchema.optional(),
  poster: AssetRefSchema.optional(),
  audio: AssetRefSchema.optional(),
});
export type PromptMedia = z.infer<typeof PromptMediaSchema>;

export const MEDIA_KINDS = ['poster', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** `null`/absent jsonb is "no media", never a parse failure — most community items have none. */
export function parsePromptMedia(value: unknown): PromptMedia {
  if (value === null || value === undefined) return {};
  const parsed = PromptMediaSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function mediaEntries(media: PromptMedia): Array<[MediaKind, AssetRef]> {
  const out: Array<[MediaKind, AssetRef]> = [];
  if (media.poster) out.push(['poster', media.poster]);
  if (media.video) out.push(['video', media.video]);
  if (media.audio) out.push(['audio', media.audio]);
  return out;
}

// ---------------------------------------------------------------------------
// slugs
// ---------------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SlugSchema = z.string().regex(SLUG_PATTERN, 'slug must be lowercase words joined by hyphens').min(3).max(80);

/**
 * Title → slug candidate.
 *
 * Latin-only by design: a Korean title transliterates to nothing here and falls back to the
 * caller's suffix, which is honest — the admin edits the slug at approval time (§13.1 "admin
 * approves (may edit slug/tags/handle…)"), and a mojibake URL is worse than a generated one.
 */
export function slugify(title: string, fallback: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : fallback;
}

/** `@handle`, normalised: no leading @, no spaces, lowercase. Empty ⇒ null (fall back to a mark). */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, PROMPT_HANDLE_MAX);
  return value.length === 0 ? null : value.toLowerCase();
}

// ---------------------------------------------------------------------------
// submission (§13.1 — the community form)
// ---------------------------------------------------------------------------

const UseCaseList = z
  .array(z.enum(USE_CASES))
  .min(USE_CASE_MIN, 'pick at least one use case')
  .max(USE_CASE_MAX, `pick at most ${USE_CASE_MAX} use cases`)
  // A form can post the same checkbox twice; the column is a set, not a bag.
  .transform((values) => [...new Set(values)]);

export const SubmissionSchema = z.object({
  title: z.string().trim().min(3).max(PROMPT_TITLE_MAX),
  promptText: z
    .string()
    .trim()
    .min(10)
    .max(PROMPT_TEXT_MAX, `prompt must be ${PROMPT_TEXT_MAX} characters or fewer`),
  /** The optional making-of, in whichever language the submitter writes (2026-08-14). */
  processMd: ProcessSchema,
  /** The easy path (2026-08-15): a link to their own post, instead of an upload. */
  sourceUrl: SourceUrlSchema,
  useCase: UseCaseList,
  handle: z.string().max(PROMPT_HANDLE_MAX).nullable(),
  /**
   * §13.1: "consent checkbox (display license line)". `literal(true)` rather than a boolean:
   * an unchecked box posts nothing, and "absent" must fail the same way "false" does.
   */
  consent: z.literal(true, 'the display licence must be accepted'),
});
export type SubmissionInput = z.infer<typeof SubmissionSchema>;

// ---------------------------------------------------------------------------
// admin authoring + moderation (§13.1 / F)
// ---------------------------------------------------------------------------

const VisibilityEnum = z.enum(VISIBILITY_ORDER);

/**
 * YAGI authoring. §13.3-2: text defaults to `pro`; a `public` teaser is a deliberate admin choice.
 * Media is REQUIRED here (§13.3-4) and `title_ko` with it — a YAGI card that cannot render in
 * Korean is not publishable on a bilingual site.
 *
 * The slug is OPTIONAL (founder direction, 2026-08-14): left blank it derives from the EN title
 * (`slugify`), which is what the founder actually wants every time — the URL should simply
 * follow the title with hyphens. A typed slug still validates against `SlugSchema`; the derive
 * happens in the operation, where the collision-avoidance suffix lives.
 */
export const AuthoringSchema = z.object({
  slug: z
    .literal('')
    .transform(() => null)
    .or(SlugSchema)
    .nullable(),
  title: z.string().trim().min(3).max(PROMPT_TITLE_MAX),
  titleKo: z.string().trim().min(1).max(PROMPT_TITLE_MAX),
  promptText: z.string().trim().min(10).max(PROMPT_TEXT_MAX),
  processMd: ProcessSchema,
  processMdKo: ProcessSchema,
  sourceUrl: SourceUrlSchema,
  useCase: UseCaseList,
  textVisibility: VisibilityEnum,
  featured: z.boolean(),
  model: z.string().trim().min(1).max(60),
});
export type AuthoringInput = z.infer<typeof AuthoringSchema>;

/** Approval of a community submission: editable slug/handle/use-case/featured, text stays public. */
export const ApprovalSchema = z.object({
  id: z.string().uuid(),
  slug: SlugSchema,
  handle: z.string().max(PROMPT_HANDLE_MAX).nullable(),
  useCase: UseCaseList,
  featured: z.boolean(),
});
export type ApprovalInput = z.infer<typeof ApprovalSchema>;

export const RejectionSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(400),
});
export type RejectionInput = z.infer<typeof RejectionSchema>;

/** Edit-in-place on a published item (§13.1 — "no revisions"). */
export const EditSchema = z.object({
  id: z.string().uuid(),
  slug: SlugSchema,
  title: z.string().trim().min(3).max(PROMPT_TITLE_MAX),
  titleKo: z.string().trim().max(PROMPT_TITLE_MAX).nullable(),
  promptText: z.string().trim().min(10).max(PROMPT_TEXT_MAX),
  processMd: ProcessSchema,
  processMdKo: ProcessSchema,
  sourceUrl: SourceUrlSchema,
  useCase: UseCaseList,
  handle: z.string().max(PROMPT_HANDLE_MAX).nullable(),
  textVisibility: VisibilityEnum,
  featured: z.boolean(),
});
export type EditInput = z.infer<typeof EditSchema>;

/**
 * The one place the community/pro rule is applied to a payload.
 *
 * The DB CHECK (`prompt_items_community_text_public`) is the backstop; this is the gate, so an
 * admin gets a validation message rather than a raw constraint name.
 */
export function effectiveTextVisibility(source: PromptSource, requested: Visibility): Visibility {
  return source === 'community' ? 'public' : requested;
}
