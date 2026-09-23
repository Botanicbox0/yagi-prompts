import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import { readMigration } from "@/lib/db/migrations";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";
import { ADMIN_OPERATION_NAMES } from "@/lib/admin/operations";

/**
 * Post presentation: the studio's thumbnail, handle and follower count for each post card. Fixture
 * values only: no real customer, creator handle, image or figure appears here.
 */
const ids = { studio: randomUUID(), owner: randomUUID(), guest: randomUUID(), outsider: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const studio = as(ids.studio, true), owner = as(ids.owner), guest = as(ids.guest), outsider = as(ids.outsider);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const link = (code: string) => `https://www.instagram.com/p/${code}/`;
let db: PGlite, sql: SqlRunner, orgId: string, projectId: string, siblingId: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

async function campaign(title: string) {
  const id = idOf(await s.createStudioProject({ sql }, studio, { organizationId: orgId, title, objective: "Share campaign results", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: id, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, studio, { projectId: id, expectedRevision: 1, status: "active" }));
  return id;
}
async function file(project: string, mime: "image/png" | "application/pdf" = "image/png", complete = true) {
  const bytes = mime === "image/png" ? PNG : Buffer.from("%PDF-1.7");
  const r = await s.reserveBrandAttachment({ sql }, studio, { projectId: project, requestId: randomUUID(), name: mime === "image/png" ? "thumb.png" : "brief.pdf", mime, sizeBytes: bytes.length });
  if (!r.ok) throw Error(r.code);
  if (complete) idOf(await s.completeBrandAttachment({ sql, storage: { read: async () => bytes } }, studio, r.id));
  return r.id;
}
async function linkedPost(code = "FIXTURE01", project = projectId) {
  idOf(await s.importBrandExternalPosts({ sql }, studio, { projectId: project, requestId: randomUUID(), posts: [{ url: link(code), publishedAt: null }] }));
  return (await s.loadStudioProject({ sql }, studio, project))!.posts.find(p => p.url === link(code))!;
}
const present = (who: Viewer, input: Record<string, unknown>) => s.setBrandPostPresentation({ sql }, who, input);
const history = async (postId: string) => (await sql.query("select id from brand_post_measurements where post_id=$1", [postId])).rows.length;
const MEASURED = "2026-09-22T03:00:00.000Z";

beforeEach(async () => {
  db = await freshDb(); sql = runner(db);
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "studio", email: `${id}@example.test` });
  orgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand", requestId: randomUUID() }));
  projectId = await campaign("Fixture campaign");
  siblingId = await campaign("Sibling campaign");
  for (const [user, project, role] of [[owner, null, "owner"], [guest, siblingId, "viewer"]] as const) {
    const r = await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: project, email: user.email, role, canComment: false, requestId: randomUUID() });
    if (!r.ok) throw Error(r.code);
    expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
  }
});
afterEach(async () => { await db?.close(); });

