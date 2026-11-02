import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import { readMigration } from "@/lib/db/migrations";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
import { campaignPerformance, campaignCsv } from "@/lib/brands/workspace/performance";
import { BRAND_WORKSPACE_OPERATIONS } from "@/lib/admin/brand-workspace-operations";

/**
 * Private client sharing of a studio-run campaign: an explicit cover, links to posts that were
 * already published elsewhere, and comments from campaign-only guests. Fixture values only: no
 * real customer, handle, image or figure appears here.
 */
const ids = { studio: randomUUID(), owner: randomUUID(), guest: randomUUID(), reader: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const studio = as(ids.studio, true), owner = as(ids.owner), guest = as(ids.guest), reader = as(ids.reader), orgViewer = as(ids.viewer), outsider = as(ids.outsider);
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const link = (code: string) => `https://www.instagram.com/p/${code}/`;
let db: PGlite, sql: SqlRunner, orgId: string, projectId: string, siblingId: string, otherOrgId: string, otherProjectId: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };

async function campaign(organizationId: string, title: string) {
  const id = idOf(await s.createStudioProject({ sql }, studio, { organizationId, title, objective: "Share campaign results", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId: id, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, studio, { projectId: id, expectedRevision: 1, status: "active" }));
  return id;
}
async function file(project: string, mime: "image/png" | "application/pdf" = "image/png", purpose: "workspace" | "contract" = "workspace") {
  const bytes = mime === "image/png" ? PNG : Buffer.from("%PDF-1.7");
  const r = await s.reserveBrandAttachment({ sql }, studio, { projectId: project, requestId: randomUUID(), name: mime === "image/png" ? "cover.png" : "file.pdf", mime, sizeBytes: bytes.length, purpose });
  if (!r.ok) throw Error(r.code);
  idOf(await s.completeBrandAttachment({ sql, storage: { read: async () => bytes } }, studio, r.id));
  return r.id;
}
async function invite(user: Viewer, project: string | null, canComment: boolean, role: "owner" | "editor" | "viewer" = "viewer") {
  const r = await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: project, email: user.email, role, canComment, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
}
const revision = async (project: string) => Number((await sql.query("select revision from brand_projects where id=$1", [project])).rows[0]!.revision);
const importLinks = (posts: Array<{ url: string; publishedAt?: string | null }>, requestId = randomUUID(), project = projectId, who = studio) =>
  s.importBrandExternalPosts({ sql }, who, { projectId: project, requestId, posts: posts.map(p => ({ publishedAt: null, ...p })) });

beforeEach(async () => {
  db = await freshDb(); sql = runner(db);
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "studio", email: `${id}@example.test` });
  orgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand", requestId: randomUUID() }));
  otherOrgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Other fixture brand", requestId: randomUUID() }));
  projectId = await campaign(orgId, "Fixture campaign");
  siblingId = await campaign(orgId, "Sibling campaign");
  otherProjectId = await campaign(otherOrgId, "Other brand campaign");
  await invite(owner, null, false, "owner");
});
afterEach(async () => { await db?.close(); });

