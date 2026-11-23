import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { ADMIN_OPERATIONS } from '@/lib/admin/operations';
import type { Viewer } from '@/lib/auth/identity';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { grantExtraAllowance, listExtraAllowanceGrants, revokeExtraAllowance } from '@/lib/brands/billing/allowance';
import {
  approveWorkspace,
  carryTrialGrants,
  loadWorkspaceApproval,
  loadWorkspaceApprovalPanel,
  ROUTE_TRIAL_CARRY_BUDGET_MS,
} from '@/lib/brands/billing/workspace-approval';
import { isOrganizationUploadApproved } from '@/lib/brands/upload-gate';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { pre0184Db, recorder } from '@/tests/brands/helpers/workspace-approval-parity';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1b-1 §3/§5: explicit workspace approval with one-time trial credits (400 credits = 4,000 KRW, granted when an
 * admin approves, usable through the last day of the following KST month by one carry), behind
 * `BRAND_WORKSPACE_APPROVAL` (default off). §4: an organization on an allowance override keeps `source: 'override'`.
 */
const routeMocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));
const tickRoute = await import('@/app/api/brand-billing/tick/route');

const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };
const TRIAL_KRW = 4_000;

let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const at = (iso: string) => () => new Date(iso);

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  routeMocks.sql = f.sql;
  vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
  vi.stubEnv('BRAND_STUDIO_DEFAULT_MONTHLY_KRW', '0');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  vi.stubEnv('CRON_SECRET', 'cron-secret-test');
  // A workspace created after the upload cutoff, so the gate applies to it.
  await f.sql.query('update brand_organizations set created_at = $2 where id = $1', [f.orgId, '2026-11-25T00:00:00+09:00']);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await f.db.close();
});

async function newOrg(name: string): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id, created_at) values ($1, $2, $3, $4, $5)', [
    id,
    name,
    f.ids.owner,
    randomUUID(),
    '2026-11-25T00:00:00+09:00',
  ]);
  return id;
}

/** A finished studio run of `krw` usage created at `iso` (what `usedKrwIn` counts). */
async function used(orgId: string, krw: number, iso: string, status = 'succeeded'): Promise<void> {
  await f.sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', $4, 'seedream-5.5', 'p', $5, $5, $6, $6)`,
    [orgId, f.ids.owner, `use_${randomUUID().slice(0, 12)}`, status, krw, iso],
  );
}

async function trialRows(orgId: string) {
  return (
    await f.sql.query<{ id: string; amount_krw: number; valid_month: string; carried_from: string | null; revoked_at: unknown; created_by: string | null }>(
      "select id::text as id, amount_krw, valid_month, carried_from::text as carried_from, revoked_at, created_by::text as created_by from brand_allowance_grants where organization_id = $1 and kind = 'trial' order by valid_month, created_at",
      [orgId],
    )
  ).rows;
}

async function checkedAt(grantId: string): Promise<string | null> {
  const row = (await f.sql.query<{ at: Date | null }>('select trial_carry_checked_at as at from brand_allowance_grants where id = $1', [grantId])).rows[0];
  return row?.at ? new Date(row.at).toISOString() : null;
}

const approve = (iso: string, organizationId = f.orgId, note = '') =>
  approveWorkspace({ sql: f.sql, now: at(iso) }, admin(), { organizationId, note });
const carry = (iso: string, sql: SqlRunner = f.sql) => carryTrialGrants({ sql, now: at(iso), studio: STUDIO });

