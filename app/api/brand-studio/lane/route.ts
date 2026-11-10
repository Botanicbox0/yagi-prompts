import { after, type NextRequest } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { secretMatches } from '@/lib/brand-studio/env';
import { studioJson } from '@/lib/brand-studio/http';
import { laneClaim, laneComplete, laneFail, laneHeartbeat } from '@/lib/brand-studio/lane-api';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';

/**
 * The account-lane worker's door (docs/BRAND-STUDIO-V2.md §7; lib/brand-studio/lane-api.ts has the
 * protocol). `Authorization: Bearer $BRAND_STUDIO_LANE_SECRET`, POST `{ op, ... }` with op one of
 * heartbeat | claim | complete | fail. Not reachable on brand.twings.app (lib/routing/surfaces.ts).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BODY_MAX = 65_536;

export async function POST(request: NextRequest) {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (!secretMatches(process.env.BRAND_STUDIO_LANE_SECRET, bearer)) return studioJson({ ok: false, code: 'forbidden' }, 401);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new Error('shape');
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const deps = await studioRuntimeDeps(sql);
    switch (body.op) {
      case 'heartbeat':
        return studioJson(await laneHeartbeat(deps, body.info));
      case 'claim':
        return studioJson(await laneClaim(deps, body));
      case 'complete': {
        const result = await laneComplete(deps, body);
        if (!result.ok) return studioJson(result, result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 400);
        after(async () => {
          try {
            await advanceStudioJobsWith(deps, { jobIds: [result.jobId] });
          } catch (error) {
            studioLog('studio_lane_advance_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
          }
        });
        return studioJson(result);
      }
      case 'fail': {
        const result = await laneFail(deps, body);
        return studioJson(result, result.ok ? 200 : result.code === 'not_found' ? 404 : result.code === 'conflict' ? 409 : 400);
      }
      default:
        return studioJson({ ok: false, code: 'invalid' }, 400);
    }
  } catch (error) {
    studioLog('studio_lane_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
