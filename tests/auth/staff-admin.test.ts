import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { expectReject, runner } from '@/tests/helpers/pglite';
import { sqlIdentitySource, resolveViewer, type Viewer } from '@/lib/auth/identity';
import { isStaffEmail, TWINGS_STAFF_EMAIL_DOMAIN } from '@/lib/brands/workspace/staff';
import { isBuyer } from '@/lib/brands/usage/core';
import * as s from '@/lib/brands/workspace/service';
import { resolveWorkspaceSelection } from '@/lib/brands/workspace/selection';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * Every account whose email the auth server confirmed on exactly @yagiworkshop.xyz is an admin
 * (0038_core_staff_admin.sql). The DB derives it from `auth.users` only: `profiles.email`, user
 * metadata and anything a browser sends never count. Real PGlite with the Supabase-shaped columns of
 * `auth.users` the policy reads; fixture addresses only.
 *
 * Reproduction (2026-09-24): an existing account, email confirmed on the team domain, profile row
 * present, `is_admin=false` → every admin gate denied it. The first block replays that state on a
 * database migrated only up to 0037, then applies the new migrations like the cloud will.
 */
const STAFF_MIGRATION = '0038_core_staff_admin.sql';
const at = `@${TWINGS_STAFF_EMAIL_DOMAIN}`;
const CONFIRMED = '2026-09-01T00:00:00Z';

const ids = {
  existingStaff: randomUUID(),
  existingStaffManual: randomUUID(),
  manualOutsider: randomUUID(),
  unconfirmedStaff: randomUUID(),
  spoof: randomUUID(),
  lookalike: randomUUID(),
  outsider: randomUUID(),
};
let db: PGlite;
let sql: SqlRunner;

async function authUser(id: string, email: string | null, confirmed: boolean) {
  await sql.query('insert into auth.users (id, email, email_confirmed_at) values ($1,$2,$3)', [id, email, confirmed ? CONFIRMED : null]);
}
async function profile(id: string, email: string, isAdmin = false) {
  await sql.query('insert into profiles (id, email, locale, is_admin) values ($1,$2,$3,$4)', [id, email, 'ko', isAdmin]);
}
async function admin(id: string) {
  return (await sql.query<{ is_admin: boolean; admin_source: string | null }>('select is_admin, admin_source from profiles where id=$1', [id])).rows[0];
}
async function viewerOf(id: string): Promise<Viewer> {
  return resolveViewer({ id }, await sqlIdentitySource(sql).load(id));
}

