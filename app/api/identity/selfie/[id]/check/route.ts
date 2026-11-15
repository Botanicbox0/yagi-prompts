import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { photoCheckerFromEnv } from '@/lib/identity/photo-check';
import { selfiePhotoCheck } from '@/lib/identity/photo-check-service';

/**
 * `POST /api/identity/selfie/{id}/check` → `{ ok: true, check: { status, issues } | null }`.
 *
 * The advisory photo check for one of the viewer's own active photos (lib/identity/photo-check.ts).
 * Off (404 `off`) unless TWINGS_PHOTO_CHECK=on and GEMINI_API_KEY is set and 0089 is applied; a
 * stranger's, replaced or deleted photo is 404 `not_found`. `check: null` means "no result" — the
 * screens then show nothing. Nothing here ever blocks saving, choosing or paying.
 */
export const dynamic = 'force-dynamic';
/** One model call of up to PHOTO_CHECK_TIMEOUT_MS plus a storage read. */
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const OFF = { ok: false, code: 'off' };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = photoCheckerFromEnv();
  if (!check) return json(OFF, 404);
  if (!isSameOrigin(request)) return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: 'unavailable' }, 503);
    const result = await selfiePhotoCheck({ sql, store: await getRenderStore(), check }, viewer.userId, (await params).id);
    if (!result.ok) return json(result.code === 'off' ? OFF : { ok: false, code: 'not_found' }, 404);
    return json({ ok: true, check: result.check });
  } catch { return json({ ok: false, code: 'unavailable' }, 503); }
}
