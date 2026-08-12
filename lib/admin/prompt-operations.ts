import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { publishPromptMedia, stagePromptUpload } from '@/lib/prompts/media';
import {
  approvePrompt,
  insertPrompt,
  loadPromptById,
  rejectPrompt,
  setPromptArchived,
  setPromptFeatured,
  updatePrompt,
  updatePromptMedia,
} from '@/lib/prompts/repo';
import {
  ApprovalSchema,
  AuthoringSchema,
  DEFAULT_PROMPT_MODEL,
  EditSchema,
  RejectionSchema,
  USE_CASES,
  effectiveTextVisibility,
  normalizeHandle,
  parsePromptMedia,
  type PromptMedia,
} from '@/lib/prompts/schemas';
import { ADMIN_PROMPTS_PATH } from '@/lib/prompts/links';
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

/** Repeated checkbox values, filtered to the §13.1 vocabulary. */
function chips(form: FormData, name: string): string[] {
  const allowed = new Set<string>(USE_CASES);
  return form
    .getAll(name)
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => allowed.has(value));
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
  for (const kind of ['poster', 'video'] as const) {
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
      useCase: chips(form, 'useCase'),
      textVisibility: f.str(form, 'textVisibility') || 'pro',
      featured: f.bool(form, 'featured'),
      model: f.str(form, 'model') || DEFAULT_PROMPT_MODEL,
    });
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const id = randomUUID();
    const staged = await applyUploads(ctx, id, form, {});
    if (!staged.ok) return fail('upload', staged.detail);
    // §13.3-4: "YAGI media required". The poster is the card surface, so it is the required half;
    // the hover video is what makes the gallery move, and is strongly encouraged but optional.
    if (!staged.value.poster) {
      return fail('invalid', 'poster: a YAGI prompt needs a poster image');
    }

    const { media } = await publishPromptMedia(ctx.storage, staged.value);

    await insertPrompt(ctx.sql, {
      id,
      slug: input.slug,
      source: 'yagi',
      authorId: null,
      authorHandle: null,
      status: 'published',
      model: input.model,
      title: input.title,
      titleKo: input.titleKo,
      promptText: input.promptText,
      textVisibility: effectiveTextVisibility('yagi', input.textVisibility),
      media,
      useCase: input.useCase,
      featured: input.featured,
      publishedAt: 'now',
    });

    ctx.revalidatePrompts?.();
    return ok('published', { detail: input.slug, to: BACK });
  },
};

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
      useCase: chips(form, 'useCase'),
      handle: f.str(form, 'handle') || null,
      textVisibility: f.str(form, 'textVisibility') || 'public',
      featured: f.bool(form, 'featured'),
    });
    if (!base.ok) return base;
    return { ok: true, value: { input: base.value, form } };
  },
  async run(ctx, { input, form }) {
    const row = await loadPromptById(ctx.sql, input.id);
    if (row === null) return fail('notFound', NOT_FOUND_DETAIL);

    const staged = await applyUploads(ctx, input.id, form, parsePromptMedia(row.media));
    if (!staged.ok) return fail('upload', staged.detail);
    const { media } = await publishPromptMedia(ctx.storage, staged.value);
    await updatePromptMedia(ctx.sql, input.id, Object.keys(media).length === 0 ? null : media);

    const saved = await updatePrompt(ctx.sql, {
      id: input.id,
      slug: input.slug,
      title: input.title,
      titleKo: input.titleKo,
      promptText: input.promptText,
      useCase: input.useCase,
      authorHandle: normalizeHandle(input.handle),
      // The community rule is applied to the payload here and enforced by the CHECK underneath.
      textVisibility: effectiveTextVisibility(row.source, input.textVisibility),
      featured: input.featured,
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

// ---------------------------------------------------------------------------
// registry fragment
// ---------------------------------------------------------------------------

export const PROMPT_OPERATIONS = {
  'prompt.create': createPrompt,
  'prompt.approve': approve,
  'prompt.reject': reject,
  'prompt.update': editPrompt,
  'prompt.feature': feature,
  'prompt.archive': archive,
};
