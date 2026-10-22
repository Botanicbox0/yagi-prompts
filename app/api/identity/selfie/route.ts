import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { SELFIE_MAX_BYTES } from '@/lib/identity/selfie-images';
import { currentSelfie, saveSelfie, selfieView } from '@/lib/identity/selfie-service';

/**
 * `GET /api/identity/selfie` — the viewer's current selfie (or `selfie: null`).
 * `POST /api/identity/selfie` — multipart `photo` + `consent=yes`: save it as the current selfie.
 *
 * The studio, the account page and `/identity/selfie` all talk to this one pair. There is no
 * generation step any more (founder, 2026-10-22): the answer to a POST is the saved selfie itself.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const STATUS = { sign_in_required: 401, consent_required: 400, bad_photo: 400, rate_limited: 429 } as const;

export async function GET() {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const row = await currentSelfie(sql, viewer.userId);
    return json({ ok: true, selfie: row ? selfieView(row) : null });
  } catch { return json({ code: 'unavailable' }, 503); }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > SELFIE_MAX_BYTES + 100_000) return json({ code: 'bad_photo' }, 413);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File) || photo.size === 0 || photo.size > SELFIE_MAX_BYTES) return json({ code: 'bad_photo' }, 400);
    const result = await saveSelfie({ sql, store: await getRenderStore() }, viewer.userId, {
      bytes: new Uint8Array(await photo.arrayBuffer()), mime: photo.type, consent: form.get('consent') === 'yes',
    });
    if (!result.ok) return json(result, STATUS[result.code]);
    const row = await currentSelfie(sql, viewer.userId);
    return json({ ...result, selfie: row ? selfieView(row) : null }, result.unchanged ? 200 : 201);
  } catch { return json({ code: 'unavailable' }, 503); }
}
