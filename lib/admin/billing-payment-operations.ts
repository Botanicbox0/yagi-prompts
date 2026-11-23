import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getTossGateway, type TossGateway, type TossPayment } from '@/lib/billing/toss-gateway';
import {
  billingErrorCode,
  logBilling,
  reconcileTossWebhook,
} from '@/lib/billing/toss-service';
import { getRenderStore } from '@/lib/renders/store';
import { createRenderJob } from '@/lib/renders/service';
import { fail, ok, type AdminContext } from './context';
import { str } from './form';
import type { AdminOperation } from './operations';

/**
 * `billing.payment.recheck` (docs/PLATFORM-2.0.md §2.3):
 * Re-reads one consumer template payment (`billing_payments`, `payment_type = 'NORMAL'`) from Toss
 * through the existing webhook/reconcile code path (`reconcileTossWebhook`), enforces same-environment
 * keys, a 60s per-payment cooldown, and records an immutable row in `platform_audit`.
 */
export const PAYMENT_RECHECK_COOLDOWN_SECONDS = 60;
export const PAYMENT_RECHECK_AUDIT_ACTION = 'billing.payment.recheck';

const inFlightPayments = new Set<string>();

const RecheckInputSchema = z.object({
  paymentId: z.string().uuid(),
});

interface PaymentSnapshotRow {
  id: string;
  environment: 'test' | 'live' | 'fake';
  payment_type: string;
  status: string;
  failure_code: string | null;
  payment_key: string | null;
  amount_krw: number;
  render_id: string | null;
}

function formatPaymentState(status: string, failureCode: string | null): string {
  return failureCode ? `${status}(${failureCode})` : status;
}

function matchesOrderSnapshot(
  payment: TossPayment,
  order: Pick<PaymentSnapshotRow, 'id' | 'payment_key' | 'amount_krw'>,
): boolean {
  return (
    payment.orderId === order.id &&
    payment.paymentKey === order.payment_key &&
    payment.amount === order.amount_krw &&
    payment.currency === 'KRW'
  );
}

async function hasAuditTable(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ok: boolean }>(
    "select to_regclass('public.platform_audit') is not null as ok",
  );
  return rows[0]?.ok === true;
}

async function loadPaymentRow(sql: SqlRunner, paymentId: string): Promise<PaymentSnapshotRow | null> {
  const { rows } = await sql.query<PaymentSnapshotRow>(
    `select id, environment, payment_type, status, failure_code, payment_key, amount_krw, render_id
       from billing_payments
      where id = $1 and payment_type = 'NORMAL'`,
    [paymentId],
  );
  return rows[0] ?? null;
}

