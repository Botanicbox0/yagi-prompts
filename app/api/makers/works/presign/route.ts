import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { creativeGate } from '@/lib/makers/access';
import { getRenderStore } from '@/lib/renders/store';
import { presignMakerWorkUpload, WorkError } from '@/lib/makers/works';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const STATUS: Record<string, number> = {
  sign_in_required: 401,
  forbidden: 403,
  not_open: 403,
  not_found: 404,
  too_large: 413,
  bad_file: 415,
  limit_reached: 409,
  invalid: 400,
  unavailable: 503,
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return json({ code: 'unavailable' }, 503);
  const access = await creativeGate(sql, viewer.userId);
  if (!access.ok) return json({ code: access.code }, STATUS[access.code] ?? 403);

  try {
    const raw = await readBoundedBody(request, 4_000);
    if (!raw) return json({ code: 'too_large' }, 413);
    let body: { mime?: unknown; bytes?: unknown };
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return json({ code: 'invalid' }, 400);
    }
    const store = await getRenderStore();
    const result = await presignMakerWorkUpload(sql, store, {
      userId: access.userId,
      mime: body.mime,
      bytes: body.bytes,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WorkError) return json({ code: error.code }, STATUS[error.code] ?? 409);
    return json({ code: 'unavailable' }, 503);
  }
}
