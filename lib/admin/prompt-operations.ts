import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { checkUpload, publishPromptMedia, stagePromptUpload } from '@/lib/prompts/media';
import { parsePosterFocus } from '@/lib/prompts/poster-focus';
import { AssetRefSchema, type AssetRef } from '@/lib/content/schemas';
import { STAGING_BUCKET } from '@/lib/storage';
import { KEYFRAMES_MAX, MARKS_PER_PART_MAX, VideoKeyframesSchema, VideoMarksSchema, parseVideoKeyframes, splitKeyframes } from '@/lib/prompts/keyframes';
import { declaredPartKeysOfPrompt } from '@/lib/template-director/parts-view';
import {
  approvePrompt,
  insertPrompt,
  loadPromptById,
  loadPromptLook,
  promptLookSchemaReady,
  setPromptLook,
  rejectPrompt,
  setPromptArchived,
  setPromptFeatured,
  setPromptTextVisibility,
  updatePrompt,
  updatePromptMedia,
  type PromptRow,
} from '@/lib/prompts/repo';
import {
  ApprovalSchema,
  AuthoringSchema,
  DEFAULT_PROMPT_MODEL,
  EditSchema,
  IMAGE_SET_FRAMES_MAX,
  IMAGE_SET_FRAMES_MIN,
  MEDIA_KINDS,
  PROMPT_TEXT_MIN,
  PROMPT_TITLE_MAX,
  RejectionSchema,
  TEMPLATE_CASTS,
  TEMPLATE_MEDIA,
  USE_CASES,
  USE_CASE_MAX,
  effectiveTextVisibility,
  normalizeHandle,
  normalizeSetPrompt,
  parsePromptMedia,
  parseStagedUpload,
  slugify,
  toTemplateCast,
  type PromptMedia,
  type TemplateCast,
} from '@/lib/prompts/schemas';
import { ADMIN_PROMPTS_PATH, adminPromptPath } from '@/lib/prompts/links';
import { announceTemplate, markPromptAnnounced } from '@/lib/prompts/announce';
import { buildImageTemplateSet, writeImageTemplateSet } from '@/lib/prompts/image-templates';
import { aspectsForMedium, enginesForMedium, imageFitsAspect, isImageAspect, isImageEngine, type ImageAspect, type ImageEngineId } from '@/lib/images/engines';
import { personalMagi2Open } from '@/lib/flags';
import { is1080pOnlyTemplate } from '@/lib/twings/resolution';
import { checkLockBlock, lockBlockRefusalDetail } from '@/lib/template-director/locks';
import { checkStylingBlock, stylingBlockRefusalDetail, stylingRequiredDetail } from '@/lib/template-director/styling';
import { planStylingDeclaration, templateCardStyling } from '@/lib/template-director/compile-prompts';
import { recipeSchemaReady } from '@/lib/recipes/repo';
import { TEMPLATE_AUDIENCES, type TemplateAudience } from '@/lib/template-look/look';
import { promptLengthRefusal, promptLengthUpdateRefusal, type TemplateLengthInput } from '@/lib/prompts/prompt-length';
import { fail, ok, type AdminContext, type AdminOutcome } from './context';
import * as f from './form';
import type { AdminOperation, ParseResult } from './operations';

/**
 * PLAN §13.2/F — the moderation + authoring operations, registered in the M4 dispatcher.
 *
 * They live in their own module but in the SAME registry, on purpose: `tests/admin/auth.test.ts`
 * enumerates `ADMIN_OPERATIONS` and refuses every entry for a non-admin, so an operation added here
 * is covered by the security acceptance the moment it exists. That property was the whole reason
 * M4 built a registry behind one guarded dispatcher instead of twenty server actions, and §13 is
 * the first milestone to actually collect on it.
 *
 * Division of labour is unchanged: zod validates the §13.1 payloads at this boundary, the DATABASE
 * owns uniqueness and the community-text-is-public rule (CHECK constraints), and rejections are
 * classified in `errors.ts`.
 */

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, detail: issues(result.error) };
}

/**
 * The model checkboxes (2026-08-15). Unlike `useCase` this is NOT filtered to a vocabulary: the
 * list in `lib/prompts/schemas.ts` is what the form OFFERS, and a value outside it is a model we
 * have not heard of yet rather than an error. Empty → the default, so a form that predates the
 * field still creates a valid row.
 */
function models(form: FormData): string[] {
  const picked = form
    .getAll('models')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  return picked.length > 0 ? picked : [DEFAULT_PROMPT_MODEL];
}

/** Repeated checkbox values, filtered to the §13.1 vocabulary. */
function chips(form: FormData, name: string): string[] {
  const allowed = new Set<string>(USE_CASES);
  return form
    .getAll(name)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => allowed.has(value));
}

/**
 * docs/TEMPLATES-IA.md — the three fields that make a prompt item a sellable template. Parsed on
 * their own so the authoring and edit schemas stay what §13 pinned; whole USD cents, and a runtime
 * only for a film (the 0015 CHECK refuses one on an image, so it is dropped here rather than sent).
 */
