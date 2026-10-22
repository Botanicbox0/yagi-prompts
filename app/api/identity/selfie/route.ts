import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { SELFIE_MAX_BYTES } from '@/lib/identity/selfie-images';
import { deleteSelfie, saveSelfie, selfieLibrary, selfieLimit, updateSelfie } from '@/lib/identity/selfie-service';

/**
 * The saved photos (docs/IDENTITY-SELFIE.md §4). One route for the studio sheet, the account card
 * and `/identity/selfie`:
 *
 *   GET     → `{ ok, limit, defaultId, items }` — the viewer's active photos, default first
 *   POST    multipart `photo` + `consent=yes` (+ `replaceId`) → saves one; 409 `limit_reached` when full
 *   PATCH   `{ id, isDefault?: true, label?: string | null }` → the library
 *   DELETE  `{ id }` → soft delete, the library (the default passes to the newest photo)
 *
 * Owner-only, same-origin writes, bounded bodies, every answer `private, no-store`. Previews use
 * the owner-only image route (`/api/identity/selfie/{id}/image`); there is no generation step.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const STATUS = { sign_in_required: 401, consent_required: 400, bad_photo: 400, rate_limited: 429, limit_reached: 409, not_found: 404, invalid: 400 } as const;
/** A PATCH or DELETE body is an id and a 40-character note; anything near this size is not one. */
const MAX_JSON_BYTES = 2048;
const UNAVAILABLE = { ok: false, code: 'unavailable' };

/** The JSON object of a PATCH/DELETE, or why not. Only the listed keys, nothing nested. */
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

/** Shared gate for the writes: same origin first (403), then a session (401), then a database (503). */
async function writer(request: Request): Promise<{ ok: false; response: NextResponse } | { ok: true; userId: string }> {
  if (!isSameOrigin(request)) return { ok: false, response: json({ ok: false, code: 'forbidden' }, 403) };
  const viewer = await getViewer();
  if (!viewer.userId) return { ok: false, response: json({ ok: false, code: 'sign_in_required' }, 401) };
  return { ok: true, userId: viewer.userId };
}

export async function GET() {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    return json({ ok: true, ...(await selfieLibrary(sql, viewer.userId, selfieLimit())) });
  } catch { return json(UNAVAILABLE, 503); }
}

export async function POST(request: Request) {
  const gate = await writer(request);
  if (!gate.ok) return gate.response;
  if (Number(request.headers.get('content-length') ?? 0) > SELFIE_MAX_BYTES + 100_000) return json({ ok: false, code: 'bad_photo' }, 413);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File) || photo.size === 0 || photo.size > SELFIE_MAX_BYTES) return json({ ok: false, code: 'bad_photo' }, 400);
    const replace = form.get('replaceId');
    const limit = selfieLimit();
    const result = await saveSelfie({ sql, store: await getRenderStore(), limit }, gate.userId, {
      bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type, consent: form.get('consent') === 'yes',
      ...(typeof replace === 'string' && replace ? { replaceId: replace } : {}),
    });
    // A full library says how full, so the message can name the number.
    if (!result.ok) return json(result.code === 'limit_reached' ? { ...result, limit } : result, STATUS[result.code]);
    const library = await selfieLibrary(sql, gate.userId, limit);
    return json({ ...result, selfie: library.items.find(item => item.id === result.id) ?? null, library }, result.unchanged ? 200 : 201);
  } catch { return json(UNAVAILABLE, 503); }
}

export async function PATCH(request: Request) {
  const gate = await writer(request);
  if (!gate.ok) return gate.response;
  try {
    const body = await readJson(request, ['id', 'isDefault', 'label']);
    if (body === 'too_large') return json({ ok: false, code: 'too_large' }, 413);
    if (body === 'invalid' || (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') || (body.label !== undefined && body.label !== null && typeof body.label !== 'string')) {
      return json({ ok: false, code: 'invalid' }, 400);
    }
    const sql = await getSqlRunner();
    if (!sql) return json(UNAVAILABLE, 503);
    const change = {
      id: body.id as string,
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault as true } : {}),
      ...(body.label !== undefined ? { label: body.label as string | null } : {}),
    };
    const result = await updateSelfie({ sql }, gate.userId, change);
    if (!result.ok) return json(result, STATUS[result.code]);
    return json({ ok: true, ...(await selfieLibrary(sql, gate.userId, selfieLimit())) });
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
    const result = await deleteSelfie({ sql }, gate.userId, body.id as string);
    if (!result.ok) return json(result, STATUS[result.code]);
    return json({ ok: true, ...(await selfieLibrary(sql, gate.userId, selfieLimit())) });
  } catch { return json(UNAVAILABLE, 503); }
}
