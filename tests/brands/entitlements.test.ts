import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import { ADMIN_VIEWER, adminHarness, expectOk, type AdminHarness } from '@/tests/helpers/admin';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioOrganization, createStudioProject, loadBrandWorkspaceScope } from '@/lib/brands/workspace/service';
import { sectionVisibility, switchHref } from '@/lib/brands/workspace/selection';
import {
  BRAND_FEATURES, BrandFeatureDenied, assertBrandFeature, featureDenied, loadFeaturePolicies, loadFeaturePolicy, normalizeDenied, setFeaturePolicy,
} from '@/lib/brands/entitlements';
import { BRAND_PLANS, loadPlanAssignment, planActiveOn, setPlanAssignment } from '@/lib/brands/plans';
import { createProductionContract, createProductionTemplate, reserveProduction } from '@/lib/brands/production/service';
import { insertRenderJob } from '@/lib/renders/repo';

/**
 * docs/BRAND-PRODUCT.md §4 — "open to everyone, with named exceptions" (founder, 2026-11-03).
 *
 * The policy is a per-organization deny-list that only the studio writes. These tests pin the three
 * doors it closes (sidebar, studio page via `sectionVisibility`, the render reservation) and the
 * plan record that sits beside it. A new generative, sound or grading entry point gets its own
 * assertion here the day it ships.
 */
const adminId = randomUUID(), ownerId = randomUUID(), outsiderId = randomUUID();
const viewer = (userId: string, isAdmin = false): Viewer => ({ userId, isAdmin, tier: isAdmin ? 'admin' : 'free', email: `${userId}@example.test`, locale: 'ko' });
const admin = viewer(adminId, true), owner = viewer(ownerId), outsider = viewer(outsiderId);
let db: PGlite, sql: SqlRunner, orgId: string;
const idOf = (r: { ok: boolean; id?: string; code?: string }) => {
  if (!r.ok || !r.id) throw Error(r.code);
  return r.id;
};

beforeEach(async () => {
  db = await freshDb();
  sql = runner(db);
  for (const id of [adminId, ownerId, outsiderId]) await seedProfile(sql, { id, isAdmin: id === adminId, email: `${id}@example.test` });
  orgId = idOf(await createStudioOrganization({ sql }, admin, { name: 'Policy fixture', requestId: randomUUID() }));
  await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'owner')", [orgId, ownerId]);
});
afterEach(async () => {
  await db?.close();
});

describe('feature catalogue', () => {
  it('normalizes to known features in catalogue order', () => {
    expect(BRAND_FEATURES).toHaveLength(8);
    expect(normalizeDenied(['sound', 'self_studio', 'generative_media', 'sound', 'bogus', 42])).toEqual(['generative_media', 'self_studio', 'sound']);
    expect(featureDenied(undefined, 'sound')).toBe(false);
    expect(featureDenied([], 'sound')).toBe(false);
    expect(featureDenied(['sound'], 'sound')).toBe(true);
    expect(featureDenied(['self_studio'], 'self_studio')).toBe(true);
  });
});

describe('the sandboxed client is recognised by name as well as by id', () => {
  it('refuses the sandbox features through the server gate for a same-named organization with a new id', async () => {
    const twin = idOf(await createStudioOrganization({ sql }, admin, { name: 'Morphic Studios Korea', requestId: randomUUID() }));
    const denied = Object.values(await loadFeaturePolicies(sql, [twin]))[0] ?? [];
    expect(denied).toContain('generative_media');
    expect((await loadFeaturePolicy(sql, twin)).denied).toEqual(denied);
    for (const feature of denied) await expect(assertBrandFeature(sql, twin, feature)).rejects.toBeInstanceOf(BrandFeatureDenied);
    // An ordinary organization is still open.
    await expect(assertBrandFeature(sql, orgId, 'generative_media')).resolves.toBeUndefined();
    expect(await loadFeaturePolicies(sql, [orgId])).toEqual({});
  });
});

