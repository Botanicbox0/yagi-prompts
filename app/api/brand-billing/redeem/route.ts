import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { redeemBrandDiscountCode } from '@/lib/brands/billing';
import { billingJson, billingStatus } from '@/lib/brands/billing/http';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * `POST /api/brand-billing/redeem`
 * Redeem a discount code for an organization (owner/admin only, DB rate-limited 5 / 10 min).
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 1_024;

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return billingJson({ ok: false, code: 'forbidden' }, 403);
  }
  const viewer = await getViewer();
  if (!viewer.userId) return billingJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return billingJson({ ok: false, code: 'invalid' }, 413);
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return billingJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
  } catch {
    return billingJson({ ok: false, code: 'invalid' }, 400);
  }
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return billingJson({ ok: false, code: 'unavailable' }, 503);
  try {
    const result = await redeemBrandDiscountCode({ sql }, viewer, body);
    if (!result.ok) {
      return billingJson({ ok: false, code: result.code }, billingStatus(result.code));
    }
    const d = result.discount;
    return billingJson(
      {
        ok: true,
        activeDiscount: {
          id: d.id,
          percent: d.percent,
          invoicesTotal: d.invoicesTotal,
          invoicesUsed: d.invoicesUsed,
          invoicesRemaining: d.invoicesRemaining,
          openEnded: d.invoicesTotal === null,
          source: d.source,
        },
        replaced: result.replacedDiscountId !== null,
      },
      200,
    );
  } catch (error) {
    console.warn(
      '[brand-billing] redeem_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );
    return billingJson({ ok: false, code: 'unavailable' }, 503);
  }
}
