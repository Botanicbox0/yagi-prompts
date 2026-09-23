import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { dispatchAdmin } from "@/lib/admin/dispatch";
import { ADMIN_OPERATION_NAMES } from "@/lib/admin/operations";
import type { AdminContext } from "@/lib/admin/context";
import type { StorageDriver } from "@/lib/storage";
import * as u from "@/lib/brands/usage/service";
import { usageFixture, kstDay, type UsageFixture } from "@/tests/helpers/brand-usage";

/** The studio console forms for secondary usage, through the one guarded dispatcher. */
let f: UsageFixture;
beforeEach(async () => { f = await usageFixture(); });
afterEach(async () => { await f.db.close(); });
const ctx = (viewer = f.studio): AdminContext => ({ sql: f.sql, storage: {} as StorageDriver, viewer });
const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const value of Array.isArray(v) ? v : [v]) data.append(k, value);
  return data;
};

describe("brandUsage admin operations", () => {
  it("are registered and refused for non-admins before parsing", async () => {
    for (const name of ["brandUsage.triage", "brandUsage.scope", "brandUsage.consent", "brandUsage.quote", "brandUsage.resolve", "brandUsage.reconcile"])
      expect(ADMIN_OPERATION_NAMES).toContain(name);
    expect(await dispatchAdmin("brandUsage.triage", form({}), ctx(f.owner))).toEqual({ ok: false, code: "forbidden" });
  });
  it("triage, then a scope form with one shared set of terms and a per-item pin", async () => {
    const caseId = (await u.submitUsageInquiry({ sql: f.sql }, f.editor, { projectId: f.projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: f.postId }], intent: "recommend_terms" }) as { id: string }).id;
    expect(await dispatchAdmin("brandUsage.triage", form({ caseId, expectedRevision: "0" }), ctx())).toMatchObject({ ok: true, to: `/admin/brand-workspace/usage/${caseId}` });
    const itemId = String((await f.sql.query("select id from brand_usage_case_items where case_id=$1", [caseId])).rows[0]!.id);
    const scope = (extra: Record<string, string | string[]>) => form({ caseId, expectedRevision: "1", requestId: randomUUID(), itemId, [`include:${itemId}`]: "on", [`pin:${itemId}`]: "original_post",
      usageKinds: ["organic_repost"], channels: "Brand Instagram\nBrand TikTok", territory: "kr, jp", advertiser: "", edits: "none", timingKind: "fixed", startsOn: kstDay(8), endsOn: kstDay(38), ...extra });
    // A blank territory is refused, never read as worldwide.
    expect(await dispatchAdmin("brandUsage.scope", scope({ territory: "" }), ctx())).toMatchObject({ ok: false, code: "invalid" });
    expect(await dispatchAdmin("brandUsage.scope", scope({ [`pin:${itemId}`]: "content_version" }), ctx())).toMatchObject({ ok: false, detail: "subject_unpinned" });
    expect(await dispatchAdmin("brandUsage.scope", scope({}), ctx())).toMatchObject({ ok: true });
    const stored = (await f.sql.query("select scope from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.scope as { items: Array<{ territory: string[]; channels: string[] }> };
    expect(stored.items[0]).toMatchObject({ territory: ["JP", "KR"], channels: ["Brand Instagram", "Brand TikTok"] });
  });
  it("a quote without consent names the missing step to the studio", async () => {
    const caseId = (await u.submitUsageInquiry({ sql: f.sql }, f.editor, { projectId: f.projectId, requestId: randomUUID(), subjects: [{ kind: "post", id: f.postId }], intent: "know_cost" }) as { id: string }).id;
    await dispatchAdmin("brandUsage.triage", form({ caseId, expectedRevision: "0" }), ctx());
    const itemId = String((await f.sql.query("select id from brand_usage_case_items where case_id=$1", [caseId])).rows[0]!.id);
    await dispatchAdmin("brandUsage.scope", form({ caseId, expectedRevision: "1", requestId: randomUUID(), itemId, [`include:${itemId}`]: "on", [`pin:${itemId}`]: "original_post", usageKinds: "organic_repost", channels: "Brand Instagram", territory: "KR", edits: "none", timingKind: "first_use", durationDays: "30" }), ctx());
    const scopeRevisionId = String((await f.sql.query("select id from brand_usage_scope_revisions where case_id=$1", [caseId])).rows[0]!.id);
    expect(await dispatchAdmin("brandUsage.quote", form({ caseId, expectedRevision: "2", requestId: randomUUID(), scopeRevisionId, totalKrw: "100000", taxBasis: "excluded", validUntil: "2099-01-01T18:00", contractId: f.contractId, note: "" }), ctx()))
      .toMatchObject({ ok: false, detail: "consent_missing" });
  });
});