describe("post presentation service", () => {
  it("defaults every field to unknown, never 0", async () => {
    const post = await linkedPost();
    expect(post.presentation).toEqual({ revision: 0, thumbnailUrl: null, handle: null, displayName: null, followers: null, followersApproximate: false, followersSource: null, followersMeasuredAt: null });
  });

  it("sets a same-project thumbnail and identity without touching metrics or their history", async () => {
    const post = await linkedPost(), image = await file(projectId);
    const batch = await s.saveBrandPostMetricsBatch({ sql }, studio, { projectId, requestId: randomUUID(), rows: [{ postId: post.id, expectedRevision: 0, metricsSource: "studio_review", views: 1200, likes: 30, comments: 4 }] });
    expect(batch).toMatchObject({ ok: true });
    const before = (await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!;
    const r = await present(studio, { projectId, postId: post.id, expectedRevision: 0, thumbnailAttachmentId: image, handle: "@fixture.creator", displayName: "Fixture Creator",
      followers: 123000, followersApproximate: true, followersSource: "studio_review", followersMeasuredAt: MEASURED });
    expect(r).toEqual({ ok: true, id: post.id, revision: 1 });
    const after = (await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]!;
    expect(after.presentation).toEqual({ revision: 1, thumbnailUrl: `/api/brand-workspace/attachments/${image}`, handle: "fixture.creator", displayName: "Fixture Creator",
      followers: 123000, followersApproximate: true, followersSource: "studio_review", followersMeasuredAt: MEASURED });
    const { presentation: _a, ...metricsBefore } = before, { presentation: _b, ...metricsAfter } = after;
    expect(metricsAfter).toEqual(metricsBefore);
    expect(after.metricRevision).toBe(1);
    expect(await history(post.id)).toBe(1);
    // The private route re-authorizes: brand members may read it, a guest of another campaign may not.
    expect(await s.loadBrandAttachmentAccess({ sql }, owner, image)).toMatchObject({ mime: "image/png" });
    expect(await s.loadBrandAttachmentAccess({ sql }, guest, image)).toBeNull();
    expect(await s.loadBrandAttachmentAccess({ sql }, outsider, image)).toBeNull();
    // Shown on the post card only, not repeated as a campaign file for the client; the studio still sees it.
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.attachments.map(a => a.id)).not.toContain(image);
    expect((await s.loadStudioProject({ sql }, studio, projectId))!.attachments.map(a => a.id)).toContain(image);
  });

  it("is studio-only", async () => {
    const post = await linkedPost();
    const input = { projectId, postId: post.id, expectedRevision: 0, handle: "fixture" };
    expect(await present(owner, input)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await present(outsider, input)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await present({ ...outsider, userId: null } as unknown as Viewer, input)).toMatchObject({ ok: false, code: "sign_in_required" });
    expect((await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!.presentation.revision).toBe(0);
  });

  it("refuses another project's image, a non-image file, an unfinished upload and a post of another campaign", async () => {
    const post = await linkedPost(), foreign = await file(siblingId), pdf = await file(projectId, "application/pdf"), pending = await file(projectId, "image/png", false);
    for (const thumbnailAttachmentId of [foreign, pdf, pending, randomUUID()])
      expect(await present(studio, { projectId, postId: post.id, expectedRevision: 0, thumbnailAttachmentId })).toMatchObject({ ok: false, code: "invalid" });
    const other = await linkedPost("FIXTURE09", siblingId);
    expect(await present(studio, { projectId, postId: other.id, expectedRevision: 0, handle: "fixture" })).toMatchObject({ ok: false, code: "not_found" });
    // The database refuses the same cross-project reference even without the service check.
    await expect(sql.query("update brand_posts set thumbnail_attachment_id=$1,presentation_revision=presentation_revision+1 where id=$2", [foreign, post.id])).rejects.toThrow();
    await expect(sql.query("update brand_posts set thumbnail_attachment_id=$1,presentation_revision=presentation_revision+1 where id=$2", [pdf, post.id])).rejects.toThrow(/ready image/);
    await expect(sql.query("update brand_posts set creator_handle='fixture' where id=$1", [post.id])).rejects.toThrow(/revision/);
  });

  it("requires a source and time for a known follower count and keeps an unknown count unknown", async () => {
    const post = await linkedPost(), base = { projectId, postId: post.id, expectedRevision: 0 };
    expect(await present(studio, { ...base, followers: 5000 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await present(studio, { ...base, followers: 5000, followersSource: "studio_review" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await present(studio, { ...base, followers: null, followersApproximate: true })).toMatchObject({ ok: false, code: "invalid" });
    expect(await present(studio, { ...base, followers: -1, followersSource: "studio_review", followersMeasuredAt: MEASURED })).toMatchObject({ ok: false, code: "invalid" });
    expect(await present(studio, { ...base, followers: 5000, followersSource: "studio_review", followersMeasuredAt: new Date(Date.now() + 3_600_000).toISOString() })).toMatchObject({ ok: false, code: "invalid" });
    for (const handle of ["two words", "https://example.test/x", "a/b", "@", ""]) expect(await present(studio, { ...base, handle })).toMatchObject({ ok: false, code: "invalid" });
    expect(await present(studio, { ...base, handle: "fixture" })).toMatchObject({ ok: true, revision: 1 });
    const loaded = (await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]!.presentation;
    expect(loaded).toMatchObject({ handle: "fixture", followers: null, followersSource: null, followersMeasuredAt: null });
    await expect(sql.query("update brand_posts set follower_count=10,presentation_revision=presentation_revision+1 where id=$1", [post.id])).rejects.toThrow();
  });

  it("uses its own optimistic revision, independent of metric revisions", async () => {
    const post = await linkedPost();
    const first = { projectId, postId: post.id, expectedRevision: 0, handle: "fixture.one" };
    expect(await present(studio, first)).toMatchObject({ ok: true, revision: 1 });
    // The same save retried after a lost response succeeds without another revision.
    expect(await present(studio, first)).toMatchObject({ ok: true, revision: 1 });
    // A second editor still holding revision 0 cannot overwrite it.
    expect(await present(studio, { ...first, handle: "fixture.two" })).toMatchObject({ ok: false, code: "conflict" });
    // Metric saves keep their own token and never move the presentation revision.
    expect(await s.saveBrandPostMetricsBatch({ sql }, studio, { projectId, requestId: randomUUID(), rows: [{ postId: post.id, expectedRevision: 0, metricsSource: "studio_review", views: 10 }] })).toMatchObject({ ok: true });
    const loaded = (await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!;
    expect(loaded).toMatchObject({ metricRevision: 1, presentation: { revision: 1, handle: "fixture.one" } });
    expect(await present(studio, { ...first, expectedRevision: 1, handle: "fixture.two" })).toMatchObject({ ok: true, revision: 2 });
    // Clearing back to unknown is an edit too.
    expect(await present(studio, { projectId, postId: post.id, expectedRevision: 2 })).toMatchObject({ ok: true, revision: 3 });
    expect((await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!).toMatchObject({ metricRevision: 1, presentation: { revision: 3, handle: null } });
  });

  it("is allowed after the campaign closes, since it describes the post rather than measuring it", async () => {
    const post = await linkedPost();
    idOf(await s.activateBrandProject({ sql }, studio, { projectId, expectedRevision: 2, status: "completed" }));
    expect(await present(studio, { projectId, postId: post.id, expectedRevision: 0, handle: "fixture" })).toMatchObject({ ok: true });
  });
});

describe("report snapshots", () => {
  it("freeze the presentation at publication and keep it when the live card changes", async () => {
    const post = await linkedPost(), image = await file(projectId), later = await file(projectId);
    idOf(await present(studio, { projectId, postId: post.id, expectedRevision: 0, thumbnailAttachmentId: image, handle: "fixture.before", followers: 900, followersSource: "creator_evidence", followersMeasuredAt: MEASURED }));
    idOf(await s.publishBrandReport({ sql }, studio, { projectId, requestId: randomUUID(), summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30" }));
    idOf(await present(studio, { projectId, postId: post.id, expectedRevision: 1, thumbnailAttachmentId: later, handle: "fixture.after" }));
    const loaded = (await s.loadBrandProject({ sql }, owner, projectId))!;
    expect(loaded.posts[0]!.presentation).toMatchObject({ handle: "fixture.after", thumbnailUrl: `/api/brand-workspace/attachments/${later}`, followers: null });
    expect(loaded.reports[0]!.snapshot.posts[0]!.presentation).toEqual({ revision: 0, thumbnailUrl: `/api/brand-workspace/attachments/${image}`, handle: "fixture.before", displayName: null,
      followers: 900, followersApproximate: false, followersSource: "creator_evidence", followersMeasuredAt: MEASURED });
    // The stored snapshot keeps the private route only: nothing signed, nothing external.
    const stored = JSON.stringify((await sql.query("select snapshot from brand_reports where project_id=$1", [projectId])).rows[0]!.snapshot);
    expect(stored).not.toMatch(/https?:\/\/(?!www\.instagram\.com)/);
    expect(stored).not.toMatch(/token=|signature|X-Amz/i);
  });

  it("read older snapshots as unknown and drop anything that is not a private route or a sourced count", async () => {
    const post = await linkedPost();
    const legacy = { id: post.id, url: post.url, platform: "instagram", contentVersionId: null, publishedAt: null, metricRevision: 0, verification: "unverified", metricsSource: "unavailable", measuredAt: null, views: null, likes: null, comments: null, shares: null, saves: null, createdAt: post.createdAt };
    const tampered = { ...legacy, id: randomUUID(), presentation: { thumbnailUrl: "https://cdn.example.test/signed?token=1", handle: "<script>", followers: 5000, followersApproximate: true, followersSource: "studio_review", followersMeasuredAt: null } };
    const snapshot = { totalPosts: 2, measuredPosts: 0, viewsTotal: null, metricDefinition: "sum_of_latest_post_views", posts: [legacy, tampered] };
    await sql.query("insert into brand_reports(id,organization_id,project_id,version,summary,period_start,period_end,snapshot,created_by,request_id) values($1,$2,$3,1,'Legacy','2026-09-01','2026-09-30',$4::jsonb,$5,$6)",
      [randomUUID(), orgId, projectId, JSON.stringify(snapshot), ids.studio, randomUUID()]);
    const [a, z] = (await s.loadBrandProject({ sql }, owner, projectId))!.reports[0]!.snapshot.posts;
    for (const p of [a!, z!]) expect(p.presentation).toEqual({ revision: 0, thumbnailUrl: null, handle: null, displayName: null, followers: null, followersApproximate: false, followersSource: null, followersMeasuredAt: null });
  });
});

describe("admin operation", () => {
  const form = (values: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(values)) f.set(k, v); return f; };
  it("is registered and reads blanks as unknown", () => {
    expect(ADMIN_OPERATION_NAMES).toContain("brandWorkspace.postPresentation");
    const op = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.postPresentation"];
    expect(op.parse(form({ projectId: "p", postId: "q", expectedRevision: "2", thumbnailAttachmentId: "", handle: " ", displayName: "", followers: "", followersSource: "studio_review", followersMeasuredAt: "", views: "999" })))
      .toEqual({ ok: true, value: { projectId: "p", postId: "q", expectedRevision: 2, thumbnailAttachmentId: null, handle: null, displayName: null, followers: null, followersApproximate: false, followersSource: null, followersMeasuredAt: null } });
    expect(op.parse(form({ projectId: "p", postId: "q", expectedRevision: "0", followers: "12300", followersApproximate: "true", followersSource: "creator_evidence", followersMeasuredAt: "2026-09-22T12:00" })))
      .toMatchObject({ ok: true, value: { followers: 12300, followersApproximate: true, followersSource: "creator_evidence", followersMeasuredAt: "2026-09-22T03:00:00.000Z" } });
    expect(op.parse(form({ projectId: "p", postId: "q", expectedRevision: "0", followersMeasuredAt: "2026-02-30T12:00" }))).toMatchObject({ ok: false });
  });
  it("runs through the service with the studio's privileges only", async () => {
    const post = await linkedPost(), op = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.postPresentation"];
    const parsed = op.parse(form({ projectId, postId: post.id, expectedRevision: "0", handle: "fixture" }));
    if (!parsed.ok) throw Error("parse");
    const ctx = (viewer: Viewer) => ({ sql, viewer }) as unknown as Parameters<typeof op.run>[0];
    expect(await op.run(ctx(owner), parsed.value)).toMatchObject({ ok: false });
    expect(await op.run(ctx(studio), parsed.value)).toMatchObject({ ok: true });
    expect(await op.run(ctx(studio), { ...parsed.value, handle: "fixture.two" })).toMatchObject({ ok: false });
  });
});

describe("database privileges", () => {
  it("grants the server role only the presentation columns and browser roles nothing", async () => {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
    for (const glue of ["0113_glue_brand_workspace.sql", "0116_glue_brand_post_collection.sql", "0117_glue_brand_managed_workspace.sql", "0118_glue_brand_profile_support.sql", "0119_glue_brand_production.sql", "0120_glue_brand_client_sharing.sql", "0121_glue_brand_organization_logo.sql", "0122_glue_brand_post_presentation.sql"])
      await db.exec(readMigration(glue));
    const can = async (role: string, column: string) => (await sql.query<{ ok: boolean }>("select has_column_privilege($1,'brand_posts',$2,'UPDATE') as ok", [role, column])).rows[0]!.ok;
    for (const column of ["thumbnail_attachment_id", "creator_handle", "creator_name", "follower_count", "followers_approximate", "followers_source", "followers_measured_at", "presentation_revision"]) {
      expect(await can("service_role", column)).toBe(true);
      expect(await can("anon", column)).toBe(false);
      expect(await can("authenticated", column)).toBe(false);
    }
    for (const column of ["url", "platform", "project_id", "content_version_id", "origin"]) expect(await can("service_role", column)).toBe(false);
    expect((await sql.query<{ ok: boolean }>("select has_table_privilege('service_role','brand_post_measurements','UPDATE,DELETE') as ok")).rows[0]!.ok).toBe(false);
    expect((await sql.query<{ ok: boolean }>("select has_function_privilege('service_role','brand_post_presentation_guard()','EXECUTE') as ok")).rows[0]!.ok).toBe(false);
  });
});
