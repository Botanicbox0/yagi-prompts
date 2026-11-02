import { NextResponse } from 'next/server';
import { getTossContext, TOSS_HEADERS } from '@/lib/billing/toss-runtime';
import {
  allowTossWebhook,
  billingErrorCode,
  logBilling,
  reconcileTossWebhook,
  tossWebhookHint,
} from '@/lib/billing/toss-service';
import { reconcileBrandUsageWebhook } from '@/lib/brands/usage/payment';
import { reconcileFundingWebhook } from '@/lib/campaigns/funding/payment';
import { fundingRuntime } from '@/lib/campaigns/funding/runtime';

/**
 * `POST /api/billing/toss/webhook` — 토스페이먼츠 웹훅 (docs/PLATFORM-2.0.md §2.2-5).
 *
 * The body is a HINT, never a fact: it may name an order (`orderId`, `paymentKey`, `status`), and
 * that one order is read again at Toss with its own stored payment key and settled by the same
 * rules as the render pass. That is how a cancellation made in the merchant console reaches the
 * database, and why the endpoint needs no signature: a forged hint can only make us look again.
 *
 * The merchant account also takes secondary-usage and campaign-funding payments, and its console
 * has one webhook URL. An order render billing does not know is looked for with the same hint, in
 * the same environment, in `brand_usage_payments` and then `campaign_funding_payments`, and settled
 * by that module's own rules. This route is where the three meet; none of the services knows another.
 *
 * Unknown orders and malformed bodies get an empty 200 — nothing to deliver again, and no oracle
 * for which orders exist. Only our own fault (no database, the provider unreachable for a known
 * order) answers 503, so Toss delivers the hint again. Nothing from the body is logged. 상점관리자
 * 웹훅 URL 등록은 대표 할 일이다 (docs/qa/toss-checkout/README.md).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const empty = (status: number, headers: Record<string, string> = {}) =>
  new NextResponse(null, { status, headers: { ...TOSS_HEADERS, ...headers } });

export async function POST(request: Request) {
  const sender =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  if (!allowTossWebhook(sender)) return empty(429, { 'Retry-After': '60' });
  let hint = null;
  try {
    const text = await request.text();
    if (text.length <= 64 * 1024) hint = tossWebhookHint(JSON.parse(text));
  } catch {
    /* not JSON: nothing to act on */
  }
  if (!hint) return empty(200);
  try {
    const deps = await getTossContext();
    if (!deps) return empty(503);
    const outcome = await reconcileTossWebhook(deps, hint);
    if (outcome.matched) {
      logBilling('info', 'toss_webhook', { matched: true, ...outcome.report });
      return empty(200);
    }
    const { sql, gateway } = deps;
    const usage = await reconcileBrandUsageWebhook({ sql, gateway }, hint);
    if (usage.matched) {
      logBilling('info', 'toss_webhook', { matched: true, kind: 'brand_usage', status: usage.status });
      return empty(200);
    }
    const funding = await reconcileFundingWebhook({ sql, gateway, ...fundingRuntime() }, hint);
    logBilling(
      'info',
      'toss_webhook',
      funding.matched ? { matched: true, kind: 'campaign_funding', status: funding.status } : { matched: false },
    );
    return empty(200);
  } catch (error) {
    logBilling('error', 'toss_webhook_failed', { code: billingErrorCode(error) });
    return empty(503);
  }
}

export function GET() {
  return empty(405, { Allow: 'POST' });
}
