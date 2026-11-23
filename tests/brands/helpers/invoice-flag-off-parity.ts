import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Viewer } from '@/lib/auth/identity';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  markBrandInvoicePaid,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing/invoices';
import { setPlanAssignment } from '@/lib/brands/plans';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1a C6, reshaped in B1c: the flag-off admin invoice scenario whose path B1c leaves unchanged. The plan assignment is
 * written for one organization (`setPlan`), and every draft / update / issue / paid / void / list runs for a SECOND
 * organization that has no plan (the calendar-month path). A paid plan organization's drafts are per billing cycle since
 * B1c (a deliberate change, tests/brands/billing-cycle-invoices.test.ts). Recorded from origin/main (14d21d56) into
 * `tests/brands/fixtures/brand-billing-flag-off-legacy-parity.json`, on the schema with and without 0182.
 */
type Logged = { text: string; params: unknown[] };

function recorder(db: PGlite): { sql: SqlRunner; log: Logged[] } {
  const log: Logged[] = [];
  const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    log.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
  return { sql, log };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const normalizeIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null).replace(UUID_RE, '<uuid>'));

/** Every core migration except 0182. */
export async function pre0182Db(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0182_'))) await db.exec(readMigration(file));
  return db;
}

export async function invoiceFlagOffScenario(db: PGlite): Promise<Array<{ op: string; log: unknown; result: unknown }>> {
  const base = runner(db);
  const adminId = randomUUID();
  const ownerId = randomUUID();
  await seedProfile(base, { id: adminId, isAdmin: true, email: 'parity-admin@fixture.invalid' });
  await seedProfile(base, { id: ownerId, email: 'parity-owner@fixture.invalid' });
  const viewer = { userId: adminId, isAdmin: true, tier: 'pro', email: 'parity-admin@fixture.invalid', locale: 'ko' } as Viewer;
  const planOrgId = randomUUID();
  const orgId = randomUUID();
  for (const [id, name] of [[planOrgId, 'Parity Plan Fixture'], [orgId, 'Parity Fixture']] as const) {
    await base.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, ownerId, randomUUID()]);
  }
  const now = () => new Date('2026-11-10T01:00:00Z');
  const out: Array<{ op: string; log: unknown; result: unknown }> = [];
  const run = async <R,>(op: string, fn: (sql: SqlRunner) => Promise<R>): Promise<R> => {
    const r = recorder(db);
    const result = await fn(r.sql);
    out.push({ op, log: normalizeIds(r.log), result: normalizeIds(result) });
    return result;
  };
  await run('setPlan', (sql) =>
    setPlanAssignment({ sql }, viewer, {
      organizationId: planOrgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-05',
      endsOn: null,
      seats: null,
      note: 'x',
      expectedRevision: 0,
    }),
  );
  await base.query(
    "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 20, 2, 'active', $2)",
    [orgId, adminId],
  );
  const id = (r: { ok: boolean }) => (r as unknown as { invoice: { id: string } }).invoice.id;
  const d1 = await run('draft', (sql) => draftBrandInvoice({ sql, now }, viewer, { organizationId: orgId, period: '2026-11', planId: 'b2b_29' }));
  await run('updateDraft', (sql) => updateDraftBrandInvoice({ sql, now }, viewer, { invoiceId: id(d1), memo: 'edited' }));
  await run('issue', (sql) => issueBrandInvoice({ sql, now }, viewer, { invoiceId: id(d1) }));
  await run('markPaid', (sql) => markBrandInvoicePaid({ sql, now }, viewer, { invoiceId: id(d1), paidMethod: 'wire' }));
  await run('markPaidAgain', (sql) => markBrandInvoicePaid({ sql, now }, viewer, { invoiceId: id(d1), paidMethod: 'wire' }));
  const d2 = await run('draft2', (sql) => draftBrandInvoice({ sql, now }, viewer, { organizationId: orgId, period: '2026-12', planId: 'b2b_49' }));
  await run('issue2', (sql) => issueBrandInvoice({ sql, now }, viewer, { invoiceId: id(d2) }));
  await run('voidIssued', (sql) => voidBrandInvoice({ sql, now }, viewer, { invoiceId: id(d2), reason: 'wrong' }));
  const d3 = await run('draftManual', (sql) =>
    draftBrandInvoice({ sql, now }, viewer, {
      organizationId: orgId,
      period: '2027-01',
      planId: 'b2b_29',
      manualAmounts: true,
      manualReason: 'negotiated',
      supplyKrw: 200000,
    }),
  );
  await run('voidDraft', (sql) => voidBrandInvoice({ sql, now }, viewer, { invoiceId: id(d3), reason: 'drop' }));
  await run('draftConflict', (sql) => draftBrandInvoice({ sql, now }, viewer, { organizationId: orgId, period: '2026-11', planId: 'b2b_29' }));
  await run('list', (sql) => listBrandInvoices(sql, { organizationId: orgId, now: now() }));
  return out;
}