describe("already-published links", () => {
  it("dedupes by normalized platform post id within a paste, across pastes and against approved posts", async () => {
    const first = await importLinks([
      { url: link("FIXTURE01") },
      { url: "https://instagram.com/reel/FIXTURE01/?igsh=tracking" },
      { url: "https://www.instagram.com/p/FIXTURE01#comments" },
      { url: link("FIXTURE02") },
    ]);
    expect(first).toEqual({ ok: true, id: projectId, added: 2, existing: 0, dated: 0 });
    expect((await sql.query("select url from brand_posts where project_id=$1 order by url", [projectId])).rows.map(r => r.url)).toEqual([link("FIXTURE01"), link("FIXTURE02")]);
    // Pasting the list again with one new link appends only the new one.
    expect(await importLinks([{ url: link("FIXTURE02") }, { url: link("FIXTURE03") }])).toMatchObject({ added: 1, existing: 1 });
    // A retried request replays its own rows without writing any.
    const requestId = randomUUID();
    expect(await importLinks([{ url: link("FIXTURE04") }], requestId)).toMatchObject({ added: 1 });
    expect(await importLinks([{ url: link("FIXTURE04") }], requestId)).toMatchObject({ added: 1, existing: 0 });
    expect((await sql.query("select count(*)::int as n from brand_posts where project_id=$1", [projectId])).rows[0]!.n).toBe(4);
    // The same post may be linked from a different campaign; campaigns do not share posts.
    expect(await importLinks([{ url: link("FIXTURE01") }], randomUUID(), siblingId)).toMatchObject({ added: 1 });
  });

  it("refuses the whole paste for a profile or non-post link and never fetches anything", async () => {
    for (const bad of ["https://www.instagram.com/fixture_account/", "http://www.instagram.com/p/FIXTURE01/", "https://example.com/p/FIXTURE01/"])
      expect(await importLinks([{ url: link("FIXTURE09") }, { url: bad }])).toMatchObject({ ok: false, code: "invalid" });
    expect((await sql.query("select count(*)::int as n from brand_posts")).rows[0]!.n).toBe(0);
    expect(await importLinks([{ url: link("FIXTURE01"), publishedAt: new Date(Date.now() + 3600000).toISOString() }])).toMatchObject({ ok: false, code: "invalid" });
    expect(await importLinks([{ url: link("FIXTURE01"), publishedAt: "2026-09-20T09:30:00.000Z" }, { url: link("FIXTURE01"), publishedAt: "2026-09-21T09:30:00.000Z" }])).toMatchObject({ ok: false, code: "invalid" });
  });

  it("keeps unknown dates and counts unknown, and fills only a first known publish time", async () => {
    await importLinks([{ url: link("FIXTURE01") }, { url: link("FIXTURE02"), publishedAt: "2026-09-18T09:30:00.000Z" }]);
    const posts = (await s.loadBrandProject({ sql }, owner, projectId))!.posts;
    const undated = posts.find(p => p.url === link("FIXTURE01"))!;
    expect(undated).toMatchObject({ origin: "external_import", contentVersionId: null, publishedAt: null, metricsSource: "unavailable", measuredAt: null, views: null, likes: null, comments: null, shares: null, saves: null, verification: "unverified" });
    expect(posts.find(p => p.url === link("FIXTURE02"))!.publishedAt).toBe("2026-09-18T09:30:00.000Z");
    expect((await sql.query("select count(*)::int as n from brand_post_measurements")).rows[0]!.n).toBe(0);
    expect(campaignPerformance(posts)).toMatchObject({ totalPosts: 2, views: { total: null, measured: 0 }, engagementRate: null });
    // A later paste with a checked time fills the unknown one; a known time is never replaced.
    expect(await importLinks([{ url: link("FIXTURE01"), publishedAt: "2026-09-19T01:00:00.000Z" }, { url: link("FIXTURE02"), publishedAt: "2026-09-01T00:00:00.000Z" }])).toMatchObject({ added: 0, existing: 2, dated: 1 });
    const after = (await s.loadStudioProject({ sql }, studio, projectId))!.posts;
    expect(after.map(p => p.publishedAt).sort()).toEqual(["2026-09-18T09:30:00.000Z", "2026-09-19T01:00:00.000Z"]);
    // The database holds the same line.
    await expect(sql.query("update brand_posts set published_at=now() where url=$1", [link("FIXTURE02")])).rejects.toThrow(/immutable/);
  });

  it("collects counts through the existing console and stops when the campaign is completed", async () => {
    await importLinks([{ url: link("FIXTURE01") }]);
    const post = (await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!;
    expect(await s.saveBrandPostMetricsBatch({ sql }, studio, { projectId, requestId: randomUUID(), rows: [{ postId: post.id, expectedRevision: 0, metricsSource: "studio_review", views: 1000, likes: null, comments: 0, shares: null, saves: null }] })).toMatchObject({ ok: true, saved: 1 });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]).toMatchObject({ origin: "external_import", views: 1000, likes: null, comments: 0, publishedAt: null });
    idOf(await s.activateBrandProject({ sql }, studio, { projectId, expectedRevision: await revision(projectId), status: "completed" }));
    expect(await importLinks([{ url: link("FIXTURE02") }])).toMatchObject({ ok: false, code: "not_active" });
    expect(await s.saveBrandPostMetricsBatch({ sql }, studio, { projectId, requestId: randomUUID(), rows: [{ postId: post.id, expectedRevision: 1, metricsSource: "studio_review", views: 2000, likes: null, comments: null, shares: null, saves: null }] })).toMatchObject({ ok: false, code: "not_active" });
  });

  it("includes undated links in a report visibly, without inventing a date or a total", async () => {
    await importLinks([{ url: link("FIXTURE01") }, { url: link("FIXTURE02"), publishedAt: "2026-08-01T03:00:00.000Z" }, { url: link("FIXTURE03"), publishedAt: "2026-09-10T03:00:00.000Z" }]);
    idOf(await s.publishBrandReport({ sql }, studio, { projectId, requestId: randomUUID(), summary: "Fixture summary", periodStart: "2026-09-01", periodEnd: "2026-09-30" }));
    const report = (await s.loadBrandProject({ sql }, owner, projectId))!.reports[0]!;
    expect(report.snapshot.posts.map(p => [p.url, p.publishedAt])).toEqual([[link("FIXTURE03"), "2026-09-10T03:00:00.000Z"], [link("FIXTURE01"), null]]);
    expect(report.snapshot).toMatchObject({ totalPosts: 2, measuredPosts: 0, viewsTotal: null });
    expect(report.snapshot.posts.every(p => p.origin === "external_import" && p.contentVersionId === null)).toBe(true);
  });

  it("is studio-only and leaves the approved-content rule for ordinary posts intact", async () => {
    expect(await importLinks([{ url: link("FIXTURE01") }], randomUUID(), projectId, owner)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await importLinks([{ url: link("FIXTURE01") }], randomUUID(), projectId, { ...owner, isAdmin: true })).toMatchObject({ ok: false, code: "forbidden" });
    // Ordinary posts still need a content version approved in this workspace.
    const attachmentId = await file(projectId, "application/pdf");
    const contentVersionId = idOf(await s.addBrandContentVersion({ sql }, studio, { projectId, requestId: randomUUID(), slotKey: "hero", title: "Hero", attachmentId, caption: "", usageRights: "Organic social" }));
    const record = (url: string) => s.recordBrandPost({ sql }, studio, { projectId, contentVersionId, requestId: randomUUID(), url, publishedAt: "2026-09-20T00:00:00.000Z" });
    expect(await record(link("FIXTURE05"))).toMatchObject({ ok: false, code: "not_approved" });
    idOf(await s.approveBrandContent({ sql }, owner, { projectId, contentVersionId, expectedRevision: 0, decision: "approved", comment: "", requestId: randomUUID() }));
    expect(await record(link("FIXTURE05"))).toMatchObject({ ok: true });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]).toMatchObject({ origin: "approved_content", contentVersionId });
    // An imported link and an approved post are still one post.
    await importLinks([{ url: link("FIXTURE06") }]);
    expect(await record(link("FIXTURE06"))).toMatchObject({ ok: false, code: "conflict" });
    expect(await importLinks([{ url: link("FIXTURE05") }])).toMatchObject({ added: 0, existing: 1, dated: 0 });
    // The database refuses an "approved" post without a version or date and an import that claims one.
    const insert = (origin: string, content: string | null, published: string | null) => sql.query(
      `insert into brand_posts(organization_id,project_id,content_version_id,origin,url,platform,platform_post_id,published_at,verification,metrics_source,created_by,request_id)
       values($1,$2,$3,$4,$5,'instagram',$6,$7,'unverified','unavailable',$8,$9)`, [orgId, projectId, content, origin, link(`X${randomUUID().slice(0, 6)}`), randomUUID(), published, ids.studio, randomUUID()]);
    await expect(insert("approved_content", null, "2026-09-20T00:00:00Z")).rejects.toThrow(/origin_shape/);
    await expect(insert("approved_content", contentVersionId, null)).rejects.toThrow(/origin_shape/);
    await expect(insert("external_import", contentVersionId, null)).rejects.toThrow(/origin_shape/);
    await expect(sql.query("update brand_posts set origin='approved_content' where url=$1", [link("FIXTURE06")])).rejects.toThrow();
  });
});

