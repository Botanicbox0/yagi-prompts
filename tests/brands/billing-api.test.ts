import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { loadAllowance } from '@/lib/brand-studio/usage';
import {
  createBrandDiscountCode,
  draftBrandInvoice,
  grantExtraAllowance,
  issueBrandInvoice,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createBrandOrganization } from '@/lib/brands/workspace/service';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { adminRouteAllowed, brandRouteAllowed } from '@/lib/routing/surfaces';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'anon', email: null, locale: 'ko' } as Viewer,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer }));

const billingGet = await import('@/app/api/brand-billing/route');
const profilePut = await import('@/app/api/brand-billing/profile/route');
const redeemPost = await import('@/app/api/brand-billing/redeem/route');
const noticesTick = await import('@/app/api/brand-rooms/notices/tick/route');

let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = (): Viewer => viewerOf(f.ids.owner);

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  mocks.sql = f.sql;
  mocks.viewer = owner();
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  vi.stubEnv('BRAND_ROOM_NOTIFY', 'off');
  vi.stubEnv('CRON_SECRET', 'cron-secret-test');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const getReq = (orgId: string) =>
  billingGet.GET(new NextRequest(`https://brand.twings.app/api/brand-billing?organizationId=${orgId}`, { headers: { host: 'brand.twings.app' } }));

const putReq = (body: unknown, origin = 'https://brand.twings.app') =>
  profilePut.PUT(
    new NextRequest('https://brand.twings.app/api/brand-billing/profile', {
      method: 'PUT',
      headers: { host: 'brand.twings.app', origin, 'sec-fetch-site': origin === 'https://brand.twings.app' ? 'same-origin' : 'cross-site' },
      body: JSON.stringify(body),
    }),
  );

const postReq = (body: unknown, origin = 'https://brand.twings.app') =>
  redeemPost.POST(
    new NextRequest('https://brand.twings.app/api/brand-billing/redeem', {
      method: 'POST',
      headers: { host: 'brand.twings.app', origin, 'sec-fetch-site': origin === 'https://brand.twings.app' ? 'same-origin' : 'cross-site' },
      body: JSON.stringify(body),
    }),
  );

