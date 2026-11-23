import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { loadAllowance } from '@/lib/brand-studio/usage';
import {
  BRAND_DISCOUNT_CODE_ALPHABET,
  createBrandDiscountCode,
  disableBrandDiscountCode,
  draftBrandInvoice,
  endBrandDiscount,
  generateBrandDiscountCode,
  grantBrandDiscount,
  issueBrandInvoice,
  listBrandDiscountCodes,
  listBrandDiscounts,
  loadActiveBrandDiscount,
  redeemBrandDiscountCode,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { setPlanAssignment } from '@/lib/brands/plans';
import { createBrandOrganization } from '@/lib/brands/workspace/service';
import { seedProfile } from '@/tests/helpers/billing';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = (): Viewer => viewerOf(f.ids.owner);
const editor = (): Viewer => viewerOf(f.ids.editor);

beforeEach(async () => {
  f = await studioFixture({ capKrw: 500_000 });
  deps = studioDeps(f.sql);
  await setPlanAssignment({ sql: f.sql }, admin(), {
    organizationId: f.orgId,
    planId: 'b2b_49',
    startedOn: '2026-10-01',
    expectedRevision: 0,
  });
});

afterEach(async () => {
  await f.db.close();
});

describe('per-organization discount lifecycle (count-based)', () => {
  it('grants 40% for 3 invoices, consumes on issue, auto-ends at 3, restores on void, and never alters credits/allowance', async () => {
    const t0 = new Date('2026-11-01T00:00:00Z');
    const beforeAllowance = await loadAllowance(f.sql, f.orgId, deps.env, t0);
    const granted = await grantBrandDiscount(
      { sql: f.sql, now: () => t0 },
      admin(),
      { organizationId: f.orgId, percent: 40, invoicesTotal: 3, memo: '40% off 3 months' },
    );
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    expect(granted.discount).toMatchObject({ percent: 40, invoicesTotal: 3, invoicesUsed: 0, status: 'active' });

    // Discount never changes studio allowance or per-run quote!
    expect(await loadAllowance(f.sql, f.orgId, deps.env, t0)).toEqual(beforeAllowance);
    const job = await createStudioJob(deps, owner(), {
      kind: 'image',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedream-5.5',
      prompt: 'bottle',
      aspect: '1:1',
      resolution: '2K',
      count: 1,
    });
    expect(job.ok).toBe(true);
    if (job.ok) expect(job.job.estimateKrw).toBe(70); // exact list quote untouched by 40% plan fee discount

    // Invoice #1, #2, #3
    let thirdInvoiceId = '';
    for (const [idx, period] of ['2026-11', '2026-12', '2027-01'].entries()) {
      const drafted = await draftBrandInvoice({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: f.orgId,
        period,
      });
      expect(drafted.ok).toBe(true);
      if (!drafted.ok) return;
      expect(drafted.invoice).toMatchObject({
        listKrw: 490_000,
        discountPercent: 40,
        discountKrw: 196_000,
        supplyKrw: 294_000,
        vatKrw: 29_400,
        totalKrw: 323_400,
      });
      const issued = await issueBrandInvoice({ sql: f.sql, now: () => t0 }, admin(), { invoiceId: drafted.invoice.id });
      expect(issued.ok).toBe(true);
      if (idx === 2) thirdInvoiceId = drafted.invoice.id;
    }

    // Discount auto-ended at 3/3!
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toBeNull();
    const historyAfter3 = await listBrandDiscounts(f.sql, f.orgId);
    expect(historyAfter3[0]).toMatchObject({
      id: granted.discount.id,
      status: 'ended',
      invoicesUsed: 3,
      endReason: 'exhausted',
    });

    // Invoice #4 gets 0% discount
    const fourth = await draftBrandInvoice({ sql: f.sql, now: () => t0 }, admin(), {
      organizationId: f.orgId,
      period: '2027-02',
    });
    expect(fourth.ok).toBe(true);
    if (fourth.ok) expect(fourth.invoice.discountPercent).toBe(0);

    // Voiding invoice #3 returns 1 use and re-activates the discount
    const voided = await voidBrandInvoice({ sql: f.sql, now: () => t0 }, admin(), {
      invoiceId: thirdInvoiceId,
      reason: 'reissue with correction',
    });
    expect(voided.ok).toBe(true);
    const reactivated = await loadActiveBrandDiscount(f.sql, f.orgId);
    expect(reactivated).toMatchObject({
      id: granted.discount.id,
      status: 'active',
      invoicesUsed: 2,
      invoicesRemaining: 1,
    });
  });

  it('replaces an existing active discount when a new one is granted and supports manual ending', async () => {
    const first = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 20,
      invoicesTotal: null,
      memo: 'open ended',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 40,
      invoicesTotal: 2,
      memo: 'upgrade discount',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.replacedDiscountId).toBe(first.discount.id);

    const history = await listBrandDiscounts(f.sql, f.orgId);
    expect(history).toHaveLength(2);
    expect(history.find((d) => d.id === first.discount.id)).toMatchObject({ status: 'ended', endReason: 'replaced' });
    expect(history.find((d) => d.id === second.discount.id)).toMatchObject({ status: 'active' });

    const ended = await endBrandDiscount({ sql: f.sql }, admin(), { organizationId: f.orgId, reason: 'contract changed' });
    expect(ended.ok).toBe(true);
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toBeNull();
  });
});

