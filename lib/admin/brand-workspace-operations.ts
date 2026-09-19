import {
  activateBrandProject,
  addBrandContentVersion,
  sendBrandMessage,
  recordBrandPost,
  updateBrandPostMetrics,
  publishBrandReport,
} from "@/lib/brands/workspace/service";
import type { BrandOutcome } from "@/lib/brands/workspace/types";
import type { AdminOperation } from "./operations";
import { fail, ok, type AdminContext } from "./context";
import * as f from "./form";
type Input = Record<string, unknown>;
function operation(
  run: (ctx: AdminContext, input: Input) => Promise<BrandOutcome>,
): AdminOperation<Input> {
  return {
    parse(form) {
      const input: Input = Object.fromEntries(form);
      input.expectedRevision = Number(f.str(form, "expectedRevision"));
      input.creatorConsentConfirmed = f.bool(form, "creatorConsentConfirmed");
      for (const name of ["views", "likes", "comments", "shares", "saves"]) {
        const raw = f.str(form, name);
        input[name] = raw === "" ? null : Number(raw);
      }
      for (const name of ["measuredAt", "publishedAt"]) {
        const raw = f.str(form, name);
        if (!raw) {
          input[name] = null;
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw))
          return { ok: false, detail: "invalid datetime" };
        const date = new Date(`${raw}+09:00`);
        if (!Number.isFinite(+date))
          return { ok: false, detail: "invalid datetime" };
        if (
          new Date(+date + 9 * 3600000).toISOString().slice(0, raw.length) !==
          raw
        )
          return { ok: false, detail: "invalid datetime" };
        input[name] = date.toISOString();
      }
      return { ok: true, value: input };
    },
    async run(ctx, input) {
      const result = await run(ctx, input);
      if (result.ok)
        return ok("saved", {
          to: `/admin/brand-workspace/${String(input.projectId)}`,
        });
      return fail(
        result.code === "conflict"
          ? "staleReview"
          : result.code === "not_found"
            ? "notFound"
            : result.code === "forbidden"
              ? "forbidden"
              : "invalid",
      );
    },
  };
}
export const BRAND_WORKSPACE_OPERATIONS = {
  "brandWorkspace.status": operation((ctx, input) =>
    activateBrandProject({ sql: ctx.sql }, ctx.viewer, input),
  ),
  "brandWorkspace.content": operation((ctx, input) =>
    addBrandContentVersion({ sql: ctx.sql }, ctx.viewer, input),
  ),
  "brandWorkspace.message": operation((ctx, input) =>
    sendBrandMessage({ sql: ctx.sql }, ctx.viewer, input),
  ),
  "brandWorkspace.post": operation((ctx, input) =>
    recordBrandPost({ sql: ctx.sql }, ctx.viewer, input),
  ),
  "brandWorkspace.metrics": operation((ctx, input) =>
    updateBrandPostMetrics({ sql: ctx.sql }, ctx.viewer, input),
  ),
  "brandWorkspace.report": operation((ctx, input) =>
    publishBrandReport({ sql: ctx.sql }, ctx.viewer, input),
  ),
} as const;
