import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadReviewDetail,
  loadReviewList,
  loadRoomReviews,
  roomReviewReady,
  runReviewOperation,
  staffAddComment,
  staffReviewDetail,
  staffReviewList,
} from '@/lib/brand-studio/review';
import { createShare, resolveShare } from '@/lib/brand-rooms/shares';
import type { ReviewCommentAdded, ReviewCreated } from '@/lib/brand-studio/review-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, seedOutput } from './fixtures';

/**
 * The studio review room is live in production before 0084 is applied. On a database without the room
 * columns and the share table, the v3 screen and the team's page work exactly as before (rooms on or off),
 * and everything rooms add answers "not available" instead of failing. Its own file: the service remembers
 * a positive schema probe for the life of the module.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  await f.db.exec(`
    drop table brand_room_share_visits;
    alter table brand_studio_review_comments drop column end_ms, drop column strokes, drop column guest_name, drop column carried_from, drop column share_id cascade;
    drop table brand_room_shares;
    drop index if exists brand_studio_reviews_stack_version_key;
    alter table brand_studio_reviews drop column project_id cascade, drop column stack_id cascade, drop column version cascade, drop column source cascade;
  `);
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('a database without 0084', () => {
  it('runs the studio review screen and the team page as before', async () => {
    expect(await roomReviewReady(f.sql)).toBe(false);
    const owner = viewerOf(f.ids.owner);
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const created = (await runReviewOperation(reviewDeps(deps), owner, 'review.create', { organizationId: f.orgId, outputId, title: 'Spring film' })).result as ReviewCreated;
    expect(created).toMatchObject({ ok: true, review: { title: 'Spring film' } });
    expect('version' in created.review).toBe(false);
    const note = (
      await runReviewOperation(reviewDeps(deps), owner, 'comment.add', {
        organizationId: f.orgId,
        reviewId: created.review.id,
        body: 'Logo',
        atMs: 300,
        endMs: 900,
        strokes: [{ tool: 'pen', color: 'blue', points: [[0, 0], [1, 1]] }],
      })
    ).result as ReviewCommentAdded;
    expect(note).toMatchObject({ ok: true, comment: { atMs: 300 } });
    expect('endMs' in note.comment).toBe(false);
    expect((await runReviewOperation(reviewDeps(deps), owner, 'comment.resolve', { organizationId: f.orgId, reviewId: created.review.id, commentId: note.comment.id })).result).toEqual({ ok: true });
    expect((await runReviewOperation(reviewDeps(deps), owner, 'review.status', { organizationId: f.orgId, reviewId: created.review.id, status: 'approved' })).result).toEqual({ ok: true });

    const detail = await loadReviewDetail(reviewDeps(deps), owner, f.orgId, created.review.id);
    expect(detail).toMatchObject({ ok: true, review: { status: 'approved' }, comments: [{ body: 'Logo', resolved: true }] });
    expect(detail.ok && 'extended' in detail).toBe(false);
    expect(await loadReviewList(reviewDeps(deps), owner, f.orgId)).toMatchObject({ ok: true, reviews: [{ id: created.review.id }] });

    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    expect((await staffAddComment(reviewDeps(deps), admin, { reviewId: created.review.id, body: 'On it' })).ok).toBe(true);
    expect(await staffReviewList(reviewDeps(deps), admin)).toMatchObject({ ok: true, reviews: [{ id: created.review.id }] });
    expect(await staffReviewDetail(reviewDeps(deps), admin, created.review.id)).toMatchObject({ ok: true, comments: [{ body: 'Logo' }, { body: 'On it' }] });
  });

  it('answers the room features as unavailable instead of failing', async () => {
    const owner = viewerOf(f.ids.owner);
    expect(await loadRoomReviews(reviewDeps(deps), owner, f.orgId, f.projectId)).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(await createShare({ sql: f.sql, media: deps.media }, owner, { organizationId: f.orgId, kind: 'review', targetId: f.projectId })).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(await resolveShare(f.sql, 'A'.repeat(43))).toBeNull();
  });
});
