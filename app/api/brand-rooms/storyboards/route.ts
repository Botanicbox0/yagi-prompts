import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { notifySlackBrandConcierge } from '@/lib/brands/concierge-slack';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { getStorage } from '@/lib/storage';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { loadStoryboardDetail, loadStoryboardList, runStoryboardOperation, type StoryboardDeps } from '@/lib/brand-rooms/storyboards';
import { storyboardHttpStatus } from '@/lib/brand-rooms/storyboard-contracts';

/**
 * Project room storyboards (docs/BRAND-ROOMS.md §5). Guard order on every method: the flag (404) ->
 * sign-in (401) -> inside the service: the room seat (membership or a project invitation -> the
 * sandbox hardline and the generation policy, 404) -> the project (404) -> role (owners and editors
 * write, 403).
 *
 *   GET  ?organizationId=&projectId=              the project's boards, each storyboard's versions newest first
 *   GET  ?organizationId=&projectId=&board=<id>   one board with its cuts, versions and what changed
 *   POST { operation, input }                     one of STORYBOARD_OPERATIONS
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BODY_MAX = 262_144;

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

async function deps(sql: NonNullable<Awaited<ReturnType<typeof getSqlRunner>>>): Promise<StoryboardDeps> {
  return {
    sql,
    media: createStudioMediaStore(),
    staging: await getStorage(),
    log,
    // A brand's approval or change request reaches the team's internal notifier after the answer, best effort.
    notify: (notice) =>
      after(async () => {
        try {
          await notifySlackBrandConcierge(sql, notice);
        } catch (error) {
          log('storyboard_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        }
      }),
  };
}

export async function GET(request: NextRequest) {
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'not_found' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const params = request.nextUrl.searchParams;
    const organizationId = params.get('organizationId') ?? '';
    const projectId = params.get('projectId') ?? '';
    const boardId = params.get('board');
    const d = await deps(sql);
    const result =
      boardId !== null
        ? await loadStoryboardDetail(d, viewer, organizationId, projectId, boardId)
        : await loadStoryboardList(d, viewer, organizationId, projectId);
    return studioJson(result, result.ok ? 200 : storyboardHttpStatus(result.code));
  } catch (error) {
    log('storyboard_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'not_found' }, 404);
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
    const result = await runStoryboardOperation(await deps(sql), viewer, body.operation, body.input);
    if (!result.ok) return studioJson(result, storyboardHttpStatus(result.code));
    return studioJson(result, body.operation === 'board.create' || body.operation === 'board.version' ? 201 : 200);
  } catch (error) {
    log('storyboard_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
