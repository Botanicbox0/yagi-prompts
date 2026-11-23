import {
  sendBrandSupport, revokeStudioInvitation, createStudioOrganization, createStudioProject, createStudioInvitation, setBrandProjectVisibility, revokeStudioAccess, addBrandContract, shareBrandContract,
  activateBrandProject,
  addBrandContentVersion,
  sendBrandMessage,
  recordBrandPost,
  updateBrandPostMetrics,
  saveBrandPostMetricsBatch,
  publishBrandReport,
  importBrandExternalPosts,
  setBrandProjectCover,
  storeBrandOrganizationLogo,
  removeBrandOrganizationLogo,
  setBrandPostPresentation,
  BRAND_LOGO_MAX_BYTES,
} from "@/lib/brands/workspace/service";
import type { BrandOutcome } from "@/lib/brands/workspace/types";
import { importShortlist, removeShortlistCandidate, saveShortlistCriteria, setShortlistShared, triageShortlist } from "@/lib/brands/shortlist/service";
import { SHORTLIST_IMPORT_MAX_BODY } from "@/lib/brands/shortlist/schema";
import { mirrorAdminReplyToSlackThread } from "@/lib/brands/team-notice-outbox";
import type { AdminOperation } from "./operations";
import { fail, ok, type AdminContext } from "./context";
import * as f from "./form";
type Input = Record<string, unknown>;
/**
 * The service's refusal → an admin outcome with brand wording (P2-6). The service code rides along as
 * `detail`, so the banner (and a support conversation) can name exactly what was refused.
 * `not_shared` is compared as a string: it is the campaign-only-invite refusal for a campaign the
 * client cannot see yet.
 */
export function brandFailure(code: string) {
  const admin =
    code === "conflict" ? "brandConflict"
    : code === "not_active" ? "brandNotActive"
    : code === "consent_required" ? "brandConsentRequired"
    : code === "not_shared" ? "brandNotShared"
    : code === "not_found" ? "notFound"
    : code === "forbidden" ? "forbidden"
    : "invalid";
  return fail(admin, code);
}
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
      return brandFailure(result.code);
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
   if(!r.ok)return brandFailure(r.code);
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
    return brandFailure(result.code);
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
    return brandFailure(result.code);
  },
};
/** A `datetime-local` value read as Korea time. Blank is unknown (null); an impossible date is refused. */
function koreaTime(raw: string): { ok: true; value: string | null } | { ok: false } {
  if (!raw) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return { ok: false };
  const date = new Date(`${raw}+09:00`);
  if (!Number.isFinite(+date) || new Date(+date + 9 * 3600000).toISOString().slice(0, raw.length) !== raw) return { ok: false };
  return { ok: true, value: date.toISOString() };
}
/**
 * One post's presentation card on the project page. Blank means unknown and is sent as null, never 0 or
 * an empty handle. Only the fields below are read; metric fields in the same request are ignored.
 */
const postPresentation: AdminOperation<Input> = {
  parse(form) {
    const blank = (name: string) => { const raw = f.str(form, name).trim(); return raw === "" ? null : raw; };
    const followersRaw = blank("followers");
    const measured = koreaTime(f.str(form, "followersMeasuredAt"));
    if (!measured.ok) return { ok: false, detail: "invalid datetime" };
    return { ok: true, value: {
      projectId: f.str(form, "projectId"), postId: f.str(form, "postId"),
      expectedRevision: Number(f.str(form, "expectedRevision") || NaN),
      thumbnailAttachmentId: blank("thumbnailAttachmentId"),
      handle: blank("handle"), displayName: blank("displayName"),
      followers: followersRaw === null ? null : Number(followersRaw),
      followersApproximate: f.bool(form, "followersApproximate"),
      // A source without a count is dropped, so leaving the count blank always means "unknown".
      followersSource: followersRaw === null ? null : blank("followersSource"),
      followersMeasuredAt: measured.value,
    } };
  },
  async run(ctx, input) {
    const result = await setBrandPostPresentation({ sql: ctx.sql }, ctx.viewer, input);
    if (result.ok) return ok("saved", { to: `/admin/brand-workspace/${String(input.projectId)}` });
    return brandFailure(result.code);
  },
};
/**
 * The studio sets a brand's logo from the organization page: one image file, inspected by the same
 * service an owner's upload goes through (bytes sniffed, 2 MiB, private staging only).
 */
const logoUpload: AdminOperation<Input> = {
  ...managedOperation(async (ctx, v) => {
    const bytes = new Uint8Array(await (v.file as File).arrayBuffer());
    return storeBrandOrganizationLogo(ctx, ctx.viewer, { organizationId: v.organizationId, requestId: v.requestId, expectedRevision: v.expectedRevision, bytes });
  }, "home"),
  parse(form) {
    const file = f.file(form, "file");
    if (!file) return { ok: false, detail: "file: choose a PNG, JPEG or WebP image" };
    if (file.size > BRAND_LOGO_MAX_BYTES) return { ok: false, detail: "file: 2 MiB at most" };
    return { ok: true, value: { organizationId: f.str(form, "organizationId"), requestId: f.str(form, "requestId"), expectedRevision: Number(f.str(form, "expectedRevision")), file } };
  },
};
/**
 * Creator shortlist (docs/BRAND-SHORTLIST.md). The import file is the same JSON contract the import
 * worker sends and goes through the same validation; it always lands on the campaign whose page the
 * form was sent from. Sharing and removal take one candidate, or every candidate when none is named.
 */
