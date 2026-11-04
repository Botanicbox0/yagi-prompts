import { z } from "zod";
import type { AdminOperation } from "./operations";
import { ok, fail } from "./context";
import { str } from "./form";
import { canResendRenderNotice, canRetryRender } from "./render-board";
import type { RenderStatus } from "@/lib/renders/repo";
import type { SqlRunner } from "@/lib/db/sql-runner";

/**
 * `render.retry` & `render.resendNotice` (docs/ADMIN.md §8 & §10-4, founder decision 2026-11-04).
 *
 * Safety invariants:
 * 1. `render.retry` only re-queues `failed` jobs with transient provider errors (`provider_timeout`,
 *    `engine_error`, `stalled`, etc.). Face check, liveness, moderation, and safety rejections are
 *    permanently refused (AGENTS.md §4).
 * 2. When a `billing_payments` row is linked to the render, `render.retry` locks both `render_jobs`
 *    and `billing_payments` `FOR UPDATE` in the same transaction and requires `payment.status = 'paid'`
 *    with no active refund lease. Once `render_jobs.status` becomes `'queued'`, `reconcileTossPayments`
 *    will not select the order for automatic refund.
 * 3. `render.resendNotice` only acts on `succeeded` renders, resetting `notify_status = 'pending'`
 *    and `notified_at = null` so the notification pass delivers the completion notice again.
 */

const RetryInputSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  confirmed: z.literal(true),
});

const ResendNoticeInputSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500).default("operator resend notice"),
  confirmed: z.literal(true),
});

function isConfirmed(form: FormData): boolean {
  const c1 = str(form, "_confirm").trim();
  const c2 = str(form, "confirm").trim();
  return c1 === "1" || c1 === "yes" || c1 === "true" || c2 === "1" || c2 === "yes" || c2 === "true";
}

async function hasTable(sql: SqlRunner, name: string): Promise<boolean> {
  const { rows } = await sql.query<{ ok: boolean }>(
    "select to_regclass('public.' || $1) is not null as ok",
    [name],
  );
  return rows[0]?.ok === true;
}

async function writeRenderAudit(
  sql: SqlRunner,
  actorId: string | null,
  entityId: string,
  action: string,
  reason: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!actorId) return;
  if (!(await hasTable(sql, "platform_audit"))) return;
  await sql.query(
    "insert into platform_audit (actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5::jsonb)",
    [actorId, entityId, action, reason, JSON.stringify(details)],
  );
}

const retryRender: AdminOperation<z.infer<typeof RetryInputSchema>> = {
  parse(form) {
    const parsed = RetryInputSchema.safeParse({
      id: str(form, "id").trim(),
      reason: str(form, "reason").trim(),
      confirmed: isConfirmed(form),
    });
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, detail: "invalid render retry input" };
  },
  async run(ctx, input) {
    return ctx.sql.transaction(async (tx) => {
      const { rows: jobRows } = await tx.query<{
        id: string;
        status: RenderStatus;
        error_code: string | null;
      }>("select id, status, error_code from render_jobs where id = $1 for update", [input.id]);

      const job = jobRows[0];
      if (!job) return fail("notFound");

      let paymentStatus: string | null = null;
      if (await hasTable(tx, "billing_payments")) {
        const { rows: payRows } = await tx.query<{
          id: string;
          status: string;
          lease_until: Date | string | null;
        }>("select id, status, lease_until from billing_payments where render_id = $1 for update", [
          input.id,
        ]);
        const payment = payRows[0];
        if (payment) {
          paymentStatus = payment.status;
          const leaseActive =
            payment.lease_until !== null &&
            new Date(String(payment.lease_until)).getTime() > Date.now();
          if (payment.status !== "paid" || leaseActive) {
            return fail("invalid", "payment_refunding");
          }
        }
      }

      if (
        !canRetryRender({
          status: job.status,
          errorCode: job.error_code,
          paymentStatus,
        })
      ) {
        return fail("invalid", "render_not_retryable");
      }

      await tx.query(
        `update render_jobs
            set status = 'queued',
                attempts = 0,
                claimed_at = null,
                provider_task_id = null,
                started_at = null,
                finished_at = null,
                error_code = null,
                error_message = null,
                notify_status = 'pending',
                notified_at = null,
                updated_at = now()
          where id = $1`,
        [input.id],
      );

      await writeRenderAudit(tx, ctx.viewer.userId, input.id, "render.retry", input.reason, {
        previousErrorCode: job.error_code,
        paymentStatus,
      });

      return ok("saved", {
        to: `/admin/renders/${input.id}`,
        detail: input.id.slice(0, 8),
      });
    });
  },
};

const resendRenderNotice: AdminOperation<z.infer<typeof ResendNoticeInputSchema>> = {
  parse(form) {
    const rawReason = str(form, "reason").trim();
    const parsed = ResendNoticeInputSchema.safeParse({
      id: str(form, "id").trim(),
      reason: rawReason.length >= 3 ? rawReason : "operator resend notice",
      confirmed: isConfirmed(form),
    });
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, detail: "invalid render resendNotice input" };
  },
  async run(ctx, input) {
    return ctx.sql.transaction(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        status: RenderStatus;
        notify_status: string;
      }>("select id, status, notify_status from render_jobs where id = $1 for update", [input.id]);

      const job = rows[0];
      if (!job) return fail("notFound");
      if (!canResendRenderNotice({ status: job.status })) {
        return fail("invalid", "render_not_succeeded");
      }

      await tx.query(
        `update render_jobs
            set notify_status = 'pending',
                notified_at = null,
                notify_attempts = 0,
                updated_at = now()
          where id = $1`,
        [input.id],
      );

      await writeRenderAudit(tx, ctx.viewer.userId, input.id, "render.resendNotice", input.reason, {
        previousNotifyStatus: job.notify_status,
      });

      return ok("saved", {
        to: `/admin/renders/${input.id}`,
        detail: input.id.slice(0, 8),
      });
    });
  },
};

export const RENDER_OPERATIONS = {
  "render.retry": retryRender,
  "render.resendNotice": resendRenderNotice,
};
