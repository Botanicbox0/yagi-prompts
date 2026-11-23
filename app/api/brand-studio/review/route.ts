import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { notifySlackBrandConcierge } from '@/lib/brands/concierge-slack';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { studioLog } from '@/lib/brand-studio/runtime';
import { loadReviewDetail, loadReviewList, runReviewOperation, type ReviewDeps, type ReviewNotice } from '@/lib/brand-studio/review';
import type { ReviewErrorCode } from '@/lib/brand-studio/review-contracts';

/**
 * Review space API (docs/BRAND-STUDIO-V3.md §7). The same chain as `/api/brand-studio`: the flag
 * (`studio_closed`, 404), sign-in, then inside the service: membership -> Morphic hardline + feature
 * policy (404) -> role (owners and editors write, viewers read).
 *
 *   GET  ?organizationId=…              the list
 *   GET  ?organizationId=…&review=<id>  one piece and its comments
 *   POST { operation, input }           one of REVIEW_OPERATIONS
 *
 * A brand member's comment or status move is passed to the team notifier after the answer has gone
 * out. A notifier failure is logged and never reaches the customer.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 32_768;

function reviewStatus(code: ReviewErrorCode): number {
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
      studioLog('review_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
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
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const reviewId = request.nextUrl.searchParams.get('review');
    const result =
      reviewId !== null ? await loadReviewDetail(deps(sql), viewer, organizationId, reviewId) : await loadReviewList(deps(sql), viewer, organizationId);
    return studioJson(result, result.ok ? 200 : reviewStatus(result.code));
  } catch (error) {
    studioLog('review_get_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
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
    const { result, notice } = await runReviewOperation(deps(sql), viewer, body.operation, body.input);
    if (!result.ok) return studioJson(result, reviewStatus(result.code));
    tellTheTeam(sql, notice);
    return studioJson(result, body.operation === 'review.create' && 'existing' in result && !result.existing ? 201 : 200);
  } catch (error) {
    studioLog('review_post_failed', { operation: String(body.operation).slice(0, 40), message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
