import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { getRequestLocale } from '@/lib/i18n/server';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { STUDIO_JOB_OPEN_STATUSES } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { loadWorkflowsHubState, runWorkflowOperation } from '@/lib/brand-studio/workflows';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BODY_MAX = 65_536;

function advanceLater(deps: StudioDeps, jobIds: string[]): void {
  if (jobIds.length === 0) return;
  after(async () => {
    try {
      await advanceStudioJobsWith(deps, { jobIds });
    } catch (error) {
      studioLog('workflows_after_failed', {
        message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  });
}

async function screenLocale(profileLocale: string | null | undefined): Promise<'ko' | 'en'> {
  try {
    return (await getRequestLocale(profileLocale)) === 'en' ? 'en' : 'ko';
  } catch {
    return profileLocale === 'en' ? 'en' : 'ko';
  }
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
    const result = await loadWorkflowsHubState(deps, viewer, organizationId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('workflows_get_failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return studioJson({ ok: false, code: 'invalid' }, 413);
  }

  let op: unknown;
  let input: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') throw new Error('shape');
    op = parsed.op ?? parsed.operation;
    if (parsed.input && typeof parsed.input === 'object') {
      input = parsed.input;
    } else {
      const { op: _o1, operation: _o2, ...rest } = parsed;
      input = rest;
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    const deps = await studioRuntimeDeps(sql);
    const actor = { ...viewer, locale: await screenLocale(viewer.locale) };
    const result = await runWorkflowOperation(deps, actor, op, input);
    if (!result.ok) return studioJson(result, studioStatus(result.code));

    if (op === 'run' && 'jobs' in result) {
      const openIds = result.jobs.filter((j) => STUDIO_JOB_OPEN_STATUSES.includes(j.status)).map((j) => j.id);
      advanceLater(deps, openIds);
      return studioJson(result, 201);
    }
    if ((op === 'create' || op === 'save_from_job' || op === 'build_with_ai') && 'workflow' in result) {
      return studioJson(result, 201);
    }
    return studioJson(result, 200);
  } catch (error) {
    studioLog('workflows_post_failed', {
      op: String(op).slice(0, 40),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