async function writePaymentAudit(
  sql: SqlRunner,
  entry: {
    actorId: string;
    paymentId: string;
    details: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  await sql.query(
    `insert into platform_audit (actor_id, entity_id, action, reason, details, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
    [
      entry.actorId,
      entry.paymentId,
      PAYMENT_RECHECK_AUDIT_ACTION,
      'admin_payment_recheck',
      JSON.stringify(entry.details),
      entry.now.toISOString(),
    ],
  );
}

function resolveGateway(ctx: AdminContext): TossGateway | null {
  if (ctx.toss && 'gateway' in ctx.toss) {
    return ctx.toss.gateway ?? null;
  }
  try {
    return getTossGateway();
  } catch {
    return null;
  }
}

const recheckPayment: AdminOperation<z.infer<typeof RecheckInputSchema>> = {
  parse(form) {
    const rawId = str(form, 'paymentId') || str(form, 'id');
    const parsed = RecheckInputSchema.safeParse({ paymentId: rawId });
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, detail: 'invalid paymentId' };
  },
  async run(ctx, input) {
    if (ctx.viewer.isAdmin !== true || !ctx.viewer.userId) {
      return fail('forbidden');
    }

    const now = ctx.toss?.now ? ctx.toss.now() : new Date();
    const gateway = resolveGateway(ctx);
    if (!gateway) {
      return fail('paymentUnavailable', 'gateway_unavailable');
    }

    if (!(await hasAuditTable(ctx.sql))) {
      return fail('unknown', 'audit table unavailable');
    }

    const before = await loadPaymentRow(ctx.sql, input.paymentId);
    if (!before) {
      return fail('notFound');
    }

    if (before.environment !== gateway.kind) {
      return fail('paymentWrongEnvironment', `${before.environment} != ${gateway.kind}`);
    }

    if (inFlightPayments.has(before.id)) {
      return fail('paymentCooldown', `${PAYMENT_RECHECK_COOLDOWN_SECONDS}s`);
    }

    const cooldownSince = new Date(
      now.getTime() - PAYMENT_RECHECK_COOLDOWN_SECONDS * 1000,
    ).toISOString();
    const { rows: recentAudits } = await ctx.sql.query<{ created_at: Date | string }>(
      `select created_at
         from platform_audit
        where action = $1 and entity_id = $2 and created_at > $3::timestamptz
        order by created_at desc
        limit 1`,
      [PAYMENT_RECHECK_AUDIT_ACTION, before.id, cooldownSince],
    );
    if (recentAudits[0]) {
      const lastMs = new Date(recentAudits[0].created_at).getTime();
      const remainingSeconds = Math.max(
        1,
        Math.ceil((lastMs + PAYMENT_RECHECK_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000),
      );
      return fail('paymentCooldown', `${remainingSeconds}s`);
    }

    const observed: { called: boolean; payment: TossPayment | null } = {
      called: false,
      payment: null,
    };
    const observingGateway: TossGateway = {
      kind: gateway.kind,
      confirm: (args) => gateway.confirm(args),
      cancel: (args) => gateway.cancel(args),
      async retrieve(paymentKey) {
        observed.called = true;
        const snapshot = await gateway.retrieve(paymentKey);
        observed.payment = snapshot;
        return snapshot;
      },
    };

    const store = ctx.toss?.store ?? (await getRenderStore());
    const createRender = ctx.toss?.createRender ?? createRenderJob;

    inFlightPayments.add(before.id);
    try {
      let outcome: Awaited<ReturnType<typeof reconcileTossWebhook>>;
      try {
        outcome = await reconcileTossWebhook(
          { sql: ctx.sql, gateway: observingGateway, store, createRender, now },
          { orderId: before.id },
        );
      } catch (error) {
        const code = billingErrorCode(error);
        logBilling('error', 'admin_payment_recheck_failed', { order: before.id, code });
        await writePaymentAudit(ctx.sql, {
          actorId: ctx.viewer.userId,
          paymentId: before.id,
          now,
          details: {
            environment: before.environment,
            before: { status: before.status, failureCode: before.failure_code },
            provider: { called: observed.called, status: null, error: code },
            after: { status: before.status, failureCode: before.failure_code },
            changed: false,
          },
        });
        return fail('paymentUnavailable', code);
      }

      const after = await loadPaymentRow(ctx.sql, before.id);
      if (!after) {
        return fail('notFound');
      }

      const providerStatus = !observed.called
        ? 'NOT_QUERIED'
        : observed.payment === null
          ? 'NOT_FOUND'
          : !matchesOrderSnapshot(observed.payment, before)
            ? 'MISMATCH'
            : observed.payment.status;

      const changed =
        before.status !== after.status ||
        before.failure_code !== after.failure_code ||
        (before.render_id ?? null) !== (after.render_id ?? null);

      await writePaymentAudit(ctx.sql, {
        actorId: ctx.viewer.userId,
        paymentId: before.id,
        now,
        details: {
          environment: before.environment,
          before: { status: before.status, failureCode: before.failure_code },
          provider: {
            called: observed.called,
            status: providerStatus,
            balance: observed.payment?.balance ?? null,
          },
          after: { status: after.status, failureCode: after.failure_code },
          changed,
          report: outcome.matched ? outcome.report : null,
        },
      });

      const detail = `${formatPaymentState(before.status, before.failure_code)} → ${providerStatus} → ${formatPaymentState(after.status, after.failure_code)}`;
      return ok(changed ? 'paymentRechecked' : 'paymentUnchanged', { detail });
    } finally {
      inFlightPayments.delete(before.id);
    }
  },
};

export const BILLING_PAYMENT_OPERATIONS = {
  'billing.payment.recheck': recheckPayment,
} as const;