const TemplateFieldsShape = z.object({
  medium: z.enum(TEMPLATE_MEDIA),
  /** docs/CAST-CATEGORIES.md §1 — who is in it. Absent (a form without the field) = unchanged / solo. */
  cast: z.enum(TEMPLATE_CASTS).optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  /** The fixed won price (0018); 0 = suggested from the dollar price. */
  priceKrw: z.number().int().min(0).max(100_000_000),
  /** The 1080p price (0039), films only; 0 = 1080p not offered. Both currencies or neither. */
  price1080Cents: z.number().int().min(0).max(1_000_000),
  price1080Krw: z.number().int().min(0).max(100_000_000),
  runtimeSeconds: z.number().int().positive().max(600).nullable(),
  /** docs/TEMPLATES-IA.md §7 — null = the medium's default; a named engine must be one of its medium's. */
  engine: z.string().nullable(),
  aspectDefault: z.string().nullable(),
  /**
   * docs/PERSONAL-STUDIO.md §3.4.10 — who the template is written for ("대상: 누구나 / 여성 스타일 / 남성 스타일").
   * Absent (a form without the select: 0190 not applied, or an older open tab) = unchanged / for anyone.
   */
  look: z.enum(TEMPLATE_AUDIENCES).optional(),
});

function templateFieldsSchema(storedEngine?: string | null) {
  return TemplateFieldsShape.superRefine((value, ctx) => {
    const allowed = enginesForMedium(value.medium, { includeMagi2: personalMagi2Open() }) as readonly string[];
    // Keeping the row's engine is allowed only for an engine of this medium that is merely switched
    // off; a stored value that was never valid for the medium is refused, as it always was.
    const everValid = enginesForMedium(value.medium, { includeMagi2: true }) as readonly string[];
    const keepingStored =
      storedEngine !== undefined && storedEngine !== null && value.engine === storedEngine && everValid.includes(storedEngine);
    if (value.engine !== null && !allowed.includes(value.engine) && !keepingStored) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['engine'], message: `not a ${value.medium} engine` });
    }
    if (value.aspectDefault !== null && !(aspectsForMedium(value.medium) as readonly string[]).includes(value.aspectDefault)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['aspectDefault'], message: `not a ${value.medium} aspect` });
    }
    const hd = value.price1080Cents > 0 || value.price1080Krw > 0;
    if (hd && value.medium !== 'video') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price1080Cents'], message: 'a 1080p price is for films only' });
    }
    if (hd && value.medium === 'video' && is1080pOnlyTemplate({ medium: value.medium, engine: value.engine, runtimeSeconds: value.runtimeSeconds })) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['price1080Krw'],
        message: 'this engine already renders at 1080p only; leave the second 1080p price empty',
      });
      return;
    }
    if (hd && (value.price1080Cents <= 0 || value.price1080Krw <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price1080Krw'], message: 'set the 1080p price in both currencies, or neither' });
    }
    // 1080p costs the provider ~2.5× what 720p does; it can never sell for less than the default.
    if (hd && (value.price1080Cents < value.priceCents || (value.priceKrw > 0 && value.price1080Krw < value.priceKrw))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price1080Krw'], message: 'the 1080p price must be at least the base price' });
    }
  });
}

function templateFields(form: FormData, storedEngine?: string | null): ParseResult<z.infer<typeof TemplateFieldsShape>> {
  const medium = f.str(form, 'medium') || 'video';
  const runtime = f.optionalInt(form, 'runtimeSeconds');
  return parsed(templateFieldsSchema(storedEngine), {
    medium,
    cast: f.str(form, 'cast') || undefined,
    priceCents: f.optionalInt(form, 'priceCents') ?? 0,
    priceKrw: f.optionalInt(form, 'priceKrw') ?? 0,
    price1080Cents: medium === 'image' ? 0 : (f.optionalInt(form, 'price1080Cents') ?? 0),
    price1080Krw: medium === 'image' ? 0 : (f.optionalInt(form, 'price1080Krw') ?? 0),
    runtimeSeconds: medium === 'image' ? null : (runtime ?? null),
    engine: f.str(form, 'engine') || null,
    aspectDefault: f.str(form, 'aspectDefault') || null,
    look: f.str(form, 'look') || undefined,
  });
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — refuse a one-style label before anything is written when 0190 is missing (the form
 * only offers the select once it is applied, so this is an old tab or a hand-made post). `any` needs nothing.
 */
async function lookRefusal(ctx: AdminContext, look: TemplateAudience | undefined): Promise<string | null> {
  if (look === undefined || look === 'any') return null;
  return (await promptLookSchemaReady(ctx.sql)) ? null : 'look: the template style needs 0190_core_template_look applied first';
}

/** Write the label when it changed, with one `platform_audit` row (who, which template, from → to). */
async function saveLook(ctx: AdminContext, row: { id: string; slug: string }, before: TemplateAudience, look: TemplateAudience | undefined): Promise<void> {
  if (look === undefined || look === before) return;
  await setPromptLook(ctx.sql, row.id, look);
  if (ctx.viewer.userId) {
    await ctx.sql.query(
      'insert into platform_audit (actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5::jsonb)',
      [ctx.viewer.userId, row.id, 'prompt.look', 'admin_template_look', JSON.stringify({ slug: row.slug, from: before, to: look })],
    );
  }
}

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C3) — a `Template locks:` block that would lock everything (it does not parse) or
 * that would not be read at all (a mistyped header, lock lines with no header) is refused before anything is
 * written, with a detail that names the lines. A prompt with a valid block, or with none, saves exactly as before.
 */
