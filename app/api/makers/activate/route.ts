import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { openMakerEnabled } from '@/lib/creator-platform/runtime';
import { PlatformError } from '@/lib/creator-platform/contract';
import { activateOpenMaker } from '@/lib/makers/self-activate';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const STATUS: Record<string, number> = {
  sign_in_required: 401,
  rights_required: 400,
  forbidden: 403,
  not_open: 403,
  not_found: 404,
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'forbidden' }, { status: 403, headers: HEADERS });
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    return NextResponse.json({ ok: false, code: 'sign_in_required' }, { status: 401, headers: HEADERS });
  }

  let body: { rightsAgreed?: unknown } = {};
  try {
    body = (await request.json()) as { rightsAgreed?: unknown };
  } catch {
    return NextResponse.json({ ok: false, code: 'invalid' }, { status: 400, headers: HEADERS });
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }
  if (!(await openMakerEnabled(sql))) {
    return NextResponse.json({ ok: false, code: 'not_open' }, { status: 403, headers: HEADERS });
  }

  try {
    const activated = await activateOpenMaker(sql, viewer, {
      rightsAgreed: body.rightsAgreed === true,
    });
    return NextResponse.json({ ok: true, ...activated }, { headers: HEADERS });
  } catch (error) {
    if (error instanceof PlatformError) {
      return NextResponse.json(
        { ok: false, code: error.code },
        { status: STATUS[error.code] ?? 400, headers: HEADERS },
      );
    }
    return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503, headers: HEADERS });
  }
}
