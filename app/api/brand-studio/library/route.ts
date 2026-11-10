import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { loadFolderItems, loadLibrary, runLibraryOperation, type LibraryDeps } from '@/lib/brand-studio/library';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { studioLog } from '@/lib/brand-studio/runtime';

/**
 * The studio library rail (docs/BRAND-STUDIO-V3.md §4). The same chain as `/api/brand-studio`: the flag
 * (`studio_closed`, 404), sign-in, then inside the service: membership -> Morphic hardline + feature
 * policy (404) -> role. A sandboxed organization gets the same 404 on every method.
 *
 *   GET  ?organizationId=…             folders and this member's likes
 *   GET  ?organizationId=…&folder=<id> one folder's items
 *   POST { operation, input }          one of LIBRARY_OPERATIONS
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 8_192;

const depsOf = (sql: LibraryDeps['sql']): LibraryDeps => ({ sql, media: createStudioMediaStore(process.env) });

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const deps = depsOf(sql);
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const folder = request.nextUrl.searchParams.get('folder');
    const result = folder !== null ? await loadFolderItems(deps, viewer, organizationId, folder) : await loadLibrary(deps, viewer, organizationId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_library_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') throw new Error('shape');
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result = await runLibraryOperation(depsOf(sql), viewer, body.operation, body.input);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_library_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
