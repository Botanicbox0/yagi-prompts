import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { disableToggle, enableToggle, loadPreferences } from '@/lib/notify/preferences';

/** The closed studio's one button (2026-09-11): it can only ever switch the new-template mail ON. */
describe('enableToggle', () => {
  let db: PGlite;
  let sql: SqlRunner;
  const user = 'f0000000-0000-4000-8000-000000000101';

  beforeEach(async () => {
    db = await freshDb();
    sql = runner(db);
    await seedProfile(sql, { id: user, email: 'interested@twings.test', locale: 'ko', plan: 'free', isAdmin: false });
  });
  afterEach(async () => {
    await db.close();
  });

  it('turns the switch on, idempotently, and leaves the other switch alone', async () => {
    expect((await loadPreferences(sql, user))?.newPlaybook).toBe(false);
    expect(await enableToggle(sql, user, 'notif_new_playbook')).toBe(true);
    expect(await enableToggle(sql, user, 'notif_new_playbook')).toBe(true);
    const after = await loadPreferences(sql, user);
    expect(after).toEqual({ newPlaybook: true, updates: false });
  });

  it('is undone by the account page / unsubscribe path, and says so for an unknown profile', async () => {
    await enableToggle(sql, user, 'notif_new_playbook');
    await disableToggle(sql, user, 'notif_new_playbook');
    expect((await loadPreferences(sql, user))?.newPlaybook).toBe(false);
    expect(await enableToggle(sql, '00000000-0000-4000-8000-000000000000', 'notif_new_playbook')).toBe(false);
  });
});
