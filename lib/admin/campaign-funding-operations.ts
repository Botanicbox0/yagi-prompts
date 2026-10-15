import type { AdminOperation } from "./operations";
import { fail, ok } from "./context";
import {
  issueFundingQuote,
  reviewCampaignReward,
  voidExpiredFundingQuote,
} from "@/lib/campaigns/funding/service";
import {
  reconcileFunding,
  refundFundingPayment,
  releaseUnpaidFundingOrder,
} from "@/lib/campaigns/funding/payment";
import { fundingDeps } from "@/lib/campaigns/funding/runtime";
import { Denied, studio } from "@/lib/campaigns/funding/core";
type Input = Record<string, unknown>;
const quote: AdminOperation<Input> = {
  parse(form) {
    const raw = String(form.get("validUntil") ?? "");
    const valid = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
      ? new Date(`${raw}+09:00`)
      : null;
    return {
      ok: true,
      value: {
        campaignId: form.get("campaignId"),
        requestId: form.get("requestId"),
        totalKrw: Number(form.get("totalKrw")),
        taxBasis: form.get("taxBasis"),
        termsSummary: form.get("termsSummary"),
        termsRef: form.get("termsRef"),
        validUntil: valid && Number.isFinite(+valid) ? valid.toISOString() : "",
      },
    };
  },
  async run(ctx, input) {
    const r = await issueFundingQuote({ sql: ctx.sql }, ctx.viewer, input);
    return r.ok
      ? ok("saved", { to: "/admin/funding" })
      : fail(
          r.code === "forbidden"
            ? "forbidden"
            : r.code === "not_found"
              ? "notFound"
              : "invalid",
          r.code,
        );
  },
};
const reconcile: AdminOperation<Input> = {
  parse: () => ({ ok: true, value: {} }),
  async run(ctx) {
    try {
      await studio(ctx.sql, ctx.viewer.userId!);
    } catch (e) {
      if (e instanceof Denied) return fail("forbidden");
      throw e;
    }
    const deps = fundingDeps(ctx.sql);
    if (!deps) return fail("invalid", "payments_closed");
    await reconcileFunding(deps);
    return ok("saved", { to: "/admin/funding" });
  },
};
const refund: AdminOperation<Input> = {
  parse: (form) => ({
    ok: true,
    value: {
      paymentId: form.get("paymentId"),
      reason: form.get("reason"),
      confirmed: form.get("_confirm") === "1",
    },
  }),
  async run(ctx, input) {
    const deps = fundingDeps(ctx.sql);
    if (!deps) return fail("invalid", "payments_closed");
    const r = await refundFundingPayment(deps, ctx.viewer, input);
    return r.ok
      ? ok("saved", { to: "/admin/funding" })
      : fail(r.code === "forbidden" ? "forbidden" : "invalid", r.code);
  },
};
const reviewReward: AdminOperation<Input> = {
  parse: (form) => ({
    ok: true,
    value: {
      proposalId: form.get("proposalId"),
      state: form.get("state"),
      note: form.get("note"),
    },
  }),
  async run(ctx, input) {
    const r = await reviewCampaignReward({ sql: ctx.sql }, ctx.viewer, input);
    return r.ok
      ? ok("saved", { to: "/admin/funding" })
      : fail(r.code === "forbidden" ? "forbidden" : "invalid", r.code);
  },
};
const voidExpired: AdminOperation<Input> = {
  parse: (form) => ({
    ok: true,
    value: {
      caseId: form.get("caseId"),
      reason: form.get("reason"),
      confirmed: form.get("_confirm") === "1",
    },
  }),
  async run(ctx, input) {
    const r = await voidExpiredFundingQuote(
      { sql: ctx.sql },
      ctx.viewer,
      input,
    );
    return r.ok
      ? ok("saved", { to: "/admin/funding" })
      : fail(r.code === "forbidden" ? "forbidden" : "invalid", r.code);
  },
};
const releaseUnpaid: AdminOperation<Input> = {
  parse: (form) => ({
    ok: true,
    value: {
      paymentId: form.get("paymentId"),
      reason: form.get("reason"),
      confirmed: form.get("_confirm") === "1",
    },
  }),
  async run(ctx, input) {
    const deps = fundingDeps(ctx.sql);
    if (!deps) return fail("invalid", "unavailable");
    const r = await releaseUnpaidFundingOrder(deps, ctx.viewer, input);
    return r.ok
      ? ok("saved", { to: "/admin/funding" })
      : fail(r.code === "forbidden" ? "forbidden" : "invalid", r.code);
  },
};
export const CAMPAIGN_FUNDING_OPERATIONS = {
  "campaignFunding.voidExpired": voidExpired,
  "campaignFunding.releaseUnpaid": releaseUnpaid,
  "campaignFunding.reviewReward": reviewReward,
  "campaignFunding.quote": quote,
  "campaignFunding.reconcile": reconcile,
  "campaignFunding.refund": refund,
} as const;
