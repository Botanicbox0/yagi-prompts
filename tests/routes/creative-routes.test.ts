import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * docs/PLATFORM-2.0.md §20 — the public doors of the AI creative system: `twings.app/@handle` opens
 * the creative's page in the reader's language; a template's full recipe needs a signed-in member;
 * the MCP endpoint needs a creative token and refuses a foreign browser origin.
 */

const state = vi.hoisted(() => ({ userId: null as string | null, token: null as string | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ tier: state.userId ? 'free' : 'anon', userId: state.userId, email: null, isAdmin: false, locale: null }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({ query: async () => ({ rows: [] }) }) }));
vi.mock('@/lib/recipes/public', () => ({
  loadPublicRecipe: async () => ({ presentation: 'make-first', intro: null, outro: null, steps: [{ n: 1, kind: 'image', engine: 'GPT IMAGE 2', inputs: [], prompt: 'MEMBER ONLY', note: null }], files: null }),
  recordRecipeOpen: async () => undefined,
}));
vi.mock('@/lib/makers/tokens', () => ({ resolveMakerToken: async (_sql: unknown, auth: string | null) => (auth === `Bearer ${state.token}` ? 'creative-id' : null) }));
vi.mock('@/lib/mcp/server', () => ({ handleMcp: async (_deps: unknown, body: { id?: number; method?: string }) => (body.method?.startsWith('notifications/') ? null : { jsonrpc: '2.0', id: body.id ?? null, result: {} }) }));
vi.mock('@/lib/renders/store', () => ({ getRenderStore: async () => ({}) }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: async () => undefined }));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: () => undefined }));

import { middleware } from '@/middleware';
import { GET as recipeGET } from '@/app/api/recipes/[id]/route';
import { GET as mcpGET, POST as mcpPOST } from '@/app/api/mcp/route';

const ID = '7a000000-0000-4000-8000-000000000065';
const page = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://twings.app${path}`, { headers: { host: 'twings.app', ...headers } });

describe('creative short link', () => {
  it('sends /@handle (any case, with or without a locale) to the creative page in the reader’s language', async () => {
    const ko = await middleware(page('/@Jun_Films', { 'accept-language': 'ko-KR,ko;q=0.9' }));
    expect(ko.status).toBe(307);
    expect(new URL(ko.headers.get('location')!).pathname).toBe('/ko/makers/jun_films');
    const en = await middleware(page('/en/@jun_films?utm_source=ig'));
    expect(new URL(en.headers.get('location')!).pathname).toBe('/en/makers/jun_films');
    expect(new URL(en.headers.get('location')!).searchParams.get('utm_source')).toBe('ig');
    // Not a handle: the ordinary locale redirect, never the creative page.
    expect(new URL((await middleware(page('/@a'))).headers.get('location')!).pathname).not.toContain('/makers/');
  });
});

describe('member-only recipe', () => {
  it('answers 401 to an anonymous reader and the full recipe to a member, never cached publicly', async () => {
    state.userId = null;
    const anon = await recipeGET(new Request(`https://twings.app/api/recipes/${ID}?locale=en`), { params: Promise.resolve({ id: ID }) });
    expect(anon.status).toBe(401);
    expect(await anon.text()).not.toContain('MEMBER ONLY');
    state.userId = 'f0000000-0000-4000-8000-000000000001';
    const member = await recipeGET(new Request(`https://twings.app/api/recipes/${ID}?locale=en`), { params: Promise.resolve({ id: ID }) });
    expect(member.status).toBe(200);
    expect(member.headers.get('cache-control')).toBe('private, no-store');
    expect((await member.json()).recipe.steps[0].prompt).toBe('MEMBER ONLY');
    expect((await recipeGET(new Request('https://twings.app/api/recipes/nope'), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(404);
  });
});

describe('MCP endpoint', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) => mcpPOST(new Request('https://twings.app/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', host: 'twings.app', ...headers }, body: JSON.stringify(body) }));

  it('needs a creative token, refuses a foreign browser origin, and answers 202 to a notification', async () => {
    state.token = `twk_${'a'.repeat(40)}`;
    const missing = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    const auth = { authorization: `Bearer ${state.token}` };
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { ...auth, origin: 'https://evil.example' })).status).toBe(403);
    const ok = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, auth);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, auth)).status).toBe(202);
    const broken = await mcpPOST(new Request('https://twings.app/api/mcp', { method: 'POST', headers: { host: 'twings.app', ...auth }, body: '{nope' }));
    expect(await broken.json()).toMatchObject({ error: { code: -32700 } });
    expect(mcpGET().status).toBe(405);
  });
});
