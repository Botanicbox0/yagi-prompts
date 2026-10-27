import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { SOCIAL_EVIDENCE_MAX_BYTES } from '@/lib/influencers/evidence';
import { influencersOpen, isInfluencer } from '@/lib/influencers/rules';
import { deleteSocialAccount, listSocialAccounts, setPoolConsent, submitSocialAccount } from '@/lib/influencers/service';

/**
 * The member's linked SNS accounts (docs/PLATFORM-2.0.md §17.1):
 *
 *   GET     → `{ ok, influencer, items }`
 *   POST    multipart `platform`, `profileUrl`, `photo` (+ `claimedCount`, `poolConsent=yes`) → one platform submitted
 *   PATCH   `{ id, poolConsent }` → the creator-pool box
 *   DELETE  `{ id }` → unlink: the row and its screenshot go
 *
 * Owner-only, same-origin writes, bounded bodies, every answer `private, no-store`. With
 * TWINGS_INFLUENCERS off the whole door is closed (404 `closed`).
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const STATUS = {
  sign_in_required: 401, unavailable: 503, bad_platform: 400, bad_url: 400, bad_count: 400, bad_photo: 400,
  rate_limited: 429, already_verified: 409, not_found: 404,
} as const;
const MAX_JSON_BYTES = 1024;
const UNAVAILABLE = { ok: false, code: 'unavailable' };

async function readJson(request: Request, keys: readonly string[]): Promise<Record<string, unknown> | 'too_large' | 'invalid'> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_JSON_BYTES) return 'too_large';
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) return 'too_large';
  let body: unknown;
  try { body = JSON.parse(text); } catch { return 'invalid'; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid';
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || typeof record.id !== 'string') return 'invalid';
  return record;
}

/** Closed flag first (404), then same origin (403), then a session (401). */
async function writer(request: Request): Promise<{ ok: false; response: NextResponse } | { ok: true; userId: string }> {
  if (!influencersOpen()) return { ok: false, response: json({ ok: false, code: 'closed' }, 404) };
  if (!isSameOrigin(request)) return { ok: false, response: json({ ok: false, code: 'forbidden' }, 403) };
  const viewer = await getViewer();
  if (!viewer.userId) return { ok: false, response: json({ ok: false, code: 'sign_in_required' }, 401) };
  return { ok: true, userId: viewer.userId };
}

async function state(userId: string) {
  const sql = await getSqlRunner();
  if (!sql) return null;
  const [items, influencer] = await Promise.all([listSocialAccounts(sql, userId), isInfluencer(sql, userId)]);
  return { ok: true, influencer, items };
}

export async function GET() {
  if (!influencersOpen()) return json({ ok: false, code: 'closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  try {
    const body = await state(viewer.userId);
    return body ? json(body) : json(UNAVAILABLE, 503);
  } catch { return json(UNAVAILABLE, 503); }
}

export async function POST(request: Request) {
  const gate = await writer(request);
  if (!gate.ok) return gate.response;
  if (Number(request.headers.get('content-length') ?? 0) > SOCIAL_EVIDENCE_MAX_BYTES + 100_000) return json({ ok: false, code: 'bad_photo' }, 413);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File) || photo.size === 0 || photo.size > SOCIAL_EVIDENCE_MAX_BYTES) return json({ ok: false, code: 'bad_photo' }, 400);
    const result = await submitSocialAccount({ sql, store: await getRenderStore() }, gate.userId, {
      platform: form.get('platform'),
      profileUrl: form.get('profileUrl'),
      claimedCount: form.get('claimedCount'),
      poolConsent: form.get('poolConsent') === 'yes',
      bytes: new Uint8Array(await photo.arrayBuffer()),
      mime: photo.type,
    });
    if (!result.ok) return json(result, STATUS[result.code]);
    return json({ ...(await state(gate.userId)), id: result.id }, 201);
  } catch { return json(UNAVAILABLE, 503); }
}

export async function PATCH(request: Request) {
  const gate = await writer(request);
  if (!gate.ok) return gate.response;
  try {
    const body = await readJson(request, ['id', 'poolConsent']);
    if (body === 'too_large') return json({ ok: false, code: 'too_large' }, 413);
    if (body === 'invalid' || typeof body.poolConsent !== 'boolean') return json({ ok: false, code: 'invalid' }, 400);
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    const result = await setPoolConsent({ sql }, gate.userId, body.id as string, body.poolConsent);
    if (!result.ok) return json(result, STATUS[result.code]);
    return json(await state(gate.userId));
  } catch { return json(UNAVAILABLE, 503); }
}

export async function DELETE(request: Request) {
  const gate = await writer(request);
  if (!gate.ok) return gate.response;
  try {
    const body = await readJson(request, ['id']);
    if (body === 'too_large') return json({ ok: false, code: 'too_large' }, 413);
    if (body === 'invalid') return json({ ok: false, code: 'invalid' }, 400);
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    const result = await deleteSocialAccount({ sql, store: await getRenderStore() }, gate.userId, body.id as string);
    if (!result.ok) return json(result, STATUS[result.code]);
    return json(await state(gate.userId));
  } catch { return json(UNAVAILABLE, 503); }
}
