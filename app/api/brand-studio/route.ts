import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getRequestLocale } from '@/lib/i18n/server';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { STUDIO_JOB_OPEN_STATUSES } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { studioStateScopeOf } from '@/lib/brand-studio/brand-projects';

/**
 * Brand studio v2 API (docs/BRAND-STUDIO-V2.md). Checks, in order: the flag (`studio_closed`, 404),
 * sign-in, then inside the service: membership -> Morphic hardline + feature policy (404) -> role.
 *
 *   GET  ?organizationId=…           the studio state (`&brandProject=<id>|unfiled` while the project spine is open)
 *   GET  ?organizationId=…&jobs=a,b  the board's poll; open jobs are moved forward after the answer
 *   POST { operation, input }        one of STUDIO_OPERATIONS
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BODY_MAX = 65_536;
/** `revise.mark` carries one marked frame (a JPEG data URL, ≤ 400,000 characters by contract). */
const MARK_BODY_MAX = 450_000;

function advanceLater(deps: StudioDeps, jobIds: string[]): void {
  if (jobIds.length === 0) return;
  after(async () => {
    try {
      await advanceStudioJobsWith(deps, { jobIds });
    } catch (error) {
      // The poll, the webhook and the daily sweep pick the persisted job up again.
      studioLog('studio_after_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  });
}

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const deps = await studioRuntimeDeps(sql);
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const jobs = request.nextUrl.searchParams.get('jobs');
    if (jobs !== null) {
      const result = await pollStudioJobs(deps, viewer, organizationId, jobs.split(',').map((s) => s.trim()).filter(Boolean));
      if (!result.ok) return studioJson(result, studioStatus(result.code));
      advanceLater(deps, result.jobs.filter((j) => STUDIO_JOB_OPEN_STATUSES.includes(j.status)).map((j) => j.id));
      return studioJson(result);
    }
    // `&brandProject=<id>|unfiled`: the brand project spine's scope; ignored while it is closed (and for guests).
    const scope = studioStateScopeOf(request.nextUrl.searchParams.get('brandProject'));
    const result = scope ? await loadStudioState(deps, viewer, organizationId, { scope }) : await loadStudioState(deps, viewer, organizationId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

/** The language of the screen the request came from; the profile's language when there is no request scope. */
async function screenLocale(profileLocale: string | null | undefined): Promise<'ko' | 'en'> {
  try {
    return (await getRequestLocale(profileLocale)) === 'en' ? 'en' : 'ko';
  } catch {
    return profileLocale === 'en' ? 'en' : 'ko';
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > MARK_BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    const size = Buffer.byteLength(raw);
    if (size > MARK_BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') throw new Error('shape');
    if (size > BODY_MAX && body.operation !== 'revise.mark') return studioJson({ ok: false, code: 'invalid' }, 413);
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const deps = await studioRuntimeDeps(sql);
    // What the customer reads back (the note under a prompt, a film summary, a handoff sentence) follows the
    // language of the screen they are on, which can differ from the language saved on their profile.
    const actor = { ...viewer, locale: await screenLocale(viewer.locale) };
    const result = await runStudioOperation(deps, actor, body.operation, body.input);
    if (!result.ok) return studioJson(result, studioStatus(result.code));
    if (body.operation === 'job.create' && 'job' in result) {
      if (STUDIO_JOB_OPEN_STATUSES.includes(result.job.status)) advanceLater(deps, [result.job.id]);
      return studioJson(result, 201);
    }
    if (body.operation === 'job.create_group' && 'jobs' in result) {
      advanceLater(deps, result.jobs.filter((job) => STUDIO_JOB_OPEN_STATUSES.includes(job.status)).map((job) => job.id));
      return studioJson(result, 201);
    }
    return studioJson(result);
  } catch (error) {
    studioLog('studio_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
