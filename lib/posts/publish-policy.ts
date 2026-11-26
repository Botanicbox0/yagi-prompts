import type { PostStatus } from './schema';

/**
 * Single policy source for blog post publication and public visibility (Batch 3).
 *
 * Currently configured for immediate self-publishing (mirroring templates under Open Maker):
 * a creative can move a valid `draft` directly to `published`, while an admin-hidden post
 * (`hidden`) stays locked unless an admin restores it (`post.restore`).
 *
 * Switching to studio-approval publishing later:
 *   1. Add `'submitted'` (and optional `'rejected'` + review note columns) to `creator_posts`.
 *   2. Change `POST_SELF_PUBLISH_ENABLED` to `false` or return `nextStatus: 'submitted'` from
 *      `resolvePublishTransition`, keeping `isPostPubliclyVisible` strict on `status === 'published'`.
 *   3. Add `post.approve` / `post.reject` admin operations in `lib/admin/platform-operations.ts`.
 */

export const POST_SELF_PUBLISH_ENABLED = true;

export const PUBLIC_POST_SQL_FILTER =
  "cp.status = 'published' and pc.active and pc.public_profile and pc.handle is not null";

export function isPostPubliclyVisible(input: {
  status: PostStatus;
  makerActive: boolean;
  makerPublicProfile: boolean;
  makerHandle: string | null;
}): boolean {
  return (
    input.status === 'published' &&
    input.makerActive &&
    input.makerPublicProfile &&
    Boolean(input.makerHandle)
  );
}

export function resolvePublishTransition(
  currentStatus: PostStatus,
): { ok: true; nextStatus: 'published' } | { ok: false; code: 'hidden_locked' } {
  if (currentStatus === 'hidden') {
    return { ok: false, code: 'hidden_locked' };
  }
  return { ok: true, nextStatus: 'published' };
}
