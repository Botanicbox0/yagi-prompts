import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §5 — the team's two review screens from a real schema: the detail page reads
 * the team note, tags it and offers "팀만 보기"; the list counts team notes in their own column.
 */
const db = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => db.viewer, getViewer: async () => db.viewer }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/brand-studio/reviews',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { runReviewOperation, staffAddComment } from '@/lib/brand-studio/review';
import type { ReviewCreated } from '@/lib/brand-studio/review-contracts';
import ReviewsPage from '@/app/(admin)/admin/brand-studio/reviews/page';
import ReviewDetailPage from '@/app/(admin)/admin/brand-studio/reviews/[id]/page';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { reviewDeps, seedOutput } from './fixtures';

const SECRET = 'internal: the brand asked twice, keep the blue';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

let f: StudioFixture;
let reviewId = '';
beforeAll(async () => {
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  f = await studioFixture();
  db.sql = f.sql;
  db.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
  const deps = studioDeps(f.sql);
  const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
  reviewId = ((await runReviewOperation(reviewDeps(deps), viewerOf(f.ids.owner), 'review.create', { organizationId: f.orgId, outputId, title: 'Spring film v1' })).result as ReviewCreated).review.id;
  await runReviewOperation(reviewDeps(deps), viewerOf(f.ids.owner), 'comment.add', { organizationId: f.orgId, reviewId, body: 'Logo smaller', atMs: 1500 });
  const added = await staffAddComment(reviewDeps(deps), db.viewer, { reviewId, body: SECRET, atMs: 2500, visibility: 'team' });
  expect(added.ok).toBe(true);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('the team review pages', () => {
  it('the detail page reads the team note, tags it, and offers the switch', async () => {
    const page = await html(ReviewDetailPage({ params: Promise.resolve({ id: reviewId }), searchParams: Promise.resolve({}) }));
    expect(page).toContain('Logo smaller');
    expect(page).toContain(SECRET);
    expect(page).toContain('data-review-team-toggle');
    expect(page).toContain('팀만 보기');
    expect(page).toContain('data-review-team-tag');
    expect(page).toContain('팀 메모');
  });

  it('the list counts team notes in their own column', async () => {
    const page = await html(ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('팀 메모');
    const row = page.slice(page.indexOf(`data-admin-review-row="${reviewId}"`));
    expect(row.slice(0, row.indexOf('</tr>'))).toMatch(/1 \/ 1[\s\S]*1 \/ 1/);
  });
});
