import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, runner } from "@/tests/helpers/pglite";
import { seedProfile } from "@/tests/helpers/billing";
import type { Viewer } from "@/lib/auth/identity";
import type { SqlRunner } from "@/lib/db/sql-runner";
import * as s from "@/lib/brands/workspace/service";
import * as sl from "@/lib/brands/shortlist/service";

/**
 * A campaign's creator shortlist: the studio imports and shares candidates, the brand compares the
 * shared ones and marks the ones it prefers. Fixture handles and figures only.
 */
const ids = { studio: randomUUID(), owner: randomUUID(), guest: randomUUID(), reader: randomUUID(), viewer: randomUUID(), outsider: randomUUID() };
const as = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? "admin" : "free", email: `${userId}@example.test`, locale: "ko" });
const studio = as(ids.studio, true), owner = as(ids.owner), guest = as(ids.guest), reader = as(ids.reader), orgViewer = as(ids.viewer), outsider = as(ids.outsider);
let db: PGlite, sql: SqlRunner, orgId: string, projectId: string;
const idOf = (r: s.BrandOutcome<{ id: string }>) => { if (!r.ok) throw Error(r.code); return r.id; };
const puts: Array<{ key: string; type: string; size: number }> = [];
const storage = { putStaging: async (key: string, bytes: Uint8Array, type: string) => { puts.push({ key, type, size: bytes.byteLength }); } };

async function invite(user: Viewer, project: string | null, canComment: boolean, role: "owner" | "editor" | "viewer" = "viewer") {
  const r = await s.createStudioInvitation({ sql }, studio, { organizationId: orgId, projectId: project, email: user.email, role, canComment, requestId: randomUUID() });
  if (!r.ok) throw Error(r.code);
  expect(await s.acceptBrandInvitation({ sql, verifiedEmail: user.email! }, user, { token: r.token })).toMatchObject({ ok: true });
}
const candidate = (handle: string, followers: number, extra: Record<string, unknown> = {}) => ({
  handle, displayName: `Fixture ${handle}`, category: "뷰티",
  metrics: { followers, following: 164, posts: 562, feedPosts30d: 18, feedEngagement: 343, feedEngagementRate: 0.5, feedLikes: 330, feedComments: 13,
    adPosts30d: 9.3, adShare: 53, reelsPosts30d: 20, reelsEngagementRate: 0.4, reelsComments: 4.2, viewsMedian90d: 10000, viewsMax90d: 39000 },
  ...extra,
});
const studioImport = (candidates: unknown[], extra: Record<string, unknown> = {}) =>
  sl.importShortlist({ sql, storage }, { kind: "studio", viewer: studio }, { projectId, measuredOn: "2026-10-27", candidates, ...extra });
const shared = async (who: Viewer) => (await sl.loadBrandShortlist({ sql }, who, projectId))?.candidates.map(c => c.handle);
const shareAll = () => sl.setShortlistShared({ sql }, studio, { projectId, shared: true });
const candidateId = async (handle: string) => String((await sql.query("select id from brand_shortlist_candidates where handle=$1", [handle])).rows[0]!.id);

