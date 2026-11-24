import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAdultConfirmation, recordAdultAnswer } from '@/lib/account/adult-confirmation';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { runner } from '@/tests/helpers/pglite';
import { adminHarness, expectOk, viewerOf, type AdminHarness } from '@/tests/helpers/admin';

/**
 * docs/PERSONAL-STUDIO.md §6.1 — the stored 19+ answer is written once by the person; the only way to
 * change it is this admin operation, which rewrites the birth year (never the ticked box) and leaves an
 * immutable audit row naming the operator and the reason.
 */
const OP = 'account.adultConfirmation.correct';
const member = viewerOf('free');

describe(OP, () => {
  let h: AdminHarness;
  beforeEach(async () => {
    h = await adminHarness();
    await h.db.query('insert into auth.users (id) values ($1) on conflict do nothing', [member.userId]);
  });
  afterEach(async () => { await h.close(); });

  it('is registered', () => {
    expect(ADMIN_OPERATION_NAMES).toContain(OP);
  });

  it('corrects the year with an audit row', async () => {
    const sql = runner(h.db);
    await recordAdultAnswer(sql, member.userId!, { birthYear: 2011, attested: true }, new Date());
    expectOk(await h.run(OP, { userId: member.userId!, birthYear: '1993', reason: 'support ticket: picked the wrong year' }));
    expect(await readAdultConfirmation(sql, member.userId!)).toMatchObject({ birthYear: 1993, attested: true });
    const audit = await sql.query<{ action: string; details: unknown }>("select action, details from platform_audit where entity_id=$1", [member.userId]);
    expect(audit.rows).toEqual([{ action: OP, details: { before: 2011, after: 1993, attested: true } }]);
  });

  it('refuses a non-admin, a missing reason, a bad year and an account that never answered', async () => {
    const sql = runner(h.db);
    expect(await h.run(OP, { userId: member.userId!, birthYear: '1993', reason: 'support ticket' }, member)).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await h.run(OP, { userId: member.userId!, birthYear: '1993' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.run(OP, { userId: member.userId!, birthYear: '93', reason: 'support ticket' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.run(OP, { userId: 'not-a-uuid', birthYear: '1993', reason: 'support ticket' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.run(OP, { userId: member.userId!, birthYear: '1993', reason: 'support ticket' })).toMatchObject({ ok: false, code: 'notFound' });
    expect((await sql.query('select count(*)::int as n from platform_audit')).rows[0]).toEqual({ n: 0 });
  });
});
