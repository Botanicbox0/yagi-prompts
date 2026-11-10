import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-STUDIO-V3.md §7 — the team's two screens rendered from a real schema: the list across
 * brands (organization, title, status, open notes, last activity, the "open a review" form) and the
 * detail with the same stage, whose writes post the registered `brand_studio.review.*` operations.
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

import { runReviewOperation } from '@/lib/brand-studio/review';
import type { ReviewCreated } from '@/lib/brand-studio/review-contracts';
import ReviewsPage from '@/app/(admin)/admin/brand-studio/reviews/page';
import ReviewDetailPage from '@/app/(admin)/admin/brand-studio/reviews/[id]/page';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { reviewDeps, seedOutput } from './fixtures';

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
  await runReviewOperation(reviewDeps(deps), viewerOf(f.ids.owner), 'comment.add', { organizationId: f.orgId, reviewId, body: 'Logo smaller', atMs: 1500, x: 0.2, y: 0.3 });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('/admin/brand-studio/reviews', () => {
  it('lists reviews across brands with their open notes and the form to open one', async () => {
    const page = await html(ReviewsPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('data-admin-studio-reviews');
    expect(page).toContain(`data-admin-review-row="${reviewId}"`);
    expect(page).toContain('Studio fixture brand');
    expect(page).toContain('Spring film v1');
    expect(page).toContain(`href="/admin/brand-studio/reviews/${reviewId}"`);
    expect(page).toContain('스튜디오 리뷰');
    expect(page).toContain('1 / 1');
    expect(page).toContain('data-admin-review-create');
    expect(page).toContain('value="brand_studio.review.create"');
  });

  it('filters by status', async () => {
    const page = await html(ReviewsPage({ searchParams: Promise.resolve({ status: 'approved' }) }));
    expect(page).not.toContain(`data-admin-review-row="${reviewId}"`);
  });

  it('opens one review on the shared stage, naming the brand', async () => {
    const page = await html(ReviewDetailPage({ params: Promise.resolve({ id: reviewId }), searchParams: Promise.resolve({ t: '1500' }) }));
    expect(page).toContain(`data-admin-studio-review="${reviewId}"`);
    expect(page).toContain(`data-review-stage="${reviewId}"`);
    expect(page).toContain('브랜드: Studio fixture brand');
    expect(page).toContain('data-review-pin=');
    expect(page).toContain('data-review-composer');
    expect(page).toContain('Logo smaller');
  });

  it('answers 404 for a review that does not exist', async () => {
    await expect(html(ReviewDetailPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }), searchParams: Promise.resolve({}) }))).rejects.toThrow();
  });
});