beforeEach(async () => {
  db = await freshDb(); sql = runner(db); puts.length = 0;
  for (const [key, id] of Object.entries(ids)) await seedProfile(sql, { id, isAdmin: key === "studio", email: `${id}@example.test` });
  orgId = idOf(await s.createStudioOrganization({ sql }, studio, { name: "Fixture brand", requestId: randomUUID() }));
  projectId = idOf(await s.createStudioProject({ sql }, studio, { organizationId: orgId, title: "Fixture campaign", objective: "Find creators", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
  idOf(await s.setBrandProjectVisibility({ sql }, studio, { projectId, visible: true, expectedRevision: 0 }));
  idOf(await s.activateBrandProject({ sql }, studio, { projectId, expectedRevision: 1, status: "active" }));
  await invite(owner, null, false, "owner");
  await invite(orgViewer, null, false, "viewer");
  await invite(guest, projectId, true);
  await invite(reader, projectId, false);
});
afterEach(async () => { await db?.close(); });

describe("import and sharing", () => {
  it("keeps imported candidates hidden until the studio shares them, then lists them biggest first", async () => {
    expect(await studioImport([candidate("fixture_small", 9042), candidate("@Fixture.Big", 67000)])).toEqual({ ok: true, id: projectId, added: 2, updated: 0 });
    expect(await shared(owner)).toEqual([]);
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))?.candidates.map(c => [c.handle, c.shared])).toEqual([["fixture.big", false], ["fixture_small", false]]);
    expect(await shareAll()).toMatchObject({ ok: true, changed: 2 });
    for (const who of [owner, orgViewer, guest, reader]) expect(await shared(who)).toEqual(["fixture.big", "fixture_small"]);
    expect(await sl.loadBrandShortlist({ sql }, outsider, projectId)).toBeNull();
    const view = await sl.loadBrandShortlist({ sql }, owner, projectId);
    expect(view?.candidates[1]).toMatchObject({ displayName: "Fixture fixture_small", category: "뷰티", measuredOn: "2026-10-27", avatarUrl: null, picked: false,
      metrics: { followers: 9042, adPosts30d: 9.3, feedEngagementRate: 0.5, reelsComments: 4.2, viewsMax90d: 39000 } });
    // Hiding one takes it off the brand's page again.
    expect(await sl.setShortlistShared({ sql }, studio, { projectId, candidateId: await candidateId("fixture.big"), shared: false })).toMatchObject({ ok: true, changed: 1 });
    expect(await shared(owner)).toEqual(["fixture_small"]);
  });

  it("refreshes figures by handle without touching sharing or the brand's mark", async () => {
    await studioImport([candidate("fixture_one", 1000)]);
    await shareAll();
    expect(await sl.pickShortlistCandidate({ sql }, owner, { candidateId: await candidateId("fixture_one"), picked: true })).toMatchObject({ ok: true, picked: true });
    expect(await studioImport([{ handle: "fixture_one", metrics: { followers: 1200 } }], { measuredOn: "2026-11-02" })).toMatchObject({ added: 0, updated: 1 });
    const [one] = (await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates;
    // A new reading replaces the whole set of figures; name and category the new reading lacks are kept.
    expect(one).toMatchObject({ displayName: "Fixture fixture_one", category: "뷰티", measuredOn: "2026-11-02", picked: true, metrics: { followers: 1200 } });
    expect(one!.metrics.posts).toBeUndefined();
    // A reading with no figures leaves the earlier figures and their day alone.
    await studioImport([{ handle: "fixture_one", displayName: "Renamed fixture" }], { measuredOn: "2026-11-09" });
    expect((await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates[0]).toMatchObject({ displayName: "Renamed fixture", measuredOn: "2026-11-02", metrics: { followers: 1200 } });
  });

  it("accepts the import worker without a user and refuses anyone who is not the studio", async () => {
    expect(await sl.importShortlist({ sql, storage }, { kind: "worker" }, { projectId, candidates: [candidate("fixture_worker", 500)] })).toMatchObject({ ok: true, added: 1 });
    for (const who of [owner, guest])
      expect(await sl.importShortlist({ sql, storage }, { kind: "studio", viewer: who }, { projectId, candidates: [candidate("fixture_x", 1)] })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.setShortlistShared({ sql }, owner, { projectId, shared: true })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.removeShortlistCandidate({ sql }, owner, { projectId, candidateId: await candidateId("fixture_worker") })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.loadStudioShortlist({ sql }, owner, projectId)).toBeNull();
    expect(await sl.importShortlist({ sql, storage }, { kind: "worker" }, { projectId: randomUUID(), candidates: [candidate("fixture_y", 1)] })).toEqual({ ok: false, code: "not_found" });
  });

  it("removes a candidate", async () => {
    await studioImport([candidate("fixture_gone", 10)]);
    await shareAll();
    const id = await candidateId("fixture_gone");
    expect(await sl.removeShortlistCandidate({ sql }, studio, { projectId, candidateId: id })).toEqual({ ok: true, id: projectId });
    expect(await shared(owner)).toEqual([]);
    expect(await sl.removeShortlistCandidate({ sql }, studio, { projectId, candidateId: id })).toEqual({ ok: false, code: "not_found" });
  });
});

describe("what can never reach the brand", () => {
  it("refuses a fee, a note or any other field the contract does not name, anywhere in the request", async () => {
    const refused = [
      { ...candidate("fixture_a", 1), price: 114500 },
      { ...candidate("fixture_a", 1), note: "internal" },
      { ...candidate("fixture_a", 1), penalty: true },
      { ...candidate("fixture_a", 1), metrics: { followers: 1, feeKrw: 50000 } },
      { ...candidate("fixture_a", 1), metrics: { followers: 1, effectiveFollowers: 1 } },
      { ...candidate("fixture_a", 1), profileUrl: "https://example.test/fixture_a" },
    ];
    for (const c of refused) expect(await studioImport([c])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([candidate("fixture_a", 1)], { sourceCampaign: "x" })).toMatchObject({ ok: false, code: "invalid" });
    expect((await sql.query("select count(*)::int as n from brand_shortlist_candidates")).rows[0]!.n).toBe(0);
  });

  it("refuses names or categories that mention where candidates were recruited", async () => {
    for (const extra of [{ displayName: "Brandazine pick" }, { category: "브랜더진 모집" }, { displayName: "brand azine" }])
      expect(await studioImport([candidate("fixture_b", 1, extra)])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([candidate("brandazine_fan", 1)])).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses bad handles, duplicates, impossible figures and an empty list", async () => {
    for (const handle of ["", "has space", "x".repeat(31), "fixture/one"]) expect(await studioImport([candidate(handle, 1)])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([candidate("fixture_c", 1), candidate("@FIXTURE_C", 2)])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([candidate("fixture_c", -1)])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([candidate("fixture_c", 1.5)])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([{ handle: "fixture_c", metrics: { feedEngagementRate: 101 } }])).toMatchObject({ ok: false, code: "invalid" });
    expect(await studioImport([])).toMatchObject({ ok: false, code: "invalid", field: "candidates" });
    expect(await studioImport([candidate("fixture_c", 1)], { measuredOn: "2026-02-30" })).toMatchObject({ ok: false, code: "invalid", field: "measuredOn" });
  });

  it("is also guarded by the database: no other key can enter the figures", async () => {
    await expect(sql.query("insert into brand_shortlist_candidates(project_id,handle,metrics) values($1,'fixture_d',$2::jsonb)", [projectId, JSON.stringify({ followers: 1, priceKrw: 100 })])).rejects.toThrow();
    await expect(sql.query("insert into brand_shortlist_candidates(project_id,handle,metrics) values($1,'Fixture_D','{}'::jsonb)", [projectId])).rejects.toThrow();
  });

  it("stores a picture only as a re-encoded WebP and serves it only where the candidate is visible", async () => {
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#cc3344" } }).png().toBuffer();
    const avatar = `data:image/png;base64,${png.toString("base64")}`;
    expect(await studioImport([candidate("fixture_pic", 5, { avatar })])).toMatchObject({ ok: true, added: 1 });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ type: "image/webp" });
    expect(puts[0]!.key).toMatch(new RegExp(`^brands/${orgId}/shortlist/[0-9a-f-]{36}/[0-9a-f]{64}\\.webp$`));
    // The same picture again is not written twice.
    await studioImport([candidate("fixture_pic", 6, { avatar })]);
    expect(puts).toHaveLength(1);
    const id = await candidateId("fixture_pic");
    expect(await sl.loadShortlistAvatarAccess({ sql }, owner, id)).toBeNull();
    expect(await sl.loadShortlistAvatarAccess({ sql }, studio, id)).toMatchObject({ mime: "image/webp" });
    await shareAll();
    expect(await sl.loadShortlistAvatarAccess({ sql }, guest, id)).toMatchObject({ mime: "image/webp" });
    expect(await sl.loadShortlistAvatarAccess({ sql }, outsider, id)).toBeNull();
    expect((await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates[0]!.avatarUrl).toMatch(new RegExp(`^/api/brand-workspace/shortlist/${id}/avatar\\?v=[0-9a-f]{12}$`));
    // Bytes that are not the declared image type, and no storage at all, are refused.
    const fake = `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}`;
    expect(await studioImport([candidate("fixture_fake", 1, { avatar: fake })])).toEqual({ ok: false, code: "invalid", field: "candidates.0.avatar" });
    expect(await sl.importShortlist({ sql }, { kind: "worker" }, { projectId, candidates: [candidate("fixture_nostore", 1, { avatar })] })).toEqual({ ok: false, code: "storage_unavailable" });
  });
});

describe("triage", () => {
  const states = async () => (await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates.map(c => [c.handle, c.state]);
  const triage = (input: Record<string, unknown>) => sl.triageShortlist({ sql }, studio, { projectId, ...input });

  it("keeps an excluded candidate off the brand's page, out of 'share all' and out after a re-import", async () => {
    await studioImport([candidate("fixture_keep", 3000), candidate("fixture_out", 2000)]);
    const out = await candidateId("fixture_out");
    expect(await triage({ exclude: [out] })).toEqual({ ok: true, id: projectId, changed: 1 });
    expect(await shareAll()).toMatchObject({ ok: true, changed: 1 });
    expect(await shared(owner)).toEqual(["fixture_keep"]);
    // The import worker sends the same handle again: figures refresh, the exclusion stays.
    expect(await studioImport([candidate("fixture_out", 2500)])).toMatchObject({ added: 0, updated: 1 });
    expect(await states()).toEqual([["fixture_keep", "shared"], ["fixture_out", "excluded"]]);
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates[1]!.metrics.followers).toBe(2500);
    expect((await sql.query("select excluded_by from brand_shortlist_candidates where id=$1", [out])).rows[0]!.excluded_by).toBe(ids.studio);
    // Sharing that one candidate brings it back.
    expect(await sl.setShortlistShared({ sql }, studio, { projectId, candidateId: out, shared: true })).toMatchObject({ ok: true, changed: 1 });
    expect(await shared(owner)).toEqual(["fixture_keep", "fixture_out"]);
  });

  it("moves many candidates in one call, and nothing when one ID is not this campaign's", async () => {
    await studioImport([candidate("fixture_a", 400), candidate("fixture_b", 300), candidate("fixture_c", 200), candidate("fixture_d", 100)]);
    const [a, b, c, d] = await Promise.all(["fixture_a", "fixture_b", "fixture_c", "fixture_d"].map(candidateId));
    expect(await triage({ share: [a, b], exclude: [c] })).toMatchObject({ ok: true, changed: 3 });
    expect(await states()).toEqual([["fixture_a", "shared"], ["fixture_b", "shared"], ["fixture_c", "excluded"], ["fixture_d", "waiting"]]);
    // Moving to where a candidate already is changes nothing; back to waiting clears both marks.
    expect(await triage({ share: [a], wait: [b, c] })).toMatchObject({ ok: true, changed: 2 });
    expect(await states()).toEqual([["fixture_a", "shared"], ["fixture_b", "waiting"], ["fixture_c", "waiting"], ["fixture_d", "waiting"]]);
    // Another campaign's candidate in the list: refused whole.
    const other = idOf(await s.createStudioProject({ sql }, studio, { organizationId: orgId, title: "Other campaign", objective: "Find creators", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
    await sl.importShortlist({ sql, storage }, { kind: "studio", viewer: studio }, { projectId: other, candidates: [candidate("fixture_elsewhere", 1)] });
    expect(await triage({ exclude: [d, await candidateId("fixture_elsewhere")] })).toEqual({ ok: false, code: "not_found" });
    expect((await states()).at(-1)).toEqual(["fixture_d", "waiting"]);
    // The same ID in two lists, an empty call, a non-ID and a non-studio caller are refused.
    expect(await triage({ share: [d], exclude: [d] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await triage({})).toMatchObject({ ok: false, code: "invalid" });
    expect(await triage({ share: ["fixture_d"] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await sl.triageShortlist({ sql }, owner, { projectId, share: [d] })).toEqual({ ok: false, code: "forbidden" });
    // The database refuses a candidate that is both shared and excluded.
    await expect(sql.query("update brand_shortlist_candidates set shared_at=now(), excluded_at=now() where id=$1", [d])).rejects.toThrow();
  });

  it("keeps the campaign's ranges as criteria, only ranges, and clears them", async () => {
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.criteria).toBeNull();
    const save = (criteria: unknown) => sl.saveShortlistCriteria({ sql }, studio, { projectId, criteria });
    expect(await save({ followers: { min: 1000, max: 50000 }, engagement: { min: 1.5, max: null } })).toEqual({ ok: true, id: projectId });
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.criteria).toEqual({ followers: { min: 1000, max: 50000 }, engagement: { min: 1.5 } });
    for (const bad of [{ fee: { max: 100000 } }, { followers: { min: 10, max: 1 } }, { followers: {} }, { followers: { min: -1 } }, { followers: { min: 1, note: "x" } }])
      expect(await save(bad)).toMatchObject({ ok: false, code: "invalid" });
    expect(await sl.saveShortlistCriteria({ sql }, owner, { projectId, criteria: null })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.saveShortlistCriteria({ sql }, studio, { projectId: randomUUID(), criteria: null })).toEqual({ ok: false, code: "not_found" });
    expect(await save(null)).toMatchObject({ ok: true });
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.criteria).toBeNull();
    await expect(sql.query(`update brand_projects set shortlist_criteria='{"priceKrw":{"max":1}}'::jsonb where id=$1`, [projectId])).rejects.toThrow();
  });

  it("stores the picture large enough for the card portrait, with its dominant colour", async () => {
    const png = await sharp({ create: { width: 320, height: 320, channels: 3, background: "#3366cc" } }).png().toBuffer();
    await studioImport([candidate("fixture_tone", 5, { avatar: `data:image/png;base64,${png.toString("base64")}` })]);
    const [c] = (await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates;
    expect(c!.avatarTone).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c!.avatarTone!.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r! + 60);
    expect(g).toBeLessThan(b!);
    expect(puts[0]!.size).toBeGreaterThan(0);
    const stored = await sql.query("select avatar_tone from brand_shortlist_candidates where id=$1", [c!.id]);
    expect(stored.rows[0]!.avatar_tone).toBe(c!.avatarTone);
    // No picture, no colour.
    await studioImport([candidate("fixture_plain", 1)]);
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates.find(x => x.handle === "fixture_plain")!.avatarTone).toBeNull();
  });
});

describe("the brand's preference", () => {
  beforeEach(async () => {
    await studioImport([candidate("fixture_pick", 100), candidate("fixture_hidden", 50)]);
    await sl.setShortlistShared({ sql }, studio, { projectId, candidateId: await candidateId("fixture_pick"), shared: true });
  });

  it("lets owners and commenting guests mark a shared candidate, and nobody else", async () => {
    const id = await candidateId("fixture_pick");
    expect((await sl.loadBrandShortlist({ sql }, owner, projectId))!.canPick).toBe(true);
    expect((await sl.loadBrandShortlist({ sql }, guest, projectId))!.canPick).toBe(true);
    expect((await sl.loadBrandShortlist({ sql }, reader, projectId))!.canPick).toBe(false);
    expect((await sl.loadBrandShortlist({ sql }, orgViewer, projectId))!.canPick).toBe(false);
    expect(await sl.pickShortlistCandidate({ sql }, guest, { candidateId: id, picked: true })).toEqual({ ok: true, id, picked: true });
    expect((await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates[0]!.picked).toBe(true);
    // Marking again keeps the first mark; unmarking clears it.
    await sl.pickShortlistCandidate({ sql }, owner, { candidateId: id, picked: true });
    expect((await sql.query("select picked_by from brand_shortlist_candidates where id=$1", [id])).rows[0]!.picked_by).toBe(ids.guest);
    expect(await sl.pickShortlistCandidate({ sql }, owner, { candidateId: id, picked: false })).toMatchObject({ ok: true, picked: false });
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates.find(c => c.handle === "fixture_pick")).toMatchObject({ picked: false, pickedAt: null });
    expect(await sl.pickShortlistCandidate({ sql }, reader, { candidateId: id, picked: true })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.pickShortlistCandidate({ sql }, orgViewer, { candidateId: id, picked: true })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.pickShortlistCandidate({ sql }, outsider, { candidateId: id, picked: true })).toEqual({ ok: false, code: "not_found" });
  });

  it("treats a hidden candidate as not there", async () => {
    expect(await sl.pickShortlistCandidate({ sql }, owner, { candidateId: await candidateId("fixture_hidden"), picked: true })).toEqual({ ok: false, code: "not_found" });
    expect(await sl.pickShortlistCandidate({ sql }, owner, { candidateId: randomUUID(), picked: true })).toEqual({ ok: false, code: "not_found" });
  });
});

describe("the brand's own sorting", () => {
  let a: string, b: string, c: string, hidden: string;
  const marks = async () => Object.fromEntries((await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates.map(x => [x.handle, x.picked ? "picked" : x.passed ? "passed" : "none"]));
  beforeEach(async () => {
    await studioImport([candidate("fixture_a", 300), candidate("fixture_b", 200), candidate("fixture_c", 100), candidate("fixture_hidden", 50)]);
    [a, b, c, hidden] = await Promise.all(["fixture_a", "fixture_b", "fixture_c", "fixture_hidden"].map(candidateId)) as [string, string, string, string];
    expect(await sl.triageShortlist({ sql }, studio, { projectId, share: [a, b, c] })).toMatchObject({ ok: true, changed: 3 });
  });

  it("prefers, sets aside and clears many at once, never both marks on one candidate", async () => {
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, b], choice: "picked" })).toEqual({ ok: true, id: projectId, choice: "picked", changed: 2 });
    expect(await sl.chooseShortlistCandidates({ sql }, guest, { candidateIds: [b, c], choice: "passed" })).toMatchObject({ ok: true, changed: 2 });
    expect(await marks()).toEqual({ fixture_a: "picked", fixture_b: "passed", fixture_c: "passed" });
    expect((await sql.query("select count(*)::int as n from brand_shortlist_candidates where picked_at is not null and passed_at is not null")).rows[0]!.n).toBe(0);
    expect((await sql.query("select passed_by from brand_shortlist_candidates where id=$1", [c])).rows[0]!.passed_by).toBe(ids.guest);
    // The single heart also takes a candidate out of "set aside".
    await sl.pickShortlistCandidate({ sql }, owner, { candidateId: b, picked: true });
    expect(await marks()).toEqual({ fixture_a: "picked", fixture_b: "picked", fixture_c: "passed" });
    // Marking what is already marked changes nothing; clearing clears both kinds.
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a], choice: "picked" })).toMatchObject({ ok: true, changed: 0 });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, b, c], choice: "none" })).toMatchObject({ ok: true, changed: 3 });
    expect(await marks()).toEqual({ fixture_a: "none", fixture_b: "none", fixture_c: "none" });
    // The studio sees the brand's marks; the figures' refresh date does not move.
    await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [c], choice: "passed" });
    expect((await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates.find(x => x.handle === "fixture_c")).toMatchObject({ passed: true, picked: false, state: "shared" });
  });

  it("lets only commenting seats sort, and only shared candidates of one campaign", async () => {
    for (const who of [reader, orgViewer]) expect(await sl.chooseShortlistCandidates({ sql }, who, { candidateIds: [a], choice: "passed" })).toEqual({ ok: false, code: "forbidden" });
    expect(await sl.chooseShortlistCandidates({ sql }, outsider, { candidateIds: [a], choice: "passed" })).toEqual({ ok: false, code: "not_found" });
    // One hidden or unknown ID and nothing changes.
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, hidden], choice: "picked" })).toEqual({ ok: false, code: "not_found" });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, randomUUID()], choice: "picked" })).toEqual({ ok: false, code: "not_found" });
    expect(await marks()).toEqual({ fixture_a: "none", fixture_b: "none", fixture_c: "none" });
    // Candidates of two campaigns never move together.
    const other = idOf(await s.createStudioProject({ sql }, studio, { organizationId: orgId, title: "Other campaign", objective: "Find creators", budgetKrw: null, productionMode: "creator", requestId: randomUUID() }));
    await sl.importShortlist({ sql, storage }, { kind: "studio", viewer: studio }, { projectId: other, candidates: [candidate("fixture_other", 10)] });
    const elsewhere = String((await sql.query("select id from brand_shortlist_candidates where project_id=$1", [other])).rows[0]!.id);
    await sl.setShortlistShared({ sql }, studio, { projectId: other, shared: true });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, elsewhere], choice: "picked" })).toEqual({ ok: false, code: "not_found" });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [], choice: "picked" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a, a], choice: "picked" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await sl.chooseShortlistCandidates({ sql }, owner, { candidateIds: [a], choice: "booked" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("campaigns that share every new candidate", () => {
  it("shares new candidates on import when asked, and leaves the studio's later decisions alone", async () => {
    expect(await studioImport([candidate("fixture_new", 10)], { shareNew: true })).toMatchObject({ ok: true, added: 1 });
    expect(await shared(owner)).toEqual(["fixture_new"]);
    // A candidate the studio hid or excluded stays that way when the next import refreshes it.
    expect(await sl.setShortlistShared({ sql }, studio, { projectId, candidateId: await candidateId("fixture_new"), shared: false })).toMatchObject({ ok: true, changed: 1 });
    expect(await studioImport([candidate("fixture_new", 11)], { shareNew: true })).toMatchObject({ ok: true, updated: 1 });
    expect(await shared(owner)).toEqual([]);
    // Without the flag a new candidate waits, as it always has.
    await studioImport([candidate("fixture_other", 20)]);
    expect(await shared(owner)).toEqual([]);
    expect(await studioImport([candidate("fixture_other", 20)], { shareNew: "yes" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("confirmed bookings", () => {
  const booked = async (handle: string) => (await sl.loadStudioShortlist({ sql }, studio, projectId))!.candidates.find(x => x.handle === handle)!.confirmed;

  it("takes the booking from the import, keeps it when the field is absent, and takes it back", async () => {
    await studioImport([candidate("fixture_booked", 10, { confirmed: true }), candidate("fixture_open", 20, { confirmed: false })]);
    expect(await booked("fixture_booked")).toBe(true);
    expect(await booked("fixture_open")).toBe(false);
    await shareAll();
    expect((await sl.loadBrandShortlist({ sql }, owner, projectId))!.candidates.map(x => [x.handle, x.confirmed])).toEqual([["fixture_open", false], ["fixture_booked", true]]);
    const first = (await sql.query("select confirmed_at from brand_shortlist_candidates where handle='fixture_booked'")).rows[0]!.confirmed_at;
    await studioImport([candidate("fixture_booked", 11)]);
    await studioImport([candidate("fixture_booked", 12, { confirmed: true })]);
    expect((await sql.query("select confirmed_at from brand_shortlist_candidates where handle='fixture_booked'")).rows[0]!.confirmed_at).toEqual(first);
    await studioImport([candidate("fixture_booked", 13, { confirmed: false })]);
    expect(await booked("fixture_booked")).toBe(false);
    expect(await studioImport([candidate("fixture_booked", 13, { confirmed: "yes" })])).toMatchObject({ ok: false, code: "invalid" });
  });

  it("shares a candidate when the booking arrives, and everyone else still waits for the studio", async () => {
    await studioImport([candidate("fixture_booked", 10, { confirmed: true }), candidate("fixture_open", 20, { confirmed: false }), candidate("fixture_plain", 30)]);
    expect(await shared(owner)).toEqual(["fixture_booked"]);
    await studioImport([candidate("fixture_open", 21, { confirmed: true })]);
    expect(await shared(owner)).toEqual(["fixture_open", "fixture_booked"]);
    // Taking the booking back drops the mark, not the card.
    await studioImport([candidate("fixture_open", 22, { confirmed: false })]);
    expect(await shared(owner)).toEqual(["fixture_open", "fixture_booked"]);
    expect(await booked("fixture_open")).toBe(false);
  });

  it("leaves the studio's decision alone: an excluded candidate stays out, a hidden one stays hidden on refresh", async () => {
    await studioImport([candidate("fixture_out", 10), candidate("fixture_hidden", 20, { confirmed: true })]);
    expect(await sl.triageShortlist({ sql }, studio, { projectId, exclude: [await candidateId("fixture_out")] })).toMatchObject({ ok: true });
    await studioImport([candidate("fixture_out", 11, { confirmed: true })]);
    expect(await booked("fixture_out")).toBe(true);
    expect(await sl.setShortlistShared({ sql }, studio, { projectId, candidateId: await candidateId("fixture_hidden"), shared: false })).toMatchObject({ ok: true, changed: 1 });
    await studioImport([candidate("fixture_hidden", 21, { confirmed: true })]);
    expect(await shared(owner)).toEqual([]);
  });
});
