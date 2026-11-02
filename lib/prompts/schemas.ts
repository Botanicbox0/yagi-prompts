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
 * The models a prompt may name (founder direction, 2026-08-15: "seedance2.5랑 seedance2.0 둘 다
 * 체크하고 싶으면 어떻게 해?").
 *
 * A LIST, because the honest answer to "which model made this" is often more than one: the same
 * brief run on 2.5 and on 2.0, or a clip whose audio came from somewhere else. §13.3-3's single chip
 * was a constant on the card rather than a fact about the row, so two prompts made with different
 * models advertised the same one.
 *
 * The vocabulary lives HERE and nowhere else — not in SQL (model names change monthly and a CHECK
 * would turn "the founder used something new" into a migration) and not in the dictionaries (these
 * are proper nouns with fixed capitalisation, identical in both locales, exactly like the platform
 * chips in `lib/contests/schemas.ts`). Adding one is a line in this array.
 */
export const PROMPT_MODELS = [
  { id: 'seedance-2.5', label: 'SEEDANCE 2.5' },
  { id: 'seedance-2.0', label: 'SEEDANCE 2.0' },
  { id: 'kling-3.0', label: 'KLING 3.0' },
  { id: 'sora-2', label: 'SORA 2' },
  { id: 'veo-3', label: 'VEO 3' },
  { id: 'higgsfield', label: 'HIGGSFIELD' },
  { id: 'nano-banana-pro', label: 'NANO BANANA PRO' },
  { id: 'nano-banana-2', label: 'NANO BANANA 2' },
  { id: 'gpt-image-2', label: 'GPT IMAGE 2' },
  { id: 'seedream-5.0-pro', label: 'SEEDREAM 5.0 PRO' },
] as const;

export type PromptModelId = (typeof PROMPT_MODELS)[number]['id'];
export const PROMPT_MODEL_IDS = PROMPT_MODELS.map((model) => model.id) as readonly PromptModelId[];

/** Four is what fits on the narrowest card; the DB CHECK holds the same bound. */
export const MODELS_MIN = 1;
export const MODELS_MAX = 4;

/**
 * id → chip text, with an UNKNOWN id rendered rather than dropped.
 *
 * A row written before this vocabulary existed (or by a future admin who typed a new name into the
 * database) still has to render. Hiding it would make the card lie by omission, so an unrecognised
 * id is shown as itself, upper-cased — which reads as a model name because that is what it is.
 */
export function promptModelLabel(id: string): string {
  return PROMPT_MODELS.find((model) => model.id === id)?.label ?? id.replace(/-/g, ' ').toUpperCase();
}

export function isPromptModel(value: unknown): value is PromptModelId {
  return typeof value === 'string' && (PROMPT_MODEL_IDS as readonly string[]).includes(value);
}

/** Repeated checkboxes → a de-duplicated, order-preserving list. */
export const ModelList = z
  .array(z.string().trim().min(1).max(60))
  .transform((values) => [...new Set(values)])
  .refine((values) => values.length >= MODELS_MIN, { error: 'pick at least one model' })
  .refine((values) => values.length <= MODELS_MAX, {
    error: `pick at most ${MODELS_MAX} models`,
  });

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

/**
 * docs/TEMPLATES-IA.md — what a template PRODUCES. The catalogue's first split (VIDEO · IMAGE), the
 * two nav tabs, and the one field that decides whether a runtime makes sense.
 */
export const TEMPLATE_MEDIA = ['video', 'image'] as const;
export type TemplateMedium = (typeof TEMPLATE_MEDIA)[number];

export const PROMPT_SOURCES = ['yagi', 'community'] as const;
export type PromptSource = (typeof PROMPT_SOURCES)[number];

export const PROMPT_STATUSES = ['pending', 'published', 'rejected', 'archived'] as const;
export type PromptStatus = (typeof PROMPT_STATUSES)[number];

// ---------------------------------------------------------------------------
// caps (§13.1 moderation limits)
// ---------------------------------------------------------------------------

/**
 * How long a prompt may be. Raised TWICE on 2026-08-15, and the second time is the interesting one.
 *
 * §13.1 wrote "text ≤ 2,000 chars" when a prompt was a paragraph. The founder's 1994 ENG segment
 * brief was 4,853 characters and was refused, so the cap went to 12,000 — "comfortably above a full
 * multi-scene brief", said the comment. Four hours later the next brief arrived: a 30-second teen
 * reel with timecoded beats, three wardrobe specs, six camera angles and a 200-item negative
 * prompt. 15,540 characters.
 *
 * The lesson is not the number. It is that a cap chosen by imagining the artefact keeps landing
 * under the real one, so this bound stops being a judgement about what a prompt SHOULD be: 40,000
 * exists to refuse a paste-bomb, and nothing else. It is 40KB of text against a `text` column with
 * no limit of its own, rendered into a `<pre>` that already scrolls. The abuse control on community
 * submissions was never the length anyway — it is 3/day/user plus human review.
 */
export const PROMPT_TEXT_MAX = 40000;
export const PROMPT_TEXT_MIN = 10;

/**
 * One definition for every path that takes prompt text — submission, admin authoring, admin edit.
 * The bug was not the number alone: authoring silently inherited a limit written for community
 * moderation, and three separate `.max(...)` calls made that look like three decisions.
 *
 * The messages are explicit because they are what the founder reads at 2am. Zod's default names the
 * limit, but the admin banner shows this string with no field context around it, so it says what
 * the field is and what the bound is.
 */
export const PromptTextSchema = z
  .string()
  .trim()
  .min(PROMPT_TEXT_MIN, `prompt must be at least ${PROMPT_TEXT_MIN} characters`)
  .max(PROMPT_TEXT_MAX, `prompt must be ${PROMPT_TEXT_MAX.toLocaleString('en-US')} characters or fewer`);
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
/**
 * "video ≤ 60s/32MB" (§13.1) → 48MB on 2026-08-15, and the number is set by STORAGE, not taste.
 *
 * Chasing one 57.7MB export uncovered three ceilings stacked behind each other, only one of which
 * was ours:
 *   1. Vercel refuses a serverless request body over ~4.5MB — fixed by uploading direct to storage;
 *   2. this constant, then 32MB — raised;
 *   3. **Supabase Storage refuses a single object over 50MB on the free plan** — a hard stop that
 *      no code change reaches, and the one that actually decided the answer.
 *
 * So the cap sits just under (3). A limit ABOVE what storage will accept is worse than a low one:
 * it lets the founder wait through a full upload and then fail with a storage error instead of our
 * own message. If the project moves to a plan (or a bucket) with a higher object limit, raise this
 * with it.
 *
 * Worth restating anyway: this clip is what the gallery card PLAYS on hover, so its size is paid by
 * every visitor who points at the card. A 30-second hover loop wants to be ~10MB — the founder's
 * 57.7MB master re-encodes to 11.1MB at 1080p with no visible difference at card size.
 */
export const VIDEO_MAX_BYTES = 48 * 1024 * 1024;
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
 *
 * `gallery` (2026-10-27, the five-shot bridal set): a SET template's example frames, one per frame it
 * makes, in set order. Public like the poster, shown on the template page only — never on a card,
 * and never a form field: it arrives with the set (lib/prompts/image-templates.ts) and every later
 * `/admin` edit carries it through `publishPromptMedia` unchanged.
 */
export const PROMPT_GALLERY_MAX = 6;

/** A set's frames: a recipe caps at six steps, the gallery at six images. */
export const IMAGE_SET_FRAMES_MIN = 2;
export const IMAGE_SET_FRAMES_MAX = PROMPT_GALLERY_MAX;
const SET_PHOTO = /\bImage 1\b/;
const SET_OTHER_REFERENCE = /\b(?:Image [2-9]\d*|Image 1\d+|Video \d+|Audio \d+)\b/;
export type SetPromptIssue = 'no_photo' | 'other_reference' | 'braces';
/**
 * The admin form's prompts come from tools that write the photo `@image1`; the set's own word is
 * "Image 1". Handles of other references become words too, so the check below refuses them by name.
 */
export function normalizeSetPrompt(prompt: string): string {
  return prompt
    .replace(/@(image|video|audio)[ _]?(\d+)\b/gi, (_, kind: string, n: string) => `${kind[0]!.toUpperCase()}${kind.slice(1).toLowerCase()} ${n}`)
    .replace(/\bimage[ _]?1\b/gi, 'Image 1');
}
/** What a set frame's prompt may say about references: the buyer's photo as "Image 1", nothing else. */
export function setPromptIssue(prompt: string): SetPromptIssue | null {
  if (!SET_PHOTO.test(prompt)) return 'no_photo';
  if (SET_OTHER_REFERENCE.test(prompt)) return 'other_reference';
  if (/\{\{|\}\}/.test(prompt)) return 'braces';
  return null;
}

export const PromptMediaSchema = z.object({
  video: AssetRefSchema.optional(),
  poster: AssetRefSchema.optional(),
  /** The admin wall's 1:1 crop. `catch`: a bad value must not fail the parse and lose the media. */
  posterFocus: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).optional().catch(undefined),
  audio: AssetRefSchema.optional(),
  gallery: z.array(AssetRefSchema).min(1).max(PROMPT_GALLERY_MAX).optional(),
});
export type PromptMedia = z.infer<typeof PromptMediaSchema>;

