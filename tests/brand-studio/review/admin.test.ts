import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin, outcomeUrl } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { runReviewOperation } from '@/lib/brand-studio/review';
import type { ReviewCommentAdded, ReviewCreated } from '@/lib/brand-studio/review-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { reviewDeps, seedOutput } from './fixtures';

/**
 * docs/BRAND-STUDIO-V3.md §7 — the team's writes go through the admin registry (`/admin/do`) only:
 * registered, refused for a non-admin before the form is read, re-checked against the profile row,
 * stored as the YAGI team, and returning to the review's admin page.
 */
let f: StudioFixture;
beforeEach(async () => {
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const ctx = (userId: string, isAdmin: boolean): AdminContext => ({ sql: f.sql, storage: {} as never, viewer: { ...viewerOf(userId), isAdmin } });
const form = (op: string, fields: Record<string, string>) => {
  const data = new FormData();
  data.set('_op', op);
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

async function brandReview() {
  const deps = studioDeps(f.sql);
  const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
  const created = (await runReviewOperation(reviewDeps(deps), viewerOf(f.ids.owner), 'review.create', { organizationId: f.orgId, outputId, title: 'Spring film' })).result as ReviewCreated;
  const root = (
    (await runReviewOperation(reviewDeps(deps), viewerOf(f.ids.owner), 'comment.add', { organizationId: f.orgId, reviewId: created.review.id, body: 'Logo', atMs: 400 }))
      .result as ReviewCommentAdded
  ).comment.id;
  return { reviewId: created.review.id, root };
}

describe('brand_studio.review.* admin operations', () => {
  it('are registered', () => {
    for (const name of ['brand_studio.review.reply', 'brand_studio.review.resolve', 'brand_studio.review.status', 'brand_studio.review.create']) {
      expect(ADMIN_OPERATION_NAMES).toContain(name);
    }
  });

  it('refuse a non-admin session, and a session that claims admin without the profile flag', async () => {
    const { reviewId, root } = await brandReview();
    expect(await dispatchAdmin('brand_studio.review.reply', form('brand_studio.review.reply', { reviewId, body: 'hi' }), ctx(f.ids.owner, false))).toEqual({ ok: false, code: 'forbidden' });
    const claimed = await dispatchAdmin('brand_studio.review.resolve', form('brand_studio.review.resolve', { reviewId, commentId: root }), ctx(f.ids.owner, true));
    expect(claimed).toMatchObject({ ok: false, code: 'forbidden' });
    expect((await f.sql.query('select resolved_at from brand_studio_review_comments where id = $1', [root])).rows[0]).toEqual({ resolved_at: null });
  });

  it('reply as the YAGI team at a moment and a spot, resolve, move the status, and return to the review', async () => {
    const { reviewId, root } = await brandReview();
    const admin = ctx(f.ids.admin, true);
    const replied = await dispatchAdmin('brand_studio.review.reply', form('brand_studio.review.reply', { reviewId, body: 'Fixed in v2', parentId: root }), admin);
    expect(replied).toEqual({ ok: true, code: 'saved', to: `/admin/brand-studio/reviews/${reviewId}` });
    expect(outcomeUrl('/admin/brand-studio/reviews', replied)).toBe(`/admin/brand-studio/reviews/${reviewId}?ok=saved`);
    const note = await dispatchAdmin('brand_studio.review.reply', form('brand_studio.review.reply', { reviewId, body: 'Also this frame', atMs: '1200.4', x: '0.25', y: '0.5' }), admin);
    expect(note).toMatchObject({ ok: true });
    const rows = (
      await f.sql.query<{ author_role: string; author_id: string; at_ms: number | null; x: number | null; parent_id: string | null }>(
        "select author_role, author_id, at_ms, x, parent_id from brand_studio_review_comments where author_role = 'studio' order by created_at",
      )
    ).rows;
    expect(rows).toEqual([
      { author_role: 'studio', author_id: f.ids.admin, at_ms: null, x: null, parent_id: root },
      { author_role: 'studio', author_id: f.ids.admin, at_ms: 1200, x: 0.25, parent_id: null },
    ]);
    expect(await dispatchAdmin('brand_studio.review.reply', form('brand_studio.review.reply', { reviewId, body: 'x', atMs: 'soon' }), admin)).toMatchObject({ ok: false, code: 'invalid' });
    expect(await dispatchAdmin('brand_studio.review.reply', form('brand_studio.review.reply', { reviewId, body: '' }), admin)).toMatchObject({ ok: false, code: 'invalid' });

    expect(await dispatchAdmin('brand_studio.review.resolve', form('brand_studio.review.resolve', { reviewId, commentId: root }), admin)).toMatchObject({ ok: true });
    const resolved = (await f.sql.query<{ resolved_by: string }>('select resolved_by from brand_studio_review_comments where id = $1', [root])).rows[0];
    expect(resolved).toEqual({ resolved_by: f.ids.admin });
    expect(await dispatchAdmin('brand_studio.review.status', form('brand_studio.review.status', { reviewId, status: 'approved' }), admin)).toMatchObject({ ok: true });
    expect((await f.sql.query('select status, status_changed_by from brand_studio_reviews where id = $1', [reviewId])).rows[0]).toEqual({ status: 'approved', status_changed_by: f.ids.admin });
    expect(await dispatchAdmin('brand_studio.review.status', form('brand_studio.review.status', { reviewId: '00000000-0000-4000-8000-000000000000', status: 'open' }), admin)).toMatchObject({
      ok: false,
      code: 'notFound',
    });
  });

  it('open a review on an existing result or asset of that organization', async () => {
    const outputId = await seedOutput(studioDeps(f.sql), f.orgId, f.ids.owner, 'image');
    const admin = ctx(f.ids.admin, true);
    const created = await dispatchAdmin('brand_studio.review.create', form('brand_studio.review.create', { organizationId: f.orgId, subjectKind: 'output', subjectId: outputId, title: 'Delivery v1' }), admin);
    expect(created).toMatchObject({ ok: true, code: 'created' });
    const again = await dispatchAdmin('brand_studio.review.create', form('brand_studio.review.create', { organizationId: f.orgId, subjectKind: 'output', subjectId: outputId, title: 'Delivery v1' }), admin);
    expect(again).toMatchObject({ ok: true, code: 'saved' });
    expect(created.ok && again.ok && created.to).toBe(again.ok ? again.to : null);
    expect(await dispatchAdmin('brand_studio.review.create', form('brand_studio.review.create', { organizationId: f.orgId, subjectKind: 'asset', subjectId: outputId, title: 'Wrong kind' }), admin)).toMatchObject({
      ok: false,
      code: 'notFound',
    });
    expect(await dispatchAdmin('brand_studio.review.create', form('brand_studio.review.create', { organizationId: f.orgId, subjectKind: 'file', subjectId: outputId, title: 'x' }), admin)).toMatchObject({
      ok: false,
      code: 'invalid',
    });
  });
});
