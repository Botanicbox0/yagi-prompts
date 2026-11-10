import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { memoryStaging, pngBytes, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §5, §9 — `/api/brand-rooms/storyboards` and its local upload gateway over HTTP:
 * the guard order (flag 404 -> sign-in 401 -> seat and project 404 -> role 403), the same-origin rule,
 * answers private and uncached, and a picture going reserve -> local POST -> complete.
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  media: null as ReturnType<typeof createMemoryMediaStore> | null,
  staging: null as ReturnType<typeof memoryStaging> | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
vi.mock('@/lib/storage', async (original) => ({ ...(await original<typeof import('@/lib/storage')>()), getStorage: async () => mocks.staging }));
vi.mock('@/lib/brand-studio/media-store', async (original) => ({
  ...(await original<typeof import('@/lib/brand-studio/media-store')>()),
  createStudioMediaStore: () => mocks.media,
}));

const route = await import('@/app/api/brand-rooms/storyboards/route');
const upload = await import('@/app/api/brand-rooms/storyboards/upload/[id]/route');
const BASE = 'http://localhost:3000/api/brand-rooms/storyboards';

let f: StudioFixture;
const q = () => `organizationId=${f.orgId}&projectId=${f.projectId}`;
const get = (extra = '') => route.GET(new NextRequest(`${BASE}?${q()}${extra}`));
const post = (operation: string, input: Record<string, unknown>, headers: Record<string, string> = {}) =>
  route.POST(
    new NextRequest(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ operation, input: { organizationId: f.orgId, projectId: f.projectId, ...input } }),
    }),
  );
const sendBytes = (path: string, bytes: Uint8Array, type: string, headers: Record<string, string> = {}) =>
  upload.POST(new NextRequest(`http://localhost:3000${path}`, { method: 'POST', headers: { 'content-type': type, ...headers }, body: Buffer.from(bytes) }), {
    params: Promise.resolve({ id: path.split('/').pop()! }),
  });

beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  mocks.media = createMemoryMediaStore();
  mocks.staging = memoryStaging();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  mocks.sql = null;
  mocks.viewer = null;
});

async function createBoard(): Promise<string> {
  const response = await post('board.create', { title: 'Spring film' });
  expect(response.status).toBe(201);
  return (await response.json()).board.id;
}

describe('/api/brand-rooms/storyboards', () => {
  it('is a 404 for everyone while the flag is off', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect((await get()).status).toBe(404);
    expect((await post('board.create', { title: 'x' })).status).toBe(404);
    expect((await sendBytes('/api/brand-rooms/storyboards/upload/00000000-0000-4000-8000-000000000000', new Uint8Array([1]), 'image/png')).status).toBe(404);
    expect(await f.sql.query('select count(*)::int as n from brand_storyboards')).toEqual({ rows: [{ n: 0 }] });
  });

  it('wants a session, refuses a cross-site post, and answers private and uncached', async () => {
    mocks.viewer = null;
    expect((await get()).status).toBe(401);
    expect((await post('board.create', { title: 'x' })).status).toBe(401);
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await post('board.create', { title: 'x' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const boardId = await createBoard();
    const list = await get();
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('private, no-store');
    expect(list.headers.get('x-robots-tag')).toContain('noindex');
    expect(await list.json()).toMatchObject({ ok: true, canEdit: true, boards: [{ id: boardId, status: 'draft', cuts: 0 }] });
    expect(await (await get(`&board=${boardId}`)).json()).toMatchObject({ ok: true, editable: true, board: { id: boardId } });
  });

  it('answers 404 to an outsider and to another project, 403 to a viewer’s write, 400 to an unknown operation', async () => {
    const boardId = await createBoard();
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await post('board.update', { storyboardId: boardId, title: 'x' })).status).toBe(403);
    expect((await get(`&board=${boardId}`)).status).toBe(200);
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await get()).status).toBe(404);
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await route.GET(new NextRequest(`${BASE}?organizationId=${f.orgId}&projectId=00000000-0000-4000-8000-000000000000`))).status).toBe(404);
    expect((await post('board.explode', { storyboardId: boardId })).status).toBe(400);
  });

  it('takes a picture through the local gateway and turns it into a cut', async () => {
    const boardId = await createBoard();
    const bytes = await pngBytes(80, 45);
    const reserved = await (await post('frame.reserve', { storyboardId: boardId, name: '01.png', mime: 'image/png', sizeBytes: bytes.byteLength, text: { description: 'Opening' } })).json();
    expect(reserved).toMatchObject({ ok: true, direct: false, url: `/api/brand-rooms/storyboards/upload/${reserved.frameId}` });
    expect((await sendBytes(reserved.url, bytes, 'image/jpeg')).status).toBe(415);
    mocks.viewer = viewerOf(f.ids.viewer);
    expect((await sendBytes(reserved.url, bytes, 'image/png')).status).toBe(404);
    mocks.viewer = viewerOf(f.ids.owner);
    expect((await sendBytes(reserved.url, new Uint8Array(bytes.byteLength + 10), 'image/png')).status).toBe(413);
    expect((await sendBytes(reserved.url, bytes, 'image/png', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await sendBytes(reserved.url, bytes, 'image/png')).status).toBe(200);
    const done = await post('frame.complete', { storyboardId: boardId, frameId: reserved.frameId });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ ok: true, frame: { id: reserved.frameId, description: 'Opening', width: 80, height: 45 } });
    expect((await post('board.share', { storyboardId: boardId })).status).toBe(200);
    expect((await post('frame.delete', { storyboardId: boardId, frameId: reserved.frameId })).status).toBe(409);
  });

  it('is a brand route; the command-line door is not', () => {
    expect(brandRouteAllowed('/api/brand-rooms/storyboards', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/storyboards', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/storyboards/upload/00000000-0000-4000-8000-000000000000', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-rooms/storyboards/upload/00000000-0000-4000-8000-000000000000', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-rooms/ingest', 'POST')).toBe(false);
  });
});
