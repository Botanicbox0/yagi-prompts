import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * docs/PLATFORM-2.0.md §20.2 — the addresses a creative's pictures travel by: `/creative-media/…` on
 * public pages (edge-cacheable) and `/api/makers/media/…` for the studio's own preview. Both name a
 * work by id and an avatar or cover (0071) by handle; anything else is a 404 without a lookup.
 */

const state = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ tier: 'anon', userId: null, email: null, isAdmin: false, locale: 'en' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/makers/works', () => ({
  makerMediaObject: async (_sql: unknown, _viewer: string | null, id: string) => {
    state.asked.push(id);
    return id === 'cover-jun_01' ? { key: 'u/cover_0123456789abcdef.jpg', mime: 'image/jpeg', publicCache: true } : null;
  },
}));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({ read: async () => new TextEncoder().encode('JPEG') }) }));

import { GET as publicGET } from '@/app/creative-media/[file]/route';
import { GET as studioGET } from '@/app/api/makers/media/[id]/route';

const pub = (file: string) => publicGET(new Request(`https://twings.app/creative-media/${file}`), { params: Promise.resolve({ file }) });
const studio = (id: string) => studioGET(new Request(`https://twings.app/api/makers/media/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => { state.asked = []; });

describe('creative media addresses', () => {
  it('serves a public cover by handle, edge-cacheable, under the version its address names', async () => {
    const response = await pub('cover-jun_01-0123456789abcdef.jpg');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toContain('public');
    expect(state.asked).toEqual(['cover-jun_01']);
  });

  it('answers 404 without a lookup for an address that is not a work, avatar or cover', async () => {
    for (const file of ['cover-jun_01.jpg', 'cover-JUN_01-0123456789abcdef.jpg', 'cover-jun_01-0123456789abcdef.png', 'banner-jun_01-0123456789abcdef.jpg', 'cover-me-0123456789abcdef.jpg']) {
      expect((await pub(file)).status, file).toBe(404);
    }
    expect(state.asked).toEqual([]);
  });

  it("lets the studio ask for the creative's own cover, and nothing that is not one", async () => {
    expect((await studio('cover-me')).status).toBe(404);
    expect((await studio('cover-jun_01')).status).toBe(200);
    expect((await studio('cover-x')).status).toBe(404);
    expect(state.asked).toEqual(['cover-me', 'cover-me', 'cover-jun_01']);
  });
});