describe('approveWorkspace', () => {
  it('records the approval once and grants 400 trial credits (4,000 KRW) for the current KST month, linked; a second approve is a no-op', async () => {
    const first = await approve('2026-11-10T01:00:00Z', f.orgId, 'checked the business');
    expect(first).toMatchObject({
      ok: true,
      created: true,
      approval: { organizationId: f.orgId, approvedBy: f.ids.admin, approvedAt: '2026-11-10T01:00:00.000Z', note: 'checked the business' },
      trialGrant: { kind: 'trial', amountKrw: TRIAL_KRW, credits: 400, validMonth: '2026-11', carriedFrom: null, revokedAt: null },
    });
    if (!first.ok) throw new Error(first.code);
    expect(first.approval.trialGrantId).toBe(first.trialGrant!.id);
    const rows = await trialRows(f.orgId);
    expect(rows).toEqual([{ id: first.trialGrant!.id, amount_krw: TRIAL_KRW, valid_month: '2026-11', carried_from: null, revoked_at: null, created_by: f.ids.admin }]);

    const second = await approve('2026-11-20T01:00:00Z', f.orgId, 'again');
    expect(second).toMatchObject({ ok: true, created: false, approval: first.approval, trialGrant: { id: first.trialGrant!.id } });
    expect(await trialRows(f.orgId)).toHaveLength(1);
    expect((await f.sql.query('select note from brand_workspace_approvals where organization_id = $1', [f.orgId])).rows).toEqual([{ note: 'checked the business' }]);
    expect(await loadWorkspaceApproval(f.sql, f.orgId)).toEqual(first.approval);

    // The trial is an ordinary grant to the allowance: added on top by the existing rule.
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-11-10T02:00:00Z'))).toMatchObject({ capKrw: TRIAL_KRW, extraKrw: TRIAL_KRW, source: 'default' });
  });

  it('two approvals racing for the same organization leave one approval and one trial grant', async () => {
    const [a, b] = await Promise.all([approve('2026-11-10T01:00:00Z'), approve('2026-11-10T01:00:00Z')]);
    expect([a, b].filter((r) => r.ok && r.created)).toHaveLength(1);
    expect([a, b].every((r) => r.ok)).toBe(true);
    expect(await trialRows(f.orgId)).toHaveLength(1);
  });

  it('an original trial grant left without an approval row is linked, never doubled', async () => {
    await f.sql.query(
      "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, kind) values ($1, 4000, '2026-11', 'orphan', 'trial')",
      [f.orgId],
    );
    const res = await approve('2026-11-10T01:00:00Z');
    expect(res).toMatchObject({ ok: true, created: true, trialGrant: { amountKrw: TRIAL_KRW } });
    const rows = await trialRows(f.orgId);
    expect(rows).toHaveLength(1);
    if (res.ok) expect(res.approval.trialGrantId).toBe(rows[0]!.id);
  });

  it('refuses non-admins, sandboxed organizations, unknown organizations and bad input, writing nothing', async () => {
    expect(await approveWorkspace({ sql: f.sql, now: at('2026-11-10T01:00:00Z') }, viewerOf(f.ids.owner), { organizationId: f.orgId })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    const sandboxed = await newOrg('Morphic sandbox fixture');
    expect(await approve('2026-11-10T01:00:00Z', sandboxed)).toMatchObject({ ok: false, code: 'forbidden', detail: 'sandboxed_organization' });
    expect(await approve('2026-11-10T01:00:00Z', randomUUID())).toMatchObject({ ok: false, code: 'not_found' });
    expect(await approve('2026-11-10T01:00:00Z', f.orgId, 'x'.repeat(501))).toMatchObject({ ok: false, code: 'invalid', field: 'note' });
    expect(await approveWorkspace({ sql: f.sql }, admin(), { organizationId: 'nope' })).toMatchObject({ ok: false, code: 'invalid', field: 'organizationId' });
    expect((await f.sql.query('select count(*)::int as n from brand_workspace_approvals')).rows[0]).toEqual({ n: 0 });
    expect((await f.sql.query("select count(*)::int as n from brand_allowance_grants where kind = 'trial'")).rows[0]).toEqual({ n: 0 });
  });
});

describe('carryTrialGrants', () => {
  it('unused: the whole 4,000 KRW moves to the next month once, as a system-made trial grant pointing at the original', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    expect(await carry('2026-11-30T14:59:59Z')).toMatchObject({ ok: true, checked: 0, carried: 0 }); // still November in KST
    expect(await carry('2026-11-30T15:00:00Z')).toMatchObject({ ok: true, fromMonth: '2026-11', month: '2026-12', checked: 1, carried: 1, carriedKrw: TRIAL_KRW });
    const rows = await trialRows(f.orgId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ amount_krw: TRIAL_KRW, valid_month: '2026-12', carried_from: approved.trialGrant!.id, created_by: null });
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-12-15T01:00:00Z'))).toMatchObject({ capKrw: TRIAL_KRW, extraKrw: TRIAL_KRW });
    // Gone after the month after approval.
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2027-01-02T01:00:00Z'))).toMatchObject({ capKrw: 0, extraKrw: 0 });
  });

  it('partly used: the remainder, rounded down to whole credits', async () => {
    await approve('2026-11-10T01:00:00Z');
    await used(f.orgId, 1_234, '2026-11-12T01:00:00Z'); // counted as 1,240 (whole credits)
    await used(f.orgId, 900, '2026-11-13T01:00:00Z', 'failed'); // failed runs take nothing
    await used(f.orgId, 5_000, '2026-12-01T01:00:00Z'); // the next month's use does not count
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ carried: 1, carriedKrw: 2_760 });
    expect((await trialRows(f.orgId))[1]).toMatchObject({ amount_krw: 2_760, valid_month: '2026-12' });
  });

  it('fully used, or less than one credit left: nothing is carried', async () => {
    await approve('2026-11-10T01:00:00Z');
    await used(f.orgId, 3_991, '2026-11-12T01:00:00Z'); // 400 credits
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ checked: 1, carried: 0, nothingLeft: 1 });

    const other = await newOrg('Second fixture');
    await approve('2026-11-10T01:00:00Z', other);
    await grantExtraAllowance({ sql: f.sql, now: at('2026-11-10T01:00:00Z') }, admin(), { organizationId: other, amountKrw: 5, validMonth: '2026-11' });
    await used(other, 4_000, '2026-11-12T01:00:00Z');
    // 5 KRW left: under one credit. The first organization was evaluated by the run above and is not looked at again.
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ checked: 1, carried: 0, nothingLeft: 1 });
    expect((await trialRows(f.orgId)).length + (await trialRows(other)).length).toBe(2);
  });

  it('a revoked trial is not carried; it is marked checked and never looked at again', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    expect(await revokeExtraAllowance({ sql: f.sql }, admin(), { grantId: approved.trialGrant!.id })).toMatchObject({ ok: true });
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ checked: 1, carried: 0, revoked: 1 });
    expect(await checkedAt(approved.trialGrant!.id)).toBe('2026-12-01T00:00:00.000Z');
    expect(await carry('2026-12-01T01:00:00Z')).toMatchObject({ checked: 0, carried: 0 });
    expect(await trialRows(f.orgId)).toHaveLength(1);
  });

  it('each original is evaluated once: a cap raised after a "nothing left" check never carries a second trial (review probe)', async () => {
    const approved = await approve('2026-11-26T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    await used(f.orgId, 4_000, '2026-11-27T01:00:00Z');
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ checked: 1, carried: 0, nothingLeft: 1 });
    expect(await checkedAt(approved.trialGrant!.id)).toBe('2026-12-01T00:00:00.000Z');
    // Later the organization gets an override, and the env default goes up: November rebuilt now would show room left.
    await f.sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, 777000, true, 'sunra_mcp', 'later override')",
      [f.orgId],
    );
    expect(await carry('2026-12-02T00:00:00Z')).toMatchObject({ checked: 0, carried: 0 });
    expect(
      await carryTrialGrants({ sql: f.sql, now: at('2026-12-03T00:00:00Z'), studio: { defaultMonthlyKrw: 1_000_000, planGraceDays: 14 } }),
    ).toMatchObject({ checked: 0, carried: 0 });
    expect(await trialRows(f.orgId)).toHaveLength(1);
    expect((await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-12-05T01:00:00Z'))).extraKrw).toBe(0);
  });

  it('a carried original is marked checked in the same transaction as the carry', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ carried: 1 });
    expect(await checkedAt(approved.trialGrant!.id)).toBe('2026-12-01T00:00:00.000Z');
    const carried = (await trialRows(f.orgId))[1]!;
    expect(await checkedAt(carried.id)).toBeNull(); // the carried grant is never a candidate
  });

  it('base credits are consumed first on the calendar month (env default); plan organizations are not carried (B1c fix round)', async () => {
    // B1c fix round: this test used plan organizations (B1b: carry = what is left of the cap). A plan organization's grant now
    // belongs to one billing cycle and is never carried; the "base credits first" rule is kept for calendar-month
    // organizations, here on an env default of 270,000.
    await approve('2026-11-10T01:00:00Z');
    await used(f.orgId, 271_000, '2026-11-20T01:00:00Z');
    const light = await newOrg('Light user');
    await approve('2026-11-10T01:00:00Z', light);
    await used(light, 100_000, '2026-11-20T01:00:00Z');
    const planned = await newOrg('Plan user');
    await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-01', null, 1)",
      [planned],
    );
    await approve('2026-11-10T01:00:00Z', planned);
    const res = await carryTrialGrants({ sql: f.sql, now: at('2026-12-01T00:00:00Z'), studio: { defaultMonthlyKrw: 270_000, planGraceDays: 14 } });
    expect(res).toMatchObject({ checked: 3, carried: 2, carriedKrw: 3_000 + TRIAL_KRW, planOrganization: 1 });
  });

  it('B1c fix round: a plan organization never has its trial carried (its grants belong to one cycle); the original is marked checked', async () => {
    await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-10-17', null, 1)",
      [f.orgId],
    );
    const approved = await approve('2026-11-05T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    expect(await carry('2026-12-01T00:00:00Z')).toMatchObject({ checked: 1, carried: 0, planOrganization: 1 });
    expect(await checkedAt(approved.trialGrant!.id)).toBe('2026-12-01T00:00:00.000Z');
    expect(await trialRows(f.orgId)).toHaveLength(1);
    expect(await carry('2026-12-01T01:00:00Z')).toMatchObject({ checked: 0 });
  });

  it('two overlapping runs carry once; later runs carry nothing; a carried grant is never carried again; older originals have expired', async () => {
    await approve('2026-10-10T01:00:00Z'); // October: carried into November, expired by December
    const runs = await Promise.all([carry('2026-11-01T01:00:00Z'), carry('2026-11-01T01:00:00Z')]);
    expect(runs.reduce((n, r) => n + (r.ok && 'carried' in r ? r.carried : 0), 0)).toBe(1);
    expect(await carry('2026-11-01T02:00:00Z')).toMatchObject({ carried: 0 });
    expect(await trialRows(f.orgId)).toHaveLength(2);
    expect(await carry('2026-12-01T01:00:00Z')).toMatchObject({ checked: 0, carried: 0 });
    expect(await trialRows(f.orgId)).toHaveLength(2);

    const late = await newOrg('Missed carry');
    const lateApproval = await approve('2026-10-10T01:00:00Z', late);
    if (!lateApproval.ok) throw new Error(lateApproval.code);
    // Two months back: expired, marked checked, not carried.
    expect(await carry('2026-12-01T01:00:00Z')).toMatchObject({ checked: 1, carried: 0, expired: 1 });
    expect(await checkedAt(lateApproval.trialGrant!.id)).toBe('2026-12-01T01:00:00.000Z');
    expect(await carry('2026-12-01T02:00:00Z')).toMatchObject({ checked: 0 });
    expect(await trialRows(late)).toHaveLength(1);
  });

  it('the KST month boundary decides the trial month: 14:59:59Z on the last day is that month, 15:00:00Z the next', async () => {
    await approve('2026-11-30T14:59:59Z');
    expect((await trialRows(f.orgId))[0]).toMatchObject({ valid_month: '2026-11' });
    const next = await newOrg('Boundary next');
    await approve('2026-11-30T15:00:00Z', next);
    expect((await trialRows(next))[0]).toMatchObject({ valid_month: '2026-12' });

    expect(await carry('2026-11-30T15:00:00Z')).toMatchObject({ carried: 1 });
    expect((await trialRows(f.orgId))[1]).toMatchObject({ valid_month: '2026-12' });
    expect(await trialRows(next)).toHaveLength(1);
    expect(await carry('2026-12-31T15:00:00Z')).toMatchObject({ carried: 1 });
    expect((await trialRows(next))[1]).toMatchObject({ valid_month: '2027-01' });
  });

  it('never writes the allowance row of any organization', async () => {
    await f.sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, 777000, true, 'sunra_mcp', 'override fixture')",
      [f.orgId],
    );
    await approve('2026-11-10T01:00:00Z');
    const r = recorder(f.db);
    expect(await carry('2026-12-01T00:00:00Z', r.sql)).toMatchObject({ carried: 1, carriedKrw: TRIAL_KRW });
    const writes = r.log.map((q) => q.text).filter((t) => /^(insert into|update|delete from)\b/i.test(t));
    expect(writes.length).toBe(2);
    expect(
      writes.every((t) => /^insert into brand_allowance_grants\b/.test(t) || /^update brand_allowance_grants set trial_carry_checked_at = /.test(t)),
    ).toBe(true);
    expect(r.log.some((q) => /brand_studio_allowances/.test(q.text) && /^(insert|update|delete)/i.test(q.text))).toBe(false);
  });
});

