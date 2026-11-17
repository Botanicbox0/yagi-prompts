import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadRoomReviewDetail, loadRoomReviews, staffAddComment, staffReviewDetail, staffReviewList } from '@/lib/brand-studio/review';
import { teamNotesReady } from '@/lib/brand-studio/review-visibility';
import type { ReviewCommentAdded, ReviewCreated, RoomReviewDetail } from '@/lib/brand-studio/review-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, roomOp, seedOutput } from './fixtures';

/**
 * The code may reach production before 0093 (team notes) is applied. On a database without the
 * `visibility` column every read, write and carry-over works exactly as before, and a team note is refused
 * as "not available" instead of failing or silently turning public. Its own file: the probe remembers a
 * positive answer for the life of the module.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  await f.db.exec('alter table brand_studio_review_comments drop column visibility');
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('a database without 0093', () => {
  it('reads, writes and carries notes as before, and refuses a team note', async () => {
    expect(await teamNotesReady(f.sql)).toBe(false);
    const owner = viewerOf(f.ids.owner);
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const v1 = ((await roomOp(f, deps, owner, 'review.create', { outputId, title: 'Spring film' })).result as ReviewCreated).review.id;
    const brand = (await roomOp(f, deps, owner, 'comment.add', { reviewId: v1, body: 'Logo smaller' })).result as ReviewCommentAdded;
    expect(brand.ok).toBe(true);
    expect(await staffAddComment(reviewDeps(deps), admin, { reviewId: v1, body: 'secret', visibility: 'team' })).toEqual({ ok: false, code: 'provider_unavailable' });
    const reply = (await staffAddComment(reviewDeps(deps), admin, { reviewId: v1, body: 'On it', parentId: brand.comment.id })) as ReviewCommentAdded;
    expect(reply.ok).toBe(true);
    const done = (await roomOp(f, deps, owner, 'comment.add', { reviewId: v1, body: 'Fixed already' })).result as ReviewCommentAdded;
    expect((await roomOp(f, deps, owner, 'comment.resolve', { reviewId: v1, commentId: done.comment.id })).result).toEqual({ ok: true });

    const d = (await loadRoomReviewDetail(reviewDeps(deps), owner, f.orgId, f.projectId, v1)) as RoomReviewDetail;
    expect(d.comments.map((c) => c.body)).toEqual(['Logo smaller', 'On it', 'Fixed already']);
    expect(d.review).toMatchObject({ commentsOpen: 1, commentsTotal: 3 });
    expect(await loadRoomReviews(reviewDeps(deps), owner, f.orgId, f.projectId)).toMatchObject({ ok: true });
    const listed = await staffReviewList(reviewDeps(deps), admin);
    expect(listed.ok && listed.reviews[0]).not.toHaveProperty('teamCommentsOpen');
    expect(await staffReviewDetail(reviewDeps(deps), admin, v1)).toMatchObject({ ok: true, comments: [{ body: 'Logo smaller' }, { body: 'On it' }, { body: 'Fixed already' }] });

    // The open note carries to v2 as before.
    const v2 = (await roomOp(f, deps, owner, 'review.version', { reviewId: v1, outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'video') })).result as ReviewCreated;
    expect(v2).toMatchObject({ ok: true, review: { version: 2 } });
    const d2 = (await loadRoomReviewDetail(reviewDeps(deps), owner, f.orgId, f.projectId, v2.review.id)) as RoomReviewDetail;
    expect(d2.comments.map((c) => [c.body, c.carriedFrom])).toEqual([['Logo smaller', { version: 1 }]]);
  });
});
