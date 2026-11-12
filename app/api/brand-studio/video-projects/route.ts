import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { studioLog } from '@/lib/brand-studio/runtime';
import {
  loadVideoProjects,
  runVideoProjectOperation,
  type VideoProjectsDeps,
} from '@/lib/brand-studio/video-projects';

/**
 * `영상 스튜디오` server-persisted projects API (`docs/STUDIO-PRO-SUITE-V4.md` §1.4).
 *
 * Security chain:
 *   1. `brandStudioV2Open()` -> `404`
 *   2. `getViewer()` -> `401`
 *   3. `studioSeat(..., { requireSelfStudio: true })` inside service ->
 *      membership -> Morphic/sandbox hardline (`404`) -> `generative_media` + `self_studio` (`404`) -> role
 *
 *   GET  ?organizationId=<uuid>[&projectId=<uuid>]
 *   POST { op: 'create' | 'save' | 'status' | 'delete', organizationId, ... }
 *        (also accepts `{ operation, input }` envelope)
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 262_144;

const depsOf = (sql: VideoProjectsDeps['sql']): VideoProjectsDeps => ({
  sql,
  media: createStudioMediaStore(process.env),
});

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const projectId = request.nextUrl.searchParams.get('projectId');
    const result = await loadVideoProjects(depsOf(sql), viewer, organizationId, projectId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_video_projects_get_failed', {
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
    if (typeof parsed.op === 'string') {
      op = parsed.op;
      input = parsed;
    } else if (typeof parsed.operation === 'string' && parsed.input && typeof parsed.input === 'object') {
      op = parsed.operation;
      input = parsed.input;
    } else {
      throw new Error('shape');
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const result = await runVideoProjectOperation(depsOf(sql), viewer, op, input);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('studio_video_projects_post_failed', {
      op: String(op).slice(0, 40),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
