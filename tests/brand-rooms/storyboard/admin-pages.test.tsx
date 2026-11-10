import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactNode } from 'react';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/BRAND-ROOMS.md §5 — the team's two storyboard screens rendered from a real schema: the list
 * across brands with the "new storyboard" form, a draft opening in the editor, and a shared board read
 * only. The writes themselves are pinned in admin.test.ts.
 */
const db = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => db.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ admin: true }), publicHref: (path: string) => `https://twings.app${path}` }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: async () => db.viewer, getViewer: async () => db.viewer }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/admin/brand-rooms/storyboards',
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/components/brand-rooms/share', () => ({ ShareButton: () => null }));
vi.mock('@/components/brand-rooms/chat', () => ({ RoomThread: () => null, RoomChannel: () => null }));

import { staffCreateStoryboard, staffReplaceFrames, staffShareStoryboard } from '@/lib/brand-rooms/storyboards';
import ListPage from '@/app/(admin)/admin/brand-rooms/storyboards/page';
import DetailPage from '@/app/(admin)/admin/brand-rooms/storyboards/[id]/page';
import { pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

async function html(node: ReactNode | Promise<ReactNode>) {
  const { prelude } = await prerender(await node);
  return new Response(prelude).text();
}

let f: StudioFixture;
let draftId = '';
let sharedId = '';
beforeAll(async () => {
  f = await studioFixture();
  db.sql = f.sql;
  db.viewer = { ...viewerOf(f.ids.admin), isAdmin: true };
  const deps = studioDeps(f.sql);
  draftId = ((await staffCreateStoryboard(deps, db.viewer, { projectId: f.projectId, title: 'Launch film' })) as { board: { id: string } }).board.id;
  await staffReplaceFrames(deps, db.viewer, { storyboardId: draftId, frames: [{ picture: await pngBytes(30, 20), text: { scene: '1', shot: '1', description: 'Opening' } }] });
  sharedId = ((await staffCreateStoryboard(deps, db.viewer, { projectId: f.projectId, title: 'Teaser' })) as { board: { id: string } }).board.id;
  await staffReplaceFrames(deps, db.viewer, { storyboardId: sharedId, frames: [{ picture: await pngBytes(30, 20), text: { description: 'Logo' } }] });
  await staffShareStoryboard(deps, db.viewer, { storyboardId: sharedId });
});
afterAll(async () => {
  await f.db.close();
});

describe('/admin/brand-rooms/storyboards', () => {
  it('lists boards across brands with the form to start one for a project', async () => {
    const page = await html(ListPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain('data-admin-storyboards');
    expect(page).toContain(`data-admin-storyboard-row="${draftId}"`);
    expect(page).toContain(`data-admin-storyboard-row="${sharedId}"`);
    expect(page).toContain('Studio fixture brand');
    expect(page).toContain('Spring launch');
    expect(page).toContain(`href="/admin/brand-rooms/storyboards/${draftId}"`);
    expect(page).toContain('value="brand_rooms.storyboard.create"');
    expect(page).toContain(`value="${f.projectId}"`);
  });

  it('opens a draft in the editor and a shared board read only', async () => {
    const draft = await html(DetailPage({ params: Promise.resolve({ id: draftId }), searchParams: Promise.resolve({}) }));
    expect(draft).toContain(`data-admin-storyboard="${draftId}"`);
    expect(draft).toContain(`data-storyboard-editor="${draftId}"`);
    expect(draft).toContain('Opening');
    expect(draft).toContain('value="brand_rooms.storyboard.version"');
    expect(draft).toContain('value="brand_rooms.storyboard.delete"');
    expect(draft).toContain('브랜드에 공유');
    const shared = await html(DetailPage({ params: Promise.resolve({ id: sharedId }), searchParams: Promise.resolve({}) }));
    expect(shared).toContain(`data-storyboard-readonly="${sharedId}"`);
    expect(shared).not.toContain('data-storyboard-editor');
  });

  it('answers 404 for a board that does not exist', async () => {
    await expect(html(DetailPage({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }), searchParams: Promise.resolve({}) }))).rejects.toThrow();
  });
});
