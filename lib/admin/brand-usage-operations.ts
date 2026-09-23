import {
  triageUsageCase, sendUsageMessage, defineUsageScope, recordUsageCompensation, recordUsageConsent, withdrawUsageConsent,
  issueUsageQuote, reopenUsageCase, closeUsageCase, setUsageBuyer, recordUsageGrantEvent, startUsageGrant,
} from "@/lib/brands/usage/service";
import { reconcileBrandUsagePayments, resolveUsageCase } from "@/lib/brands/usage/payment";
import type { UsageOutcome } from "@/lib/brands/usage/types";
import { getTossGateway } from "@/lib/billing/toss-gateway";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import type { AdminOperation } from "./operations";
import { fail, ok, type AdminContext } from "./context";
import { brandFailure } from "./brand-workspace-operations";
import * as f from "./form";

/**
 * Studio operations for brand secondary usage (docs/SECONDARY-USAGE.md), registered in `/admin/do`.
 * Every one is `is_admin`-only twice over: the dispatcher and the service. The service's detailed
 * refusal (`consent_missing`, `subject_unpinned`, …) rides along as the banner detail.
 */
type Input = Record<string, unknown>;
const back = (caseId: unknown) => `/admin/brand-workspace/usage/${String(caseId)}`;

/** A `datetime-local` value read as Korea time; an impossible date is refused. */
function koreaInstant(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return null;
  const date = new Date(`${raw}+09:00`);
  if (!Number.isFinite(+date) || new Date(+date + 9 * 3600000).toISOString().slice(0, raw.length) !== raw) return null;
  return date.toISOString();
}
const num = (raw: string) => raw === "" ? NaN : Number(raw.replace(/[,\s]/g, ""));

function usageOp(parse: (form: FormData) => { ok: true; value: Input } | { ok: false; detail: string },
  run: (ctx: AdminContext, input: Input) => Promise<UsageOutcome<{ id: string }>>, to: (input: Input, id: string) => string = input => back(input.caseId)): AdminOperation<Input> {
  return {
    parse,
    async run(ctx, input) {
      const result = await run(ctx, input);
      return result.ok ? ok("saved", { to: to(input, result.id) }) : brandFailure(result.code);
    },
  };
}
const plain = (...names: string[]) => (form: FormData) => {
  const value: Input = {};
  for (const name of names) value[name] = name === "body" || name === "note" || name === "reason" || name === "evidenceReference" ? f.text(form, name) : f.str(form, name);
  if ("expectedRevision" in value) value.expectedRevision = Number(value.expectedRevision);
  return { ok: true as const, value };
};

/**
 * The scope form: one set of terms applied to every ticked item, each with its own pin. Blank never
 * means "all": missing channels, territory or timing are refused by the schema.
 */
function parseScope(form: FormData) {
  const itemIds = form.getAll("itemId").filter((v): v is string => typeof v === "string");
  const timingKind = f.str(form, "timingKind");
  const timing = timingKind === "first_use" ? { kind: "first_use", durationDays: num(f.str(form, "durationDays")) }
    : { kind: "fixed", startsOn: f.str(form, "startsOn"), endsOn: f.str(form, "endsOn") };
  const shared = {
    usageKinds: form.getAll("usageKinds").filter((v): v is string => typeof v === "string"),
    channels: f.text(form, "channels").split("\n").map(s => s.trim()).filter(Boolean),
    territory: f.str(form, "territory").toUpperCase().split(/[\s,]+/).filter(Boolean),
    advertiser: f.str(form, "advertiser"), edits: f.str(form, "edits") || "none", timing,
  };
  const items = itemIds.filter(id => f.bool(form, `include:${id}`)).map(id => {
    const pin = f.str(form, `pin:${id}`);
    return { itemId: id, pin: pin.startsWith("master:") ? { kind: "master", attachmentId: pin.slice(7) } : { kind: pin }, ...shared };
  });
  if (!items.length) return { ok: false as const, detail: "items: include at least one item" };
  return { ok: true as const, value: { caseId: f.str(form, "caseId"), expectedRevision: Number(f.str(form, "expectedRevision")), requestId: f.str(form, "requestId"), items, excludedNote: f.text(form, "excludedNote") } };
}

