import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { reviewAdminPath } from '@/lib/brand-studio/review';
import { deliverFile } from '@/lib/brand-rooms/deliveries';
import { roomDeskPath } from '@/lib/brand-rooms/message-contracts';
import { purgeStagingObject } from '@/lib/brand-rooms/staging-cleanup';
import { staffCreateShare, staffRevokeShare } from '@/lib/brand-rooms/shares';
import { SHARE_KINDS, SHARE_LIMITS, type ShareKind } from '@/lib/brand-rooms/share-contracts';
import { storyboardAdminHref } from '@/lib/brand-rooms/storyboard-contracts';
import { brandRoomsOpen } from '@/lib/flags';
import type { AdminOperation } from './operations';
import { fail, ok, type AdminContext } from './context';
import * as f from './form';

/**
 * Project room deliverables and share links, the team side (docs/BRAND-ROOMS.md §6). The forms live on
 * `/admin/brand-rooms/reviews`, on a review's detail page and on a project's desk
 * (`/admin/brand-rooms/<org>/<project>`, docs/BRAND-ROOMS-FEEDBACK.md §4), and return there.
 *
 *   brand_rooms.delivery.add   a file already put into staging (`/api/brand-rooms/reviews/upload`)
 *                              becomes a studio asset (`source = 'delivery'`) and a review item in the
 *                              project: a new deliverable, or the next version of `stackReviewId`'s stack.
 *                              `landing=desk` returns to the project's desk on that version
 *   brand_rooms.share.create   a link to one draft or one shared storyboard of a project, made by the team
 *                              with the brand dialog's options; the token goes back once, in the JSON answer;
 *                              a post returns to its own `_back`
 *   brand_rooms.share.revoke   the kill switch on any share link; with `organizationId` + `projectId` (the
 *                              desk) only that project's links of an open brand, returning to its own `_back`
 *                              (the desk's 공유 링크 tab)
 *
 * Every service call re-reads the admin flag inside its own transaction and keeps the Morphic hardline
 * (a sandboxed or generation-closed brand gets no delivery and no new link). The rows are the audit: the
 * asset and the review carry `created_by` and `created_role = 'studio'`, a link `created_by` and
 * `created_role = 'studio'`, a revoked link `revoked_by`.
 */

function failure(code: string) {
  const admin =
    code === 'not_found' || code === 'feature_unavailable'
      ? 'notFound'
      : code === 'forbidden' || code === 'sign_in_required'
        ? 'forbidden'
        : code === 'conflict' || code === 'limit_reached'
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
  landing: 'review' | 'desk';
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
        landing: f.str(form, 'landing') === 'desk' ? 'desk' : 'review',
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!brandRoomsOpen()) return fail('notFound', 'BRAND_ROOMS is off');
    const { landing, ...delivery } = input;
    const result = await deliverFile({ sql: ctx.sql, media: createStudioMediaStore(), staging: ctx.storage, purgeStagingKey: purgeStagingObject }, { viewer: ctx.viewer }, delivery);
    if (!result.ok) return failure(result.code);
    const review = result.created.review;
    const to = landing === 'desk' && review.projectId ? roomDeskPath(review.organizationId, review.projectId, { review: review.id }) : reviewAdminPath(review.id);
    return ok(result.created.existing ? 'saved' : 'created', { to });
  },
};

interface ShareCreateInput {
  organizationId: string;
  projectId: string;
  kind: ShareKind;
  targetId: string;
  allowComments: boolean;
  allowDownload: boolean;
  expiresInDays: number;
  passphrase: string;
}

/** `target` is `review:<id>` or `storyboard:<id>` (one select on the desk); `kind` + `targetId` also work. */
function targetOf(form: FormData): { kind: ShareKind; targetId: string } | null {
  const raw = f.str(form, 'target');
  const [kind, targetId] = raw ? raw.split(':') : [f.str(form, 'kind'), f.str(form, 'targetId')];
  if (!(SHARE_KINDS as readonly string[]).includes(kind ?? '') || !targetId) return null;
  return { kind: kind as ShareKind, targetId };
}

const createLink: AdminOperation<ShareCreateInput> = {
  parse(form) {
    const target = targetOf(form);
    if (!target) return { ok: false, detail: 'choose a draft or a storyboard to share' };
    const days = f.optionalInt(form, 'expiresInDays');
    if (days === undefined || (days !== null && (days < 1 || days > SHARE_LIMITS.expiryDaysMax))) return { ok: false, detail: `expiresInDays must be 1 to ${SHARE_LIMITS.expiryDaysMax}` };
    const passphrase = f.str(form, 'passphrase');
    if (passphrase && (passphrase.length < SHARE_LIMITS.passphraseMin || passphrase.length > SHARE_LIMITS.passphraseMax)) {
      return { ok: false, detail: `the passphrase needs ${SHARE_LIMITS.passphraseMin} to ${SHARE_LIMITS.passphraseMax} characters` };
    }
    return {
      ok: true,
      value: {
        organizationId: f.str(form, 'organizationId'),
        projectId: f.str(form, 'projectId'),
        ...target,
        allowComments: f.bool(form, 'allowComments'),
        allowDownload: f.bool(form, 'allowDownload'),
        expiresInDays: days ?? SHARE_LIMITS.expiryDaysDefault,
        passphrase,
      },
    };
  },
  async run(ctx: AdminContext, input) {
    if (!brandRoomsOpen()) return fail('notFound', 'BRAND_ROOMS is off');
    const result = await staffCreateShare({ sql: ctx.sql, media: createStudioMediaStore() }, ctx.viewer, { ...input, passphrase: input.passphrase || null });
    if (!result.ok) return failure(result.code);
    // The token rides only in the JSON answer (`/admin/do`), never in a redirect: the desk shows it once.
    // No `to`: a form post without script returns to its own `_back` (the desk's 공유 링크 tab) with its query.
    return ok('created', { shareToken: result.token });
  },
};

const revoke: AdminOperation<{ shareId: string; organizationId: string | null; projectId: string | null }> = {
  parse: (form) => ({
    ok: true,
    value: { shareId: f.str(form, 'shareId'), organizationId: f.str(form, 'organizationId') || null, projectId: f.str(form, 'projectId') || null },
  }),
  async run(ctx: AdminContext, input) {
    const result = await staffRevokeShare({ sql: ctx.sql, media: createStudioMediaStore() }, ctx.viewer, input);
    if (!result.ok) return failure(result.code);
    // From a desk: back to the form's own `_back` (the 공유 링크 tab, query kept). A `to` would lose the query
    // (lib/admin/dispatch.ts `outcomeUrl` drops it when `to` is given) and land on 시안.
    if (input.organizationId && input.projectId) return ok('saved');
    return ok('saved', { to: result.kind === 'review' ? reviewAdminPath(result.targetId) : storyboardAdminHref(result.targetId) });
  },
};

export const BRAND_ROOMS_REVIEW_OPERATIONS = {
  'brand_rooms.delivery.add': deliver,
  'brand_rooms.share.create': createLink,
  'brand_rooms.share.revoke': revoke,
};