describe('discount codes & redemption security', () => {
  it('enforces uppercase codes, generic failures, org binding, higher-% replacement, rate limit & concurrency', async () => {
    let now = new Date('2026-11-15T00:00:00Z');
    const clock = () => now;

    // Create other org
    const orgBOwner = randomUUID();
    await seedProfile(f.sql, { id: orgBOwner, email: 'orgb@example.test' });
    const ownerB: Viewer = { userId: orgBOwner, isAdmin: false, tier: 'free', email: 'orgb@example.test', locale: 'ko' };
    const orgBRes = await createBrandOrganization({ sql: f.sql }, ownerB, { name: 'Org B', requestId: randomUUID() });
    if (!orgBRes.ok) throw new Error(orgBRes.code);
    const orgB = orgBRes.id;

    // Non-owner cannot redeem (editor gets forbidden)
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, editor(), { organizationId: f.orgId, code: 'ANYCODE-10' })).toMatchObject({
      ok: false,
      code: 'forbidden',
    });

    // Invalid format / <10 chars create refused; valid >=10 lowercase normalized to uppercase
    expect(await createBrandDiscountCode({ sql: f.sql }, admin(), { code: 'bad!', percent: 30 })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await createBrandDiscountCode({ sql: f.sql }, admin(), { code: 'TOO-SHORT', percent: 30 })).toMatchObject({ ok: false, code: 'invalid' });
    const cMain = await createBrandDiscountCode(
      { sql: f.sql, now: clock },
      admin(),
      { code: ' launch-30-ok ', percent: 30, invoicesTotal: 3, maxRedemptions: 2, validUntil: '2026-12-01T00:00:00Z', memo: 'launch promo' },
    );
    expect(cMain.ok).toBe(true);
    if (cMain.ok) expect(cMain.discountCode.code).toBe('LAUNCH-30-OK');

    // Happy path redemption on org A
    const r1 = await redeemBrandDiscountCode({ sql: f.sql, now: clock }, owner(), { organizationId: f.orgId, code: 'launch-30-ok' });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.discount).toMatchObject({ percent: 30, invoicesTotal: 3, source: 'code' });

    // Second redemption of same code by same org ALSO returns generic code_unavailable (no 409 oracle!)
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, owner(), { organizationId: f.orgId, code: 'LAUNCH-30-OK' })).toEqual({
      ok: false,
      code: 'code_unavailable',
    });

    // Lower or equal percent code ALSO returns generic code_unavailable while active discount is 30%
    await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), { code: 'LOWER-20-OFF', percent: 20, maxRedemptions: 5 });
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, owner(), { organizationId: f.orgId, code: 'LOWER-20-OFF' })).toEqual({
      ok: false,
      code: 'code_unavailable',
    });

    // Higher percent code replaces existing 30% discount and records both
    await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), { code: 'VIP-50-OFFER', percent: 50, invoicesTotal: 2, maxRedemptions: 5 });
    const upgraded = await redeemBrandDiscountCode({ sql: f.sql, now: clock }, owner(), { organizationId: f.orgId, code: 'VIP-50-OFFER' });
    expect(upgraded.ok).toBe(true);
    if (upgraded.ok && r1.ok) {
      expect(upgraded.replacedDiscountId).toBe(r1.discount.id);
      expect(upgraded.discount.percent).toBe(50);
    }

    // Wrong, expired, disabled, bound-to-another-org ALL return identical 'code_unavailable'
    await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), {
      code: 'EXPIRED-10',
      percent: 10,
      validUntil: '2026-11-10T00:00:00Z',
    });
    const toDisable = await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), { code: 'DISABL-10-XX', percent: 10 });
    if (toDisable.ok) await disableBrandDiscountCode({ sql: f.sql }, admin(), { codeId: toDisable.discountCode.id });
    await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), { code: 'BOUND-ORG-B', percent: 15, organizationId: orgB });

    // Check generic refusal on orgB (fresh attempt budget)
    for (const badCode of ['NOPE-999-XXX', 'EXPIRED-10', 'DISABL-10-XX']) {
      expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerB, { organizationId: orgB, code: badCode })).toEqual({
        ok: false,
        code: 'code_unavailable',
      });
    }
    // Check org-bound code refused on orgA (need fresh time window first after 4 attempts on orgA)
    now = new Date(now.getTime() + 11 * 60_000);
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, owner(), { organizationId: f.orgId, code: 'BOUND-ORG-B' })).toEqual({
      ok: false,
      code: 'code_unavailable',
    });

    // DB-backed rate limit: 5 attempts within 10 min on a fresh org -> 6th returns rate_limited
    const orgCOwner = randomUUID();
    await seedProfile(f.sql, { id: orgCOwner, email: 'orgc@example.test' });
    const ownerC: Viewer = { userId: orgCOwner, isAdmin: false, tier: 'free', email: 'orgc@example.test', locale: 'ko' };
    const orgCRes = await createBrandOrganization({ sql: f.sql }, ownerC, { name: 'Org C', requestId: randomUUID() });
    if (!orgCRes.ok) throw new Error(orgCRes.code);
    const orgC = orgCRes.id;

    for (let i = 0; i < 5; i++) {
      expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerC, { organizationId: orgC, code: `MISSING-00${i}` })).toEqual({
        ok: false,
        code: 'code_unavailable',
      });
    }
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerC, { organizationId: orgC, code: 'VIP-50-OFFER' })).toEqual({
      ok: false,
      code: 'rate_limited',
    });

    // Advance clock > 10 minutes -> rate limit clears and VIP-50-OFFER succeeds
    now = new Date(now.getTime() + 10 * 60_000 + 1000);
    expect((await redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerC, { organizationId: orgC, code: 'VIP-50-OFFER' })).ok).toBe(true);

    // Concurrency: two orgs simultaneously redeem maxRedemptions = 1 code -> exactly one succeeds
    await createBrandDiscountCode({ sql: f.sql, now: clock }, admin(), {
      code: 'ONE-ONLY-CODE',
      percent: 60,
      invoicesTotal: 1,
      maxRedemptions: 1,
    });
    now = new Date(now.getTime() + 11 * 60_000);
    const concurrent = await Promise.all([
      redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerB, { organizationId: orgB, code: 'ONE-ONLY-CODE' }),
      redeemBrandDiscountCode({ sql: f.sql, now: clock }, ownerC, { organizationId: orgC, code: 'ONE-ONLY-CODE' }),
    ]);
    expect(concurrent.filter((r) => r.ok)).toHaveLength(1);
    expect(concurrent.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'code_unavailable' }]);

    const oneOnly = (await listBrandDiscountCodes(f.sql)).find((c) => c.code === 'ONE-ONLY-CODE');
    expect(oneOnly?.redeemedCount).toBe(1);
  });

  it('S6: enforces 10/hour per-user rate limit across orgs and generates >=12-char unambiguous codes', async () => {
    expect(BRAND_DISCOUNT_CODE_ALPHABET).toHaveLength(31);
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(BRAND_DISCOUNT_CODE_ALPHABET).not.toContain(ambiguous);
    }
    const generated = generateBrandDiscountCode();
    expect(generated.length).toBeGreaterThanOrEqual(12);
    expect([...generated].every((ch) => BRAND_DISCOUNT_CODE_ALPHABET.includes(ch))).toBe(true);

    // createBrandDiscountCode auto-generates an unambiguous >=12 char code when code is omitted
    const autoCreated = await createBrandDiscountCode({ sql: f.sql }, admin(), { percent: 15, maxRedemptions: 1 });
    expect(autoCreated.ok).toBe(true);
    if (autoCreated.ok) {
      expect(autoCreated.discountCode.code.length).toBeGreaterThanOrEqual(12);
      expect([...autoCreated.discountCode.code].every((ch) => BRAND_DISCOUNT_CODE_ALPHABET.includes(ch))).toBe(true);
    }

    // One user creates 3 orgs and makes 4 + 4 + 2 = 10 failed attempts within 1 hour -> 11th on a fresh 3rd/4th org is rate_limited
    const clock = () => new Date('2026-11-15T05:00:00Z');
    const multiUserId = randomUUID();
    await seedProfile(f.sql, { id: multiUserId, email: 'multi@example.test' });
    const multiViewer: Viewer = { userId: multiUserId, isAdmin: false, tier: 'free', email: 'multi@example.test', locale: 'ko' };
    const orgIds: string[] = [];
    for (const label of ['M1', 'M2', 'M3']) {
      const created = await createBrandOrganization({ sql: f.sql }, multiViewer, { name: label, requestId: randomUUID() });
      if (!created.ok) throw new Error(created.code);
      orgIds.push(created.id);
    }

    for (let i = 0; i < 4; i++) {
      expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, multiViewer, { organizationId: orgIds[0]!, code: `MISS-CODE-A${i}` })).toEqual({
        ok: false,
        code: 'code_unavailable',
      });
      expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, multiViewer, { organizationId: orgIds[1]!, code: `MISS-CODE-B${i}` })).toEqual({
        ok: false,
        code: 'code_unavailable',
      });
    }
    for (let i = 0; i < 2; i++) {
      expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, multiViewer, { organizationId: orgIds[2]!, code: `MISS-CODE-C${i}` })).toEqual({
        ok: false,
        code: 'code_unavailable',
      });
    }

    // Org 3 has only used 2/5 of its org limit, yet the USER already hit 10/hour across orgs -> rate_limited!
    expect(await redeemBrandDiscountCode({ sql: f.sql, now: clock }, multiViewer, { organizationId: orgIds[2]!, code: 'MISS-11TH-XX' })).toEqual({
      ok: false,
      code: 'rate_limited',
    });
  });

  it('S10: conditional SQL UPDATE (redeemed_count < max_redemptions) returns 0 rows on interleaved second writer without JS mutex', async () => {
    // PGlite has a single connection whose runner serializes transactions via a JS mutex.
    // To prove the SQL WHERE guard itself stops lost updates even without FOR UPDATE serialization,
    // we interleave two writers on an un-mutexed runner so BOTH execute SELECT before either executes UPDATE.
    const now = new Date('2026-11-15T06:00:00Z');
    const orgBOwner = randomUUID();
    const orgCOwner = randomUUID();
    await seedProfile(f.sql, { id: orgBOwner, email: 'b2@example.test' });
    await seedProfile(f.sql, { id: orgCOwner, email: 'c2@example.test' });
    const viewerB: Viewer = { userId: orgBOwner, isAdmin: false, tier: 'free', email: 'b2@example.test', locale: 'ko' };
    const viewerC: Viewer = { userId: orgCOwner, isAdmin: false, tier: 'free', email: 'c2@example.test', locale: 'ko' };
    const orgB = await createBrandOrganization({ sql: f.sql }, viewerB, { name: 'Interleave B', requestId: randomUUID() });
    const orgC = await createBrandOrganization({ sql: f.sql }, viewerC, { name: 'Interleave C', requestId: randomUUID() });
    if (!orgB.ok || !orgC.ok) throw new Error('org setup failed');

    const createdCode = await createBrandDiscountCode({ sql: f.sql, now: () => now }, admin(), {
      code: 'SQL-RACE-ONE',
      percent: 50,
      invoicesTotal: 1,
      maxRedemptions: 1,
    });
    if (!createdCode.ok) throw new Error('code create failed');

    let readBarrierCount = 0;
    let releaseReads!: () => void;
    const bothReadsDone = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    let sqlGuardRejections = 0;

    // Interleaving runner executes each statement on PGlite directly (no singleConnectionTransaction mutex)
    // and pauses right after BOTH callers select the unredeemed code row!
    const interleavedSql: SqlRunner = {
      async query<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
        const res = await f.sql.query<T>(text, params);
        if (text.includes('from brand_discount_codes where code =')) {
          readBarrierCount += 1;
          if (readBarrierCount === 2) releaseReads();
          await bothReadsDone;
        }
        if (text.includes('update brand_discount_codes') && text.includes('redeemed_count < max_redemptions') && res.rows.length === 0) {
          sqlGuardRejections += 1;
        }
        return res;
      },
      async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
        return fn(interleavedSql);
      },
    };

    const [resB, resC] = await Promise.all([
      redeemBrandDiscountCode({ sql: interleavedSql, now: () => now }, viewerB, { organizationId: orgB.id, code: 'SQL-RACE-ONE' }),
      redeemBrandDiscountCode({ sql: interleavedSql, now: () => now }, viewerC, { organizationId: orgC.id, code: 'SQL-RACE-ONE' }),
    ]);

    expect([resB, resC].filter((r) => r.ok)).toHaveLength(1);
    expect([resB, resC].filter((r) => !r.ok)).toEqual([{ ok: false, code: 'code_unavailable' }]);
    expect(sqlGuardRejections).toBe(1);

    const finalCode = (await listBrandDiscountCodes(f.sql)).find((c) => c.code === 'SQL-RACE-ONE');
    expect(finalCode?.redeemedCount).toBe(1);
  });

  it('R2-(1)&(4): locks organization before profile (FOR NO KEY UPDATE) and executes identical query count for existing and missing codes', async () => {
    let clockTime = new Date('2026-11-15T07:00:00Z');
    await createBrandDiscountCode({ sql: f.sql, now: () => clockTime }, admin(), {
      code: 'EXPIRED-2026-X',
      percent: 20,
      validUntil: '2026-11-10T00:00:00Z',
    });
    await createBrandDiscountCode({ sql: f.sql, now: () => clockTime }, admin(), {
      code: 'VALID-40-2026X',
      percent: 40,
      invoicesTotal: 2,
    });
    expect(
      (await redeemBrandDiscountCode({ sql: f.sql, now: () => clockTime }, owner(), { organizationId: f.orgId, code: 'VALID-40-2026X' })).ok,
    ).toBe(true);

    clockTime = new Date(clockTime.getTime() + 15 * 60_000);
    // Warm schema cache first so we measure only operational SQL queries cleanly
    await redeemBrandDiscountCode({ sql: f.sql, now: () => clockTime }, owner(), {
      organizationId: f.orgId,
      code: 'WARMUP-CODE-1',
    });

    clockTime = new Date(clockTime.getTime() + 15 * 60_000);
    type Runner = Parameters<typeof redeemBrandDiscountCode>[0]['sql'];
    const statements: string[] = [];
    const trace = (runner: Runner): Runner => ({
      query: async (sqlText, params) => {
        statements.push(String(sqlText).replace(/\s+/g, ' ').trim());
        return runner.query(sqlText, params);
      },
      transaction: async (fn) => runner.transaction(async (tx) => fn(trace(tx))),
    });
    const tracedSql = trace(f.sql);
    const queryCounts: number[] = [];

    for (const candidate of ['BAD!', 'MISSING-2026-1', 'EXPIRED-2026-X', 'VALID-40-2026X']) {
      statements.length = 0;
      const outcome = await redeemBrandDiscountCode({ sql: tracedSql, now: () => clockTime }, owner(), {
        organizationId: f.orgId,
        code: candidate,
      });
      expect(outcome).toEqual({ ok: false, code: 'code_unavailable' });
      queryCounts.push(statements.length);

      // R2-(1): brand_organizations FOR UPDATE strictly precedes profiles FOR NO KEY UPDATE (never profiles FOR UPDATE!)
      const orgLockIdx = statements.findIndex((s) => s.includes('from brand_organizations') && s.includes('for update'));
      const profLockIdx = statements.findIndex((s) => s.includes('from profiles') && s.includes('for no key update'));
      expect(orgLockIdx).toBeGreaterThanOrEqual(0);
      expect(profLockIdx).toBeGreaterThan(orgLockIdx);
      expect(statements.some((s) => s.includes('from profiles') && /\bfor update\b/i.test(s))).toBe(false);
    }

    // R2-(4): invalid syntax, missing code, expired code, already-redeemed/active code take IDENTICAL SQL query counts!
    expect(new Set(queryCounts).size).toBe(1);
  });
});
