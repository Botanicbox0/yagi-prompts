import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { reviewAdminPath } from '@/lib/brand-studio/review';
import { deliverFile } from '@/lib/brand-rooms/deliveries';
import { purgeStagingObject } from '@/lib/brand-rooms/staging-cleanup';
import { staffRevokeShare } from '@/lib/brand-rooms/shares';
import { storyboardAdminHref } from '@/lib/brand-rooms/storyboard-contracts';
import { brandRoomsOpen } from '@/lib/flags';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import * as f from './form';

/**
 * Project room deliverables and share links, the team side (docs/BRAND-ROOMS.md §6). The forms live on
 * `/admin/brand-rooms/reviews` and on a review's detail page and return there.
 *
 *   brand_rooms.delivery.add   a file already put into staging (`/api/brand-rooms/reviews/upload`)
 *                              becomes a studio asset (`source = 'delivery'`) and a review item in the
 *                              project: a new deliverable, or the next version of `stackReviewId`'s stack
 *   brand_rooms.share.revoke   the kill switch on any share link
 *
 * Every service call re-reads the admin flag inside its own transaction and keeps the Morphic hardline
 * (a sandboxed or generation-closed brand gets no delivery). The rows are the audit: the asset and the
 * review carry `created_by` and `created_role = 'studio'`, a revoked link `revoked_by`.
 */

function failure(code: string) {
  const admin =
    code === 'not_found' || code === 'feature_unavailable'
      ? 'notFound'
      : code === 'forbidden' || code === 'sign_in_required'
        ? 'forbidden'
        : code === 'conflict'
          ? 'brandConflict'
          : code === 'file_too_large' || code === 'unsupported_file'
            ? 'upload'
            : code === 'provider_unavailable'
              ? 'storage'
              : 'invalid';
  return fail(admin, code);
}

interface DeliveryInput {
  organizationId: string;
  projectId: string;
  title: string;
  stackReviewId: string | null;
  stagingKey: string;
  name: string | null;
}

const deliver: AdminOperation<DeliveryInput> = {
  parse(form) {
    const title = f.str(form, 'title');
    const stagingKey = f.str(form, 'stagingKey');
    if (!title) return { ok: false, detail: 'title is required' };
    if (!stagingKey) return { ok: false, detail: 'upload the file first' };
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        projectId: f.str(form, 'projectId'),
        title,
        stackReviewId: f.str(form, 'stackReviewId') || null,
        stagingKey,
        name: f.str(form, 'name') || null,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!brandRoomsOpen()) return fail('notFound', 'BRAND_ROOMS is off');
    const result = await deliverFile({ sql: ctx.sql, media: createStudioMediaStore(), staging: ctx.storage, purgeStagingKey: purgeStagingObject }, { viewer: ctx.viewer }, input);
    if (!result.ok) return failure(result.code);
    return ok(result.created.existing ? 'saved' : 'created', { to: reviewAdminPath(result.created.review.id) });
  },
};

const revoke: AdminOperation<{ shareId: string }> = {
  parse: (form) => ({ ok: true, value: { shareId: f.str(form, 'shareId') } }),
  async run(ctx: AdminContext, input) {
    const result = await staffRevokeShare({ sql: ctx.sql, media: createStudioMediaStore() }, ctx.viewer, input);
    if (!result.ok) return failure(result.code);
    return ok('saved', { to: result.kind === 'review' ? reviewAdminPath(result.targetId) : storyboardAdminHref(result.targetId) });
  },
};

export const BRAND_ROOMS_REVIEW_OPERATIONS = {
  'brand_rooms.delivery.add': deliver,
  'brand_rooms.share.revoke': revoke,
};