describe('BRAND_WORKSPACE_APPROVAL off, or the schema not ready', () => {
  it('flag off: approve is disabled and the carry pass skipped, both without a query; loaders return nothing', async () => {
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    const r = recorder(f.db);
    expect(await approveWorkspace({ sql: r.sql, now: at('2026-11-10T01:00:00Z') }, admin(), { organizationId: f.orgId })).toEqual({ ok: false, code: 'disabled' });
    expect(await carryTrialGrants({ sql: r.sql, now: at('2026-12-01T00:00:00Z'), studio: STUDIO })).toEqual({ ok: true, skipped: 'disabled' });
    expect(await loadWorkspaceApproval(r.sql, f.orgId)).toBeNull();
    expect(await loadWorkspaceApprovalPanel(r.sql, f.orgId, { now: new Date('2026-11-10T01:00:00Z') })).toEqual({
      enabled: false,
      schemaReady: false,
      approval: null,
      approverEmail: null,
      trial: { original: null, carried: null, usableThrough: null },
    });
    expect(r.log).toEqual([]);
  });

  it('flag off: an approved organization is gated again by the upload rule, exactly as before', async () => {
    await approve('2026-11-10T01:00:00Z');
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    expect(await isOrganizationUploadApproved(f.sql, f.orgId, new Date('2027-01-15T01:00:00Z'))).toBe(false);
  });

  it('schema not ready (before 0184): every path degrades without throwing', async () => {
    const db = await pre0184Db();
    try {
      const sql = runner(db);
      const adminId = randomUUID();
      const ownerId = randomUUID();
      await seedProfile(sql, { id: adminId, isAdmin: true, email: 'pre0184-admin@fixture.invalid' });
      await seedProfile(sql, { id: ownerId, email: 'pre0184-owner@fixture.invalid' });
      const orgId = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id, created_at) values ($1, $2, $3, $4, $5)', [
        orgId,
        'Pre-0184 fixture',
        ownerId,
        randomUUID(),
        '2026-11-25T00:00:00+09:00',
      ]);
      const viewer = { ...viewerOf(adminId), isAdmin: true };
      expect(await approveWorkspace({ sql, now: at('2026-11-10T01:00:00Z') }, viewer, { organizationId: orgId })).toMatchObject({ ok: false, code: 'unavailable' });
      expect(await carryTrialGrants({ sql, now: at('2026-12-01T00:00:00Z'), studio: STUDIO })).toEqual({ ok: true, skipped: 'schema_not_ready' });
      expect(await loadWorkspaceApproval(sql, orgId)).toBeNull();
      expect(await loadWorkspaceApprovalPanel(sql, orgId, { now: new Date('2026-11-10T01:00:00Z') })).toMatchObject({ enabled: true, schemaReady: false, approval: null });
      expect(await isOrganizationUploadApproved(sql, orgId, new Date('2026-11-10T01:00:00Z'))).toBe(false);
      const grant = await grantExtraAllowance({ sql, now: at('2026-11-10T01:00:00Z') }, viewer, { organizationId: orgId, amountKrw: 1000, validMonth: '2026-11' });
      expect(grant).toMatchObject({ ok: true });
      const list = await listExtraAllowanceGrants(sql, orgId, new Date('2026-11-10T01:00:00Z'));
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty('kind');
    } finally {
      await db.close();
    }
  });
});

