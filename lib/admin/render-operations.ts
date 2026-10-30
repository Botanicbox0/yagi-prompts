import { z } from "zod";
import { getTossGateway } from "@/lib/billing/toss-gateway";
import { reconcileTossPayments } from "@/lib/billing/toss-service";
import { createRenderJob } from "@/lib/renders/service";
import { getRenderStore } from "@/lib/renders/store";
import { fail, ok, type AdminContext } from "./context";
import * as f from "./form";
import type { AdminOperation, ParseResult } from "./operations";
import { canRetryRenderJob } from "./renders-users";

const Uuid = z.string().uuid();

const RetrySchema = z.object({
  id: Uuid,
  reason: z.string().trim().min(2).max(500),
  confirm: z.literal(true, {
    message: "confirmation required",
  }),
});

const ResendSchema = z.object({
  id: Uuid,
});

const ReconcileSchema = z.object({
  orderId: Uuid.optional(),
});

function parsed<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
  const res = schema.safeParse(value);
  return res.success
    ? { ok: true, value: res.data }
    : {
        ok: false,
        detail: res.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      };
}

const retryRenderOp: AdminOperation<z.infer<typeof RetrySchema>> = {
  parse: (form) =>
    parsed(RetrySchema, {
      id: f.str(form, "id"),
      reason: f.text(form, "reason"),
      confirm: f.bool(form, "_confirm"),
    }),
  async run(ctx: AdminContext, input) {
    if (ctx.viewer.isAdmin !== true) return fail("forbidden");
    const { rows } = await ctx.sql.query<{
      id: string;
      status: string;
      error_code: string | null;
      input_key: string | null;
    }>(
      `select id, status, error_code, input_key from render_jobs where id = $1`,
      [input.id],
    );
    const job = rows[0];
    if (!job) return fail("notFound", "render job not found");
    if (
      !canRetryRenderJob({
        status: job.status,
        errorCode: job.error_code,
        inputKey: job.input_key,
      })
    ) {
      return fail(
        "badTransition",
        "only failed provider renders with an input file and no safety or face refusal may be retried",
      );
    }
    const updated = await ctx.sql.query<{ id: string }>(
      `update render_jobs
          set status = 'queued',
              attempts = 0,
              claimed_at = null,
              started_at = null,
              finished_at = null,
              provider_task_id = null,
              error_code = null,
              error_message = null,
              updated_at = now()
        where id = $1 and status = 'failed'
        returning id`,
      [input.id],
    );
    if (!updated.rows.length) {
      return fail("badTransition", "render job is no longer in failed state");
    }
    ctx.revalidate?.();
    return ok("saved", { to: "/admin/renders", detail: input.id });
  },
};

const resendNotificationOp: AdminOperation<z.infer<typeof ResendSchema>> = {
  parse: (form) =>
    parsed(ResendSchema, {
      id: f.str(form, "id"),
    }),
  async run(ctx: AdminContext, input) {
    if (ctx.viewer.isAdmin !== true) return fail("forbidden");
    const updated = await ctx.sql.query<{ id: string }>(
      `update render_jobs
          set notify_status = 'pending',
              notify_attempts = 0,
              updated_at = now()
        where id = $1 and status in ('succeeded', 'failed')
        returning id`,
      [input.id],
    );
    if (!updated.rows.length) {
      return fail(
        "notFound",
        "only finished render jobs can re-queue a completion notification",
      );
    }
    ctx.revalidate?.();
    return ok("saved", { to: "/admin/renders", detail: input.id });
  },
};

const reconcilePaymentsOp: AdminOperation<z.infer<typeof ReconcileSchema>> = {
  parse: (form) => {
    const rawOrderId = f.str(form, "orderId");
    return parsed(ReconcileSchema, {
      orderId: rawOrderId ? rawOrderId : undefined,
    });
  },
  async run(ctx: AdminContext, input) {
    if (ctx.viewer.isAdmin !== true) return fail("forbidden");
    const gateway = getTossGateway();
    if (!gateway) return fail("invalid", "payment_unavailable");
    const store = await getRenderStore();
    await reconcileTossPayments(
      {
        sql: ctx.sql,
        gateway,
        store,
        createRender: createRenderJob,
      },
      input.orderId ? { orderId: input.orderId } : {},
    );
    ctx.revalidate?.();
    return ok("saved", { to: "/admin/renders?tab=payments" });
  },
};

export const RENDER_OPERATIONS = {
  "render.retry": retryRenderOp,
  "render.resendNotification": resendNotificationOp,
  "payment.reconcile": reconcilePaymentsOp,
} as const;