const shortlistTo = (projectId: unknown) => `/admin/brand-workspace/${String(projectId)}#shortlist-admin`;
const shortlistImportOperation: AdminOperation<Input> = {
  parse(form) {
    const file = f.file(form, "file");
    if (!file) return { ok: false, detail: "file: choose a .json file" };
    if (file.size > SHORTLIST_IMPORT_MAX_BODY) return { ok: false, detail: "file: 4 MB at most" };
    return { ok: true, value: { projectId: f.str(form, "projectId"), file } };
  },
  async run(ctx, input) {
    let body: unknown;
    try { body = JSON.parse(await (input.file as File).text()); }
    catch { return fail("invalid", "file: not valid JSON"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid", "file: expected an object with candidates");
    const result = await importShortlist({ sql: ctx.sql, storage: ctx.storage }, { kind: "studio", viewer: ctx.viewer }, { ...body, projectId: input.projectId });
    if (!result.ok) return result.code === "invalid" ? fail("invalid", result.field ? `invalid: ${result.field}` : "invalid") : brandFailure(result.code);
    return ok("saved", { to: shortlistTo(input.projectId) });
  },
};
const shortlistShareOperation: AdminOperation<Input> = {
  parse(form) {
    const candidateId = f.str(form, "candidateId");
    return { ok: true, value: { projectId: f.str(form, "projectId"), ...(candidateId ? { candidateId } : {}), shared: f.str(form, "shared") === "true" } };
  },
  async run(ctx, input) {
    const result = await setShortlistShared({ sql: ctx.sql }, ctx.viewer, input);
    return result.ok ? ok("saved", { to: shortlistTo(input.projectId) }) : brandFailure(result.code);
  },
};
/**
 * The triage list's one door. A row's own button sends `one` = "share:<id>"; the selection bar sends
 * `action` with every checked `candidateId`; the split sheet sends `share` / `exclude` lists directly.
 */
const TRIAGE_ACTIONS = ["share", "exclude", "wait"] as const;
const strings = (form: FormData, name: string) =>
  form.getAll(name).filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
const shortlistTriageOperation: AdminOperation<Input> = {
  parse(form) {
    const lists: Record<(typeof TRIAGE_ACTIONS)[number], string[]> = { share: strings(form, "share"), exclude: strings(form, "exclude"), wait: strings(form, "wait") };
    const [oneAction, oneId] = f.str(form, "one").split(":");
    const action = f.str(form, "action");
    if (oneAction && oneId) {
      if (!(TRIAGE_ACTIONS as readonly string[]).includes(oneAction)) return { ok: false, detail: "one: unknown action" };
      lists[oneAction as keyof typeof lists].push(oneId);
    } else if (action) {
      if (!(TRIAGE_ACTIONS as readonly string[]).includes(action)) return { ok: false, detail: "action: unknown action" };
      lists[action as keyof typeof lists].push(...strings(form, "candidateId"));
    }
    return { ok: true, value: { projectId: f.str(form, "projectId"), ...lists } };
  },
  async run(ctx, input) {
    const result = await triageShortlist({ sql: ctx.sql }, ctx.viewer, input);
    return result.ok ? ok("saved", { to: shortlistTo(input.projectId) }) : brandFailure(result.code);
  },
};
const shortlistCriteriaOperation: AdminOperation<Input> = {
  parse(form) {
    const raw = f.str(form, "criteria");
    if (raw.length > 2000) return { ok: false, detail: "criteria: too long" };
    let criteria: unknown = null;
    if (raw) {
      try { criteria = JSON.parse(raw); }
      catch { return { ok: false, detail: "criteria: not valid JSON" }; }
    }
    return { ok: true, value: { projectId: f.str(form, "projectId"), criteria } };
  },
  async run(ctx, input) {
    const result = await saveShortlistCriteria({ sql: ctx.sql }, ctx.viewer, input);
    return result.ok ? ok("saved", { to: shortlistTo(input.projectId) }) : brandFailure(result.code);
  },
};
const shortlistRemoveOperation: AdminOperation<Input> = {
  parse(form) {
    return { ok: true, value: { projectId: f.str(form, "projectId"), candidateId: f.str(form, "candidateId") } };
  },
  async run(ctx, input) {
    const result = await removeShortlistCandidate({ sql: ctx.sql }, ctx.viewer, input);
    return result.ok ? ok("saved", { to: shortlistTo(input.projectId) }) : brandFailure(result.code);
  },
};
export const BRAND_WORKSPACE_OPERATIONS = {
  "brandWorkspace.shortlistImport": shortlistImportOperation,
  "brandWorkspace.shortlistShare": shortlistShareOperation,
  "brandWorkspace.shortlistRemove": shortlistRemoveOperation,
  "brandWorkspace.shortlistTriage": shortlistTriageOperation,
  "brandWorkspace.shortlistCriteria": shortlistCriteriaOperation,
 'brandWorkspace.logo': logoUpload,
 'brandWorkspace.logoRemove': managedOperation((ctx,v)=>removeBrandOrganizationLogo(ctx,ctx.viewer,v),'home'),
 'brandWorkspace.cover': managedOperation((ctx,v)=>setBrandProjectCover(ctx,ctx.viewer,v)),
  "brandWorkspace.externalPosts": externalPosts,
  "brandWorkspace.postPresentation": postPresentation,
 'brandWorkspace.support': managedOperation(async (ctx, v) => {
   const r = await sendBrandSupport(ctx, ctx.viewer, v, 'studio');
   if (r.ok && typeof v.organizationId === 'string' && typeof v.body === 'string') {
     await mirrorAdminReplyToSlackThread(ctx.sql, {
       targetType: 'brand',
       organizationId: v.organizationId,
       body: v.body,
     }).catch(() => undefined);
   }
   return r;
 }, 'home'),
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
    sendBrandMessage({ sql: ctx.sql }, ctx.viewer, input, "studio"),
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
