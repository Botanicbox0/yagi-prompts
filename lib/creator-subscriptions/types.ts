import type { SqlRunner } from '@/lib/db/sql-runner';
import type { TossPayment } from '@/lib/billing/toss-gateway';

export type BillingEnvironment = 'test' | 'live';
export type SubscriptionPlanId = 'creator' | 'premium';
export type SubscriptionStatus = 'awaiting_auth' | 'authorizing' | 'active' | 'past_due' | 'refund_pending' | 'refunded' | 'ended';
export type Failure = { ok: false; code: string };
export interface BillingKeyCipher {
  encrypt(value: string, context: string): string;
  decrypt(value: string, context: string): string;
}
export interface SubscriptionGateway {
  readonly kind: BillingEnvironment;
  issue(input: { authKey: string; customerKey: string; idempotencyKey: string }): Promise<{ billingKey: string; customerKey: string }>;
  charge(input: { billingKey: string; customerKey: string; orderId: string; orderName: string; amount: number; idempotencyKey: string }): Promise<TossPayment>;
  retrieveOrder(orderId: string): Promise<TossPayment | null>;
  cancel(input: { paymentKey: string; reason: string; idempotencyKey: string }): Promise<TossPayment>;
  revokeBillingKey(input: { billingKey: string; idempotencyKey: string }): Promise<void>;
}
export interface SubscriptionDeps {
  sql: SqlRunner;
  gateway: SubscriptionGateway;
  cipher: BillingKeyCipher;
  environment: BillingEnvironment;
  consentVersion: string;
  /** Server-approved quota captured only when accepting a new Premium contract. */
  premiumEditLimit?: number | null;
  now?: () => Date;
}
/** Server records: never return these rows through an API. */
export interface SubscriptionRow {
  id: string; user_id: string; environment: BillingEnvironment; plan_id: SubscriptionPlanId;
  plan_version: string; amount_krw: number; monthly_units: number; consent_version: string;
  premium_edit_limit: number | null;
  locale: 'ko' | 'en'; customer_key: string; billing_key_ciphertext: string | null;
  auth_fingerprint: string | null; auth_lease_until: Date | string | null;
  status: SubscriptionStatus; cancel_at_period_end: boolean;
  anchor_at: Date | string | null; current_period_index: number;
  next_billing_at: Date | string | null; created_at: Date | string; expires_at: Date | string;
}
export interface PeriodRow {
  id: string; subscription_id: string; period_index: number; environment: BillingEnvironment;
  starts_at: Date | string; ends_at: Date | string; amount_krw: number; monthly_units: number;
  reserved_units: number; consumed_units: number;
  status: 'pending' | 'charging' | 'paid' | 'failed' | 'refund_pending' | 'refunded';
  payment_key: string | null; lease_until: Date | string | null; charge_started_at: Date | string | null;
  attempts: number;
  failure_code: string | null;
}
export interface SubscriptionSummary {
  id: string; planId: SubscriptionPlanId; status: SubscriptionStatus; environment: BillingEnvironment;
  cancelAtPeriodEnd: boolean; periodStart: string | null; periodEnd: string | null;
  nextBillingAt: string | null; remainingPercent: number; usedPercent: number; hasAccess: boolean;
}
