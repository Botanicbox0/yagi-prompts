import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { checkUpload, publishPromptMedia, stagePromptUpload } from '@/lib/prompts/media';
import { AssetRefSchema } from '@/lib/content/schemas';
import { STAGING_BUCKET } from '@/lib/storage';
import {
  approvePrompt,
  insertPrompt,
  loadPromptById,
  rejectPrompt,
  setPromptArchived,
  setPromptFeatured,
  setPromptTextVisibility,
  updatePrompt,
  updatePromptMedia,
} from '@/lib/prompts/repo';
import {
  ApprovalSchema,
  AuthoringSchema,
  DEFAULT_PROMPT_MODEL,
  EditSchema,
  MEDIA_KINDS,
  RejectionSchema,
  TEMPLATE_MEDIA,
  USE_CASES,
  effectiveTextVisibility,
  normalizeHandle,
  parsePromptMedia,
  parseStagedUpload,
  slugify,
  type PromptMedia,
} from '@/lib/prompts/schemas';
import { ADMIN_PROMPTS_PATH } from '@/lib/prompts/links';
import { announceTemplate, markPromptAnnounced } from '@/lib/prompts/announce';
import { aspectsForMedium, enginesForMedium } from '@/lib/images/engines';
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
const TemplateFields = z
  .object({
    medium: z.enum(TEMPLATE_MEDIA),
    priceCents: z.number().int().min(0).max(1_000_000),
    /** The fixed won price (0018); 0 = suggested from the dollar price. */
    priceKrw: z.number().int().min(0).max(100_000_000),
    runtimeSeconds: z.number().int().positive().max(600).nullable(),
    /** docs/TEMPLATES-IA.md §7 — null = the medium's default; a named engine must be one of its medium's. */
    engine: z.string().nullable(),
    aspectDefault: z.string().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.engine !== null && !(enginesForMedium(value.medium) as readonly string[]).includes(value.engine)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['engine'], message: `not a ${value.medium} engine` });
    }
    if (value.aspectDefault !== null && !(aspectsForMedium(value.medium) as readonly string[]).includes(value.aspectDefault)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['aspectDefault'], message: `not a ${value.medium} aspect` });
    }
  });

function templateFields(form: FormData): ParseResult<z.infer<typeof TemplateFields>> {
  const medium = f.str(form, 'medium') || 'video';
  const runtime = f.optionalInt(form, 'runtimeSeconds');
  return parsed(TemplateFields, {
    medium,
    priceCents: f.optionalInt(form, 'priceCents') ?? 0,
    priceKrw: f.optionalInt(form, 'priceKrw') ?? 0,
    runtimeSeconds: medium === 'image' ? null : (runtime ?? null),
    engine: f.str(form, 'engine') || null,
    aspectDefault: f.str(form, 'aspectDefault') || null,
  });
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
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// YAGI authoring (§13.1 — media required, title_ko required, visibility default pro)
// ---------------------------------------------------------------------------

const createPrompt: AdminOperation<{ input: z.infer<typeof AuthoringSchema>; form: FormData }> = {
  parse(form) {
    const base = parsed(AuthoringSchema, {
      slug: f.str(form, 'slug'),
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
    const id = randomUUID();
    const staged = await applyUploads(ctx, id, form, {});
    if (!staged.ok) return fail('upload', staged.detail);
    // §13.3-4: "YAGI media required". The poster is the card surface, so it is the required half;
    // the hover video is what makes the gallery move, and is strongly encouraged but optional.
    if (!staged.value.poster) {
      return fail('invalid', 'poster: a YAGI prompt needs a poster image');
    }

    // Founder direction (2026-08-14): a blank slug FOLLOWS THE EN TITLE. Collisions get a short
    // numeric suffix instead of a refusal — the founder is publishing, not naming database rows.
    // (Single-admin surface: the read-then-insert window is acceptable, and the unique index is
    // still the backstop underneath.)
    const slug =
      input.slug ?? (await freeSlug(ctx.sql, slugify(input.title, `prompt-${id.slice(0, 8)}`)));

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
      ...template.value,
      publishedAt: 'now',
    });

    ctx.revalidatePrompts?.();
    return ok('published', { detail: slug, to: BACK });
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
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);

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
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);
    const template = templateFields(form);
    if (!template.ok) return fail('invalid', template.detail);

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
      ...template.value,
    });
    if (!saved) return fail('notFound', NOT_FOUND_DETAIL);

    ctx.revalidatePrompts?.();
    return ok('saved', { detail: input.slug, to: BACK });
  },
};

const Feature = z.object({ id: Uuid, featured: z.boolean() });

const feature: AdminOperation<z.infer<typeof Feature>> = {
  parse: (form) => parsed(Feature, { id: f.str(form, 'id'), featured: f.bool(form, 'featured') }),
  async run(ctx, input) {
    const changed = await setPromptFeatured(ctx.sql, input.id, input.featured);
    if (!changed) return fail('notFound', NOT_FOUND_DETAIL);
    ctx.revalidatePrompts?.();
    return ok('saved', { to: BACK });
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
    return ok('saved', { to: BACK });
  },
};

const Archive = z.object({ id: Uuid, archived: z.boolean() });

const archive: AdminOperation<z.infer<typeof Archive>> = {
  parse: (form) => parsed(Archive, { id: f.str(form, 'id'), archived: f.bool(form, 'archived') }),
  async run(ctx, input) {
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
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);
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
// registry fragment
// ---------------------------------------------------------------------------

export const PROMPT_OPERATIONS = {
  'prompt.announce': announce,
  'prompt.create': createPrompt,
  'prompt.approve': approve,
  'prompt.reject': reject,
  'prompt.update': editPrompt,
  'prompt.feature': feature,
  'prompt.visibility': visibility,
  'prompt.archive': archive,
};
