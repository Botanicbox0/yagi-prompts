import { NextResponse } from 'next/server';
import { getTossContext, TOSS_HEADERS } from '@/lib/billing/toss-runtime';
import {
  allowTossWebhook,
  billingErrorCode,
  logBilling,
  reconcileTossWebhook,
  tossWebhookHint,
} from '@/lib/billing/toss-service';

/**
 * `POST /api/billing/toss/webhook` — 토스페이먼츠 웹훅 (docs/PLATFORM-2.0.md §2.2-5).
 *
 * The body is a HINT, never a fact: it may name an order (`orderId`, `paymentKey`, `status`), and
 * that one order is read again at Toss with its own stored payment key and settled by the same
 * rules as the render pass. That is how a cancellation made in the merchant console reaches the
 * database, and why the endpoint needs no signature: a forged hint can only make us look again.
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
    logBilling('info', 'toss_webhook', outcome.matched ? { matched: true, ...outcome.report } : { matched: false });
    return empty(200);
  } catch (error) {
    logBilling('error', 'toss_webhook_failed', { code: billingErrorCode(error) });
    return empty(503);
  }
}

export function GET() {
  return empty(405, { Allow: 'POST' });
}