describe("campaign cover", () => {
  it("uses only this project's own ready image and is visible only to people with access", async () => {
    const cover = await file(projectId);
    const set = (attachmentId: string | null, who = studio, project = projectId) => revision(project).then(expectedRevision => s.setBrandProjectCover({ sql }, who, { projectId: project, attachmentId, expectedRevision }));
    expect(await set(cover, owner)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await set(cover, { ...owner, isAdmin: true })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await set(await file(siblingId))).toMatchObject({ ok: false, code: "invalid" });
    expect(await set(await file(otherProjectId))).toMatchObject({ ok: false, code: "invalid" });
    expect(await set(await file(projectId, "application/pdf"))).toMatchObject({ ok: false, code: "invalid" });
    expect(await set(await file(projectId, "application/pdf", "contract"))).toMatchObject({ ok: false, code: "invalid" });
    expect(await s.setBrandProjectCover({ sql }, studio, { projectId, attachmentId: cover, expectedRevision: 0 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await set(cover)).toMatchObject({ ok: true });
    const url = `/api/brand-workspace/attachments/${cover}`;
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.coverUrl).toBe(url);
    expect((await s.loadBrandWorkspace({ sql }, owner)).projects.find(p => p.id === projectId)!.coverUrl).toBe(url);
    expect((await s.loadBrandWorkspace({ sql }, owner)).projects.find(p => p.id === siblingId)!.coverUrl).toBeNull();
    // The private route re-authorizes: other brands and outsiders get nothing.
    expect(await s.loadBrandAttachmentAccess({ sql }, owner, cover)).toMatchObject({ mime: "image/png" });
    expect(await s.loadBrandAttachmentAccess({ sql }, outsider, cover)).toBeNull();
    expect((await s.loadBrandWorkspace({ sql }, outsider)).projects).toEqual([]);
    // A campaign-only guest of the sibling campaign cannot read this campaign's cover either.
    await invite(guest, siblingId, true);
    expect(await s.loadBrandAttachmentAccess({ sql }, guest, cover)).toBeNull();
    // Hiding the campaign hides its cover from the client too.
    idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId, visible: false, expectedRevision: await revision(projectId) }));
    expect(await s.loadBrandAttachmentAccess({ sql }, owner, cover)).toBeNull();
    // Removing it is explicit.
    expect(await set(null)).toMatchObject({ ok: true });
    expect((await s.loadStudioProject({ sql }, studio, projectId))!.coverUrl).toBeNull();
  });

  it("is enforced by the database as a same-project ready image", async () => {
    const foreign = await file(siblingId), pdf = await file(projectId, "application/pdf");
    await expect(sql.query("update brand_projects set cover_attachment_id=$1 where id=$2", [foreign, projectId])).rejects.toThrow();
    await expect(sql.query("update brand_projects set cover_attachment_id=$1 where id=$2", [pdf, projectId])).rejects.toThrow(/cover/);
  });
});