describe('upload gate with the flag on', () => {
  it('an approved organization stays exempt after its trial and the carried month have passed', async () => {
    const jan = new Date('2027-01-15T01:00:00Z');
    expect(await isOrganizationUploadApproved(f.sql, f.orgId, jan)).toBe(false);
    await approve('2026-11-10T01:00:00Z');
    await carry('2026-12-01T00:00:00Z');
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, jan)).toMatchObject({ capKrw: 0 });
    expect(await isOrganizationUploadApproved(f.sql, f.orgId, jan)).toBe(true);
  });
});

describe('organizations on an allowance override (§4, flag on)', () => {
  const OVERRIDE = 777_000;
  const addOverride = (orgId: string) =>
    f.sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, $2, true, 'sunra_mcp', 'override fixture')",
      [orgId, OVERRIDE],
    );
  const allowanceRow = async (orgId: string) =>
    (await f.sql.query('select monthly_cap_krw, is_override, preferred_lane, note, updated_by, updated_at from brand_studio_allowances where organization_id = $1', [orgId])).rows[0];

  it('approved: keeps source override and its lane; the cap is the override plus the trial grant on top', async () => {
    await addOverride(f.orgId);
    const other = await newOrg('Override not approved');
    await addOverride(other);
    const now = new Date('2026-11-10T02:00:00Z');
    const otherBefore = await loadAllowance(f.sql, other, STUDIO, now);
    const rowBefore = await allowanceRow(f.orgId);
    const otherRowBefore = await allowanceRow(other);

    await approve('2026-11-10T01:00:00Z');
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, now)).toEqual({
      capKrw: OVERRIDE + TRIAL_KRW,
      baseCapKrw: OVERRIDE,
      extraKrw: TRIAL_KRW,
      source: 'override',
      usedKrw: 0,
      resetsAt: '2026-11-30T15:00:00.000Z',
      preferredLane: 'sunra_mcp',
      configured: true,
    });
    await carry('2026-12-01T00:00:00Z');
    expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-12-10T01:00:00Z'))).toMatchObject({
      source: 'override',
      baseCapKrw: OVERRIDE,
      extraKrw: TRIAL_KRW,
      preferredLane: 'sunra_mcp',
    });
    expect(await allowanceRow(f.orgId)).toEqual(rowBefore);

    // The override organization that was not approved is untouched.
    expect(await loadAllowance(f.sql, other, STUDIO, now)).toEqual(otherBefore);
    expect(await allowanceRow(other)).toEqual(otherRowBefore);
    expect(await trialRows(other)).toEqual([]);
    expect(await loadWorkspaceApproval(f.sql, other)).toBeNull();
  });
});

