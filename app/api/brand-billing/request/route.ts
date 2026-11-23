import { after, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { billingJson, billingStatus } from '@/lib/brands/billing/http';
import { submitBrandBillingRequest } from '@/lib/brands/billing-request';
import { runLiveTeamNoticeDeliveryPass } from '@/lib/brands/team-notice-outbox';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * `POST /api/brand-billing/request`
 * Customer billing / allowance request endpoint: enforces same-origin CSRF +
 * bounded request payload, inserts one row into `brand_support_messages`,
 * enqueues one `plan_request` or `allowance_request` team notice pointing to
 * `/admin/brand-workspace/organizations/<orgId>`, triggers live outbox delivery
 * after response, and enforces a DB-backed limit of 5 requests per organization
 * per hour.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 8_192;

async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch {
      // Delivery pass is best effort and never blocks the customer request.
    }
  };
  try {
    after(run);
  } catch {
    await run();
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return billingJson({ ok: false, code: 'forbidden' }, 403);
  }
  const viewer = await getViewer();
  if (!viewer.userId) {
    return billingJson({ ok: false, code: 'sign_in_required' }, 401);
  }
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return billingJson({ ok: false, code: 'invalid' }, 413);
  }

  let raw = '';
  try {
    raw = await request.text();
  } catch {
    return billingJson({ ok: false, code: 'invalid' }, 400);
  }
  if (Buffer.byteLength(raw) > BODY_MAX) {
    return billingJson({ ok: false, code: 'invalid' }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return billingJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return billingJson({ ok: false, code: 'unavailable' }, 503);
  }

  const result = await submitBrandBillingRequest({ sql }, viewer, body);
  if (!result.ok) {
    return billingJson({ ok: false, code: result.code }, billingStatus(result.code));
  }

  await afterResponse(() =>
    runLiveTeamNoticeDeliveryPass(sql, {
      sourceKind: result.noticeKind,
      sourceId: result.id,
    }),
  );

  return billingJson(
    {
      ok: true,
      id: result.id,
      noticeKind: result.noticeKind,
    },
    200,
  );
}
