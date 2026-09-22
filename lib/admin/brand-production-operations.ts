import {
  createProductionContract,
  createProductionTemplate,
  setProductionContractEnabled,
} from "@/lib/brands/production/service";
import type { AdminOperation } from "./operations";
import { fail, ok, type AdminContext } from "./context";
type Input = Record<string, unknown>;
function op(
  run: (
    ctx: AdminContext,
    input: Input,
  ) => Promise<{ ok: boolean; code?: string }>,
): AdminOperation<Input> {
  return {
    parse(form) {
      const v: Input = Object.fromEntries(form);
      for (const k of ["limit", "seconds", "expectedRevision"])
        if (k in v) v[k] = Number(v[k]);
      if (v.previewAttachmentId === "") v.previewAttachmentId = null;
      if ("enabled" in v) v.enabled = v.enabled === "true";
      for (const k of ["startsAt", "endsAt"])
        if (k in v) {
          const raw = String(v[k]);
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))
            return { ok: false, detail: "invalid datetime" };
          const date = new Date(`${raw}+09:00`);
          if (
            !Number.isFinite(+date) ||
            new Date(+date + 9 * 3600000).toISOString().slice(0, 16) !== raw
          )
            return { ok: false, detail: "invalid datetime" };
          v[k] = date.toISOString();
        }
      return { ok: true, value: v };
    },
    async run(ctx, v) {
      const r = await run(ctx, v);
      return r.ok
        ? ok("saved", {
            to: `/admin/brand-workspace/organizations/${String(v.organizationId)}`,
          })
        : fail(
            r.code === "forbidden"
              ? "forbidden"
              : r.code === "conflict"
                ? "staleReview"
                : "invalid",
          );
    },
  };
}
export const BRAND_PRODUCTION_OPERATIONS = {
  "brandProduction.contract": op((ctx, v) =>
    createProductionContract(ctx, ctx.viewer, v),
  ),
  "brandProduction.template": op((ctx, v) =>
    createProductionTemplate(ctx, ctx.viewer, v),
  ),
  "brandProduction.enabled": op((ctx, v) =>
    setProductionContractEnabled(ctx, ctx.viewer, v),
  ),
};