describe('admin operation brandWorkspace.approve', () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const ctx = (viewer = admin()) => ({ sql: f.sql, viewer }) as unknown as AdminContext;
  const op = () => ADMIN_OPERATIONS['brandWorkspace.approve' as keyof typeof ADMIN_OPERATIONS] as unknown as {
    parse(fd: FormData): { ok: true; value: unknown } | { ok: false; detail: string };
    run(ctx: AdminContext, input: unknown): Promise<Record<string, unknown>>;
  };

  it('is registered, needs the confirm box, refuses when the flag is off, and returns the approval and the trial grant', async () => {
    expect(op()).toBeDefined();
    const parsedNoConfirm = op().parse(form({ organizationId: f.orgId, note: 'n' }));
    if (!parsedNoConfirm.ok) throw new Error(parsedNoConfirm.detail);
    expect(await op().run(ctx(), parsedNoConfirm.value)).toEqual({ ok: false, code: 'invalid', detail: 'confirmCheck' });

    const parsed = op().parse(form({ organizationId: f.orgId, note: 'n', _confirm: '1' }));
    if (!parsed.ok) throw new Error(parsed.detail);
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    expect(await op().run(ctx(), parsed.value)).toEqual({ ok: false, code: 'disabled' });
    expect((await f.sql.query('select count(*)::int as n from brand_workspace_approvals')).rows[0]).toEqual({ n: 0 });

    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
    const done = await op().run(ctx(), parsed.value);
    expect(done).toMatchObject({
      ok: true,
      code: 'created',
      detail: 'workspace_approved',
      approval: { organizationId: f.orgId, approvedBy: f.ids.admin, note: 'n' },
      trialGrant: { kind: 'trial', amountKrw: TRIAL_KRW, credits: 400 },
    });
    expect(await op().run(ctx(), parsed.value)).toMatchObject({ ok: true, code: 'saved', detail: 'already_approved' });

    const sandboxed = await newOrg('모픽 fixture');
    const p2 = op().parse(form({ organizationId: sandboxed, _confirm: '1' }));
    if (!p2.ok) throw new Error(p2.detail);
    expect(await op().run(ctx(), p2.value)).toEqual({ ok: false, code: 'forbidden', detail: 'sandboxed_organization' });
    const p3 = op().parse(form({ organizationId: 'bad', _confirm: '1' }));
    if (!p3.ok) throw new Error(p3.detail);
    expect(await op().run(ctx(), p3.value)).toEqual({ ok: false, code: 'invalid', detail: 'organizationId' });
  });
});