export const MEDIA_KINDS = ['poster', 'video', 'audio'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * What the browser reports after uploading DIRECTLY to storage (2026-08-15).
 *
 * Vercel refuses a request body over ~4.5MB, so a real video can never be posted through the admin
 * door; it goes browser → storage, and the form carries this receipt instead of the bytes.
 *
 * The `key` pattern is the security boundary and is deliberately narrow: only the direct-upload
 * namespace, only a uuid filename, only an extension. A caller therefore cannot name an object it
 * did not just create — the server minted this exact key one request earlier — which is what stops
 * "attach an arbitrary staging object to my prompt" from being a request anyone can make.
 *
 * `sha256` is the client's digest and is TRUSTED, with eyes open: this surface is admin-only, and a
 * wrong digest can only mis-name the content-addressed public copy (a dedup miss), never expose a
 * byte. Re-hashing server-side would mean pulling the whole file back through the function, which
 * is the transfer this design exists to avoid.
 */
export const STAGED_KEY_PATTERN = /^content\/prompt\/upload\/[0-9a-f-]{36}\.[A-Za-z0-9]{1,8}$/;

export const StagedUploadSchema = z.object({
  key: z.string().trim().regex(STAGED_KEY_PATTERN, 'not a staged upload key'),
  sha256: z.string().trim().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex characters'),
  mime: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative(),
});
export type StagedUpload = z.infer<typeof StagedUploadSchema>;

/** `null` for anything malformed — the caller falls back to the inline file, never to a guess. */
export function parseStagedUpload(raw: unknown): StagedUpload | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StagedUploadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

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
  promptText: PromptTextSchema,
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
  promptText: PromptTextSchema,
  processMd: ProcessSchema,
  processMdKo: ProcessSchema,
  sourceUrl: SourceUrlSchema,
  useCase: UseCaseList,
  textVisibility: VisibilityEnum,
  featured: z.boolean(),
  models: ModelList,
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
  promptText: PromptTextSchema,
  processMd: ProcessSchema,
  processMdKo: ProcessSchema,
  sourceUrl: SourceUrlSchema,
  useCase: UseCaseList,
  handle: z.string().max(PROMPT_HANDLE_MAX).nullable(),
  textVisibility: VisibilityEnum,
  featured: z.boolean(),
  /** Editable after the fact (2026-08-15) — the second model is usually discovered later. */
  models: ModelList,
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
