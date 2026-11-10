import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-ROOMS.md §6 — the team's two screens from a real schema: the delivery desk (projects of open
 * brands only, the upload form, the project's drafts) and a draft's review page with its versions and the
 * brand's share links with the kill switch. Rooms off: the desk says so and offers nothing.
 */
const db = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko', getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => db.viewer, getViewer: async () => db.viewer }));
vi.mock('@/lib/brand-rooms/events', async (original) => ({ ...(await original<typeof import('@/lib/brand-rooms/events')>()), postRoomEvent: async () => undefined }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/brand-rooms/reviews',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import DeskPage from '@/app/(admin)/admin/brand-rooms/reviews/page';
import ReviewDetailPage from '@/app/(admin)/admin/brand-studio/reviews/[id]/page';
import { createShare } from '@/lib/brand-rooms/shares';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { roomDraft, teamDelivery } from './fixtures';
import type { ReviewCreated } from '@/lib/brand-studio/review-contracts';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

let f: StudioFixture;
let morphic: string;
let v2 = '';
beforeAll(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  db.sql = f.sql;
  db.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
  const deps = studioDeps(f.sql);
  const first = (await teamDelivery(f, deps)) as { created: ReviewCreated };
  v2 = ((await teamDelivery(f, deps, { stackReviewId: first.created.review.id, colour: 150 })) as { created: ReviewCreated }).created.review.id;
  await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: v2, passphrase: 'pass-word' });
  await roomDraft(f, deps, 'image', 'Brand still');
  morphic = (await f.sql.query<{ id: string }>(`insert into brand_organizations (id, name, created_by, request_id) values (gen_random_uuid(), 'Morphic Korea', $1, gen_random_uuid()) returning id`, [f.ids.owner])).rows[0]!.id;
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible) values (gen_random_uuid(), $1, 'Sandbox project', 'Launch the line', 'creator', $2, gen_random_uuid(), true)`,
    [morphic, f.ids.owner],
  );
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('/admin/brand-rooms/reviews', () => {
  it('lists projects of open brands only and the drafts of the chosen one', async () => {
    const page = await html(DeskPage({ searchParams: Promise.resolve({ projectId: f.projectId }) }));
    expect(page).toContain('data-admin-room-deliveries');
    expect(page).toContain('Spring launch');
    expect(page).not.toContain('Sandbox project');
    expect(page).toContain('data-admin-delivery-form');
    expect(page).toContain('data-admin-delivery-stack');
    expect(page).toContain('Main film');
    expect(page).toContain('v2 / 2');
    expect(page).toContain('야기 팀');
  });

  it('offers nothing while rooms are off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const page = await html(DeskPage({ searchParams: Promise.resolve({ projectId: f.projectId }) }));
    expect(page).toContain('data-admin-delivery-closed');
    expect(page).not.toContain('data-admin-delivery-form');
    vi.stubEnv('BRAND_ROOMS', 'on');
  });
});

describe('/admin/brand-studio/reviews/[id] with rooms on', () => {
  it('shows the versions and the brand’s share links with the kill switch, never a token', async () => {
    const page = await html(ReviewDetailPage({ params: Promise.resolve({ id: v2 }), searchParams: Promise.resolve({}) }));
    expect(page).toContain(`data-review-stage="${v2}"`);
    expect(page).toContain('data-review-versions');
    expect(page).toContain('data-admin-share-links');
    expect(page).toContain('value="brand_rooms.share.revoke"');
    expect(page).toContain('암호');
    const hash = (await f.sql.query<{ token_hash: string }>('select token_hash from brand_room_shares')).rows[0]!.token_hash;
    expect(page).not.toContain(hash);
  });
});