describe('grant list and the admin panel loader (flag on)', () => {
  it('the grant list carries kind and carriedFrom; the manual operation still writes extra', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    await grantExtraAllowance({ sql: f.sql, now: at('2026-11-10T01:00:00Z') }, admin(), { organizationId: f.orgId, amountKrw: 1000, validMonth: '2026-11' });
    await carry('2026-12-01T00:00:00Z');
    const list = await listExtraAllowanceGrants(f.sql, f.orgId, new Date('2026-12-02T00:00:00Z'));
    expect(list.map((g) => [g.kind, g.carriedFrom ?? null, g.amountKrw, g.validMonth, g.activeNow]).sort()).toEqual(
      [
        ['extra', null, 1000, '2026-11', false],
        ['trial', null, TRIAL_KRW, '2026-11', false],
        ['trial', approved.trialGrant!.id, TRIAL_KRW, '2026-12', true],
      ].sort(),
    );
  });

  it('revoking a carried original revokes the carried grant too, with the same audit trail; usable-through follows', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    await carry('2026-12-01T00:00:00Z');
    const dec = new Date('2026-12-10T01:00:00Z');
    expect((await loadAllowance(f.sql, f.orgId, STUDIO, dec)).extraKrw).toBe(TRIAL_KRW);
    expect((await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: dec })).trial.usableThrough).toBe('2026-12-31');

    expect(await revokeExtraAllowance({ sql: f.sql }, admin(), { grantId: approved.trialGrant!.id, organizationId: f.orgId })).toMatchObject({ ok: true });
    const rows = (
      await f.sql.query<{ revoked: boolean; revoked_by: string | null }>(
        "select revoked_at is not null as revoked, revoked_by::text as revoked_by from brand_allowance_grants where organization_id = $1 and kind = 'trial'",
        [f.orgId],
      )
    ).rows;
    expect(rows).toEqual([
      { revoked: true, revoked_by: f.ids.admin },
      { revoked: true, revoked_by: f.ids.admin },
    ]);
    expect((await loadAllowance(f.sql, f.orgId, STUDIO, dec)).extraKrw).toBe(0);
    const panel = await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: dec });
    expect(panel.trial).toMatchObject({ usableThrough: null, carried: { activeNow: false } });
  });

  it('with the flag off, revoking an original revokes only that grant, as before', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    await carry('2026-12-01T00:00:00Z');
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    expect(await revokeExtraAllowance({ sql: f.sql }, admin(), { grantId: approved.trialGrant!.id })).toMatchObject({ ok: true });
    expect((await trialRows(f.orgId)).map((r) => r.revoked_at !== null)).toEqual([true, false]);
  });

  it('usable-through: the next month while the carry is pending, the trial month once nothing was left', async () => {
    await approve('2026-11-10T01:00:00Z');
    expect((await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: new Date('2026-11-20T01:00:00Z') })).trial.usableThrough).toBe('2026-12-31');
    await used(f.orgId, 4_000, '2026-11-21T01:00:00Z');
    await carry('2026-12-01T00:00:00Z');
    const panel = await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: new Date('2026-12-02T01:00:00Z') });
    expect(panel.trial).toMatchObject({ usableThrough: '2026-11-30', carried: null, original: { carryCheckedAt: '2026-12-01T00:00:00.000Z' } });
  });

  it('the panel shows the approval date and the trial with its remaining validity', async () => {
    const approved = await approve('2026-11-10T01:00:00Z');
    if (!approved.ok) throw new Error(approved.code);
    const before = await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: new Date('2026-11-20T01:00:00Z') });
    expect(before).toMatchObject({
      enabled: true,
      schemaReady: true,
      approval: { approvedAt: '2026-11-10T01:00:00.000Z', approvedOn: '2026-11-10' },
      trial: {
        original: { id: approved.trialGrant!.id, credits: 400, validMonth: '2026-11', validThrough: '2026-11-30', activeNow: true, daysLeft: 11 },
        carried: null,
        usableThrough: '2026-12-31',
      },
    });
    await carry('2026-12-01T00:00:00Z');
    const after = await loadWorkspaceApprovalPanel(f.sql, f.orgId, { now: new Date('2026-12-30T01:00:00Z') });
    expect(after.trial).toMatchObject({
      original: { activeNow: false, daysLeft: 0 },
      carried: { carriedFrom: approved.trialGrant!.id, validMonth: '2026-12', validThrough: '2026-12-31', activeNow: true, daysLeft: 2 },
      usableThrough: '2026-12-31',
    });
  });
});

