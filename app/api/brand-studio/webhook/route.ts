import { after, type NextRequest } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { secretMatches } from '@/lib/brand-studio/env';
import { studioJson } from '@/lib/brand-studio/http';
import { advanceStudioJobs, studioLog } from '@/lib/brand-studio/runtime';

/**
 * Sunra's terminal-state callback (docs.sunra.ai — Webhooks), registered per submission as
 * `…/api/brand-studio/webhook?token=$BRAND_STUDIO_WEBHOOK_SECRET`. Sunra signs nothing, so the body is
 * only a hint: the token is checked in constant time, the request id is matched to one of our output
 * slots, and the engine RE-FETCHES the task from the provider. Nothing in the body is ever stored.
 *
 * Not reachable on brand.twings.app (lib/routing/surfaces.ts). Answers fast (Sunra waits 5 s) and
 * works with the flag off, so results of jobs already running still land (§9).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BODY_MAX = 262_144;

export async function POST(request: NextRequest) {
  if (!secretMatches(process.env.BRAND_STUDIO_WEBHOOK_SECRET, request.nextUrl.searchParams.get('token'))) {
    return studioJson({ ok: false }, 401);
  }
  let id: string | null = null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) <= BODY_MAX) {
      const body = JSON.parse(raw) as { id?: unknown; request_id?: unknown };
      const candidate = typeof body.id === 'string' ? body.id : typeof body.request_id === 'string' ? body.request_id : null;
      id = candidate && /^[A-Za-z0-9_-]{1,128}$/.test(candidate) ? candidate : null;
    }
  } catch {
    id = null;
  }
  // Unknown or malformed: still 2xx, so Sunra stops retrying something we will never act on.
  if (!id) return studioJson({ ok: true });
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false }, 503);
  try {
    const job = (await sql.query<{ job_id: string }>('select job_id from brand_studio_outputs where provider_task_id = $1 limit 1', [id])).rows[0];
    if (job) {
      after(async () => {
        try {
          await advanceStudioJobs(sql, { jobIds: [job.job_id] });
        } catch (error) {
          studioLog('studio_webhook_advance_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        }
      });
    }
    return studioJson({ ok: true });
  } catch {
    return studioJson({ ok: false }, 503);
  }
}