describe("campaign comments", () => {
  const say = (who: Viewer, project = projectId) => s.sendBrandMessage({ sql }, who, { projectId: project, requestId: randomUUID(), body: "Fixture comment" });

  it("lets an invited campaign guest comment on that campaign only, and grants nothing else", async () => {
    await invite(guest, projectId, true);
    const detail = (await s.loadBrandProject({ sql }, guest, projectId))!;
    expect(detail).toMatchObject({ role: "viewer", canComment: true });
    expect(await say(guest)).toMatchObject({ ok: true });
    expect(await say(guest, siblingId)).toMatchObject({ ok: false, code: "not_found" });
    expect(await say(guest, otherProjectId)).toMatchObject({ ok: false, code: "not_found" });
    // No approval, upload, contract, settings or team rights come with commenting.
    const attachmentId = await file(projectId, "application/pdf");
    const contentVersionId = idOf(await s.addBrandContentVersion({ sql }, studio, { projectId, requestId: randomUUID(), slotKey: "hero", title: "Hero", attachmentId, caption: "", usageRights: "Organic social" }));
    expect(await s.approveBrandContent({ sql }, guest, { projectId, contentVersionId, expectedRevision: 0, decision: "approved", comment: "", requestId: randomUUID() })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await s.reserveBrandAttachment({ sql }, guest, { projectId, requestId: randomUUID(), name: "a.png", mime: "image/png", sizeBytes: 8 })).toMatchObject({ ok: false, code: "forbidden" });
    const contract = await file(projectId, "application/pdf", "contract");
    idOf(await s.addBrandContract({ sql }, studio, { projectId, attachmentId: contract, documentKey: "main", title: "Contract", requestId: randomUUID() }));
    expect((await s.loadBrandProject({ sql }, guest, projectId))!.contracts).toEqual([]);
    expect(await s.loadBrandAttachmentAccess({ sql }, guest, contract)).toBeNull();
    expect(await s.loadBrandSettings({ sql }, guest, orgId)).toBeNull();
    expect(await s.loadBrandMembers({ sql }, guest, orgId)).toBeNull();
    expect(await s.sendBrandSupport({ sql }, guest, { organizationId: orgId, body: "Support", requestId: randomUUID() })).toMatchObject({ ok: false });
    expect(await s.createBrandProject({ sql }, guest, { organizationId: orgId, requestId: randomUUID(), title: "New request", objective: "Something new", budgetKrw: null, productionMode: "creator" })).toMatchObject({ ok: false });
    // Both sides read the same thread, with the right author on each comment.
    expect(await say(studio)).toMatchObject({ ok: true });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.messages.map(m => m.authorRole)).toEqual(["brand", "studio"]);
    // Revocation is immediate.
    idOf(await s.revokeStudioAccess({ sql }, studio, { organizationId: orgId, userId: ids.guest, projectId }));
    expect(await say(guest)).toMatchObject({ ok: false, code: "not_found" });
  });

  it("keeps view-only guests, organization viewers and outsiders read-only", async () => {
    await invite(reader, projectId, false);
    await invite(orgViewer, null, false, "viewer");
    for (const who of [reader, orgViewer]) {
      expect((await s.loadBrandProject({ sql }, who, projectId))!.canComment).toBe(false);
      expect(await say(who)).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(await say(outsider)).toMatchObject({ ok: false, code: "not_found" });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.canComment).toBe(true);
    // Existing guests keep the scope they were invited with; a new invitation redefines it.
    await invite(reader, projectId, true);
    expect(await say(reader)).toMatchObject({ ok: true });
    await invite(reader, projectId, false);
    expect(await say(reader)).toMatchObject({ ok: false, code: "forbidden" });
    // Commenting is a campaign-only invitation option; brand-wide access follows the role.
    expect(await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: null, email: outsider.email, role: "viewer", canComment: true, requestId: randomUUID() })).toMatchObject({ ok: false, code: "invalid" });
    const access = (await s.loadStudioBrandAccess({ sql }, studio, orgId))!;
    expect(access.members.find(m => m.userId === ids.reader)).toMatchObject({ projectId, canComment: false });
  });

  it("hides a hidden campaign's thread from guests", async () => {
    await invite(guest, projectId, true);
    idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId, visible: false, expectedRevision: await revision(projectId) }));
    expect(await say(guest)).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("publicly rounded view counts", () => {
  const firstPost = async () => { await importLinks([{ url: link("FIXTURE01") }]); return (await s.loadStudioProject({ sql }, studio, projectId))!.posts[0]!; };
  const row = (postId: string, expectedRevision: number, values: Record<string, unknown>) => ({ postId, expectedRevision, metricsSource: "studio_review", views: null, likes: null, comments: null, shares: null, saves: null, ...values });
  const batch = (rows: unknown[], requestId = randomUUID()) => s.saveBrandPostMetricsBatch({ sql }, studio, { projectId, requestId, rows });
  const history = async (postId: string) => (await sql.query("select revision,views,views_approximate from brand_post_measurements where post_id=$1 order by revision", [postId])).rows;

  it("keeps the flag in step on the immutable history and the latest projection", async () => {
    const post = await firstPost();
    expect(post.viewsApproximate).toBe(false);
    expect(await batch([row(post.id, 0, { views: 12300, viewsApproximate: true, likes: 812 })])).toMatchObject({ ok: true, saved: 1 });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]).toMatchObject({ views: 12300, viewsApproximate: true, likes: 812 });
    // A later exact observation clears it; history keeps both observations exactly as recorded.
    expect(await s.updateBrandPostMetrics({ sql }, studio, { projectId, postId: post.id, requestId: randomUUID(), expectedRevision: 1, metricsSource: "studio_review", measuredAt: new Date().toISOString(), views: 12312, likes: 812 })).toMatchObject({ ok: true });
    expect((await s.loadBrandProject({ sql }, owner, projectId))!.posts[0]).toMatchObject({ views: 12312, viewsApproximate: false, metricRevision: 2 });
    expect(await history(post.id)).toEqual([{ revision: 1, views: 12300, views_approximate: true }, { revision: 2, views: 12312, views_approximate: false }]);
    await expect(sql.query("update brand_post_measurements set views_approximate=false where post_id=$1", [post.id])).rejects.toThrow(/immutable/);
    // Unticked rows stay exact: the default never turns an existing count approximate.
    expect(await batch([row(post.id, 2, { views: 70000 })])).toMatchObject({ ok: true });
    expect((await history(post.id)).at(-1)).toEqual({ revision: 3, views: 70000, views_approximate: false });
  });

  it("refuses an approximate flag without a view count in every write path and in the database", async () => {
    const post = await firstPost();
    expect(await batch([row(post.id, 0, { views: null, viewsApproximate: true, likes: 5 })])).toMatchObject({ ok: false, code: "invalid" });
    expect(await s.updateBrandPostMetrics({ sql }, studio, { projectId, postId: post.id, requestId: randomUUID(), expectedRevision: 0, metricsSource: "studio_review", measuredAt: new Date().toISOString(), views: null, viewsApproximate: true, likes: 5 })).toMatchObject({ ok: false, code: "invalid" });
    expect(await s.recordBrandPost({ sql }, studio, { projectId, contentVersionId: randomUUID(), requestId: randomUUID(), url: link("FIXTURE02"), publishedAt: "2026-09-20T00:00:00.000Z", metricsSource: "studio_review", measuredAt: new Date().toISOString(), likes: 5, viewsApproximate: true })).toMatchObject({ ok: false, code: "invalid" });
    expect(await history(post.id)).toEqual([]);
    await expect(sql.query("update brand_posts set views_approximate=true where id=$1", [post.id])).rejects.toThrow(/views_approximate/);
    await expect(sql.query(`insert into brand_post_measurements(organization_id,project_id,post_id,revision,verification,metrics_source,measured_at,likes,views_approximate,created_by,request_id)
      values($1,$2,$3,9,'unverified','studio_review',now(),5,true,$4,$5)`, [orgId, projectId, post.id, ids.studio, randomUUID()])).rejects.toThrow(/views_approximate/);
  });

  it("makes the flag part of a console save's identity", async () => {
    const post = await firstPost(), requestId = randomUUID();
    expect(await batch([row(post.id, 0, { views: 45600, viewsApproximate: true })], requestId)).toMatchObject({ ok: true });
    expect(await batch([row(post.id, 0, { views: 45600, viewsApproximate: true })], requestId)).toMatchObject({ ok: true, saved: 1 });
    expect(await batch([row(post.id, 0, { views: 45600 })], requestId)).toMatchObject({ ok: false, code: "conflict" });
    expect((await history(post.id)).length).toBe(1);
  });

  it("marks totals, rates and CSV as approximate only when a rounded count is involved", async () => {
    await importLinks([{ url: link("FIXTURE01") }, { url: link("FIXTURE02") }]);
    const loaded = (await s.loadStudioProject({ sql }, studio, projectId))!.posts;
    const a = loaded.find(p => p.url === link("FIXTURE01"))!, z = loaded.find(p => p.url === link("FIXTURE02"))!;
    await batch([row(a.id, 0, { views: 1000, likes: 10, comments: 5 }), row(z.id, 0, { views: 12300, viewsApproximate: true, likes: 100, comments: 20 })]);
    const posts = (await s.loadBrandProject({ sql }, owner, projectId))!.posts;
    expect(campaignPerformance(posts)).toMatchObject({ views: { total: 13300, measured: 2 }, viewsApproximate: 1, engagementRateApproximate: true });
    const exact = posts.filter(p => !p.viewsApproximate);
    expect(campaignPerformance(exact)).toMatchObject({ views: { total: 1000, measured: 1 }, viewsApproximate: 0, engagementRateApproximate: false });
    const csv = campaignCsv(posts, {}, ["n", "title", "platform", "url", "published", "views", "likes", "comments", "shares", "saves", "source", "measured", "approx"]).split("\r\n");
    expect(csv.find(line => line.includes("FIXTURE02"))).toMatch(/"12300",.*"true"$/);
    expect(csv.find(line => line.includes("FIXTURE01"))).toMatch(/"1000",.*"false"$/);
  });

  it("freezes the flag in report snapshots and reads older snapshots as exact", async () => {
    const post = await firstPost();
    await batch([row(post.id, 0, { views: 12300, viewsApproximate: true })]);
    idOf(await s.publishBrandReport({ sql }, studio, { projectId, requestId: randomUUID(), summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30" }));
    await batch([row(post.id, 1, { views: 13000 })]);
    const frozen = (await s.loadBrandProject({ sql }, owner, projectId))!.reports[0]!.snapshot;
    expect(frozen).toMatchObject({ viewsTotal: 12300, viewsTotalApproximate: true });
    expect(frozen.posts[0]).toMatchObject({ views: 12300, viewsApproximate: true });
    // A snapshot stored before this flag existed carries neither field; every count in it was exact.
    const legacy = { totalPosts: 1, measuredPosts: 1, viewsTotal: 500, metricDefinition: "sum_of_latest_post_views", posts: [{ id: post.id, contentVersionId: randomUUID(), url: link("FIXTURE01"), platform: "instagram", publishedAt: "2026-09-02T00:00:00.000Z", metricRevision: 1, verification: "manual", metricsSource: "studio_review", measuredAt: "2026-09-03T00:00:00.000Z", views: 500, likes: null, comments: null, shares: null, saves: null, createdAt: "2026-09-02T00:00:00.000Z" }] };
    await sql.query("insert into brand_reports(organization_id,project_id,version,summary,period_start,period_end,snapshot,created_by,request_id) values($1,$2,99,'Legacy','2026-09-01','2026-09-30',$3::jsonb,$4,$5)", [orgId, projectId, JSON.stringify(legacy), ids.studio, randomUUID()]);
    const old = (await s.loadBrandProject({ sql }, owner, projectId))!.reports.find(r => r.version === 99)!.snapshot;
    expect(old).toMatchObject({ viewsTotal: 500, viewsTotalApproximate: false });
    expect(old.posts[0]).toMatchObject({ views: 500, viewsApproximate: false, origin: "approved_content" });
  });

  it("reads the admin checkboxes: ticked is approximate, absent is exact", () => {
    const P = randomUUID();
    const form = new FormData();
    for (const [k, v] of Object.entries({ projectId, requestId: randomUUID(), only: P, [`rev:${P}`]: "0", [`verification:${P}`]: "manual", [`metricsSource:${P}`]: "studio_review", [`views:${P}`]: "12300", [`likes:${P}`]: "", [`comments:${P}`]: "", [`shares:${P}`]: "", [`saves:${P}`]: "" })) form.set(k, v);
    const exact = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.metricsBatch"].parse(form);
    expect(exact.ok && exact.value.rows).toEqual([expect.objectContaining({ views: 12300, viewsApproximate: false })]);
    form.set(`viewsApproximate:${P}`, "true");
    const rounded = BRAND_WORKSPACE_OPERATIONS["brandWorkspace.metricsBatch"].parse(form);
    expect(rounded.ok && rounded.value.rows).toEqual([expect.objectContaining({ views: 12300, viewsApproximate: true })]);
    const single = new FormData(); single.set("views", "45600"); single.set("viewsApproximate", "true");
    expect(BRAND_WORKSPACE_OPERATIONS["brandWorkspace.metrics"].parse(single)).toMatchObject({ ok: true, value: { views: 45600, viewsApproximate: true } });
  });
});

describe("database and admin entry points", () => {
  it("grants the server role only the three new column updates and browsers nothing", async () => {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;");
    for (const m of ["0113_glue_brand_workspace.sql", "0117_glue_brand_managed_workspace.sql", "0120_glue_brand_client_sharing.sql"]) await db.exec(readMigration(m));
    const can = async (role: string, table: string, column: string) => (await sql.query<{ ok: boolean }>("select has_column_privilege($1,$2,$3,'UPDATE') as ok", [role, table, column])).rows[0]!.ok;
    expect(await can("service_role", "brand_projects", "cover_attachment_id")).toBe(true);
    expect(await can("service_role", "brand_posts", "published_at")).toBe(true);
    expect(await can("service_role", "brand_posts", "views_approximate")).toBe(true);
    expect(await can("service_role", "brand_project_members", "can_comment")).toBe(true);
    for (const [table, column] of [["brand_posts", "origin"], ["brand_posts", "content_version_id"], ["brand_invites", "can_comment"], ["brand_post_measurements", "views_approximate"]]) expect(await can("service_role", table!, column!)).toBe(false);
    for (const role of ["anon", "authenticated"]) expect(await can(role, "brand_projects", "cover_attachment_id")).toBe(false);
  });

  it("parses pasted links with optional Korea-time publish times and registers both operations", async () => {
    const { ADMIN_OPERATION_NAMES } = await import("@/lib/admin/operations");
    expect(ADMIN_OPERATION_NAMES).toEqual(expect.arrayContaining(["brandWorkspace.externalPosts", "brandWorkspace.cover"]));
    const parse = (links: string) => { const form = new FormData(); form.set("projectId", projectId); form.set("requestId", randomUUID()); form.set("links", links); return BRAND_WORKSPACE_OPERATIONS["brandWorkspace.externalPosts"].parse(form); };
    const parsed = parse(`${link("FIXTURE01")}\n\n  ${link("FIXTURE02")} 2026-09-20 18:30\r\n${link("FIXTURE03")}   2026-09-21T09:05  `);
    expect(parsed.ok && parsed.value.posts).toEqual([
      { url: link("FIXTURE01"), publishedAt: null },
      { url: link("FIXTURE02"), publishedAt: "2026-09-20T09:30:00.000Z" },
      { url: link("FIXTURE03"), publishedAt: "2026-09-21T00:05:00.000Z" },
    ]);
    expect(parsed.ok && parsed.value.verification).toBe("unverified");
    for (const bad of [`${link("A")} 2026-09-20`, `${link("A")} 2026-02-31 10:00`, `${link("A")} yesterday`, `${link("A")} 2026-09-20 18:30 extra`, "  \n "]) expect(parse(bad).ok).toBe(false);
    // Invitation access choice maps onto campaign scope and the comment flag.
    const invite = (access: string) => { const form = new FormData(); for (const [k, v] of Object.entries({ organizationId: orgId, projectId, email: "x@example.test", role: "viewer", access })) form.set(k, v); return BRAND_WORKSPACE_OPERATIONS["brandWorkspace.invite"].parse(form); };
    expect(invite("comment")).toMatchObject({ ok: true, value: { projectId, canComment: true } });
    expect(invite("read")).toMatchObject({ ok: true, value: { projectId, canComment: false } });
    expect(invite("brand")).toMatchObject({ ok: true, value: { projectId: null, canComment: false } });
  });
});
