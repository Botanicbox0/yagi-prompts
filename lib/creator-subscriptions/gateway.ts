import { TossError, type TossPayment } from '@/lib/billing/toss-gateway';
import type { BillingEnvironment, SubscriptionGateway } from './types';

export interface BillingConfig { clientKey: string; secretKey: string; kind: BillingEnvironment }
export function billingConfigFromEnv(env: Record<string, string | undefined> = process.env): BillingConfig | null {
  const clientKey = env.TOSS_BILLING_CLIENT_KEY?.trim();
  const secretKey = env.TOSS_BILLING_SECRET_KEY?.trim();
  if (!clientKey && !secretKey) return null;
  const kind = clientKey?.startsWith('test_ck_') ? 'test' : clientKey?.startsWith('live_ck_') ? 'live' : null;
  if (!kind || !secretKey?.startsWith(`${kind}_sk_`)) throw new TossError('INVALID_BILLING_CONFIGURATION', false);
  return { clientKey: clientKey!, secretKey, kind };
}
function payment(body: unknown): TossPayment {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.paymentKey !== 'string' || typeof b.orderId !== 'string' ||
    !Number.isSafeInteger(b.totalAmount) || !Number.isSafeInteger(b.balanceAmount) ||
    typeof b.currency !== 'string' || typeof b.status !== 'string') throw new TossError('INVALID_RESPONSE');
  return { paymentKey: b.paymentKey, orderId: b.orderId, amount: b.totalAmount as number,
    balance: b.balanceAmount as number, currency: b.currency, status: b.status };
}
/** No fake-provider fallback, redirects, secret URLs in thrown errors, or raw provider logging. */
export function createSubscriptionGateway(config: BillingConfig, fetcher: typeof fetch = fetch): SubscriptionGateway {
  async function request(path: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown, key?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`https://api.tosspayments.com/v1${path}`, {
        method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(65_000),
        headers: { Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new TossError('NETWORK_ERROR'); }
    if (method === 'GET' && response.status === 404) {
      // Only the documented not-found result permits a same-order retry. A proxy 404 is ambiguous.
      const error = await response.json().catch(() => null) as { code?: string } | null;
      if (error?.code === 'NOT_FOUND_PAYMENT') return null;
      throw new TossError('LOOKUP_UNCERTAIN');
    }
    if (!response.ok) throw new TossError(`HTTP_${response.status}`, response.status >= 500 || response.status === 429);
    if (method === 'DELETE') return null;
    try { return await response.json(); } catch { throw new TossError('INVALID_RESPONSE'); }
  }
  return {
    kind: config.kind,
    async issue({ authKey, customerKey, idempotencyKey }) {
      const result = await request('/billing/authorizations/issue', 'POST', { authKey, customerKey }, idempotencyKey) as Record<string, unknown>;
      if (!result || typeof result.billingKey !== 'string' || !result.billingKey || result.customerKey !== customerKey) throw new TossError('INVALID_RESPONSE');
      return { billingKey: result.billingKey, customerKey };
    },
    async charge({ billingKey, customerKey, orderId, orderName, amount, idempotencyKey }) {
      return payment(await request(`/billing/${encodeURIComponent(billingKey)}`, 'POST', { customerKey, orderId, orderName, amount }, idempotencyKey));
    },
    async retrieveOrder(id) {
      const result = await request(`/payments/orders/${encodeURIComponent(id)}`, 'GET');
      return result === null ? null : payment(result);
    },
    async cancel({ paymentKey, reason, idempotencyKey }) {
      return payment(await request(`/payments/${encodeURIComponent(paymentKey)}/cancel`, 'POST', { cancelReason: reason }, idempotencyKey));
    },
    async revokeBillingKey({billingKey,idempotencyKey}) {
      await request(`/billing/${encodeURIComponent(billingKey)}`,'DELETE',undefined,idempotencyKey);
    },
  };
}
