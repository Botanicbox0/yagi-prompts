import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { PlatformError } from '@/lib/creator-platform/contract';
import { MAKER_FILE_MAX_BYTES } from '@/lib/recipes/assets';
import { uploadMakerFile } from '@/lib/recipes/maker';
import { getRenderStore } from '@/lib/renders/store';

/**
 * `POST /api/makers/formats/{id}/files?role=reference|example` — one file as the raw request body.
 * The body is counted as it arrives (4 MB), the type is read from the bytes, images are re-encoded
 * without metadata (lib/recipes/assets.ts). Only the owner's own draft takes files.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const STATUS: Record<string, number> = { sign_in_required: 401, forbidden: 403, not_open: 403, not_found: 404, too_large: 413, bad_file: 415, limit_reached: 409, conflict: 409 };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return json({ code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  const role = new URL(request.url).searchParams.get('role');
  if (role !== 'reference' && role !== 'example') return json({ code: 'invalid' }, 400);
  try {
    const bytes = await readBoundedBody(request, MAKER_FILE_MAX_BYTES);
    if (!bytes) return json({ code: 'too_large' }, 413);
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const access = await platformAccess(sql);
    const { id } = await params;
    const file = await uploadMakerFile({ sql, store: await getRenderStore() }, viewer, { formatId: id, role, bytes }, { creators: access.creators });
    return json({ ok: true, file }, 201);
  } catch (error) {
    if (error instanceof PlatformError) return json({ code: error.code }, STATUS[error.code] ?? 409);
    return json({ code: 'unavailable' }, 503);
  }
}
