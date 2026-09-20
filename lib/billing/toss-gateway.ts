import { createFakeTossGateway } from './toss-fake';

/** Narrow payment snapshots shared by normal checkout and a future billing-key adapter. */
export interface TossPayment {
  paymentKey: string;
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  balance: number;
}
export interface TossConfirm {
  paymentKey: string;
  orderId: string;
  amount: number;
  idempotencyKey: string;
}
export interface TossGateway {
  readonly kind: 'test' | 'live' | 'fake';
  confirm(input: TossConfirm): Promise<TossPayment>;
  retrieve(paymentKey: string): Promise<TossPayment | null>;
  cancel(input: {
    paymentKey: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<TossPayment>;
}

/** Do not propagate provider messages, bodies, request headers, or URLs into logs. */
export class TossError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = true,
  ) {
    super('Payment provider request could not be completed');
    this.name = 'TossError';
  }
}

export interface TossConfig {
  clientKey: string;
  secretKey: string;
  kind: 'test' | 'live';
}
export function tossConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): TossConfig | null {
  const clientKey = env.TOSS_CLIENT_KEY?.trim();
  const secretKey = env.TOSS_SECRET_KEY?.trim();
  if (!clientKey && !secretKey) return null;
  const kind = clientKey?.startsWith('test_gck_')
    ? 'test'
    : clientKey?.startsWith('live_gck_')
      ? 'live'
      : null;
  if (!kind || !secretKey?.startsWith(`${kind}_gsk_`))
    throw new TossError('INVALID_CONFIGURATION', false);
  return { clientKey: clientKey!, secretKey, kind };
}

function snapshot(body: unknown): TossPayment {
  const b = body as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.paymentKey !== 'string' ||
    typeof b.orderId !== 'string' ||
    !Number.isSafeInteger(b.totalAmount) ||
    !Number.isSafeInteger(b.balanceAmount) ||
    typeof b.currency !== 'string' ||
    typeof b.status !== 'string'
  )
    throw new TossError('INVALID_RESPONSE');
  return {
    paymentKey: b.paymentKey,
    orderId: b.orderId,
    amount: b.totalAmount as number,
    currency: b.currency,
    status: b.status,
    balance: b.balanceAmount as number,
  };
}

export function createTossGateway(
  config: TossConfig,
  fetcher: typeof fetch = fetch,
): TossGateway {
  async function request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    key?: string,
  ): Promise<TossPayment | null> {
    let response: Response;
    try {
      response = await fetcher(
        `https://api.tosspayments.com/v1/payments${path}`,
        {
          method,
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
            'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new TossError('NETWORK_ERROR');
    }
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok)
      throw new TossError(
        `HTTP_${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TossError('INVALID_RESPONSE');
    }
    return snapshot(payload);
  }
  return {
    kind: config.kind,
    async confirm({ paymentKey, orderId, amount, idempotencyKey }) {
      return (await request(
        '/confirm',
        'POST',
        { paymentKey, orderId, amount },
        idempotencyKey,
      ))!;
    },
    retrieve: (paymentKey) =>
      request(`/${encodeURIComponent(paymentKey)}`, 'GET'),
    async cancel({ paymentKey, reason, idempotencyKey }) {
      return (await request(
        `/${encodeURIComponent(paymentKey)}/cancel`,
        'POST',
        { cancelReason: reason },
        idempotencyKey,
      ))!;
    },
  };
}

/** Missing credentials use a fake ONLY on an explicitly local/test runtime, never a cloud deployment. */
export function getTossGateway(
  env: NodeJS.ProcessEnv = process.env,
): TossGateway | null {
  const config = tossConfigFromEnv(env);
  if (config) return createTossGateway(config);
  if (env.VERCEL || (env.PLAYBOOK_MODE !== 'local' && env.NODE_ENV !== 'test'))
    return null;
  const g = globalThis as typeof globalThis & {
    __twingsFakeToss?: TossGateway;
  };
  return (g.__twingsFakeToss ??= createFakeTossGateway());
}