describe('customer billing API (/api/brand-billing*)', () => {
  it('registers routes only on brandRouteAllowed and blocks adminRouteAllowed', () => {
    expect(brandRouteAllowed('/api/brand-billing', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-billing', 'POST')).toBe(false);
    expect(brandRouteAllowed('/api/brand-billing/profile', 'PUT')).toBe(true);
    expect(brandRouteAllowed('/api/brand-billing/profile', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-billing/redeem', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-billing/redeem', 'GET')).toBe(false);

    expect(adminRouteAllowed('/api/brand-billing', 'GET')).toBe(false);
    expect(adminRouteAllowed('/api/brand-billing/profile', 'PUT')).toBe(false);
    expect(adminRouteAllowed('/api/brand-billing/redeem', 'POST')).toBe(false);
  });

  it('enforces auth (401), role (403), outsider isolation (404), sandbox 404, and cross-origin CSRF (403)', async () => {
    // 1. Anonymous -> 401
    mocks.viewer = { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null };
    expect((await getReq(f.orgId)).status).toBe(401);
    expect((await putReq({ organizationId: f.orgId })).status).toBe(401);
    expect((await postReq({ organizationId: f.orgId, code: 'ABCDEFGHJK' })).status).toBe(401);

    // 2. Non-owner members (editor, viewer, guest) -> 403
    for (const id of [f.ids.editor, f.ids.viewer, f.ids.guest]) {
      mocks.viewer = viewerOf(id);
      const r1 = await getReq(f.orgId);
      expect(r1.status).toBe(403);
      expect(r1.headers.get('cache-control')).toBe('private, no-store');
      expect(r1.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect((await putReq({ organizationId: f.orgId })).status).toBe(403);
      expect((await postReq({ organizationId: f.orgId, code: 'ABCDEFGHJK' })).status).toBe(403);
    }

    // 3. Outsider -> 404
    mocks.viewer = viewerOf(f.ids.outsider);
    expect((await getReq(f.orgId)).status).toBe(404);
    expect((await putReq({ organizationId: f.orgId })).status).toBe(404);
    expect((await postReq({ organizationId: f.orgId, code: 'ABCDEFGHJK' })).status).toBe(404);

    // 4. Cross-origin mutation blocked -> 403 even for owner
    mocks.viewer = owner();
    expect((await putReq({ organizationId: f.orgId }, 'https://evil.example')).status).toBe(403);
    expect((await postReq({ organizationId: f.orgId, code: 'ABCDEFGHJK' }, 'https://evil.example')).status).toBe(403);

    // 5. Sandboxed organizations (both by id and by name) -> 404 even for owner
    const [sandboxId] = [...SANDBOXED_CLIENT_ORG_IDS];
    const sbOwnerId = randomUUID();
    await seedProfile(f.sql, { id: sbOwnerId, email: 'sb@example.test' });
    const sbOwner: Viewer = { userId: sbOwnerId, isAdmin: false, tier: 'free', email: 'sb@example.test', locale: 'ko' };
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      sandboxId,
      'Sandbox Client',
      sbOwnerId,
      randomUUID(),
    ]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      sandboxId,
      sbOwnerId,
    ]);
    const namedSandbox = await createBrandOrganization({ sql: f.sql }, sbOwner, {
      name: 'Morphic Labs',
      requestId: randomUUID(),
    });
    if (!namedSandbox.ok) throw new Error(namedSandbox.code);

    mocks.viewer = sbOwner;
    for (const id of [sandboxId!, namedSandbox.id]) {
      expect((await getReq(id)).status).toBe(404);
      expect((await putReq({ organizationId: id, companyLegalName: 'X' })).status).toBe(404);
      expect((await postReq({ organizationId: id, code: 'ABCDEFGHJK' })).status).toBe(404);
    }
  });

  it('returns strictly scoped billing JSON for org A without ever leaking org B data, and supports PUT profile + POST redeem', async () => {
    // Seed org B with distinct invoices, grants, discount, profile
    const ownerBId = randomUUID();
    await seedProfile(f.sql, { id: ownerBId, email: 'ownerb@example.test' });
    const ownerB: Viewer = { userId: ownerBId, isAdmin: false, tier: 'free', email: 'ownerb@example.test', locale: 'ko' };
    const orgBRes = await createBrandOrganization({ sql: f.sql }, ownerB, { name: 'Secret Org B', requestId: randomUUID() });
    if (!orgBRes.ok) throw new Error(orgBRes.code);
    const orgB = orgBRes.id;

    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: orgB,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    await saveBrandBillingProfileAdmin({ sql: f.sql }, admin(), {
      organizationId: orgB,
      companyLegalName: 'ORG_B_SECRET_LEGAL',
      businessRegNo: '111-11-11119',
      memo: 'ORG_B_ADMIN_SECRET',
    });
    const invB = await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: orgB, period: '2026-11' });
    if (invB.ok) await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: invB.invoice.id });

    // Seed org A
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
      expectedRevision: 0,
    });
    await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_29', monthlyCapKrw: 100_000, confirm: true });
    await grantExtraAllowance({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      amountKrw: 25_000,
      validMonth: new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7),
      reason: 'bonus',
    });
    await saveBrandBillingProfileAdmin({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      companyLegalName: 'Org A Legal',
      businessRegNo: '123-45-67891',
      memo: 'SECRET_ADMIN_MEMO_SHOULD_NOT_LEAK',
    });

    // Draft invoice on org A should NOT appear in customer API; paid + void invoices omit paidMethod/voidReason (S7)
    const currentMonth = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 7);
    await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: currentMonth });
    const paidA = await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2026-10' });
    if (paidA.ok) {
      await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: paidA.invoice.id });
      await markBrandInvoicePaid({ sql: f.sql }, admin(), { invoiceId: paidA.invoice.id, paidMethod: 'SECRET_PAID_METHOD_NOTE' });
    }
    const voidA = await draftBrandInvoice({ sql: f.sql }, admin(), { organizationId: f.orgId, period: '2026-09' });
    if (voidA.ok) {
      await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: voidA.invoice.id });
      await voidBrandInvoice({ sql: f.sql }, admin(), { invoiceId: voidA.invoice.id, reason: 'SECRET_INTERNAL_VOID_REASON' });
    }

    await createBrandDiscountCode({ sql: f.sql }, admin(), { code: 'SAVE-40-2026', percent: 40, invoicesTotal: 3 });

    mocks.viewer = owner();
    const res = await getReq(f.orgId);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('ORG_B_SECRET_LEGAL');
    expect(text).not.toContain('ORG_B_ADMIN_SECRET');
    expect(text).not.toContain('SECRET_ADMIN_MEMO_SHOULD_NOT_LEAK');
    expect(text).not.toContain('SECRET_PAID_METHOD_NOTE');
    expect(text).not.toContain('SECRET_INTERNAL_VOID_REASON');
    expect(text).not.toContain(orgB);

    const body = JSON.parse(text);
    expect(body).toMatchObject({
      ok: true,
      organizationId: f.orgId,
      plan: { id: 'b2b_29', monthlyListKrw: 290_000, active: true },
      allowance: { capKrw: 125_000, baseCapKrw: 100_000, extraKrw: 25_000, source: 'plan' },
      billingProfile: { companyLegalName: 'Org A Legal', businessRegNo: '1234567891' },
    });
    expect(body.invoices).toHaveLength(2);
    expect(body.invoices[0]).toMatchObject({ period: '2026-10', status: 'paid' });
    expect(body.invoices[1]).toMatchObject({ period: '2026-09', status: 'void' });
    expect('paidMethod' in body.invoices[0]).toBe(false);
    expect('voidReason' in body.invoices[1]).toBe(false);

    // Owner cannot read org B's billing!
    expect((await getReq(orgB)).status).toBe(404);

    // PUT billing profile
    const put = await putReq({
      organizationId: f.orgId,
      companyLegalName: 'Org A Updated',
      businessRegNo: '111-11-11119',
      taxInvoiceEmail: 'billing@example.test',
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      ok: true,
      billingProfile: { companyLegalName: 'Org A Updated', businessRegNo: '1111111119' },
    });

    // POST redeem code -> S6: duplicate/equal-or-lower discount also answer generic 400 code_unavailable
    const redeem = await postReq({ organizationId: f.orgId, code: 'save-40-2026' });
    expect(redeem.status).toBe(200);
    expect(await redeem.json()).toMatchObject({
      ok: true,
      activeDiscount: { percent: 40, invoicesTotal: 3, invoicesRemaining: 3, openEnded: false, source: 'code' },
    });
    const dupRedeem = await postReq({ organizationId: f.orgId, code: 'save-40-2026' });
    expect(dupRedeem.status).toBe(400);
    expect(await dupRedeem.json()).toEqual({ ok: false, code: 'code_unavailable' });
  });

  it('degrades cleanly on pre-0176 databases (deploy-order safety)', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0176_'))) {
        await db.exec(readMigration(file));
      }
      const preSql = runner(db);
      const userId = randomUUID();
      await seedProfile(preSql, { id: userId, email: 'pre@example.test' });
      const preOwner: Viewer = { userId, isAdmin: false, tier: 'free', email: 'pre@example.test', locale: 'ko' };
      const org = await createBrandOrganization({ sql: preSql }, preOwner, { name: 'Pre Org', requestId: randomUUID() });
      if (!org.ok) throw new Error(org.code);

      mocks.sql = preSql;
      mocks.viewer = preOwner;

      const getPre = await getReq(org.id);
      expect(getPre.status).toBe(200);
      expect(await getPre.json()).toMatchObject({
        ok: true,
        organizationId: org.id,
        plan: null,
        allowance: { capKrw: 0, baseCapKrw: 0, extraKrw: 0, source: 'default' },
        activeDiscount: null,
        invoices: [],
        billingProfile: null,
      });
      expect((await putReq({ organizationId: org.id, companyLegalName: 'Test' })).status).toBe(503);
      expect((await postReq({ organizationId: org.id, code: 'ABCDEFGHJK' })).status).toBe(503);
    } finally {
      mocks.sql = f.sql;
      await db.close();
    }
  });
});