describe('hourly route /api/brand-billing/tick with the approval flag', () => {
  const call = () =>
    tickRoute.GET(new NextRequest('https://twings.app/api/brand-billing/tick', { headers: { authorization: 'Bearer cron-secret-test' } }));

  it('subscription flag off: the subscription pass stays skipped, the carry pass runs, and its counts are added', async () => {
    await approve('2026-11-10T01:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      skipped: 'disabled',
      trialCarry: {
        ok: true,
        fromMonth: '2026-11',
        month: '2026-12',
        checked: 1,
        carried: 1,
        carriedKrw: TRIAL_KRW,
        nothingLeft: 0,
        revoked: 0,
        expired: 0,
        planOrganization: 0,
        skipped: 0,
        errors: 0,
      },
    });
    expect(await trialRows(f.orgId)).toHaveLength(2);
  });

  it('subscription flag on: the existing fields stay and trialCarry is added; a failing carry pass is isolated', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    const body = (await (await call()).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, period: '2026-12', checked: 0, trialCarry: { ok: true, checked: 0, carried: 0 } });

    const failing = recorder(f.db);
    routeMocks.sql = {
      query: (text, params) => (/kind = 'trial'/.test(text) ? Promise.reject(new Error('boom')) : failing.sql.query(text, params)),
      transaction: (fn) => failing.sql.transaction(fn),
    } as SqlRunner;
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, period: '2026-12', trialCarry: { ok: false, code: 'carry_failed' } });
  });

  it('runs the carry pass after the subscription pass, within its own small budget', async () => {
    expect(ROUTE_TRIAL_CARRY_BUDGET_MS).toBe(5_000);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await approve('2026-11-10T01:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T00:00:00Z'));
    const r = recorder(f.db);
    routeMocks.sql = r.sql;
    expect(await (await call()).json()).toMatchObject({ ok: true, period: '2026-12', trialCarry: { carried: 1 } });
    const texts = r.log.map((q) => q.text);
    const lastSubscription = texts.map((t, i) => (/brand_subscriptions|team_notice_deliveries|brand_invoice_events/.test(t) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstCarry = texts.findIndex((t) => /g\.kind = 'trial'/.test(t));
    expect(lastSubscription).toBeGreaterThanOrEqual(0);
    expect(firstCarry).toBeGreaterThan(lastSubscription);
  });

  it('both flags off: { ok: true, skipped: disabled } and no query', async () => {
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    const spy = vi.spyOn(f.sql, 'query');
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, skipped: 'disabled' });
    expect(spy).not.toHaveBeenCalled();
  });
});