export const BRAND_USAGE_OPERATIONS = {
  "brandUsage.triage": usageOp(plain("caseId", "expectedRevision"), (ctx, v) => triageUsageCase(ctx, ctx.viewer, v)),
  "brandUsage.message": usageOp(plain("caseId", "body", "requestId"), (ctx, v) => sendUsageMessage(ctx, ctx.viewer, v, "studio")),
  "brandUsage.scope": usageOp(parseScope, (ctx, v) => defineUsageScope(ctx, ctx.viewer, v)),
  "brandUsage.compensation": usageOp(form => ({ ok: true, value: { ...plain("caseId", "scopeRevisionId", "requestId", "taxBasis", "note")(form).value, amountKrw: num(f.str(form, "amountKrw")) } }),
    (ctx, v) => recordUsageCompensation(ctx, ctx.viewer, v)),
  "brandUsage.consent": usageOp(form => {
    const approvedAt = koreaInstant(f.str(form, "approvedAt"));
    if (!approvedAt) return { ok: false, detail: "approvedAt: invalid datetime" };
    return { ok: true, value: { ...plain("caseId", "itemId", "scopeRevisionId", "compensationId", "requestId", "approverKind", "evidenceReference")(form).value, approvedAt,
      rightsChecks: form.getAll("rightsChecks").filter((v): v is string => typeof v === "string") } };
  }, (ctx, v) => recordUsageConsent(ctx, ctx.viewer, v)),
  "brandUsage.consentWithdraw": usageOp(plain("caseId", "consentId"), (ctx, v) => withdrawUsageConsent(ctx, ctx.viewer, v)),
  "brandUsage.quote": usageOp(form => {
    const validUntil = koreaInstant(f.str(form, "validUntil"));
    if (!validUntil) return { ok: false, detail: "validUntil: invalid datetime" };
    return { ok: true, value: { ...plain("caseId", "expectedRevision", "requestId", "scopeRevisionId", "taxBasis", "contractId", "note")(form).value, totalKrw: num(f.str(form, "totalKrw")), validUntil } };
  }, (ctx, v) => issueUsageQuote(ctx, ctx.viewer, v)),
  "brandUsage.reopen": usageOp(plain("caseId", "expectedRevision"), (ctx, v) => reopenUsageCase(ctx, ctx.viewer, v)),
  "brandUsage.close": usageOp(plain("caseId", "expectedRevision", "reason"), (ctx, v) => closeUsageCase(ctx, ctx.viewer, v)),
  "brandUsage.buyer": usageOp(form => ({ ok: true, value: { ...plain("organizationId", "userId", "reason", "caseId")(form).value, grant: f.str(form, "grant") === "true" } }),
    (ctx, { caseId: _caseId, ...v }) => setUsageBuyer(ctx, ctx.viewer, v)),
  "brandUsage.grantEvent": usageOp(plain("caseId", "grantId", "requestId", "kind", "reason"), (ctx, { caseId: _caseId, ...v }) => recordUsageGrantEvent(ctx, ctx.viewer, v)),
  "brandUsage.grantStart": usageOp(plain("caseId", "grantId", "requestId", "startsOn", "reason"), (ctx, { caseId: _caseId, ...v }) => startUsageGrant(ctx, ctx.viewer, v)),
  /** Re-check the same accepted terms, or refund on an explicit decision. The only refund path. */
  "brandUsage.resolve": {
    parse: plain("caseId", "action", "reason"),
    async run(ctx, input) {
      const gateway = getTossGateway();
      if (!gateway) return fail("invalid", "payment_unavailable");
      const result = await resolveUsageCase({ sql: ctx.sql, gateway, paymentsOpen: usagePaymentsOpen() }, ctx.viewer, input);
      return result.ok ? ok("saved", { to: back(input.caseId) }) : brandFailure(result.code);
    },
  } satisfies AdminOperation<Input>,
  /** Run the recovery pass now instead of waiting for the daily tick. */
  "brandUsage.reconcile": {
    parse: () => ({ ok: true, value: {} }),
    async run(ctx) {
      if (ctx.viewer.isAdmin !== true) return fail("forbidden");
      const gateway = getTossGateway();
      if (!gateway) return fail("invalid", "payment_unavailable");
      const r = await reconcileBrandUsagePayments({ sql: ctx.sql, gateway });
      return ok("saved", { to: "/admin/brand-workspace/usage", detail: String(r.checked) });
    },
  } satisfies AdminOperation<Input>,
} as const;