describe('feature policy: a deny-list, open by default', () => {
  it('has no exceptions until the studio writes one', async () => {
    expect(await loadFeaturePolicies(sql, [orgId])).toEqual({});
    expect(await loadFeaturePolicy(sql, orgId)).toMatchObject({ organizationId: orgId, denied: [], note: '', revision: 0 });
    await expect(assertBrandFeature(sql, orgId, 'generative_media')).resolves.toBeUndefined();
  });

  it('is written by administrators only, refuses unknown features and stale revisions, and keeps history', async () => {
    expect(await setFeaturePolicy({ sql }, owner, { organizationId: orgId, denied: ['sound'], expectedRevision: 0 })).toMatchObject({ ok: false, code: 'forbidden' });
    // The viewer's own flag is not trusted; the profile row decides.
    expect(await setFeaturePolicy({ sql }, { ...outsider, isAdmin: true }, { organizationId: orgId, denied: ['sound'], expectedRevision: 0 })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: ['bogus'], expectedRevision: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setFeaturePolicy({ sql }, admin, { organizationId: randomUUID(), denied: [], expectedRevision: 0 })).toMatchObject({ ok: false, code: 'not_found' });
    expect(
      await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: ['sound', 'generative_media', 'color_grading'], note: 'customer and competitor', expectedRevision: 0 }),
    ).toEqual({ ok: true, id: orgId, revision: 1 });
    expect(await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: [], expectedRevision: 0 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await loadFeaturePolicy(sql, orgId)).toMatchObject({ denied: ['generative_media', 'sound', 'color_grading'], note: 'customer and competitor', revision: 1 });
    expect(await loadFeaturePolicies(sql, [orgId, randomUUID()])).toEqual({ [orgId]: ['generative_media', 'sound', 'color_grading'] });
    await expect(assertBrandFeature(sql, orgId, 'sound')).rejects.toBeInstanceOf(BrandFeatureDenied);
    await expect(assertBrandFeature(sql, orgId, 'campaigns')).resolves.toBeUndefined();
    expect(await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: [], expectedRevision: 1 })).toEqual({ ok: true, id: orgId, revision: 2 });
    expect((await loadFeaturePolicy(sql, orgId)).denied).toEqual([]);
    expect((await sql.query('select denied_features from brand_feature_policy_events where organization_id=$1 order by created_at', [orgId])).rows).toHaveLength(2);
  });

  it('closes the studio door in the sidebar for the denied brand only', async () => {
    const other = idOf(await createStudioOrganization({ sql }, admin, { name: 'Open fixture', requestId: randomUUID() }));
    await sql.query("insert into brand_memberships(organization_id,user_id,role) values($1,$2,'editor')", [other, ownerId]);
    await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: ['generative_media'], expectedRevision: 0 });
    const scope = await loadBrandWorkspaceScope({ sql }, owner);
    const denied = scope.choices.find((c) => c.id === orgId)!;
    const open = scope.choices.find((c) => c.id === other)!;
    expect(denied.denied).toEqual(['generative_media']);
    expect(open.denied).toBeUndefined();
    expect(sectionVisibility(denied)).toMatchObject({ studio: false, identity: false, settings: true });
    expect(sectionVisibility(open)).toMatchObject({ studio: true, identity: true });
    expect(switchHref('/brand/studio', denied)).toBe(`/brand?organizationId=${orgId}`);
    expect(switchHref('/brand/identity', denied)).toBe(`/brand?organizationId=${orgId}`);
    // The TWINGS team browsing the brand sees the same closed door.
    const staff = await loadBrandWorkspaceScope({ sql }, admin);
    expect(sectionVisibility(staff.choices.find((c) => c.id === orgId)!).studio).toBe(false);
    expect(sectionVisibility(staff.choices.find((c) => c.id === orgId)!).identity).toBe(false);
  });

  it('refuses to start a brand render for a denied brand, like a missing template', async () => {
    const now = new Date('2026-11-03T00:00:00Z');
    const projectId = idOf(
      await createStudioProject({ sql }, admin, { organizationId: orgId, title: 'Fixture', objective: 'Private creation', productionMode: 'studio', budgetKrw: null, requestId: randomUUID() }),
    );
    const contractId = idOf(
      await createProductionContract({ sql, now }, admin, {
        organizationId: orgId, projectId, title: 'Signed scope', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', limit: 2, requestId: randomUUID(),
      }),
    );
    const templateId = idOf(
      await createProductionTemplate({ sql, now }, admin, {
        contractId, title: 'Private template', titleKo: '비공개 템플릿', promptText: 'Use the identity reference for a studio film.', seconds: 5, aspect: '9:16', requestId: randomUUID(),
      }),
    );
    const reserve = () =>
      reserveProduction({ sql, now }, owner, { contractId, templateId, requestId: randomUUID(), fingerprint: 'fixture' }, async (tx, prompt) => {
        const id = randomUUID();
        await insertRenderJob(tx, {
          id, userId: ownerId, templateId: prompt.id, templateSlug: prompt.slug, medium: 'video', engine: 'seedance-2.5', aspect: '9:16', locale: 'ko',
          inputKey: `${id}/input.png`, inputMime: 'image/png', status: 'queued',
        });
        return { ok: true as const, id, held: false };
      });
    expect(await reserve()).toMatchObject({ ok: true });
    await setFeaturePolicy({ sql }, admin, { organizationId: orgId, denied: ['generative_media'], expectedRevision: 0 });
    expect(await reserve()).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(Number((await sql.query<{ n: number }>('select count(*)::int as n from brand_production_reservations where contract_id=$1', [contractId])).rows[0]!.n)).toBe(1);
  });
});

