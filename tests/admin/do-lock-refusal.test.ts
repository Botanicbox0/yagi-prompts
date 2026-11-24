import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { checkLockBlock, lockBlockRefusalDetail, TEMPLATE_KEEP_LINE_PREFIX } from '@/lib/template-director/locks';

const handlers = vi.hoisted(() => ({ requireAdmin: vi.fn(), dispatchAdmin: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({ requireAdmin: handlers.requireAdmin }));
vi.mock('@/lib/admin/dispatch', () => ({ dispatchAdmin: handlers.dispatchAdmin, outcomeUrl: () => '/admin/prompts/new?err=invalid' }));
vi.mock('@/lib/cache', () => ({ revalidateCampaigns: vi.fn(), revalidateCatalog: vi.fn(), revalidateContests: vi.fn(), revalidateLandingMedia: vi.fn(), revalidatePrompts: vi.fn() }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/storage', () => ({ getStorage: async () => ({}) }));
vi.mock('@/lib/notify/service', () => ({ getMailer: () => ({}) }));
import { POST } from '@/app/(admin)/admin/do/route';

/**
 * docs/PERSONAL-STUDIO.md §3.3 (C3, round 2) — the new-template screen posts with the enhanced JSON accept and used to
 * get only `{ ok, code, field }` back, so a lock-block refusal read as the generic "check the form". The lock-block
 * reason (our own fixed-prefix detail) is the one detail that answer now carries; nothing else changes.
 */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const LOCK_DETAIL = (() => {
  const check = checkLockBlock(['A prompt.', '', 'Template locks:', `${KEEP}the shoes.`].join('\n'));
  if (check.state !== 'malformed') throw new Error('fixture');
  return lockBlockRefusalDetail('promptText', check.problems);
})();

function request(op: string, accept: string | null) {
  const body = new FormData();
  body.set('_op', op);
  body.set('_back', '/admin/prompts/new');
  const headers: Record<string, string> = { host: 'admin.twings.app', 'sec-fetch-site': 'same-origin' };
  if (accept) headers.accept = accept;
  return new NextRequest('https://admin.twings.app/admin/do', { method: 'POST', body, headers });
}
const ENHANCED = 'application/vnd.twings.admin-form+json';

describe('/admin/do and a lock-block refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.requireAdmin.mockResolvedValue({ isAdmin: true, id: 'admin' });
  });

  it('hands a refused create its lock-block reason', async () => {
    expect(LOCK_DETAIL).toBe(`promptText: template locks: line 4 unknown_line — "${KEEP}the shoes."`);
    handlers.dispatchAdmin.mockResolvedValue({ ok: false, code: 'invalid', detail: LOCK_DETAIL });
    const response = await POST(request('prompt.create', ENHANCED));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: false, code: 'invalid', field: 'promptText', detail: LOCK_DETAIL });
  });

  it.each([
    ['a missing poster', { ok: false, code: 'invalid', detail: 'poster: a YAGI prompt needs a poster image' }, { ok: false, code: 'invalid', field: 'poster' }],
    ['a missing use case', { ok: false, code: 'invalid', detail: 'useCase: Array must contain at least 1 element(s)' }, { ok: false, code: 'invalid', field: 'useCase' }],
    ['a short prompt', { ok: false, code: 'invalid', detail: 'promptText: String must contain at least 40 character(s)' }, { ok: false, code: 'invalid' }],
    ['a wrong engine', { ok: false, code: 'invalid', detail: 'engine: not a video engine' }, { ok: false, code: 'invalid' }],
    ['an upload', { ok: false, code: 'upload', detail: 'video: upload_missing' }, { ok: false, code: 'upload' }],
    ['a database refusal', { ok: false, code: 'unknown', detail: 'internal db diagnostic' }, { ok: false, code: 'unknown' }],
    // Only the prompt field's own refusal: the same words under another field, or with another code, stay behind.
    ['a lock-like detail for another field', { ok: false, code: 'invalid', detail: LOCK_DETAIL.replace('promptText', 'frame 2') }, { ok: false, code: 'invalid' }],
    ['a lock-like detail with another code', { ok: false, code: 'unknown', detail: LOCK_DETAIL }, { ok: false, code: 'unknown' }],
  ])('answers a create refused for %s exactly as before', async (_name, outcome, expected) => {
    handlers.dispatchAdmin.mockResolvedValue(outcome);
    expect(await (await POST(request('prompt.create', ENHANCED))).json()).toEqual(expected);
  });

  it('leaves every other operation’s failure answer as it was', async () => {
    handlers.dispatchAdmin.mockResolvedValue({ ok: false, code: 'invalid', detail: LOCK_DETAIL });
    // The image set's enhanced answer already carried its detail.
    expect(await (await POST(request('prompt.createSet', ENHANCED))).json()).toEqual({ ok: false, code: 'invalid', detail: LOCK_DETAIL });
    // The plain JSON answer carries no detail, for any operation.
    expect(await (await POST(request('prompt.update', 'application/json'))).json()).toEqual({ ok: false, code: 'invalid' });
    expect(await (await POST(request('prompt.create', 'application/json'))).json()).toEqual({ ok: false, code: 'invalid' });
    // The enhanced accept means nothing to another operation: it still redirects.
    const update = await POST(request('prompt.update', ENHANCED));
    expect(update.status).toBe(303);
    expect(update.headers.get('location')).toBe('https://admin.twings.app/admin/prompts/new?err=invalid');
    // And a plain form post of a create still redirects with the outcome in the address.
    const plain = await POST(request('prompt.create', null));
    expect(plain.status).toBe(303);
  });
});