describe('reservation expiry from 10-minute notices tick cron', () => {
  it('expires stale queued (>24h) and running (>6h) studio reservations idempotently and frees allowance', async () => {
    const deps = studioDeps(f.sql);
    await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override) values ($1, 1000, true)', [
      f.orgId,
    ]);

    const qId = randomUUID();
    const rId = randomUUID();
    const freshId = randomUUID();
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, estimate_krw, created_at)
       values ($1, $2, $3, 'req_stale_queued', 'image', 'queued', 'sunra_api', 'seedream-5.5', 200, now() - interval '25 hours')`,
      [qId, f.orgId, f.ids.owner],
    );
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, estimate_krw, created_at, started_at)
       values ($1, $2, $3, 'req_stale_running', 'image', 'running', 'sunra_api', 'seedream-5.5', 300, now() - interval '7 hours', now() - interval '7 hours')`,
      [rId, f.orgId, f.ids.owner],
    );
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, estimate_krw, created_at, started_at)
       values ($1, $2, $3, 'req_fresh_running', 'image', 'running', 'sunra_api', 'seedream-5.5', 100, now() - interval '1 hour', now() - interval '1 hour')`,
      [freshId, f.orgId, f.ids.owner],
    );
    await f.sql.query(
      "insert into brand_studio_outputs (job_id, organization_id, idx, kind) values ($1, $4, 0, 'image'), ($2, $4, 0, 'image'), ($3, $4, 0, 'image')",
      [qId, rId, freshId, f.orgId],
    );

    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(600);

    const req = () =>
      new Request('https://twings.app/api/brand-rooms/notices/tick', {
        headers: { authorization: 'Bearer cron-secret-test' },
      });

    const pass1 = await noticesTick.GET(req());
    expect(pass1.status).toBe(200);
    expect(await pass1.json()).toEqual({ ok: true, ran: false, studio: { released: 0, expired: 2 } });

    // Stale reservations released, fresh reservation kept
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(100);
    expect(
      (await f.sql.query<{ status: string }>('select status from brand_studio_outputs where job_id = any($1::uuid[])', [[qId, rId]])).rows.every(
        (o) => o.status === 'failed',
      ),
    ).toBe(true);

    // Idempotent second run expires nothing else and returns exact clean state
    const pass2 = await noticesTick.GET(req());
    expect(pass2.status).toBe(200);
    expect(await pass2.json()).toEqual({ ok: true, ran: false });
  });

  it('B1 & S9: 10-minute notices tick NEVER expires a 31m running sunra_mcp job with brief stale heartbeat, and prunes >1d attempts', async () => {
    const deps = studioDeps(f.sql);
    await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override) values ($1, 1000, true)', [
      f.orgId,
    ]);
    // Lane heartbeat was missed 2 minutes ago while a sunra_mcp video job has been running for 35 minutes (< 6h limit)
    await f.sql.query(
      "insert into brand_studio_lanes (lane, seen_at) values ('sunra_mcp', now() - interval '2 minutes') on conflict (lane) do update set seen_at = excluded.seen_at",
    );
    const mcpRunningId = randomUUID();
    const stale6hId = randomUUID();
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, estimate_krw, created_at, started_at)
       values ($1, $2, $3, 'req_mcp_healthy', 'video', 'running', 'sunra_mcp', 'seedance-2.5', 400, now() - interval '40 minutes', now() - interval '35 minutes')`,
      [mcpRunningId, f.orgId, f.ids.owner],
    );
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, lane, model, estimate_krw, created_at, started_at)
       values ($1, $2, $3, 'req_6h_stale', 'video', 'running', 'sunra_mcp', 'seedance-2.5', 200, now() - interval '7 hours', now() - interval '6 hours 5 minutes')`,
      [stale6hId, f.orgId, f.ids.owner],
    );
    await f.sql.query(
      "insert into brand_studio_outputs (job_id, organization_id, idx, kind) values ($1, $3, 0, 'video'), ($2, $3, 0, 'video')",
      [mcpRunningId, stale6hId, f.orgId],
    );

    // Seed discount code attempts: 2 older than 1 day, 1 recent (within 30 min)
    await f.sql.query(
      `insert into brand_discount_code_attempts (organization_id, actor_id, succeeded, created_at)
       values ($1, $2, false, now() - interval '25 hours'),
              ($1, $2, false, now() - interval '48 hours'),
              ($1, $2, false, now() - interval '30 minutes')`,
      [f.orgId, f.ids.owner],
    );

    const req = () =>
      new Request('https://twings.app/api/brand-rooms/notices/tick', {
        headers: { authorization: 'Bearer cron-secret-test' },
      });

    const tickRes = await noticesTick.GET(req());
    expect(tickRes.status).toBe(200);
    expect(await tickRes.json()).toEqual({ ok: true, ran: false, studio: { released: 0, expired: 1 } });

    // Healthy 35-minute sunra_mcp job stays running with full estimate_krw; 6h job failed with 10-minute message!
    const jobs = (
      await f.sql.query<{ id: string; status: string; estimate_krw: number; error_detail: string | null }>(
        'select id, status, estimate_krw, error_detail from brand_studio_jobs where id = any($1::uuid[])',
        [[mcpRunningId, stale6hId]],
      )
    ).rows;
    expect(jobs.find((j) => j.id === mcpRunningId)).toMatchObject({ status: 'running', estimate_krw: 400 });
    expect(jobs.find((j) => j.id === stale6hId)).toMatchObject({
      status: 'failed',
      error_detail: 'expired by the 10-minute reservation sweep',
    });
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(400);

    // Only recent (<1 day) attempt remains after bounded prune
    const attempts = (
      await f.sql.query<{ n: number }>('select count(*)::int as n from brand_discount_code_attempts where organization_id = $1', [
        f.orgId,
      ])
    ).rows[0]?.n;
    expect(attempts).toBe(1);
  });
});