describe('plan assignment', () => {
  it('records the plan as a calendar day, administrators only, with the revision rule', async () => {
    expect(await loadPlanAssignment(sql, orgId)).toBeNull();
    expect(await setPlanAssignment({ sql }, owner, { organizationId: orgId, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_12', startedOn: '2026-11-01', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_39', startedOn: '2026-11-01', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_49', startedOn: '2026-11-31', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'invalid', field: 'startedOn' });
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_49', startedOn: '2026-11-01', endsOn: '2026-10-01', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'invalid', field: 'endsOn' });
    expect(BRAND_PLANS.b2b_29.monthlyKrw).toBe(290_000);
    expect(BRAND_PLANS.b2b_49.monthlyKrw).toBe(490_000);
    expect(BRAND_PLANS.b2b_69.monthlyKrw).toBe(690_000);
    expect(
      await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-01', seats: 5, note: 'annual', expectedRevision: 0 }),
    ).toEqual({ ok: true, id: orgId, revision: 1 });
    const plan = await loadPlanAssignment(sql, orgId);
    expect(plan).toMatchObject({ planId: 'b2b_49', billingMode: 'invoice', startedOn: '2026-11-01', endsOn: null, seats: 5, note: 'annual', revision: 1 });
    expect(BRAND_PLANS[plan!.planId].monthlyKrw).toBe(490_000);
    expect(planActiveOn(plan, '2026-11-03')).toBe(true);
    expect(planActiveOn(plan, '2026-10-31')).toBe(false);
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-12-01', endsOn: '2027-12-01', expectedRevision: 0 })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-12-01', endsOn: '2027-12-01', expectedRevision: 1 })).toEqual({ ok: true, id: orgId, revision: 2 });
    expect(planActiveOn(await loadPlanAssignment(sql, orgId), '2027-12-01')).toBe(false);
    expect(await setPlanAssignment({ sql }, admin, { organizationId: orgId, planId: 'project_only', startedOn: '2026-11-01', expectedRevision: 2 })).toEqual({ ok: true, id: orgId, revision: 3 });
    expect(BRAND_PLANS.project_only.monthlyKrw).toBe(0);
    await expect(assertBrandFeature(sql, orgId, 'generative_media')).resolves.toBeUndefined();
    await expect(assertBrandFeature(sql, orgId, 'self_studio')).rejects.toMatchObject({ code: 'feature_unavailable', feature: 'self_studio' });
    expect((await sql.query<{ plan_id: string }>('select plan_id from brand_plan_events where organization_id=$1 order by created_at', [orgId])).rows.map((r) => r.plan_id)).toEqual(['b2b_49', 'b2b_69', 'project_only']);
  });
});

describe('admin registry', () => {
  let harness: AdminHarness;
  beforeEach(async () => {
    harness = await adminHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('saves the policy and the plan through /admin/do and returns to the organization page', async () => {
    const hsql = runner(harness.db);
    await seedProfile(hsql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
    const org = idOf(await createStudioOrganization({ sql: hsql }, ADMIN_VIEWER, { name: 'Registry fixture', requestId: randomUUID() }));
    const saved = expectOk(await harness.run('brandEngine.featurePolicy', { organizationId: org, expectedRevision: 0, denied: ['generative_media', 'sound', 'color_grading'], note: 'deny-list' }));
    expect(saved.to).toBe(`/admin/brand-workspace/organizations/${org}`);
    expect((await loadFeaturePolicy(hsql, org)).denied).toEqual(['generative_media', 'sound', 'color_grading']);
    // An empty list is a valid save ("open everything"); a stale revision is not.
    expect(await harness.run('brandEngine.featurePolicy', { organizationId: org, expectedRevision: 0, denied: [] })).toMatchObject({ ok: false, code: 'brandConflict' });
    expectOk(await harness.run('brandEngine.featurePolicy', { organizationId: org, expectedRevision: 1 }));
    expect((await loadFeaturePolicy(hsql, org)).denied).toEqual([]);
    expect(await harness.run('brandEngine.featurePolicy', { organizationId: org, expectedRevision: 'x' })).toMatchObject({ ok: false, code: 'invalid' });
    expectOk(await harness.run('brandEngine.plan', { organizationId: org, expectedRevision: 0, planId: 'b2b_29', billingMode: 'card', startedOn: '2026-11-03', endsOn: '', seats: '', note: '' }));
    expect(await loadPlanAssignment(hsql, org)).toMatchObject({ planId: 'b2b_29', billingMode: 'card', startedOn: '2026-11-03', endsOn: null, seats: null });
    expect(await harness.run('brandEngine.plan', { organizationId: org, expectedRevision: 1, planId: 'b2b_29', startedOn: '2026-11-03', seats: 'many' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});
