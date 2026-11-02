import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
import * as u from "@/lib/brands/usage/service";

/**
 * A shared campaign with an owner, an editor, a viewer, one imported post and a shared terms PDF,
 * plus a helper that takes one inquiry all the way to an issued quote. Fixture values only.
 */
/** Korea calendar day (YYYY-MM-DD) `offset` days from now, so fixture usage windows never go stale. */
export const kstDay = (offset: number) => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const idOf = (r: { ok: boolean; code?: string; id?: string }) => { if (!r.ok) throw Error(r.code); return r.id!; };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
export interface UsageFixture {
  db: PGlite; sql: SqlRunner; studio: Viewer; owner: Viewer; editor: Viewer; viewer: Viewer;
  orgId: string; projectId: string; postId: string; contractId: string;
  quoted(totalKrw: number, taxBasis?: "included" | "excluded"): Promise<{ caseId: string; quoteId: string }>;
}
export async function usageFixture(): Promise<UsageFixture> {
  const db = await freshDb(), sql = runner(db);
  const [studio, owner, editor, viewer] = [as(randomUUID(), true), as(randomUUID()), as(randomUUID()), as(randomUUID())];
  for (const v of [studio, owner, editor, viewer]) await seedProfile(sql, { id: v.userId!, isAdmin: v.isAdmin, email: v.email! });
  const orgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand", requestId: randomUUID() }));
  const projectId = idOf(await s.createStudioProject({ sql }, studio, { organizationId: orgId, title: "Fixture campaign", objective: "Fixture objective", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, studio, { projectId, expectedRevision: 1, status: "active" }));
  for (const [v, role] of [[owner, "owner"], [editor, "editor"], [viewer, "viewer"]] as const) {
    const r = await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: null, email: v.email, role, canComment: false, requestId: randomUUID() });
    if (!r.ok) throw Error(r.code);
    await s.acceptBrandInvitation({ sql, verifiedEmail: v.email! }, v, { token: r.token });
  }
  idOf(await s.importBrandExternalPosts({ sql }, studio, { projectId, requestId: randomUUID(), posts: [{ url: "https://www.instagram.com/p/FIXTURE9/", publishedAt: null }] }));
  const postId = String((await sql.query("select id from brand_posts where project_id=$1", [projectId])).rows[0]!.id);
  const pdf = Buffer.from("%PDF-1.7");
  const file = await s.reserveBrandAttachment({ sql }, studio, { projectId, requestId: randomUUID(), name: "terms.pdf", mime: "application/pdf", sizeBytes: pdf.length, purpose: "contract" });
  if (!file.ok) throw Error(file.code);
  idOf(await s.completeBrandAttachment({ sql, storage: { read: async () => pdf } }, studio, file.id));
  const contractId = idOf(await s.addBrandContract({ sql }, studio, { projectId, attachmentId: file.id, documentKey: "usage-terms", title: "Usage terms", requestId: randomUUID() }));
  idOf(await s.shareBrandContract({ sql }, studio, { projectId, contractId, shared: true, expectedRevision: 0 }));
  const revision = async (caseId: string) => Number((await sql.query("select revision from brand_usage_cases where id=$1", [caseId])).rows[0]!.revision);
  async function quoted(totalKrw: number, taxBasis: "included" | "excluded" = "included") {
    const caseId = idOf(await u.submitUsageInquiry({ sql }, editor, { projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: postId }], intent: "know_cost" }));
    idOf(await u.triageUsageCase({ sql }, studio, { caseId, expectedRevision: await revision(caseId) }));
    const itemId = String((await sql.query("select id from brand_usage_case_items where case_id=$1", [caseId])).rows[0]!.id);
    idOf(await u.defineUsageScope({ sql }, studio, { caseId, expectedRevision: await revision(caseId), requestId: randomUUID(), items: [{ itemId, pin: { kind: "original_post" }, usageKinds: ["organic_repost"], channels: ["Brand Instagram"], territory: ["KR"], advertiser: null, edits: "none", timing: { kind: "fixed", startsOn: kstDay(8), endsOn: kstDay(38) } }] }));
    const scopeRevisionId = String((await sql.query("select id from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.id);
    const compensationId = idOf(await u.recordUsageCompensation({ sql }, studio, { caseId, scopeRevisionId, requestId: randomUUID(), amountKrw: 1, taxBasis: "included", note: "" }));
    idOf(await u.recordUsageConsent({ sql }, studio, { caseId, itemId, scopeRevisionId, compensationId, requestId: randomUUID(), approverKind: "creator", approvedAt: new Date().toISOString(), evidenceReference: "fixture", rightsChecks: ["ownership", "music", "people", "marks"] }));
    const quoteId = idOf(await u.issueUsageQuote({ sql }, studio, { caseId, expectedRevision: await revision(caseId), requestId: randomUUID(), scopeRevisionId, totalKrw, taxBasis, validUntil: new Date(Date.now() + 86400000).toISOString(), contractId, note: "" }));
    return { caseId, quoteId };
  }
  return { db, sql, studio, owner, editor, viewer, orgId, projectId, postId, contractId, quoted };
}
