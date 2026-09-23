import {
  sendBrandSupport, updateBrandSettings, revokeStudioInvitation, createStudioOrganization, createStudioProject, createStudioInvitation, setBrandProjectVisibility, revokeStudioAccess, addBrandContract, shareBrandContract,
  activateBrandProject,
  addBrandContentVersion,
  sendBrandMessage,
  recordBrandPost,
  updateBrandPostMetrics,
  saveBrandPostMetricsBatch,
  publishBrandReport,
  importBrandExternalPosts,
  setBrandProjectCover,
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
      input.viewsApproximate = f.bool(form, "viewsApproximate");
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
function managedOperation(run:(ctx:AdminContext,input:Input)=>Promise<BrandOutcome<{id:string;token?:string}>>,destination:'home'|'project'='project'):AdminOperation<Input> {
 return { parse(form) {
   const input:Input=Object.fromEntries(form);
   for(const key of ['expectedRevision']) if(key in input)input[key]=Number(input[key]);
   for(const key of ['visible','shared']) if(key in input)input[key]=input[key]==='true';
   // Campaign-only invitations choose read-only or read-and-comment; brand-wide ones follow the role.
   if('access' in input){const access=String(input.access);delete input.access;if(access==='brand')input.projectId='';input.canComment=access==='comment';}
   for(const key of ['projectId','startsOn','endsOn','attachmentId']) if(input[key]==='')input[key]=null;
   if('budgetKrw' in input)input.budgetKrw=input.budgetKrw===''?null:Number(input.budgetKrw);
   return {ok:true,value:input};
 },async run(ctx,input) {
   const r=await run(ctx,input);
   if(!r.ok)return fail(r.code==='conflict'?'staleReview':r.code==='forbidden'?'forbidden':'invalid');
   return ok('saved',{to:destination==='home'?(input.organizationId?`/admin/brand-workspace/organizations/${String(input.organizationId)}`:'/admin/brand-workspace'):`/admin/brand-workspace/${String(input.projectId||r.id)}`,...(r.token?{invitationToken:r.token}:{})});
 }};
}
const METRIC_FIELDS = ["views", "likes", "comments", "shares", "saves"] as const;
/**
 * The collection console posts one form for the whole table. Only rows the administrator chose are
 * read: the row's own save button (`only`) or the ticked `select` boxes. A row that was merely on
 * screen is never saved, and a chosen row must carry all five cells so an absent field cannot pass
 * for "unknown". Blank is unknown (null); "0" is a measured zero. No time is read from the form.
 */
const metricsBatch: AdminOperation<Input> = {
  parse(form) {
    const only = f.str(form, "only");
    const chosen = only
      ? [only]
      : form.getAll("select").filter((v): v is string => typeof v === "string");
    if (chosen.length === 0) return { ok: false, detail: "no rows selected" };
    const rows: Input[] = [];
    for (const postId of chosen) {
      const row: Input = {
        postId,
        expectedRevision: Number(f.str(form, `rev:${postId}`) || NaN),
        verification: f.str(form, `verification:${postId}`),
        metricsSource: f.str(form, `metricsSource:${postId}`),
        // Unticked is exact; only a ticked box marks the view count as a publicly rounded value.
        viewsApproximate: f.bool(form, `viewsApproximate:${postId}`),
      };
      for (const name of METRIC_FIELDS) {
        const key = `${name}:${postId}`;
        if (!form.has(key)) return { ok: false, detail: "incomplete row" };
        const raw = f.str(form, key);
        row[name] = raw === "" ? null : Number(raw);
      }
      rows.push(row);
    }
    return {
      ok: true,
      value: {
        projectId: f.str(form, "projectId"),
        requestId: f.str(form, "requestId"),
        rows,
      },
    };
  },
  async run(ctx, input) {
    const result = await saveBrandPostMetricsBatch(
      { sql: ctx.sql },
      ctx.viewer,
      input,
    );
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
      result.code,
    );
  },
};
/**
 * Already-published links, one per line. A line is a link, optionally followed by the Korea-time
 * publish time the studio actually knows (`2026-09-20 18:30` or `2026-09-20T18:30`). No time means
 * unknown; nothing is guessed. Blank lines are ignored; anything else unreadable refuses the paste.
 */
const externalPosts: AdminOperation<Input> = {
  parse(form) {
    const posts: Input[] = [];
    for (const line of f.str(form, "links").split(/\r?\n/)) {
      const [url, ...rest] = line.trim().split(/\s+/);
      if (!url) continue;
      const when = rest.join("T");
      if (!when) { posts.push({ url, publishedAt: null }); continue; }
      if (rest.length > 2 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return { ok: false, detail: "invalid line" };
      const date = new Date(`${when}+09:00`);
      if (!Number.isFinite(+date) || new Date(+date + 9 * 3600000).toISOString().slice(0, 16) !== when) return { ok: false, detail: "invalid datetime" };
      posts.push({ url, publishedAt: date.toISOString() });
    }
    if (!posts.length) return { ok: false, detail: "no links" };
    return { ok: true, value: { projectId: f.str(form, "projectId"), requestId: f.str(form, "requestId"), verification: f.str(form, "verification") || "unverified", posts } };
  },
  async run(ctx, input) {
    const result = await importBrandExternalPosts({ sql: ctx.sql }, ctx.viewer, input);
    if (result.ok) return ok("saved", { to: `/admin/brand-workspace/${String(input.projectId)}` });
    return fail(result.code === "conflict" ? "staleReview" : result.code === "not_found" ? "notFound" : result.code === "forbidden" ? "forbidden" : "invalid", result.code);
  },
};
export const BRAND_WORKSPACE_OPERATIONS = {
 'brandWorkspace.cover': managedOperation((ctx,v)=>setBrandProjectCover(ctx,ctx.viewer,v)),
  "brandWorkspace.externalPosts": externalPosts,
 'brandWorkspace.settings': managedOperation((ctx,v)=>updateBrandSettings(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.support': managedOperation((ctx,v)=>sendBrandSupport(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.revokeInvite': managedOperation((ctx,v)=>revokeStudioInvitation(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.organization': managedOperation((ctx,v)=>createStudioOrganization(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.createProject': managedOperation((ctx,v)=>createStudioProject(ctx,ctx.viewer,v)),
 'brandWorkspace.invite': managedOperation((ctx,v)=>createStudioInvitation(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.visibility': managedOperation((ctx,v)=>setBrandProjectVisibility(ctx,ctx.viewer,v)),
 'brandWorkspace.revokeAccess': managedOperation((ctx,v)=>revokeStudioAccess(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.contract': managedOperation((ctx,v)=>addBrandContract(ctx,ctx.viewer,v)),
 'brandWorkspace.contractShare': managedOperation((ctx,v)=>shareBrandContract(ctx,ctx.viewer,v)),
  "brandWorkspace.metricsBatch": metricsBatch,
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
