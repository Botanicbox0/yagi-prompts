import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { notifySlackBrandConcierge } from '@/lib/brands/concierge-slack';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { loadRoomReviewDetail, loadRoomReviews, runRoomReviewOperation, type ReviewDeps, type ReviewNotice } from '@/lib/brand-studio/review';
import type { ReviewErrorCode } from '@/lib/brand-studio/review-contracts';

/**
 * Project room deliverables (docs/BRAND-ROOMS.md §6). Guard order on every method: the flag (404) ->
 * sign-in (401) -> inside the service: the room seat (membership or this project's invitation -> the
 * sandbox hardline and the generation policy, 404) -> the project (404) -> role (owners and editors add
 * versions, move the status and resolve, 403; everyone seated comments).
 *
 *   GET  ?organizationId=&projectId=              the project's deliverables as stacks, newest version first
 *   GET  ?organizationId=&projectId=&review=<id>  one version, its notes (carried ones marked) and its stack
 *   POST { operation, input }                     one of ROOM_REVIEW_OPERATIONS
 *
 * The studio's own `/api/brand-studio/review` is unchanged. A brand member's note or status move reaches
 * the team's internal notifier after the answer; the room line is written by the service.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 65_536;

function roomReviewStatus(code: ReviewErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
    case 'feature_unavailable':
    case 'studio_closed':
      return 404;
    case 'invalid':
      return 400;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

const deps = (sql: NonNullable<Awaited<ReturnType<typeof getSqlRunner>>>): ReviewDeps => ({ sql, media: createStudioMediaStore() });

function tellTheTeam(sql: ReviewDeps['sql'], notice: ReviewNotice | null): void {
  if (!notice) return;
  after(async () => {
    try {
      await notifySlackBrandConcierge(sql, {
        ...notice,
        kind: 'review_comment',
        messageId: notice.deliverySourceId ?? notice.messageId,
      });
    } catch (error) {
      log('room_review_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  });
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
    const reviewId = params.get('review');
    const result =
      reviewId !== null
        ? await loadRoomReviewDetail(deps(sql), viewer, organizationId, projectId, reviewId)
        : await loadRoomReviews(deps(sql), viewer, organizationId, projectId);
    return studioJson(result, result.ok ? 200 : roomReviewStatus(result.code));
  } catch (error) {
    log('room_review_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
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
    const { result, notice } = await runRoomReviewOperation(deps(sql), viewer, body.operation, body.input);
    if (!result.ok) return studioJson(result, roomReviewStatus(result.code));
    tellTheTeam(sql, notice);
    const created = (body.operation === 'review.create' || body.operation === 'review.version') && 'existing' in result && !result.existing;
    return studioJson(result, created ? 201 : 200);
  } catch (error) {
    log('room_review_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
