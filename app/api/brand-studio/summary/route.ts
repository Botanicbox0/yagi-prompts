import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { studioEnv } from '@/lib/brand-studio/env';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { studioLog } from '@/lib/brand-studio/runtime';
import { loadStudioSummary } from '@/lib/brand-studio/summary';

/**
 * The workspace rail's studio summary (docs/BRAND-STUDIO-V3.md §3): credits, this person's running jobs
 * and the ones that just finished. Read-only; it never moves a job (the rail calls the board's poll,
 * `GET /api/brand-studio?jobs=…`, for that).
 *
 * Checks, in the order of `app/api/brand-studio/route.ts`: the flag (`studio_closed`, 404), sign-in,
 * then inside the service: membership -> Morphic hardline + feature policy (404) -> role.
 *
 *   GET ?organizationId=…   { ok, allowance, open: [{ id, kind }], settled: [{ id, kind, status, finishedAt }] }
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const result = await loadStudioSummary({ sql, env: studioEnv() }, viewer, organizationId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_summary_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
