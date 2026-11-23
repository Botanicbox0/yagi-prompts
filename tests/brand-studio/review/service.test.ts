import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import {
  loadReviewDetail,
  loadReviewList,
  runReviewOperation,
  staffAddComment,
  staffCreateReview,
  staffResolveComment,
  staffReviewDetail,
  staffReviewList,
  staffSetStatus,
} from '@/lib/brand-studio/review';
import type { ReviewCommentAdded, ReviewCreated } from '@/lib/brand-studio/review-contracts';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { reviewDeps, seedOutput } from './fixtures';

/**
 * docs/BRAND-STUDIO-V3.md §7 — the review service against a real PGlite database: who may read and
 * write, the subject belongs to the organization, one level of replies, the comment rate limit, the
 * resolve toggle, deleting only one's own note, the status moves and the team notice, and the team
 * side (admin flag re-read, `author_role = 'studio'`, the Morphic hardline on opening a review).
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runReviewOperation(reviewDeps(deps), viewer, operation, input);
const owner = () => viewerOf(f.ids.owner);

async function openReview(kind: 'image' | 'video' = 'video'): Promise<string> {
  const outputId = await seedOutput(deps, f.orgId, f.ids.owner, kind);
  const { result } = await op(owner(), 'review.create', { organizationId: f.orgId, outputId, title: 'Spring film v1' });
  expect(result.ok).toBe(true);
  return (result as ReviewCreated).review.id;
}

async function comment(viewer: Viewer, reviewId: string, extra: Record<string, unknown> = {}) {
  return op(viewer, 'comment.add', { organizationId: f.orgId, reviewId, body: 'The logo is too small here', ...extra });
}

describe('opening a review', () => {
  it('opens one review per piece and returns the same one the second time', async () => {
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const first = await op(owner(), 'review.create', { organizationId: f.orgId, outputId, title: '  Spring   film  ' });
    expect(first.result).toMatchObject({ ok: true, existing: false, review: { title: 'Spring film', status: 'open', kind: 'video', available: true, commentsOpen: 0, commentsTotal: 0 } });
    const again = await op(viewerOf(f.ids.editor), 'review.create', { organizationId: f.orgId, outputId, title: 'Another title' });
    expect(again.result).toMatchObject({ ok: true, existing: true, review: { id: (first.result as ReviewCreated).review.id, title: 'Spring film' } });
    expect(first.notice).toBeNull();
  });

  it('accepts an uploaded image and refuses audio, another brand’s piece and a missing one', async () => {
    const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, assetId, title: 'Logo cut' })).result).toMatchObject({ ok: true, review: { kind: 'image' } });

    const audio = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, status) values ($1, 'audio', 'jingle', 'audio/mpeg', 10, 'st/aaa.mp3', 'ready') returning id`,
        [f.orgId],
      )
    ).rows[0]!.id;
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, assetId: audio, title: 'Jingle' })).result).toEqual({ ok: false, code: 'invalid' });

    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other brand', f.ids.owner, randomUUID()]);
    const foreign = await seedOutput(deps, otherOrg, f.ids.owner, 'image');
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, outputId: foreign, title: 'Not ours' })).result).toEqual({ ok: false, code: 'not_found' });
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, outputId: randomUUID(), title: 'Gone' })).result).toEqual({ ok: false, code: 'not_found' });
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, title: 'Nothing' })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, outputId: foreign, assetId, title: 'Both' })).result).toEqual({ ok: false, code: 'invalid' });
  });
});

describe('who may read and write', () => {
  it('lets viewers read and refuses their writes; guests and outsiders see nothing', async () => {
    const reviewId = await openReview();
    const viewer = viewerOf(f.ids.viewer);
    expect(await loadReviewList(reviewDeps(deps), viewer, f.orgId)).toMatchObject({ ok: true, canWrite: false, reviews: [{ id: reviewId }] });
    expect(await loadReviewDetail(reviewDeps(deps), viewer, f.orgId, reviewId)).toMatchObject({ ok: true, canWrite: false });
    expect((await comment(viewer, reviewId)).result).toEqual({ ok: false, code: 'forbidden' });
    expect((await op(viewer, 'review.status', { organizationId: f.orgId, reviewId, status: 'approved' })).result).toEqual({ ok: false, code: 'forbidden' });
    for (const id of [f.ids.guest, f.ids.outsider]) {
      expect(await loadReviewList(reviewDeps(deps), viewerOf(id), f.orgId)).toEqual({ ok: false, code: 'not_found' });
      expect((await comment(viewerOf(id), reviewId)).result).toEqual({ ok: false, code: 'not_found' });
    }
    expect(await loadReviewList(reviewDeps(deps), viewerOf(f.ids.owner), f.orgId)).toMatchObject({ ok: true, canWrite: true });
  });

  it('answers a sandboxed organization with feature_unavailable for every read and write', async () => {
    await f.db.close();
    f = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! });
    deps = studioDeps(f.sql);
    expect(await loadReviewList(reviewDeps(deps), owner(), f.orgId)).toEqual({ ok: false, code: 'feature_unavailable' });
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    expect((await op(owner(), 'review.create', { organizationId: f.orgId, outputId, title: 'x' })).result).toEqual({ ok: false, code: 'feature_unavailable' });
    expect((await f.sql.query('select count(*)::int as n from brand_studio_reviews')).rows[0]).toEqual({ n: 0 });
  });

  it('never reads a review through another organization', async () => {
    const reviewId = await openReview();
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Other brand', f.ids.outsider, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrg, f.ids.outsider]);
    expect(await loadReviewDetail(reviewDeps(deps), viewerOf(f.ids.outsider), otherOrg, reviewId)).toEqual({ ok: false, code: 'not_found' });
    expect((await op(viewerOf(f.ids.outsider), 'comment.add', { organizationId: otherOrg, reviewId, body: 'hi' })).result).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('notes', () => {
  it('stores a moment and a spot, threads one level of replies, and tells the team', async () => {
    const reviewId = await openReview('video');
    const root = await comment(owner(), reviewId, { atMs: 1250, x: 0.4, y: 0.6 });
    expect(root.result).toMatchObject({ ok: true, comment: { atMs: 1250, x: 0.4, y: 0.6, authorRole: 'brand', authorName: 'owner', mine: true, resolved: false } });
    expect(root.notice).toMatchObject({ organizationId: f.orgId, userId: f.ids.owner });
    expect(root.notice!.body).toContain('Spring film v1 · 0:01.2 · 화면 위치 표시');
    expect(root.notice!.body).toContain(`/admin/brand-studio/reviews/${reviewId}`);
    const rootId = (root.result as ReviewCommentAdded).comment.id;

    const reply = await comment(viewerOf(f.ids.editor), reviewId, { body: 'Agreed', parentId: rootId });
    expect(reply.result).toMatchObject({ ok: true, comment: { parentId: rootId, atMs: null } });
    expect(reply.notice!.body).toContain('[리뷰 답글]');
    const replyId = (reply.result as ReviewCommentAdded).comment.id;
    expect((await comment(owner(), reviewId, { body: 'Deeper', parentId: replyId })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await comment(owner(), reviewId, { body: 'Reply with a moment', parentId: rootId, atMs: 10 })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await comment(owner(), reviewId, { x: 0.5 })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await comment(owner(), reviewId, { x: 1.5, y: 0.5 })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await comment(owner(), reviewId, { body: '   ' })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await comment(owner(), reviewId, { body: 'x'.repeat(2001) })).result).toEqual({ ok: false, code: 'invalid' });

    const detail = await loadReviewDetail(reviewDeps(deps), viewerOf(f.ids.viewer), f.orgId, reviewId);
    expect(detail).toMatchObject({ ok: true, review: { kind: 'video', seconds: 6, commentsOpen: 1, commentsTotal: 2 } });
    if (!detail.ok) throw new Error('detail');
    expect(detail.review.mediaUrl).toMatch(/^memory:|^\/api\/brand-studio\/media\/|^https?:/);
    expect(detail.comments.map((c) => [c.authorName, c.authorRole, c.mine])).toEqual([
      ['owner', 'brand', false],
      ['editor', 'brand', false],
    ]);
  });

  it('drops the moment of a note on a still, keeping its spot', async () => {
    const reviewId = await openReview('image');
    const added = await comment(owner(), reviewId, { atMs: 900, x: 0.1, y: 0.2 });
    expect(added.result).toMatchObject({ ok: true, comment: { atMs: null, x: 0.1, y: 0.2 } });
  });

  it('allows ten notes a minute per member and refuses the eleventh', async () => {
    const reviewId = await openReview();
    for (let i = 0; i < 10; i += 1) expect((await comment(owner(), reviewId, { body: `note ${i}` })).result.ok).toBe(true);
    const eleventh = await comment(owner(), reviewId, { body: 'one more' });
    expect(eleventh).toEqual({ result: { ok: false, code: 'rate_limited' }, notice: null });
    // Another member still has their own budget.
    expect((await comment(viewerOf(f.ids.editor), reviewId)).result.ok).toBe(true);
  });

  it('toggles resolution and deletes only one’s own note', async () => {
    const reviewId = await openReview();
    const rootId = ((await comment(owner(), reviewId)).result as ReviewCommentAdded).comment.id;
    const ref = { organizationId: f.orgId, reviewId, commentId: rootId };
    expect((await op(viewerOf(f.ids.editor), 'comment.resolve', ref)).result).toEqual({ ok: true });
    let list = await loadReviewList(reviewDeps(deps), owner(), f.orgId);
    expect(list).toMatchObject({ ok: true, reviews: [{ commentsOpen: 0, commentsTotal: 1 }] });
    const resolvedBy = (await f.sql.query<{ resolved_by: string }>('select resolved_by from brand_studio_review_comments where id = $1', [rootId])).rows[0];
    expect(resolvedBy).toEqual({ resolved_by: f.ids.editor });
    expect((await op(owner(), 'comment.resolve', ref)).result).toEqual({ ok: true });
    list = await loadReviewList(reviewDeps(deps), owner(), f.orgId);
    expect(list).toMatchObject({ ok: true, reviews: [{ commentsOpen: 1 }] });

    expect((await op(viewerOf(f.ids.editor), 'comment.delete', ref)).result).toEqual({ ok: false, code: 'forbidden' });
    const reply = ((await comment(viewerOf(f.ids.editor), reviewId, { body: 'on it', parentId: rootId })).result as ReviewCommentAdded).comment.id;
    expect((await op(owner(), 'comment.delete', ref)).result).toEqual({ ok: true });
    const detail = await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, reviewId);
    if (!detail.ok) throw new Error('detail');
    // The head of a thread with replies stays as a placeholder with no text or author.
    expect(detail.comments.find((c) => c.id === rootId)).toMatchObject({ deleted: true, body: '', authorName: null, mine: false });
    expect(detail.comments.find((c) => c.id === reply)).toMatchObject({ deleted: false, body: 'on it' });
    expect((await op(owner(), 'comment.delete', ref)).result).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('status and removal', () => {
  it('moves the status, records who moved it, and tells the team only on a real change', async () => {
    const reviewId = await openReview();
    const asked = await op(viewerOf(f.ids.editor), 'review.status', { organizationId: f.orgId, reviewId, status: 'changes_requested' });
    expect(asked.result).toEqual({ ok: true });
    expect(asked.notice!.body).toBe(`[리뷰 상태] Spring film v1 → 수정 요청\n관리자 화면: https://admin.twings.app/admin/brand-studio/reviews/${reviewId}`);
    const same = await op(viewerOf(f.ids.editor), 'review.status', { organizationId: f.orgId, reviewId, status: 'changes_requested' });
    expect(same).toEqual({ result: { ok: true }, notice: null });
    expect((await op(owner(), 'review.status', { organizationId: f.orgId, reviewId, status: 'done' })).result).toEqual({ ok: false, code: 'invalid' });
    const row = (await f.sql.query<{ status: string; status_changed_by: string }>('select status, status_changed_by from brand_studio_reviews where id = $1', [reviewId])).rows[0];
    expect(row).toEqual({ status: 'changes_requested', status_changed_by: f.ids.editor });
  });

  it('removes a review from the list and lets the piece be put up again', async () => {
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    const first = (await op(owner(), 'review.create', { organizationId: f.orgId, outputId, title: 'First' })).result as ReviewCreated;
    expect((await op(owner(), 'review.delete', { organizationId: f.orgId, reviewId: first.review.id })).result).toEqual({ ok: true });
    expect(await loadReviewList(reviewDeps(deps), owner(), f.orgId)).toMatchObject({ ok: true, reviews: [] });
    expect(await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, first.review.id)).toEqual({ ok: false, code: 'not_found' });
    const second = (await op(owner(), 'review.create', { organizationId: f.orgId, outputId, title: 'Second' })).result as ReviewCreated;
    expect(second).toMatchObject({ ok: true, existing: false });
    expect(second.review.id).not.toBe(first.review.id);
  });

  it('shows a piece deleted from the studio as unavailable, keeping its notes', async () => {
    const assetId = await seedVideoAsset(deps, f.orgId, f.ids.owner);
    const created = (await op(owner(), 'review.create', { organizationId: f.orgId, assetId, title: 'Ref film' })).result as ReviewCreated;
    await comment(owner(), created.review.id, { atMs: 500 });
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [assetId]);
    const detail = await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, created.review.id);
    expect(detail).toMatchObject({ ok: true, review: { available: false, mediaUrl: null, thumbUrl: null }, comments: [{ atMs: 500 }] });
  });

  it('lists the most recently active piece first', async () => {
    const a = await openReview('image');
    const b = await openReview('image');
    await f.sql.query("update brand_studio_reviews set updated_at = now() - interval '1 hour'");
    await comment(owner(), a);
    const list = await loadReviewList(reviewDeps(deps), owner(), f.orgId);
    expect(list.ok && list.reviews.map((r) => r.id)).toEqual([a, b]);
  });
});

describe('the team side', () => {
  const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });

  it('re-reads the admin flag from the profile, whatever the session says', async () => {
    const reviewId = await openReview();
    const pretender = { ...viewerOf(f.ids.owner), isAdmin: true };
    expect(await staffReviewList(reviewDeps(deps), pretender)).toEqual({ ok: false, code: 'forbidden' });
    expect(await staffAddComment(reviewDeps(deps), pretender, { reviewId, body: 'hi' })).toEqual({ ok: false, code: 'forbidden' });
    expect(await staffSetStatus(reviewDeps(deps), pretender, { reviewId, status: 'approved' })).toEqual({ ok: false, code: 'forbidden' });
  });

  it('replies as the YAGI team, resolves, moves the status and sees every organization', async () => {
    const reviewId = await openReview();
    const root = ((await comment(owner(), reviewId, { atMs: 3000 })).result as ReviewCommentAdded).comment.id;
    const list = await staffReviewList(reviewDeps(deps), admin());
    expect(list).toMatchObject({ ok: true, reviews: [{ id: reviewId, organizationName: 'Studio fixture brand', commentsOpen: 1 }] });
    expect(await staffReviewList(reviewDeps(deps), admin(), { status: 'approved' })).toMatchObject({ ok: true, reviews: [] });

    const reply = await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'Fixed in v2', parentId: root });
    expect(reply).toMatchObject({ ok: true, comment: { authorRole: 'studio', authorName: null, parentId: root, mine: true } });
    const stored = (await f.sql.query<{ author_role: string; author_id: string }>('select author_role, author_id from brand_studio_review_comments where parent_id = $1', [root])).rows[0];
    expect(stored).toEqual({ author_role: 'studio', author_id: f.ids.admin });
    expect(await staffResolveComment(reviewDeps(deps), admin(), { reviewId, commentId: root })).toEqual({ ok: true });
    expect(await staffSetStatus(reviewDeps(deps), admin(), { reviewId, status: 'approved' })).toEqual({ ok: true });
    expect(await staffSetStatus(reviewDeps(deps), admin(), { reviewId, status: 'nope' })).toEqual({ ok: false, code: 'invalid' });

    const brandView = await loadReviewDetail(reviewDeps(deps), owner(), f.orgId, reviewId);
    expect(brandView).toMatchObject({ ok: true, review: { status: 'approved', commentsOpen: 0 } });
    if (!brandView.ok) throw new Error('detail');
    expect(brandView.comments.find((c) => c.parentId === root)).toMatchObject({ authorRole: 'studio', authorName: null, mine: false });
    expect(await staffReviewDetail(reviewDeps(deps), admin(), reviewId)).toMatchObject({ ok: true, organizationName: 'Studio fixture brand', canWrite: true });
  });

  it('opens a review on an existing piece, never for a sandboxed client', async () => {
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const created = await staffCreateReview(reviewDeps(deps), admin(), { organizationId: f.orgId, outputId, title: 'Delivery v1' });
    expect(created).toMatchObject({ ok: true, existing: false });
    const row = (await f.sql.query<{ created_role: string; created_by: string }>('select created_role, created_by from brand_studio_reviews')).rows[0];
    expect(row).toEqual({ created_role: 'studio', created_by: f.ids.admin });

    const sandboxId = [...SANDBOXED_CLIENT_ORG_IDS][1]!;
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [sandboxId, 'Client', f.ids.owner, randomUUID()]);
    const sandboxOutput = await seedOutput(deps, sandboxId, f.ids.owner, 'video');
    expect(await staffCreateReview(reviewDeps(deps), admin(), { organizationId: sandboxId, outputId: sandboxOutput, title: 'No' })).toEqual({ ok: false, code: 'feature_unavailable' });
    const named = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [named, 'Morphic Korea', f.ids.owner, randomUUID()]);
    const namedOutput = await seedOutput(deps, named, f.ids.owner, 'image');
    expect(await staffCreateReview(reviewDeps(deps), admin(), { organizationId: named, outputId: namedOutput, title: 'No' })).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(await staffCreateReview(reviewDeps(deps), admin(), { organizationId: f.orgId, outputId: namedOutput, title: 'Wrong org' })).toEqual({ ok: false, code: 'not_found' });
  });
});
