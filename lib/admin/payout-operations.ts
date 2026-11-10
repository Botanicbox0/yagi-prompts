import { z } from "zod";
import type { AdminOperation } from "./operations";
import { ok } from "./context";
import { str } from "./form";
import { PAYOUT_TAX_TYPES, loadAdminPayouts, payoutHref, type PayoutTaxType } from "./payouts";

/**
 * `payout.export` — records an operator's monthly settlement check/export and redirects to the
 * filtered `/admin/payouts` view (docs/ADMIN.md §6 & §7.4).
 */
const ExportPayoutsSchema = z.object({
  month: z
    .string()
    .trim()
    .regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/)
    .default(""),
  taxType: z.enum(PAYOUT_TAX_TYPES).nullable().default(null),
});

const exportPayouts: AdminOperation<z.infer<typeof ExportPayoutsSchema>> = {
  parse(form) {
    const rawTax = str(form, "taxType").trim();
    const parsed = ExportPayoutsSchema.safeParse({
      month: str(form, "month").trim(),
      taxType: (PAYOUT_TAX_TYPES as readonly string[]).includes(rawTax)
        ? (rawTax as PayoutTaxType)
        : null,
    });
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, detail: "invalid payout export filter" };
  },
  async run(ctx, input) {
    const report = await loadAdminPayouts(ctx.sql, input);
    return ok("saved", {
      to: payoutHref(input),
      detail: `${report.rows.length} rows`,
    });
  },
};

export const PAYOUT_OPERATIONS = {
  "payout.export": exportPayouts,
};