beforeAll(async () => {
  db = new PGlite();
  // The stub plus the GoTrue columns the policy reads. Still test-only: on Supabase GoTrue owns it.
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
  `);
  const files = coreMigrationFiles();
  expect(files).toContain(STAFF_MIGRATION);
  for (const file of files.filter((f) => f < STAFF_MIGRATION)) await db.exec(readMigration(file));
  sql = runner(db);

  // Production state before the fix.
  await authUser(ids.existingStaff, `dana${at}`, true);
  await profile(ids.existingStaff, `dana${at}`);
  await authUser(ids.existingStaffManual, `yagi${at}`, true);
  await profile(ids.existingStaffManual, `yagi${at}`, true);
  await authUser(ids.manualOutsider, 'founder@example.test', true);
  await profile(ids.manualOutsider, 'founder@example.test', true);
  await authUser(ids.unconfirmedStaff, `pending${at}`, false);
  await profile(ids.unconfirmedStaff, `pending${at}`);
  // The profile/display email claims the team domain; the auth server's confirmed email does not.
  await authUser(ids.spoof, 'spoof@example.test', true);
  await profile(ids.spoof, `lead${at}`);
  await authUser(ids.lookalike, `ops@sub.${TWINGS_STAFF_EMAIL_DOMAIN}`, true);
  await profile(ids.lookalike, `ops@sub.${TWINGS_STAFF_EMAIL_DOMAIN}`);
  await authUser(ids.outsider, 'outsider@example.test', true);
  await profile(ids.outsider, 'outsider@example.test');

  expect((await viewerOf(ids.existingStaff)).isAdmin).toBe(false); // the reported bug

  for (const file of files.filter((f) => f >= STAFF_MIGRATION)) await db.exec(readMigration(file));
});
afterAll(async () => db.close());

describe('team-domain email policy (TS and SQL agree)', () => {
  const cases: [string | null, boolean][] = [
    [`ops${at}`, true],
    [`OPS@YagiWorkshop.XYZ`, true],
    [`  ops${at}  `, true],
    [`ops${at}.evil.test`, false],
    [`ops@evil-${TWINGS_STAFF_EMAIL_DOMAIN}`, false],
    [`ops@sub.${TWINGS_STAFF_EMAIL_DOMAIN}`, false],
    [`ops${at}x`, false],
    ['ops@yagiworkshop.xy', false],
    [`a@b${at}`, false],
    [at, false],
    ['ops@yagiworKshop.xyz', false], // KELVIN SIGN lowercases to "k" in JavaScript
    ['ops@yagiworkshop。xyz', false],
    [`o ps${at}`, false],
    ['', false],
    [null, false],
  ];
  it.each(cases)('%j → %s', async (email, expected) => {
    expect(isStaffEmail(email)).toBe(expected);
    const row = (await sql.query<{ v: boolean }>('select is_twings_staff_email($1) as v', [email])).rows[0]!;
    expect(row.v).toBe(expected);
  });
});

describe('existing accounts (migration backfill)', () => {
  it('promotes the existing confirmed team account and records why', async () => {
    expect(await admin(ids.existingStaff)).toEqual({ is_admin: true, admin_source: 'staff_email' });
    expect(await viewerOf(ids.existingStaff)).toMatchObject({ isAdmin: true, tier: 'admin' });
  });

  it('keeps intentional admins as manual, team domain or not', async () => {
    expect(await admin(ids.existingStaffManual)).toEqual({ is_admin: true, admin_source: 'manual' });
    expect(await admin(ids.manualOutsider)).toEqual({ is_admin: true, admin_source: 'manual' });
  });

  it('leaves unconfirmed, profile-email spoofs, subdomains and everyone else alone', async () => {
    for (const id of [ids.unconfirmedStaff, ids.spoof, ids.lookalike, ids.outsider]) {
      expect(await admin(id)).toEqual({ is_admin: false, admin_source: null });
      expect((await viewerOf(id)).isAdmin).toBe(false);
    }
  });
});

describe('signup, confirmation and email changes', () => {
  it('a new team signup becomes admin once the auth server confirms the address, not before', async () => {
    const id = randomUUID();
    await authUser(id, `new${at}`, false);
    await profile(id, `new${at}`);
    expect(await admin(id)).toEqual({ is_admin: false, admin_source: null });
    await sql.query('update auth.users set email_confirmed_at=$2 where id=$1', [id, CONFIRMED]);
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
  });

  it('an account confirmed before its first login gets the profile already promoted', async () => {
    const id = randomUUID();
    await authUser(id, `oauth${at}`, true);
    await profile(id, `oauth${at}`);
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
  });

  it('leaving the domain revokes a domain grant but never a manual one', async () => {
    const id = randomUUID();
    await authUser(id, `leaver${at}`, true);
    await profile(id, `leaver${at}`);
    await sql.query("update auth.users set email='leaver@example.test' where id=$1", [id]);
    expect(await admin(id)).toEqual({ is_admin: false, admin_source: null });

    await sql.query("update auth.users set email='yagi-new@example.test' where id=$1", [ids.existingStaffManual]);
    expect(await admin(ids.existingStaffManual)).toEqual({ is_admin: true, admin_source: 'manual' });
    await sql.query('update auth.users set email=$2 where id=$1', [ids.existingStaffManual, `yagi${at}`]);
  });

  it('moving onto the domain promotes; a deleted auth user does not', async () => {
    await sql.query('update auth.users set email=$2 where id=$1', [ids.outsider, `joined${at}`]);
    expect(await admin(ids.outsider)).toEqual({ is_admin: true, admin_source: 'staff_email' });
    await sql.query('update auth.users set deleted_at=now() where id=$1', [ids.outsider]);
    expect(await admin(ids.outsider)).toEqual({ is_admin: false, admin_source: null });
    await sql.query("update auth.users set deleted_at=null, email='outsider@example.test' where id=$1", [ids.outsider]);
    expect(await admin(ids.outsider)).toEqual({ is_admin: false, admin_source: null });
  });

  it('fails closed: if revoking fails, the off-domain or unconfirming auth change does not commit', async () => {
    const id = randomUUID();
    await authUser(id, `faulty${at}`, true);
    await profile(id, `faulty${at}`);
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
    // Fault injection: any revocation of a domain grant errors, as a broken sync would.
    await db.exec(`
      create function test_fail_revocation() returns trigger language plpgsql as $$
      begin
        if old.admin_source = 'staff_email' and not new.is_admin then raise exception 'injected sync failure'; end if;
        return new;
      end $$;
      create trigger test_fail_revocation before update on profiles for each row execute function test_fail_revocation();
    `);
    try {
      for (const change of [
        ["update auth.users set email='faulty@example.test' where id=$1", [id]],
        ['update auth.users set email_confirmed_at=null where id=$1', [id]],
        ['update auth.users set deleted_at=now() where id=$1', [id]],
      ] as const) {
        expect(await expectReject(() => sql.query(change[0], [...change[1]]))).toMatch(/injected sync failure/);
      }
      const row = (await sql.query<{ email: string; confirmed: boolean; deleted: boolean }>(
        'select email, email_confirmed_at is not null as confirmed, deleted_at is not null as deleted from auth.users where id=$1', [id])).rows[0];
      expect(row).toEqual({ email: `faulty${at}`, confirmed: true, deleted: false });
      expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
    } finally {
      await db.exec('drop trigger test_fail_revocation on profiles; drop function test_fail_revocation();');
    }
    await sql.query("update auth.users set email='faulty@example.test' where id=$1", [id]);
    expect(await admin(id)).toEqual({ is_admin: false, admin_source: null });
  });

  it('a ban revokes a domain grant, an unban or an expired ban restores it; manual grants stay', async () => {
    const id = randomUUID();
    await authUser(id, `banned${at}`, true);
    await profile(id, `banned${at}`);
    await sql.query("update auth.users set banned_until=now() + interval '100 years' where id=$1", [id]);
    expect(await admin(id)).toEqual({ is_admin: false, admin_source: null });
    await sql.query('update auth.users set banned_until=null where id=$1', [id]);
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
    await sql.query("update auth.users set banned_until=now() - interval '1 day' where id=$1", [id]);
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });

    const bannedFirst = randomUUID();
    await authUser(bannedFirst, `bannedfirst${at}`, true);
    await sql.query("update auth.users set banned_until=now() + interval '1 day' where id=$1", [bannedFirst]);
    await profile(bannedFirst, `bannedfirst${at}`);
    expect(await admin(bannedFirst)).toEqual({ is_admin: false, admin_source: null });

    await sql.query("update auth.users set banned_until=now() + interval '100 years' where id=$1", [ids.manualOutsider]);
    expect(await admin(ids.manualOutsider)).toEqual({ is_admin: true, admin_source: 'manual' });
    await sql.query('update auth.users set banned_until=null where id=$1', [ids.manualOutsider]);
  });

  /**
   * The race itself (first profile insert vs a concurrent auth.users change) needs two connections;
   * PGlite has one. What is checkable here is the mechanism: both paths take the same per-user
   * transaction lock and hold it to commit, so the second one waits and re-reads with a fresh snapshot.
   */
  it('both sync paths hold the per-user transaction lock until commit', async () => {
    const heldLocks = async (tx: SqlRunner) =>
      Number((await tx.query<{ n: number }>(
        "select count(*)::int as n from pg_locks where locktype='advisory' and classid::int=hashtext('twings_staff_admin') and pid=pg_backend_pid()")).rows[0]!.n);
    const id = randomUUID();
    await sql.transaction(async (tx) => {
      await tx.query('insert into auth.users (id, email, email_confirmed_at) values ($1,$2,$3)', [id, `locked${at}`, CONFIRMED]);
      expect(await heldLocks(tx)).toBe(1);
    });
    expect(await heldLocks(sql)).toBe(0);
    await sql.transaction(async (tx) => {
      await tx.query('insert into profiles (id, email, locale) values ($1,$2,$3)', [id, `locked${at}`, 'ko']);
      expect(await heldLocks(tx)).toBe(1);
    });
    expect(await admin(id)).toEqual({ is_admin: true, admin_source: 'staff_email' });
  });

  it('an auth.users change with no profile yet succeeds and changes nothing', async () => {
    const id = randomUUID();
    await authUser(id, `later${at}`, true);
    await sql.query("update auth.users set email='later2@example.test' where id=$1", [id]);
    expect((await sql.query('select 1 from profiles where id=$1', [id])).rows).toEqual([]);
  });

  it('a manual promotion made in SQL is recorded as manual, a demotion clears the source', async () => {
    await sql.query('update profiles set is_admin=true where id=$1', [ids.spoof]);
    expect(await admin(ids.spoof)).toEqual({ is_admin: true, admin_source: 'manual' });
    await sql.query('update profiles set is_admin=false where id=$1', [ids.spoof]);
    expect(await admin(ids.spoof)).toEqual({ is_admin: false, admin_source: null });
  });

  it('writing profiles.email to the team domain grants nothing', async () => {
    await sql.query('update profiles set email=$2 where id=$1', [ids.spoof, `boss${at}`]);
    await sql.query('update auth.users set email_confirmed_at=$2 where id=$1', [ids.spoof, CONFIRMED]);
    expect(await admin(ids.spoof)).toEqual({ is_admin: false, admin_source: null });
  });
});

describe('brand workspaces for a promoted team account', () => {
  const orgs: string[] = [];
  beforeAll(async () => {
    const studio = await viewerOf(ids.manualOutsider);
    for (const name of ['Fixture Brand A', 'Fixture Brand B']) {
      const r = await s.createStudioOrganization({ sql }, studio, { name, requestId: randomUUID() });
      if (!r.ok) throw Error(r.code);
      orgs.push(r.id);
    }
  });
  const memberships = async (userId: string) =>
    Number((await sql.query<{ n: number }>('select (select count(*) from brand_memberships where user_id=$1)+(select count(*) from brand_project_members where user_id=$1) as n', [userId])).rows[0]!.n);

  it('lists and switches to every organization as studio, with no synthetic membership', async () => {
    const staff = await viewerOf(ids.existingStaff);
    const scope = await s.loadBrandWorkspaceScope({ sql }, staff);
    expect(scope.choices.map((c) => c.id).sort()).toEqual([...orgs].sort());
    expect(scope.choices.every((c) => c.role === 'studio')).toBe(true);
    for (const id of orgs) expect(resolveWorkspaceSelection(scope.choices, { query: id })).toMatchObject({ state: 'selected', choice: { id, role: 'studio' } });
    expect(await memberships(ids.existingStaff)).toBe(0);
  });

  it('never makes the team account a buyer, even with an owner seat', async () => {
    expect(await isBuyer(sql, orgs[0]!, ids.existingStaff, 'owner')).toBe(false);
  });

  it('keeps non-team accounts isolated', async () => {
    for (const id of [ids.outsider, ids.spoof, ids.unconfirmedStaff, ids.lookalike]) {
      expect((await s.loadBrandWorkspaceScope({ sql }, await viewerOf(id))).choices).toEqual([]);
    }
  });
});
