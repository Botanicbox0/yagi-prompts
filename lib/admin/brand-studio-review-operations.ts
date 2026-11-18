import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { reviewAdminPath, staffAddComment, staffCreateReview, staffResolveComment, staffSetStatus, type ReviewDeps } from '@/lib/brand-studio/review';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import * as f from './form';

/**
 * Brand studio review space, the team side (docs/BRAND-STUDIO-V3.md §7). The forms live on
 * `/admin/brand-studio/reviews` and its detail page and return there. Each service call re-reads the
 * admin flag on the profile row inside its transaction; a team comment is stored with
 * `author_role = 'studio'` and the writer's id, a resolution with `resolved_by`, a status move with
 * `status_changed_by` — the rows are the audit.
 *
 * Uploading brand-new deliverable files from here is not part of this slice: a review opens on an asset
 * or result that already exists in the organization's studio.
 */

const reviewDeps = (ctx: AdminContext): ReviewDeps => ({ sql: ctx.sql, media: createStudioMediaStore() });

function reviewFailure(code: string) {
  const admin =
    code === 'not_found' || code === 'feature_unavailable' ? 'notFound' : code === 'forbidden' || code === 'sign_in_required' ? 'forbidden' : code === 'conflict' ? 'brandConflict' : 'invalid';
  return fail(admin, code);
}

/** `''` -> null; anything else a finite number or the parse fails. */
function optionalNumber(form: FormData, name: string): { ok: true; value: number | null } | { ok: false } {
  const raw = f.str(form, name);
  if (raw === '') return { ok: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

interface ReplyInput {
  reviewId: string;
  body: string;
  parentId: string | null;
  atMs: number | null;
  endMs: number | null;
  x: number | null;
  y: number | null;
  /** A drawing (rooms, docs/BRAND-ROOMS.md §6), sent as JSON; the review contract checks its shape. */
  strokes: unknown;
  /** 'team': a note only the YAGI team reads (docs/BRAND-ROOMS-FEEDBACK.md §5). A reply takes its thread's. */
  visibility: 'public' | 'team';
}

const reply: AdminOperation<ReplyInput> = {
  parse(form) {
    const atMs = optionalNumber(form, 'atMs'),
      endMs = optionalNumber(form, 'endMs'),
      x = optionalNumber(form, 'x'),
      y = optionalNumber(form, 'y');
    if (!atMs.ok || !endMs.ok || !x.ok || !y.ok) return { ok: false, detail: 'atMs, endMs, x and y must be numbers' };
    const body = f.text(form, 'body');
    if (!body) return { ok: false, detail: 'body is required' };
    const visibility = f.str(form, 'visibility') || 'public';
    if (visibility !== 'public' && visibility !== 'team') return { ok: false, detail: 'visibility must be public or team' };
    let strokes: unknown = null;
    const rawStrokes = f.str(form, 'strokes');
    if (rawStrokes) {
      if (rawStrokes.length > 32_768) return { ok: false, detail: 'the drawing is too large' };
      try {
        strokes = JSON.parse(rawStrokes);
      } catch {
        return { ok: false, detail: 'strokes must be JSON' };
      }
    }
    return {
      ok: true,
      value: {
        reviewId: f.str(form, 'reviewId'),
        body,
        parentId: f.str(form, 'parentId') || null,
        atMs: atMs.value == null ? null : Math.round(atMs.value),
        endMs: endMs.value == null ? null : Math.round(endMs.value),
        x: x.value,
        y: y.value,
        strokes,
        visibility,
      },
    };
  },
  async run(ctx, input) {
    const result = await staffAddComment(reviewDeps(ctx), ctx.viewer, input);
    if (!result.ok) return reviewFailure(result.code);
    return ok('saved', { to: reviewAdminPath(input.reviewId) });
  },
};

const resolve: AdminOperation<{ reviewId: string; commentId: string }> = {
  parse: (form) => ({ ok: true, value: { reviewId: f.str(form, 'reviewId'), commentId: f.str(form, 'commentId') } }),
  async run(ctx, input) {
    const result = await staffResolveComment(reviewDeps(ctx), ctx.viewer, input);
    if (!result.ok) return reviewFailure(result.code);
    return ok('saved', { to: reviewAdminPath(input.reviewId) });
  },
};

const status: AdminOperation<{ reviewId: string; status: string }> = {
  parse: (form) => ({ ok: true, value: { reviewId: f.str(form, 'reviewId'), status: f.str(form, 'status') } }),
  async run(ctx, input) {
    const result = await staffSetStatus(reviewDeps(ctx), ctx.viewer, input);
    if (!result.ok) return reviewFailure(result.code);
    return ok('saved', { to: reviewAdminPath(input.reviewId) });
  },
};

interface CreateInput {
  organizationId: string;
  title: string;
  assetId?: string;
  outputId?: string;
}

const create: AdminOperation<CreateInput> = {
  parse(form) {
    const subject = f.str(form, 'subjectId');
    const kind = f.str(form, 'subjectKind');
    if (kind !== 'asset' && kind !== 'output') return { ok: false, detail: 'subjectKind must be asset or output' };
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        title: f.str(form, 'title'),
        ...(kind === 'asset' ? { assetId: subject } : { outputId: subject }),
      },
    };
  },
  async run(ctx, input) {
    const result = await staffCreateReview(reviewDeps(ctx), ctx.viewer, input);
    if (!result.ok) return reviewFailure(result.code);
    return ok(result.existing ? 'saved' : 'created', { to: reviewAdminPath(result.review.id) });
  },
};

export const BRAND_STUDIO_REVIEW_OPERATIONS = {
  'brand_studio.review.reply': reply,
  'brand_studio.review.resolve': resolve,
  'brand_studio.review.status': status,
  'brand_studio.review.create': create,
};