function lockBlockRefusal(field: string, promptText: string): string | null {
  const check = checkLockBlock(promptText);
  if (check.state === 'malformed' || check.state === 'header_typo') return lockBlockRefusalDetail(field, check.problems);
  return stylingBlockRefusal(field, promptText);
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 — a `Template styling:` block that does not parse (it would claim nothing), or that
 * declares a part the lock block also names, is refused the same way, after the lock check. A prompt with a valid
 * block, or with none, saves exactly as before.
 */
function stylingBlockRefusal(field: string, promptText: string): string | null {
  const check = checkStylingBlock(promptText);
  return check.state === 'malformed' ? stylingBlockRefusalDetail(field, check.problems) : null;
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.9, rule 3 (founder, 2026-11-25: what a template does not specify follows the buyer's
 * photo) — a NEW person template, video or image, solo or couple, says how its hair and makeup are made: a prompt with
 * no `Template styling:` block is refused (`stylingRequired`). A pet template has no hair or makeup to declare. Only
 * creation asks: an update of a template saved without one is not refused (existing templates are declared one by one
 * after review; the edit form shows a warning line).
 */
function stylingRequiredRefusal(field: string, promptText: string, cast: TemplateCast | undefined): string | null {
  if (cast === 'pet') return null;
  return checkStylingBlock(promptText).state === 'none' ? stylingRequiredDetail(field) : null;
}

const Uuid = z.string().uuid();
const NOT_FOUND_DETAIL = 'the prompt this form points at no longer exists';

/** Every prompt mutation lands back on the moderation surface. */
const BACK = ADMIN_PROMPTS_PATH;

/**
 * Stage the posted files onto an existing media object.
 *
 * Absent file ⇒ keep whatever is already there (the same "leave empty to keep the staged file"
 * affordance the block forms have). A rejected file aborts the whole operation — a half-replaced
 * media object is worse than a refused save.
 */
async function applyUploads(
  ctx: AdminContext,
  promptId: string,
  form: FormData,
  existing: PromptMedia,
): Promise<{ ok: true; value: PromptMedia } | { ok: false; detail: string }> {
  const next: PromptMedia = { ...existing };
  for (const kind of MEDIA_KINDS) {
    /**
     * The DIRECT path first (2026-08-15): the browser already PUT the bytes to storage and the form
     * carries only a receipt. It has to be checked before the file input, because the client clears
     * that input once the direct upload succeeds — and a receipt for an object that is not actually
     * there must fail loudly rather than attach a broken ref to a published row.
     */
    const receipt = parseStagedUpload(f.str(form, `${kind}Ref`));
    if (receipt !== null) {
      const present = await ctx.storage.exists(STAGING_BUCKET, receipt.key);
      if (!present) return { ok: false, detail: `${kind}: upload_missing` };
      const rejection = checkUpload({
        kind,
        mime: receipt.mime,
        sizeBytes: receipt.size,
        durationSeconds: null,
      });
      if (rejection !== null) return { ok: false, detail: `${kind}: ${rejection}` };
      next[kind] = AssetRefSchema.parse({
        staging_key: receipt.key,
        sha256: receipt.sha256,
        mime: receipt.mime,
      });
      continue;
    }

    const file = f.file(form, kind);
    if (file === null) continue;
    const staged = await stagePromptUpload(ctx.storage, promptId, kind, file);
    if (!staged.ok) return { ok: false, detail: `${kind}: ${staged.reason}` };
    next[kind] = staged.value.ref;
  }
  // A new poster does not inherit the old crop unless the form sent one for it.
  const focus = parsePosterFocus(f.str(form, 'posterFocus'));
  if (focus) next.posterFocus = focus;
  else if (next.poster !== existing.poster) delete next.posterFocus;
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// YAGI authoring (§13.1 — media required, title_ko required, visibility default pro)
// ---------------------------------------------------------------------------

const createPrompt: AdminOperation<{ input: z.infer<typeof AuthoringSchema>; form: FormData }> = {
  parse(form) {
    const base = parsed(AuthoringSchema, {
      // Creation owns the URL. Ignore stale/manual slug inputs from older open tabs.
      slug: '',
      title: f.str(form, 'title'),
      titleKo: f.str(form, 'titleKo'),
      promptText: f.text(form, 'promptText'),
      processMd: f.text(form, 'processMd'),
      processMdKo: f.text(form, 'processMdKo'),
      sourceUrl: f.str(form, 'sourceUrl'),
      useCase: chips(form, 'useCase'),
      textVisibility: f.str(form, 'textVisibility') || 'pro',
      featured: f.bool(form, 'featured'),
      models: models(form),
    });
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const template = templateFields(form);
    if (!template.ok) return fail('invalid', template.detail);
    const locks = lockBlockRefusal('promptText', input.promptText);
    if (locks !== null) return fail('invalid', locks);
    const required = stylingRequiredRefusal('promptText', input.promptText, template.value.cast);
    if (required !== null) return fail('stylingRequired', required);
    const { look, ...fields } = template.value;
    // Founder 2026-11-25: a new template is live at once, so every Seedance 2.5 clip must fit (lib/prompts/prompt-length.ts).
    const length = promptLengthRefusal('promptText', { promptText: input.promptText, medium: fields.medium, engine: fields.engine, runtimeSeconds: fields.runtimeSeconds });
    if (length !== null) return fail('invalid', length);
    const lookRefused = await lookRefusal(ctx, look);
    if (lookRefused !== null) return fail('invalid', lookRefused);
    const id = randomUUID();
    const staged = await applyUploads(ctx, id, form, {});
    if (!staged.ok) return fail('upload', staged.detail);
    // §13.3-4: "YAGI media required". The poster is the card surface, so it is the required half;
    // the hover video is what makes the gallery move, and is strongly encouraged but optional.
    if (!staged.value.poster) {
      return fail('invalid', 'poster: a YAGI prompt needs a poster image');
    }

    // Founder direction (2026-09-26): creation always derives the URL from the EN title.
    // Existing addresses stay unchanged on edit. Collisions get a short
    // numeric suffix instead of a refusal — the founder is publishing, not naming database rows.
    // (Single-admin surface: the read-then-insert window is acceptable, and the unique index is
    // still the backstop underneath.)
    const slug = await freeSlug(ctx.sql, slugify(input.title, `prompt-${id.slice(0, 8)}`));

    const { media } = await publishPromptMedia(ctx.storage, staged.value);

    await insertPrompt(ctx.sql, {
      id,
      slug,
      source: 'yagi',
      authorId: null,
      authorHandle: null,
      status: 'published',
      models: input.models,
      title: input.title,
      titleKo: input.titleKo,
      promptText: input.promptText,
      processMd: input.processMd,
      processMdKo: input.processMdKo,
      sourceUrl: input.sourceUrl,
      textVisibility: effectiveTextVisibility('yagi', input.textVisibility),
      media,
      useCase: input.useCase,
      featured: input.featured,
      ...fields,
      publishedAt: 'now',
    });
    // A new row is born `any` (the column default); only another style is written, and audited.
    await saveLook(ctx, { id, slug }, 'any', look);

    ctx.revalidatePrompts?.();
    return ok('published', { detail: slug, to: BACK });
  },
};

// ---------------------------------------------------------------------------
// a studio image set (2026-11-01): the form version of `npm run templates:import`
// ---------------------------------------------------------------------------

const ImageSetForm = z.object({
  title: z.string().min(3).max(PROMPT_TITLE_MAX),
  titleKo: z.string().min(1).max(PROMPT_TITLE_MAX),
  engine: z.string().refine(isImageEngine, 'not an image engine'),
  aspect: z.string().refine(isImageAspect, 'not an image aspect'),
  prompts: z.array(z.string().min(PROMPT_TEXT_MIN)).min(IMAGE_SET_FRAMES_MIN).max(IMAGE_SET_FRAMES_MAX),
  thumbnail: z.number().int().min(0),
  useCase: z.array(z.string()).max(USE_CASE_MAX),
});

/** `frame{i}Size` is `WIDTHxHEIGHT`, measured in the browser when it encoded the image. */
function frameSize(form: FormData, index: number): { w: number; h: number } | null {
  const match = /^(\d{1,5})x(\d{1,5})$/.exec(f.str(form, `frame${index}Size`));
  return match ? { w: Number(match[1]), h: Number(match[2]) } : null;
}

/** One frame's image: a direct-upload receipt, or the file itself where there is no signing service. */
async function stageFrame(ctx: AdminContext, id: string, form: FormData, index: number): Promise<{ ok: true; ref: AssetRef } | { ok: false; detail: string }> {
  const label = `frame ${index + 1}`;
  const size = frameSize(form, index);
  if (size === null) return { ok: false, detail: `${label}: no image` };
  const receipt = parseStagedUpload(f.str(form, `frame${index}Ref`));
  if (receipt !== null) {
    if (!(await ctx.storage.exists(STAGING_BUCKET, receipt.key))) return { ok: false, detail: `${label}: upload_missing` };
    const rejection = checkUpload({ kind: 'poster', mime: receipt.mime, sizeBytes: receipt.size, durationSeconds: null });
    if (rejection !== null) return { ok: false, detail: `${label}: ${rejection}` };
    return { ok: true, ref: AssetRefSchema.parse({ staging_key: receipt.key, sha256: receipt.sha256, mime: receipt.mime, ...size }) };
  }
  const file = f.file(form, `frame${index}`);
  if (file === null) return { ok: false, detail: `${label}: no image` };
  const staged = await stagePromptUpload(ctx.storage, id, 'poster', file);
  if (!staged.ok) return { ok: false, detail: `${label}: ${staged.reason}` };
  return { ok: true, ref: { ...staged.value.ref, ...size } };
}

const createImageSet: AdminOperation<{ input: z.infer<typeof ImageSetForm>; form: FormData }> = {
  parse(form) {
    const count = f.optionalInt(form, 'frameCount') ?? 0;
    const base = parsed(ImageSetForm, {
      title: f.str(form, 'title'),
      titleKo: f.str(form, 'titleKo'),
      engine: f.str(form, 'engine'),
      aspect: f.str(form, 'aspect'),
      // Capped before the loop: the schema refuses too many, this only stops a silly form early.
      prompts: Array.from({ length: Math.min(Math.max(count, 0), IMAGE_SET_FRAMES_MAX + 1) }, (_, index) => f.text(form, `frame${index}Prompt`)),
      thumbnail: f.optionalInt(form, 'thumbnail') ?? 0,
      useCase: chips(form, 'useCase'),
    });
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const engine = input.engine as ImageEngineId;
    const aspect = input.aspect as ImageAspect;
    if (input.thumbnail >= input.prompts.length) return fail('invalid', 'thumbnail: not one of the frames');
    const fileName = (index: number) => `frame-${index}`;
    const frames = input.prompts.map((promptText, index) => ({
      key: `shot${index + 1}`, title: input.title, titleKo: input.titleKo, promptText: normalizeSetPrompt(promptText), engine, aspect, fileName: fileName(index),
    }));
    const slug = await freeSlug(ctx.sql, slugify(input.title, `set-${randomUUID().slice(0, 8)}`));
    const built = buildImageTemplateSet({ slug, title_en: input.title, title_ko: input.titleKo, thumbnail: fileName(input.thumbnail) }, frames);
    const validationErrors: string[] = [];
    if (!built.ok) validationErrors.push(...built.errors);

    for (let index = 0; index < frames.length; index += 1) {
      const size = frameSize(form, index);
      if (size !== null && !imageFitsAspect(size.w, size.h, aspect)) {
        validationErrors.push(`frame ${index + 1}: ${size.w}x${size.h} is not ${aspect}`);
      }
      // Each frame is a recipe step, and the set's prompt text is its first output step's (`legacyPromptText`), so
      // every step gets the C3 check.
      const locks = lockBlockRefusal(`frame ${index + 1}`, frames[index]!.promptText);
      if (locks !== null) validationErrors.push(locks);
    }
    if (validationErrors.length > 0 || !built.ok) return fail('invalid', validationErrors.join('; '));
    // Rule 3: every frame is a result step the compile reads with the buyer's photo, so each one declares its styling.
    const undeclared = frames.flatMap((frame, index) => stylingRequiredRefusal(`frame ${index + 1}`, frame.promptText, 'solo') ?? []);
    if (undeclared.length > 0) return fail('stylingRequired', undeclared.join('; '));

    const id = randomUUID();

    const staged = new Map<string, AssetRef>();
    for (let index = 0; index < frames.length; index += 1) {
      const frame = await stageFrame(ctx, id, form, index);
      if (!frame.ok) return fail('upload', frame.detail);
      staged.set(fileName(index), frame.ref);
    }

    await writeImageTemplateSet({ sql: ctx.sql, storage: ctx.storage }, id, built.set, staged, { useCase: input.useCase });
    ctx.revalidatePrompts?.();
    // The set starts at its base price; the template page's price fields are the next stop.
    return ok('published', { detail: slug, to: adminPromptPath(id) });
  },
};

/** The first of `base`, `base-2` … `base-9` that no prompt row holds yet. */
async function freeSlug(sql: AdminContext['sql'], base: string): Promise<string> {
  const { rows } = await sql.query<{ slug: string }>(
    `select slug from prompt_items where slug = $1 or slug like $2`,
    [base, `${base}-%`],
  );
  const taken = new Set(rows.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n <= 9; n += 1) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
  // Ten collisions on one title is a naming conversation, not a numbering one.
  return `${base}-${randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// moderation
// ---------------------------------------------------------------------------

const approve: AdminOperation<z.infer<typeof ApprovalSchema>> = {
  parse: (form) =>
    parsed(ApprovalSchema, {
      id: f.str(form, 'id'),
      slug: f.str(form, 'slug'),
      handle: f.str(form, 'handle') || null,
      useCase: chips(form, 'useCase'),
      featured: f.bool(form, 'featured'),
    }),
  async run(ctx, input) {
    const row = await loadPromptById(ctx.sql, input.id);
    if (row === null || row.audience === 'brand') return fail('notFound', NOT_FOUND_DETAIL);
    // Founder 2026-11-25: approving makes it live, so every Seedance 2.5 clip must fit (lib/prompts/prompt-length.ts).
    const length = promptLengthRefusal('promptText', await lengthSource(ctx.sql, row));
    if (length !== null) return fail('invalid', length);

    // §13.1 lifecycle: the copy to public keys happens at APPROVAL, which is the first moment the
    // bytes become marketing surface. Before that they sit in private staging, visible to admin
    // preview only — a rejected submission's video is never disclosed.
    const staged = parsePromptMedia(row.media);
    const { media } = await publishPromptMedia(ctx.storage, staged);
    await updatePromptMedia(ctx.sql, input.id, Object.keys(media).length === 0 ? null : media);

    const moved = await approvePrompt(ctx.sql, {
      id: input.id,
      slug: input.slug,
      authorHandle: normalizeHandle(input.handle),
      useCase: input.useCase,
      featured: input.featured,
    });
    if (!moved) return fail('notFound', 'only a pending or rejected submission can be approved');

    ctx.revalidatePrompts?.();
    return ok('approved', { detail: input.slug, to: BACK });
  },
};

const reject: AdminOperation<z.infer<typeof RejectionSchema>> = {
  parse: (form) => parsed(RejectionSchema, { id: f.str(form, 'id'), reason: f.text(form, 'reason') }),
  async run(ctx, input) {
    const moved = await rejectPrompt(ctx.sql, input.id, input.reason);
    if (!moved) return fail('notFound', 'only a pending submission can be rejected');
    // No revalidate: a rejected item was never visible, so nothing cached can be stale.
    return ok('rejected', { to: BACK });
  },
};

// ---------------------------------------------------------------------------
// published list: edit in place, feature, archive
// ---------------------------------------------------------------------------

const editPrompt: AdminOperation<{ input: z.infer<typeof EditSchema>; form: FormData }> = {
  parse(form) {
    const base = parsed(EditSchema, {
      id: f.str(form, 'id'),
      slug: f.str(form, 'slug'),
      title: f.str(form, 'title'),
      titleKo: f.str(form, 'titleKo') || null,
      promptText: f.text(form, 'promptText'),
      processMd: f.text(form, 'processMd'),
      processMdKo: f.text(form, 'processMdKo'),
      sourceUrl: f.str(form, 'sourceUrl'),
      useCase: chips(form, 'useCase'),
      handle: f.str(form, 'handle') || null,
      textVisibility: f.str(form, 'textVisibility') || 'public',
      featured: f.bool(form, 'featured'),
      models: models(form),
    });
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const row = await loadPromptById(ctx.sql, input.id);
    if (row === null || row.audience === 'brand') return fail('notFound', NOT_FOUND_DETAIL);
    const template = templateFields(form, row.engine);
    if (!template.ok) return fail('invalid', template.detail);
    const locks = lockBlockRefusal('promptText', input.promptText);
    if (locks !== null) return fail('invalid', locks);
    const { look, ...fields } = template.value;
    // Founder 2026-11-25: a text over a clip's limit is refused, unless it shortens a clip that was already over.
    const before = await lengthSource(ctx.sql, row);
    const length = promptLengthUpdateRefusal('promptText', before, { ...before, promptText: input.promptText, medium: fields.medium, engine: fields.engine, runtimeSeconds: fields.runtimeSeconds });
    if (length !== null) return fail('invalid', length);
    const lookRefused = await lookRefusal(ctx, look);
    if (lookRefused !== null) return fail('invalid', lookRefused);
    const lookBefore = look === undefined ? 'any' : (await loadPromptLook(ctx.sql, input.id)) ?? 'any';

    const staged = await applyUploads(ctx, input.id, form, parsePromptMedia(row.media));
    if (!staged.ok) return fail('upload', staged.detail);
    const { media } = await publishPromptMedia(ctx.storage, staged.value);
    await updatePromptMedia(ctx.sql, input.id, Object.keys(media).length === 0 ? null : media);

    const saved = await updatePrompt(ctx.sql, {
      id: input.id,
      slug: input.slug,
      title: input.title,
      titleKo: input.titleKo,
      models: input.models,
      promptText: input.promptText,
      processMd: input.processMd,
      processMdKo: input.processMdKo,
      sourceUrl: input.sourceUrl,
      useCase: input.useCase,
      authorHandle: normalizeHandle(input.handle),
      // The community rule is applied to the payload here and enforced by the CHECK underneath.
      textVisibility: effectiveTextVisibility(row.source, input.textVisibility),
      featured: input.featured,
      ...fields,
    });
    if (!saved) return fail('notFound', NOT_FOUND_DETAIL);
    await saveLook(ctx, { id: input.id, slug: input.slug }, lookBefore, look);

    ctx.revalidatePrompts?.();
    // No `to` (P2-8): update, feature and visibility are in-place edits, so the form's own `_back`
    // (the prompt page, or the list with its ?tab=) is where the operator should land.
    return ok('saved', { detail: input.slug });
  },
};

const Feature = z.object({ id: Uuid, featured: z.boolean() });

const feature: AdminOperation<z.infer<typeof Feature>> = {
  parse: (form) => parsed(Feature, { id: f.str(form, 'id'), featured: f.bool(form, 'featured') }),
  async run(ctx, input) {
    const changed = await setPromptFeatured(ctx.sql, input.id, input.featured);
    if (!changed) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidatePrompts?.();
    return ok('saved');
  },
};

const Visibility = z.object({ id: Uuid, textVisibility: z.enum(['public', 'pro']) });

/**
 * Founder direction (2026-08-13): "버튼 누르면 바로 보이게" — flipping a YAGI original between
 * pro and public is ONE press on the list, not a trip through the edit form. `hidden` stays a
 * deliberate form-level choice; this fast path only walks the two states presets live in.
 */
const visibility: AdminOperation<z.infer<typeof Visibility>> = {
  parse: (form) =>
    parsed(Visibility, { id: f.str(form, 'id'), textVisibility: f.str(form, 'textVisibility') }),
  async run(ctx, input) {
    const changed = await setPromptTextVisibility(ctx.sql, input.id, input.textVisibility);
    if (!changed) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidatePrompts?.();
    return ok('saved');
  },
};

const Archive = z.object({ id: Uuid, archived: z.boolean() });

const archive: AdminOperation<z.infer<typeof Archive>> = {
  parse: (form) => parsed(Archive, { id: f.str(form, 'id'), archived: f.bool(form, 'archived') }),
  async run(ctx, input) {
    if (!input.archived) {
      // Founder 2026-11-25: back on sale only when every Seedance 2.5 clip fits (lib/prompts/prompt-length.ts).
      const row = await loadPromptById(ctx.sql, input.id);
      if (row === null) return fail('notFound', NOT_FOUND_DETAIL);
      const length = promptLengthRefusal('promptText', await lengthSource(ctx.sql, row));
      if (length !== null) return fail('invalid', length);
    }
    const changed = await setPromptArchived(ctx.sql, input.id, input.archived);
    if (!changed) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidatePrompts?.();
    return ok(input.archived ? 'archived' : 'unarchived', { to: BACK });
  },
};

const Announce = z.object({ id: Uuid });

/**
 * The weekly drop's mail (founder, 2026-09-13). The stamp goes first and is the guard: a second
 * press, a retried request or a second operator finds `announced_at` set and is refused before a
 * single message leaves. The broadcast itself runs after the redirect.
 */
const announce: AdminOperation<z.infer<typeof Announce>> = {
  parse: (form) => parsed(Announce, { id: f.str(form, 'id') }),
  async run(ctx, input) {
    const row = await loadPromptById(ctx.sql, input.id);
    if (row === null || row.audience === 'brand') return fail('notFound', NOT_FOUND_DETAIL);
    if (row.status !== 'published') return fail('badTransition', `${row.status}: only a published template can be announced`);
    if (row.announcedAt !== null) return fail('badTransition', `already announced ${row.announcedAt}`);
    const stamped = await markPromptAnnounced(ctx.sql, input.id);
    if (!stamped) return fail('badTransition', 'already announced');
    const mail = ctx.mail;
    if (mail && ctx.defer) {
      ctx.defer(async () => {
        const result = await announceTemplate({ sql: ctx.sql, mailer: mail.mailer, siteUrl: mail.siteUrl }, row);
        console.info(`[prompts] announce ${row.slug}: recipients=${result.recipients} sent=${result.sent} failed=${result.failed}${result.skipped ? ` skipped=${result.skipped}` : ''}`);
      });
    }
    return ok('announced', { detail: row.slug, to: `${ADMIN_PROMPTS_PATH}/${row.id}` });
  },
};

// ---------------------------------------------------------------------------
// fixed parts: descriptions and ranges (docs/PERSONAL-STUDIO.md §3.4.4, T1a)
// ---------------------------------------------------------------------------

const Marks = z.object({ id: Uuid, marks: VideoMarksSchema });

/**
 * `prompt.marks` — the first admin writer of `prompt_items.keyframes`. The form posts the template's marks as JSON:
 * each names a part the template's STORED prompt declares (its `Template locks:` block, through `declaredPartKeys`),
 * with a range of the example video and a short ko/en description. The marks replace the row's marks; the beats it
 * already has stay. Refused, nothing is written: a part the prompt does not declare, more than two ranges for one
 * part, a range that ends before it starts or after the film, more than twelve entries with the beats, an image.
 * Audited (`platform_audit`) and the template pages re-read (tag `prompts`).
 */
const marks: AdminOperation<z.infer<typeof Marks>> = {
  parse(form) {
    let raw: unknown;
    try {
      raw = JSON.parse(f.text(form, 'marks') || '[]');
    } catch {
      return { ok: false, detail: 'marks: not JSON' };
    }
    return parsed(Marks, { id: f.str(form, 'id'), marks: raw });
  },
  async run(ctx, input) {
    const row = await loadPromptById(ctx.sql, input.id);
    if (row === null || row.audience === 'brand') return fail('notFound', NOT_FOUND_DETAIL);
    if (row.medium !== 'video') return fail('invalid', 'marks: only a film has ranges');
    // The parts the template page shows (§3.4.9 S2: the styling the compile honours, read like the catalogue card's).
    const source = await loadStylingSource(ctx.sql, row.id);
    const declared = declaredPartKeysOfPrompt(row.promptText, templateCardStyling({ promptText: row.promptText, ...source, cast: row.cast }));
    const undeclared = [...new Set(input.marks.map((m) => m.part).filter((part) => !declared.includes(part)))];
    if (undeclared.length > 0) {
      return fail('invalid', `marks: not declared by the template's prompt: ${undeclared.join(', ')}${declared.length ? ` (declared: ${declared.join(', ')})` : ' (it declares none)'}`);
    }
    for (const part of declared) {
      if (input.marks.filter((m) => m.part === part).length > MARKS_PER_PART_MAX) return fail('invalid', `marks: at most ${MARKS_PER_PART_MAX} ranges for ${part}`);
    }
    const runtime = row.runtimeSeconds ?? null;
    const bad = input.marks.find((m) => !(m.endSeconds > m.timeSeconds) || (runtime !== null && m.endSeconds > runtime));
    if (bad) return fail('invalid', `marks: ${bad.part} ${bad.timeSeconds}–${bad.endSeconds}s must end after it starts${runtime !== null ? ` and by ${runtime}s` : ''}`);

    const { rows } = await ctx.sql.query<{ keyframes: unknown }>(
      "select coalesce(to_jsonb(p.*)->'keyframes', 'null'::jsonb) as keyframes from prompt_items p where id = $1",
      [row.id],
    );
    const { beats } = splitKeyframes(parseVideoKeyframes(rows[0]?.keyframes ?? null) ?? []);
    const combined = [...beats, ...input.marks.map((m) => ({ ...m, labelKo: m.labelKo || undefined, labelEn: m.labelEn || undefined }))];
    if (combined.length > KEYFRAMES_MAX) return fail('invalid', `marks: ${beats.length} beats + ${input.marks.length} ranges is more than ${KEYFRAMES_MAX}`);
    const next = combined.length === 0 ? null : parseVideoKeyframes(combined);
    if (combined.length > 0 && next === null) return fail('invalid', 'marks: the keyframes would not read back');
    const checked = next === null ? null : VideoKeyframesSchema.parse(next);

    await ctx.sql.query('update prompt_items set keyframes = $2::jsonb where id = $1', [row.id, checked === null ? null : JSON.stringify(checked)]);
    if (ctx.viewer.userId) {
      await ctx.sql.query(
        'insert into platform_audit (actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5::jsonb)',
        [
          ctx.viewer.userId,
          row.id,
          'prompt.marks',
          'admin_template_marks',
          JSON.stringify({ slug: row.slug, marks: input.marks.length, beats: beats.length, parts: [...new Set(input.marks.map((m) => m.part))].sort() }),
        ],
      );
    }
    ctx.revalidatePrompts?.();
    return ok('saved', { detail: row.slug });
  },
};

// ---------------------------------------------------------------------------
// template styling: one declaration everywhere the compile reads (docs/PERSONAL-STUDIO.md §3.4.9, S2)
// ---------------------------------------------------------------------------

/** The saved row as the clip-length check reads it: its text, its recipe and the model it renders on. */
async function lengthSource(sql: AdminContext['sql'], row: PromptRow): Promise<TemplateLengthInput> {
  return { promptText: row.promptText, ...(await loadStylingSource(sql, row.id)), medium: row.medium, engine: row.engine, runtimeSeconds: row.runtimeSeconds };
}

/** The row's raw recipe and whether the render pass takes the recipe path at all (lib/template-director/compile-prompts.ts). */
async function loadStylingSource(sql: AdminContext['sql'], id: string): Promise<{ recipe: unknown; recipeReady: boolean }> {
  const { rows } = await sql.query<{ recipe: unknown }>("select to_jsonb(p.*)->'recipe' as recipe from prompt_items p where id = $1", [id]);
  return { recipe: rows[0]?.recipe ?? null, recipeReady: await recipeSchemaReady(sql) };
}

const DeclareStyling = z.object({ id: Uuid, block: z.string().max(2000) });

/**
 * `prompt.declareStyling` — writes one `Template styling:` block into the template's main prompt AND every prompt the
 * personal compile reads for it (a recipe's result steps; `prompt.update` edits the main text only), replacing a block
 * that is there or appending it as its own paragraph; an empty block removes it everywhere. Everything is checked
 * first (`planStylingDeclaration`: one valid block, every touched text reads it back with no part its own lock block
 * names, the lock blocks read as before, the recipe still passes, the card ends up showing it), then the row is
 * written in one transaction, audited (`platform_audit`) and the template pages re-read (tag `prompts`). Refused,
 * nothing is written. A creative's own format keeps its recipe (0059's contract): refused when the recipe would change.
 */
const declareStyling: AdminOperation<z.infer<typeof DeclareStyling>> = {
  parse: (form) => parsed(DeclareStyling, { id: f.str(form, 'id'), block: f.text(form, 'block') }),
  async run(ctx, input) {
    const outcome = await ctx.sql.transaction(async (tx): Promise<AdminOutcome | { slug: string; parts: { styled: string[]; photo: string[] } | null; texts: number; recipeChanged: boolean }> => {
      // The cast is the `cast_kind` column (0078; `cast` is a reserved word), read the way the catalogue reads it
      // (lib/prompts/repo.ts): absent before 0078 = solo.
      const { rows } = await tx.query<{ slug: string; audience: string; prompt_text: string; cast_kind: string | null; recipe: unknown; medium: string; engine: string | null; runtime_seconds: number | null }>(
        "select slug, audience::text as audience, prompt_text, coalesce(to_jsonb(p.*)->>'cast_kind', 'solo') as cast_kind, to_jsonb(p.*)->'recipe' as recipe, medium::text as medium, engine, runtime_seconds from prompt_items p where id = $1 for update",
        [input.id],
      );
      const row = rows[0];
      if (!row || row.audience === 'brand') return fail('notFound', NOT_FOUND_DETAIL);
      const cast = toTemplateCast(row.cast_kind);
      const recipeReady = await recipeSchemaReady(tx);
      const plan = planStylingDeclaration(
        { promptText: row.prompt_text, recipe: row.recipe, recipeReady, cast },
        input.block,
      );
      if (!plan.ok) return fail('invalid', `declareStyling: ${plan.detail}`);
      // Founder 2026-11-25: a block that pushes a Seedance 2.5 clip past 15,000 characters is refused (removing one is not).
      const engineOf = { medium: row.medium, engine: row.engine, runtimeSeconds: row.runtime_seconds };
      const length = promptLengthUpdateRefusal('block', { promptText: row.prompt_text, recipe: row.recipe, recipeReady, ...engineOf }, { promptText: plan.promptText, recipe: plan.recipe, recipeReady, ...engineOf });
      if (length !== null) return fail('invalid', `declareStyling: ${length}`);
      if (plan.recipeChanged) {
        const { rows: formats } = await tx.query<{ ready: boolean }>("select to_regclass('public.platform_formats') is not null as ready");
        if (formats[0]?.ready === true) {
          const { rows: owned } = await tx.query<{ id: string; payout: string | null }>(
            `select f.template_id as id, to_jsonb(c.*)->>'payout' as payout from platform_formats f
               left join platform_creators c on c.user_id = f.user_id where f.template_id = $1 limit 1`,
            [input.id],
          );
          // The studio's own company-payout format is refused here too (this stays the studio originals' tool), but it
          // has its own door: the audited recipe text revision on the same page (`format.reviseRecipe`).
          if (owned[0]?.payout === 'company') return fail('invalid', "declareStyling: the studio's own format — write the block into its result steps with the recipe text revision panel (레시피 문구 개정, format.reviseRecipe)");
          if (owned.length > 0) return fail('invalid', "declareStyling: a creative's format keeps its own recipe; ask them to declare it");
        }
      }
      const unchanged = plan.promptText === row.prompt_text && !plan.recipeChanged;
      if (!unchanged) {
        if (plan.recipeChanged) {
          await tx.query('update prompt_items set prompt_text = $2, recipe = $3::jsonb where id = $1', [input.id, plan.promptText, JSON.stringify(plan.recipe)]);
        } else {
          await tx.query('update prompt_items set prompt_text = $2 where id = $1', [input.id, plan.promptText]);
        }
      }
      const result = { slug: row.slug, parts: plan.styling ? { styled: [...plan.styling.styled], photo: [...plan.styling.photo] } : null, texts: plan.texts, recipeChanged: plan.recipeChanged };
      if (ctx.viewer.userId && !unchanged) {
        await tx.query(
          'insert into platform_audit (actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5::jsonb)',
          [ctx.viewer.userId, input.id, 'prompt.declareStyling', 'admin_template_styling', JSON.stringify({ ...result, removed: input.block.trim() === '' })],
        );
      }
      return result;
    });
    if ('ok' in outcome) return outcome;
    ctx.revalidatePrompts?.();
    return ok('saved', { detail: outcome.slug });
  },
};

// ---------------------------------------------------------------------------
// registry fragment
// ---------------------------------------------------------------------------

export const PROMPT_OPERATIONS = {
  'prompt.announce': announce,
  'prompt.create': createPrompt,
  'prompt.createSet': createImageSet,
  'prompt.approve': approve,
  'prompt.reject': reject,
  'prompt.update': editPrompt,
  'prompt.feature': feature,
  'prompt.visibility': visibility,
  'prompt.archive': archive,
  'prompt.marks': marks,
  'prompt.declareStyling': declareStyling,
};
