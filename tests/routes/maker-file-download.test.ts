import { describe, expect, it, vi } from 'vitest';

/** `GET /api/makers/files/{ast_…}?download=1` saves the file (2026-10-29): same access rule, attachment. */

const state = vi.hoisted(() => ({ object: null as { key: string; mime: string; publicCache: boolean } | null }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ tier: 'anon', userId: null, email: null, isAdmin: false, locale: 'en' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/recipes/media', () => ({ makerFileObject: async () => state.object }));
vi.mock('@/lib/renders/store', () => ({
  getRenderStore: async () => ({ read: async () => new TextEncoder().encode('FILE'), url: async () => 'https://storage.example/signed' }),
}));

import { GET } from '@/app/api/makers/files/[file]/route';

const HANDLE = 'ast_0123456789abcdef0123456789abcdef';
const call = (query = '') => GET(new Request(`https://twings.app/api/makers/files/${HANDLE}${query}`), { params: Promise.resolve({ file: HANDLE }) });

describe('maker file download', () => {
  it('streams a disclosed file inline, and as an attachment with ?download=1', async () => {
    state.object = { key: 'k', mime: 'image/jpeg', publicCache: true };
    expect((await call()).headers.get('content-disposition')).toBeNull();
    const saved = await call('?download=1');
    expect(saved.status).toBe(200);
    expect(saved.headers.get('content-disposition')).toBe('attachment; filename="twings-01234567.jpg"');
    expect(saved.headers.get('content-type')).toBe('image/jpeg');
  });

  it('streams the owner a private file for a download instead of redirecting', async () => {
    state.object = { key: 'k', mime: 'video/mp4', publicCache: false };
    expect((await call()).status).toBe(302);
    const saved = await call('?download=1');
    expect(saved.status).toBe(200);
    expect(saved.headers.get('content-disposition')).toBe('attachment; filename="twings-01234567.mp4"');
    expect(saved.headers.get('cache-control')).toBe('private, no-store');
  });

  it('is still a 404 for a file nobody may see', async () => {
    state.object = null;
    expect((await call('?download=1')).status).toBe(404);
  });
});
