import {
  TossError,
  type TossConfirm,
  type TossGateway,
  type TossPayment,
} from './toss-gateway';

/** The provider seam, never an alternative success path on a deployed site. */
export interface FakeTossGateway extends TossGateway {
  authorize(orderId: string, amount: number): void;
  keyFor(orderId: string): string;
  confirmCalls: number;
  cancelCalls: number;
  loseConfirmResponse: boolean;
  failCancel: boolean;
}
export function createFakeTossGateway(): FakeTossGateway {
  const payments = new Map<string, TossPayment>();
  const confirmations = new Map<string, TossPayment>();
  const cancellations = new Map<string, TossPayment>();
  const fake: FakeTossGateway = {
    kind: 'fake',
    confirmCalls: 0,
    cancelCalls: 0,
    loseConfirmResponse: false,
    failCancel: false,
    keyFor: (id) => `fake_${id}`,
    authorize(orderId, amount) {
      const paymentKey = fake.keyFor(orderId);
      if (!payments.has(paymentKey))
        payments.set(paymentKey, {
          paymentKey,
          orderId,
          amount,
          currency: 'KRW',
          status: 'IN_PROGRESS',
          balance: amount,
        });
    },
    async confirm(input: TossConfirm) {
      const previous = confirmations.get(input.idempotencyKey);
      if (previous) return { ...previous };
      const p = payments.get(input.paymentKey);
      if (!p || p.orderId !== input.orderId || p.amount !== input.amount)
        throw new TossError('INVALID_PAYMENT', false);
      fake.confirmCalls += 1;
      const paid = { ...p, status: 'DONE' };
      payments.set(input.paymentKey, paid);
      confirmations.set(input.idempotencyKey, paid);
      if (fake.loseConfirmResponse) {
        fake.loseConfirmResponse = false;
        throw new TossError('NETWORK_ERROR');
      }
      return { ...paid };
    },
    async retrieve(key) {
      const p = payments.get(key);
      return p ? { ...p } : null;
    },
    async cancel(input) {
      if (fake.failCancel) throw new TossError('NETWORK_ERROR');
      const previous = cancellations.get(input.idempotencyKey);
      if (previous) return { ...previous };
      const p = payments.get(input.paymentKey);
      if (!p) throw new TossError('NOT_FOUND', false);
      fake.cancelCalls += 1;
      const refunded = { ...p, status: 'CANCELED', balance: 0 };
      payments.set(input.paymentKey, refunded);
      cancellations.set(input.idempotencyKey, refunded);
      return { ...refunded };
    },
  };
  return fake;
}
