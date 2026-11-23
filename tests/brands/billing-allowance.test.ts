import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { BrandStudioAllowancePanel } from '@/lib/admin/brand-studio-allowance-panel';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadAllowance, loadAllowanceRow, reserveAllowance, setStudioAllowance } from '@/lib/brand-studio/usage';
import {
  grantExtraAllowance,
  listExtraAllowanceGrants,
  loadPlanAllowanceDefaults,
  revokeExtraAllowance,
  setPlanAllowanceDefault,
  setPlanAndAllowance,
} from '@/lib/brands/billing';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createBrandOrganization, createStudioOrganization } from '@/lib/brands/workspace/service';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ko } from '@/messages/ko';
import { ADMIN_VIEWER, adminHarness, expectOk } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
  usePathname: () => '/admin/brand-workspace/organizations/test',
  useSearchParams: () => new URLSearchParams(),
}));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = (): Viewer => viewerOf(f.ids.owner);

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  deps = studioDeps(f.sql);
});

afterEach(async () => {
  await f.db.close();
});

describe('allowance precedence, grace window & extra credits', () => {
  it('follows override > active plan default > env default, then adds unexpired extra credits', async () => {
    const now = new Date('2026-11-15T03:00:00Z'); // 2026-11-15 12:00 KST
    // 1. Nothing configured -> env default (0 -> allowance_closed)
    expect(await loadAllowance(f.sql, f.orgId, deps.env, now)).toMatchObject({
      capKrw: 0,
      baseCapKrw: 0,
      extraKrw: 0,
      source: 'default',
    });
    expect(await loadAllowance(f.sql, f.orgId, { defaultMonthlyKrw: 25_000 }, now)).toMatchObject({
      capKrw: 25_000,
      baseCapKrw: 25_000,
      extraKrw: 0,
      source: 'default',
    });

    // 2. Assign plan b2b_49, but no plan default set yet -> falls through to env default
    expect(
      await setPlanAssignment({ sql: f.sql }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_49',
        billingMode: 'invoice',
        startedOn: '2026-11-01',
        endsOn: null,
        expectedRevision: 0,
      }),
    ).toMatchObject({ ok: true });
    expect(await loadAllowance(f.sql, f.orgId, { defaultMonthlyKrw: 12_000 }, now)).toMatchObject({
      capKrw: 12_000,
      baseCapKrw: 12_000,
      extraKrw: 0,
      source: 'default',
    });

    // 3. Configure plan default (S3 two-step preview -> confirm: true) -> now resolves from plan default!
    const previewOnly = await setPlanAllowanceDefault({ sql: f.sql, now: () => now }, admin(), {
      planId: 'b2b_49',
      monthlyCapKrw: 180_000,
      note: 'b2b_49 launch allowance',
    });
    expect(previewOnly).toMatchObject({
      ok: true,
      applied: false,
      affectedCount: 1,
    });
    expect(await loadPlanAllowanceDefaults(f.sql)).toHaveLength(0);

    expect(
      await setPlanAllowanceDefault({ sql: f.sql, now: () => now }, admin(), {
        planId: 'b2b_49',
        monthlyCapKrw: 180_000,
        note: 'b2b_49 launch allowance',
        confirm: true,
      }),
    ).toMatchObject({ ok: true, applied: true, affectedCount: 1 });
    expect(await loadPlanAllowanceDefaults(f.sql)).toHaveLength(1);
    expect(await loadAllowance(f.sql, f.orgId, { defaultMonthlyKrw: 12_000 }, now)).toMatchObject({
      capKrw: 180_000,
      baseCapKrw: 180_000,
      extraKrw: 0,
      source: 'plan',
    });

    // 4. Add explicit override -> wins over plan default
    expect(
      await setStudioAllowance({ sql: f.sql }, admin(), {
        organizationId: f.orgId,
        monthlyCapKrw: 90_000,
        preferredLane: null,
        note: 'custom cap',
      }),
    ).toMatchObject({ ok: true });
    expect(await loadAllowance(f.sql, f.orgId, deps.env, now)).toMatchObject({
      capKrw: 90_000,
      baseCapKrw: 90_000,
      extraKrw: 0,
      source: 'override',
    });

    // 5. Combined operation switches back to follow plan default while updating plan
    expect(
      await setPlanAndAllowance({ sql: f.sql }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_69',
        billingMode: 'invoice',
        startedOn: '2026-11-01',
        endsOn: '2026-11-20',
        expectedRevision: 1,
        allowanceMode: 'plan_default',
        preferredLane: 'sunra_mcp',
        allowanceNote: 'follow b2b_69 default',
      }),
    ).toEqual({ ok: true, id: f.orgId, revision: 2 });
    await setPlanAllowanceDefault({ sql: f.sql, now: () => now }, admin(), { planId: 'b2b_69', monthlyCapKrw: 300_000, confirm: true });
    expect(await loadAllowance(f.sql, f.orgId, deps.env, now)).toMatchObject({
      capKrw: 300_000,
      baseCapKrw: 300_000,
      extraKrw: 0,
      source: 'plan',
      preferredLane: 'sunra_mcp',
    });
    // S2 rollback snapshot: monthly_cap_krw stores 300_000 while is_override stays false
    expect(await loadAllowanceRow(f.sql, f.orgId)).toMatchObject({
      monthlyCapKrw: 300_000,
      isOverride: false,
      preferredLane: 'sunra_mcp',
    });

    // 6. Grace period: endsOn = 2026-11-20, grace = 7 -> active on 2026-11-27, closed on 2026-11-28
    expect(await loadAllowance(f.sql, f.orgId, deps.env, new Date('2026-11-27T03:00:00Z'))).toMatchObject({
      capKrw: 300_000,
      source: 'plan',
    });
    expect(await loadAllowance(f.sql, f.orgId, deps.env, new Date('2026-11-28T03:00:00Z'))).toMatchObject({
      capKrw: 0,
      baseCapKrw: 0,
      source: 'default',
    });

    // 7. S1 One-off extra credits: valid_month only (current or next KST month), never multi-month, never counts in another month
    expect(
      await grantExtraAllowance({ sql: f.sql, now: () => now }, admin(), {
        organizationId: f.orgId,
        amountKrw: 40_000,
        expiresOn: '2026-12-31',
        reason: 'unsupported expiresOn',
      }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      await grantExtraAllowance({ sql: f.sql, now: () => now }, admin(), {
        organizationId: f.orgId,
        amountKrw: 40_000,
        validMonth: '2026-10',
        reason: 'past month rejected',
      }),
    ).toMatchObject({ ok: false, code: 'invalid' });
    expect(
      await grantExtraAllowance({ sql: f.sql, now: () => now }, admin(), {
        organizationId: f.orgId,
        amountKrw: 40_000,
        validMonth: '2027-01',
        reason: '2+ months ahead rejected',
      }),
    ).toMatchObject({ ok: false, code: 'invalid' });

    const monthGrant = await grantExtraAllowance({ sql: f.sql, now: () => now }, admin(), {
      organizationId: f.orgId,
      amountKrw: 40_000,
      validMonth: '2026-11',
      reason: 'launch bonus',
    });
    expect(monthGrant.ok).toBe(true);
    const nextMonthGrant = await grantExtraAllowance({ sql: f.sql, now: () => now }, admin(), {
      organizationId: f.orgId,
      amountKrw: 25_000,
      validMonth: '2026-12',
      reason: 'next month bonus',
    });
    expect(nextMonthGrant.ok).toBe(true);

    // On 2026-11-15: ONLY November grant (40_000) applies: 300_000 + 40_000 = 340_000
    expect(await loadAllowance(f.sql, f.orgId, deps.env, now)).toMatchObject({
      capKrw: 340_000,
      baseCapKrw: 300_000,
      extraKrw: 40_000,
      source: 'plan',
    });
    // On 2026-12-01 (after plan grace ended AND inside December): November grant is GONE, only December grant (25_000) applies
    expect(await loadAllowance(f.sql, f.orgId, deps.env, new Date('2026-12-01T03:00:00Z'))).toMatchObject({
      capKrw: 25_000,
      baseCapKrw: 0,
      extraKrw: 25_000,
      source: 'default',
    });
    // On 2027-01-01: neither grant applies -> 0
    expect(await loadAllowance(f.sql, f.orgId, deps.env, new Date('2027-01-01T03:00:00Z'))).toMatchObject({
      capKrw: 0,
      baseCapKrw: 0,
      extraKrw: 0,
      source: 'default',
    });

    // Revoke monthGrant -> immediately drops from 340_000 to 300_000 on 2026-11-15
    if (monthGrant.ok) {
      expect(await revokeExtraAllowance({ sql: f.sql }, admin(), { grantId: monthGrant.id })).toMatchObject({ ok: true });
      expect(await revokeExtraAllowance({ sql: f.sql }, admin(), { grantId: monthGrant.id })).toMatchObject({ ok: false, code: 'conflict' });
    }
    expect(await loadAllowance(f.sql, f.orgId, deps.env, now)).toMatchObject({
      capKrw: 300_000,
      baseCapKrw: 300_000,
      extraKrw: 0,
    });
    const list = await listExtraAllowanceGrants(f.sql, f.orgId, now);
    expect(list).toHaveLength(2);
    expect(list.filter((g) => g.activeNow)).toHaveLength(0);
  });

  it('reserveAllowance honors extra credits on an otherwise 0-base org and blocks once exhausted', async () => {
    const grant = await grantExtraAllowance({ sql: f.sql, now: () => new Date('2026-11-15T03:00:00Z') }, admin(), {
      organizationId: f.orgId,
      amountKrw: 150,
      validMonth: '2026-11',
      reason: 'one-off test budget',
    });
    expect(grant.ok).toBe(true);
    const fixedDeps = studioDeps(f.sql, { now: () => new Date('2026-11-15T03:00:00Z') });
    // Seedream 1 image costs usageKrw(0.04, 'image') = 70 KRW -> 2 runs fit (140 <= 150), 3rd fails (210 > 150)
    const j1 = await createStudioJob(fixedDeps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'bottle one',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    const j2 = await createStudioJob(fixedDeps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'bottle two',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    const j3 = await createStudioJob(fixedDeps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'bottle three',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(j1.ok).toBe(true);
    expect(j2.ok).toBe(true);
    expect(j3).toEqual({ ok: false, code: 'allowance_exhausted' });
  });
});

describe('migration safety & deploy-order resilience', () => {
  it('marks existing brand_studio_allowances rows as is_override=true after 0176 and leaves caps unchanged', async () => {
    const db = new PGlite();
    await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
    for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0176_'))) {
      await db.exec(readMigration(file));
    }
    const sql: SqlRunner = runner(db);
    const adminId = randomUUID();
    const ownerId = randomUUID();
    await seedProfile(sql, { id: adminId, isAdmin: true, email: 'a@test.invalid' });
    await seedProfile(sql, { id: ownerId, isAdmin: false, email: 'o@test.invalid' });
    const org = await createStudioOrganization({ sql }, { userId: adminId, isAdmin: true, tier: 'admin', email: 'a@test.invalid', locale: 'ko' }, { name: 'Pre-0176 Org', requestId: randomUUID() });
    if (!org.ok) throw new Error(org.code);

    // Pre-0176: insert allowance row and confirm pre-0176 deploy-order safety inside & outside tx
    await sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 250000)', [org.id]);
    const preAllowance = await sql.transaction((tx) => reserveAllowance(tx, org.id, 1000, studioEnv({ BRAND_STUDIO_PROVIDER: 'fake' })));
    expect(preAllowance.ok).toBe(true);
    if (preAllowance.ok) {
      expect(preAllowance.allowance).toMatchObject({ capKrw: 250_000, baseCapKrw: 250_000, extraKrw: 0, source: 'override' });
    }
    expect(await loadAllowanceRow(sql, org.id)).toMatchObject({ monthlyCapKrw: 250_000, isOverride: true });

    // Apply 0176 now!
    await db.exec(readMigration('0176_core_brand_billing.sql'));
    const row = await loadAllowanceRow(sql, org.id);
    expect(row).toMatchObject({ monthlyCapKrw: 250_000, isOverride: true });

    // Even when a plan default differs, existing org retains its 250,000 override unchanged!
    const adm: Viewer = { userId: adminId, isAdmin: true, tier: 'admin', email: 'a@test.invalid', locale: 'ko' };
    await setPlanAssignment({ sql }, adm, { organizationId: org.id, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 });
    await setPlanAllowanceDefault({ sql }, adm, { planId: 'b2b_29', monthlyCapKrw: 50_000, confirm: true });
    expect(await loadAllowance(sql, org.id, { defaultMonthlyKrw: 0 })).toMatchObject({
      capKrw: 250_000,
      baseCapKrw: 250_000,
      source: 'override',
    });

    await db.close();
  });

  it('S2: existing allowance panel preserves plan_default mode on lane-only edit, shows plan cap, and explicitly switches on cap edit', async () => {
    const h = await adminHarness();
    try {
      const hsql = runner(h.db);
      await seedProfile(hsql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const created = await createStudioOrganization({ sql: hsql }, ADMIN_VIEWER, { name: 'Panel Test Org', requestId: randomUUID() });
      if (!created.ok) throw new Error(created.code);

      expectOk(await h.run('brandBilling.planDefault.set', { planId: 'b2b_49', monthlyCapKrw: '220000', confirm: 'true' }));
      expectOk(
        await h.run('brandBilling.planAndAllowance.set', {
          organizationId: created.id,
          planId: 'b2b_49',
          billingMode: 'invoice',
          startedOn: '2026-11-01',
          expectedRevision: 0,
          allowanceMode: 'plan_default',
        }),
      );

      // Snapshot in monthly_cap_krw matches 220_000 while is_override is false!
      expect(await loadAllowanceRow(hsql, created.id)).toMatchObject({ monthlyCapKrw: 220_000, isOverride: false });

      const html = renderToStaticMarkup(
        await BrandStudioAllowancePanel({ sql: hsql, organizationId: created.id, b: ko.brandWorkspace, locale: 'ko' }),
      );
      expect(html).toContain('플랜 기본값을 따름 (220,000원)');
      expect(html).toContain('value="220000"');
      expect(html).toContain('덮어쓰기');

      // R2-(2): Lane-only edit WITHOUT hidden currentMode/baselineCapKrw, OR even with forged override hints,
      // reads DB mode/cap inside tx and preserves is_override=false!
      expectOk(
        await h.run('brand_studio.allowance.set', {
          organizationId: created.id,
          monthlyCapKrw: '220000',
          currentMode: 'override',
          baselineCapKrw: '0',
          preferredLane: 'sunra_mcp',
          note: 'use workstation lane',
        }),
      );
      expect(await loadAllowanceRow(hsql, created.id)).toMatchObject({
        monthlyCapKrw: 220_000,
        isOverride: false,
        preferredLane: 'sunra_mcp',
      });
      expect(await loadAllowance(hsql, created.id, studioEnv())).toMatchObject({
        capKrw: 220_000,
        source: 'plan',
        preferredLane: 'sunra_mcp',
      });

      // Changing the cap explicitly switches to override=true
      expectOk(
        await h.run('brand_studio.allowance.set', {
          organizationId: created.id,
          monthlyCapKrw: '350000',
          preferredLane: 'sunra_mcp',
          note: 'override cap',
        }),
      );
      expect(await loadAllowanceRow(hsql, created.id)).toMatchObject({ monthlyCapKrw: 350_000, isOverride: true });
      expect(await loadAllowance(hsql, created.id, studioEnv())).toMatchObject({ capKrw: 350_000, source: 'override' });
    } finally {
      await h.close();
    }
  });

  it('S3: restricts plan defaults to paid plans, previews blast radius safely, and records audit count on confirm', async () => {
    expect(await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'project_only', monthlyCapKrw: 50_000 })).toMatchObject({
      ok: false,
      code: 'invalid',
    });

    const p2OwnerId = randomUUID();
    await seedProfile(f.sql, { id: p2OwnerId, email: 'p2@example.test' });
    const p2Owner: Viewer = { userId: p2OwnerId, isAdmin: false, tier: 'free', email: 'p2@example.test', locale: 'ko' };
    const org2 = await createBrandOrganization({ sql: f.sql }, p2Owner, { name: 'Beta Agency', requestId: randomUUID() });
    const org3 = await createBrandOrganization({ sql: f.sql }, p2Owner, { name: 'Override Corp', requestId: randomUUID() });
    if (!org2.ok || !org3.ok) throw new Error('org create failed');

    await setPlanAssignment({ sql: f.sql }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 });
    await setPlanAssignment({ sql: f.sql }, admin(), { organizationId: org2.id, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 });
    await setPlanAssignment({ sql: f.sql }, admin(), { organizationId: org3.id, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 });
    await setStudioAllowance({ sql: f.sql }, admin(), { organizationId: org3.id, monthlyCapKrw: 999_000, preferredLane: null, note: 'vip override' });

    const preview = await setPlanAllowanceDefault({ sql: f.sql }, admin(), {
      planId: 'b2b_29',
      monthlyCapKrw: 120_000,
      note: 'launch default',
    });
    expect(preview).toMatchObject({
      ok: true,
      applied: false,
      affectedCount: 2,
    });
    if (preview.ok) {
      expect(preview.affectedOrganizations.map((o) => o.name).sort()).toEqual(['Beta Agency', 'Studio fixture brand']);
      expect(preview.affectedOrganizations.every((o) => o.beforeCapKrw === 0 && o.afterCapKrw === 120_000)).toBe(true);
    }
    expect(await loadPlanAllowanceDefaults(f.sql)).toHaveLength(0);

    const applied = await setPlanAllowanceDefault({ sql: f.sql }, admin(), {
      planId: 'b2b_29',
      monthlyCapKrw: 120_000,
      note: 'launch default',
      confirm: true,
    });
    expect(applied).toMatchObject({ ok: true, applied: true, affectedCount: 2 });

    const audit = (
      await f.sql.query<{ plan_id: string; monthly_cap_krw: number | null; affected_org_count: number; actor_id: string }>(
        'select plan_id, monthly_cap_krw, affected_org_count, actor_id from brand_plan_allowance_default_events',
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      plan_id: 'b2b_29',
      monthly_cap_krw: 120_000,
      affected_org_count: 2,
      actor_id: f.ids.admin,
    });

    // R2-(3): saving plan default ALSO created brand_studio_allowances(is_override=false, cap=120_000) for orgs that had NO row!
    expect(await loadAllowanceRow(f.sql, f.orgId)).toMatchObject({ monthlyCapKrw: 120_000, isOverride: false });
    expect(await loadAllowanceRow(f.sql, org2.id)).toMatchObject({ monthlyCapKrw: 120_000, isOverride: false });
    // Explicit override org keeps 999_000 untouched
    expect(await loadAllowanceRow(f.sql, org3.id)).toMatchObject({ monthlyCapKrw: 999_000, isOverride: true });

    // R2-(3): switching org's plan through OLD setPlanAssignment (e.g. to b2b_49 or ended) refreshes snapshot!
    await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_49', monthlyCapKrw: 240_000, confirm: true });
    expect(
      await setPlanAssignment({ sql: f.sql }, admin(), {
        organizationId: org2.id,
        planId: 'b2b_49',
        startedOn: '2026-11-01',
        expectedRevision: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(await loadAllowanceRow(f.sql, org2.id)).toMatchObject({ monthlyCapKrw: 240_000, isOverride: false });

    // Ending/switching to project_only through old setPlanAssignment refreshes snapshot down to 0
    expect(
      await setPlanAssignment({ sql: f.sql }, admin(), {
        organizationId: org2.id,
        planId: 'project_only',
        startedOn: '2026-11-01',
        expectedRevision: 2,
      }),
    ).toMatchObject({ ok: true });
    expect(await loadAllowanceRow(f.sql, org2.id)).toMatchObject({ monthlyCapKrw: 0, isOverride: false });
    // Explicit override org3 keeps 999_000 even when its plan changes
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: org3.id,
      planId: 'project_only',
      startedOn: '2026-11-01',
      expectedRevision: 1,
    });
    expect(await loadAllowanceRow(f.sql, org3.id)).toMatchObject({ monthlyCapKrw: 999_000, isOverride: true });
  });

  it('R2-(5): plan-default preview compares against the real effective env default (BRAND_STUDIO_DEFAULT_MONTHLY_KRW)', async () => {
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    vi.stubEnv('BRAND_STUDIO_DEFAULT_MONTHLY_KRW', '50000');
    try {
      // Gate gives 50,000 from env default; setting plan default = 50,000 changes 0 orgs!
      const sameAsEnv = await setPlanAllowanceDefault({ sql: f.sql }, admin(), {
        planId: 'b2b_29',
        monthlyCapKrw: 50_000,
      });
      expect(sameAsEnv).toMatchObject({ ok: true, applied: false, affectedCount: 0 });

      const raiseTo120 = await setPlanAllowanceDefault({ sql: f.sql }, admin(), {
        planId: 'b2b_29',
        monthlyCapKrw: 120_000,
      });
      expect(raiseTo120).toMatchObject({ ok: true, applied: false, affectedCount: 1 });
      if (raiseTo120.ok) {
        expect(raiseTo120.affectedOrganizations[0]).toMatchObject({ beforeCapKrw: 50_000, afterCapKrw: 120_000 });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('S4: caches positive schema probe per DB root and executes 2 queries on warm loadAllowance', async () => {
    await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_29', monthlyCapKrw: 100_000, confirm: true });
    await setPlanAssignment({ sql: f.sql }, admin(), { organizationId: f.orgId, planId: 'b2b_29', startedOn: '2026-11-01', expectedRevision: 0 });

    const spy = vi.spyOn(f.sql, 'query');
    const first = await loadAllowance(f.sql, f.orgId, deps.env);
    expect(first.capKrw).toBe(100_000);
    const coldCount = spy.mock.calls.length;
    expect(coldCount).toBeLessThanOrEqual(3);

    spy.mockClear();
    const second = await loadAllowance(f.sql, f.orgId, deps.env);
    expect(second.capKrw).toBe(100_000);
    expect(spy.mock.calls.length).toBe(2);

    spy.mockClear();
    const third = await loadAllowance(f.sql, f.orgId, deps.env);
    expect(third.capKrw).toBe(100_000);
    expect(spy.mock.calls.length).toBe(2);
    spy.mockRestore();
  });

  it('refuses non-admins (including forged isAdmin flag) on all admin billing allowance operations', async () => {
    const forgedOwner: Viewer = { ...owner(), isAdmin: true };
    expect(await setPlanAllowanceDefault({ sql: f.sql }, forgedOwner, { planId: 'b2b_29', monthlyCapKrw: 100_000, confirm: true })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(
      await setPlanAndAllowance({ sql: f.sql }, forgedOwner, {
        organizationId: f.orgId,
        planId: 'b2b_29',
        startedOn: '2026-11-01',
        expectedRevision: 0,
        allowanceMode: 'plan_default',
      }),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    expect(
      await grantExtraAllowance({ sql: f.sql }, forgedOwner, { organizationId: f.orgId, amountKrw: 1000, validMonth: '2026-11' }),
    ).toMatchObject({ ok: false, code: 'forbidden' });

    const h = await adminHarness();
    try {
      const hsql = runner(h.db);
      await seedProfile(hsql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const created = await createStudioOrganization({ sql: hsql }, ADMIN_VIEWER, { name: 'Admin Op Org', requestId: randomUUID() });
      if (!created.ok) throw new Error(created.code);

      const currentKstMonth = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
      expect(await h.run('brandBilling.planDefault.set', { planId: 'b2b_29', monthlyCapKrw: '120000', note: 'default' })).toMatchObject({
        ok: true,
        code: 'prepared',
      });
      expect(await loadPlanAllowanceDefaults(hsql)).toHaveLength(0);
      expectOk(await h.run('brandBilling.planDefault.set', { planId: 'b2b_29', monthlyCapKrw: '120000', note: 'default', confirm: 'true' }));
      expectOk(
        await h.run('brandBilling.planAndAllowance.set', {
          organizationId: created.id,
          planId: 'b2b_29',
          billingMode: 'invoice',
          startedOn: '2026-11-01',
          expectedRevision: 0,
          allowanceMode: 'plan_default',
        }),
      );
      const grantOut = expectOk(
        await h.run('brandBilling.grant.create', {
          organizationId: created.id,
          amountKrw: '30000',
          validMonth: currentKstMonth,
          reason: 'welcome',
        }),
      );
      expectOk(await h.run('brandBilling.grant.revoke', { grantId: grantOut.detail!, organizationId: created.id }));

      // Non-admin through /admin/do dispatcher is also blocked
      const nonAdmin: Viewer = { ...viewerOf(f.ids.owner), userId: f.ids.owner, isAdmin: false };
      expect(await h.run('brandBilling.planDefault.set', { planId: 'b2b_29', monthlyCapKrw: '1000' }, nonAdmin)).toMatchObject({
        ok: false,
        code: 'forbidden',
      });
    } finally {
      await h.close();
    }
  });
});
