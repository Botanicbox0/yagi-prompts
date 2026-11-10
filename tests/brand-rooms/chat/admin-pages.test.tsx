import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-ROOMS.md §4 — the team's two conversation screens rendered from a real schema: every
 * organization's channels with the brand lines waiting for the team, and one organization's channels
 * beside the chosen conversation, whose project header leads to that project's storyboards and
 * deliverables. Both are a 404 while the flag is off; the brand workspace console links to the list.
 */
const db = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => db.viewer, getViewer: async () => db.viewer }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/brand-rooms',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import RoomsPage from '@/app/(admin)/admin/brand-rooms/page';
import RoomPage from '@/app/(admin)/admin/brand-rooms/[organizationId]/page';
import { studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

let f: StudioFixture;
beforeAll(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  db.sql = f.sql;
  db.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
  await runRoomOperation({ sql: f.sql, media: createMemoryMediaStore() }, viewerOf(f.ids.owner), 'message.send', {
    organizationId: f.orgId,
    projectId: f.projectId,
    requestId: randomUUID(),
    body: '첫 시안은 언제 볼 수 있을까요?',
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('/admin/brand-rooms', () => {
  it('lists conversations across brands, the waiting ones first, and every open brand', async () => {
    const page = await html(RoomsPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('data-admin-brand-rooms');
    expect(page).toContain(`data-admin-room-row="${f.orgId}:${f.projectId}"`);
    expect(page).toContain('Spring launch');
    expect(page).toContain('첫 시안은 언제 볼 수 있을까요?');
    expect(page).toContain('1개 기다림');
    expect(page).toContain(`href="/admin/brand-rooms/${f.orgId}?channel=${f.projectId}"`);
    expect(page).toContain('data-admin-room-organizations');
  });

  it('opens one brand: its channels, the chosen conversation and the way to its storyboards and deliverables', async () => {
    const page = await html(RoomPage({ params: Promise.resolve({ organizationId: f.orgId }), searchParams: Promise.resolve({ channel: f.projectId }) }));
    expect(page).toContain(`data-admin-brand-room="${f.orgId}"`);
    expect(page).toContain('data-admin-room-channel="general"');
    expect(page).toContain(`data-admin-room-channel="${f.projectId}"`);
    expect(page).toContain(`data-room-channel="${f.projectId}"`);
    expect(page).toContain('data-admin-room-work-links');
    expect(page).toContain(`/admin/brand-rooms/storyboards?organizationId=${f.orgId}&amp;projectId=${f.projectId}`);
    expect(page).toContain(`/admin/brand-rooms/reviews?organizationId=${f.orgId}&amp;projectId=${f.projectId}`);
    const general = await html(RoomPage({ params: Promise.resolve({ organizationId: f.orgId }), searchParams: Promise.resolve({}) }));
    expect(general).toContain('data-room-channel="general"');
    expect(general).not.toContain('data-admin-room-work-links');
  });

  it('is a 404 for a missing organization and while the flag is off', async () => {
    await expect(RoomPage({ params: Promise.resolve({ organizationId: randomUUID() }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('BRAND_ROOMS', 'off');
    await expect(RoomsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('BRAND_ROOMS', 'on');
  });
});
