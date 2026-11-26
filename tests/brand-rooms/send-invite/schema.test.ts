import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles } from '../../helpers/pglite';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.5, slice 4c — migrations 0202 (core) and 0203 (glue). Pinned:
 *  - 0202 applies on the full chain and again (re-runnable), and changes no existing table, column or check;
 *  - one row per (line, invitation); the line is of the row's organization (key), the invitation an organization-wide
 *    invitation of the same organization and the line a members line (the guard); bad rows are refused;
 *  - the row goes with its line, its invitation and its organization (cascades);
 *  - brand_room_pending_mentions is closed from the moment it exists (RLS on and forced, no policy), and 0203 gives the
 *    server role select, insert and delete on it only; nobody may call the guard, which still runs as the trigger;
 *  - the report's rollback runs verbatim.
 */
const CORE = '0202_core_brand_send_invite.sql';
const GLUE = '0203_glue_brand_send_invite.sql';

let db: PGlite;
let org: string;
let other: string;
let user: string;
let project: string;
let root: string;
let teamLine: string;
let invite: string;

async function anInvite(organizationId: string, options: { projectId?: string | null; email?: string; role?: string; studio?: boolean; createdBy?: string } = {}): Promise<string> {
  const token = randomUUID();
  return (
    await db.query<{ id: string }>(
      `insert into brand_invites (organization_id, project_id, email, role, token_hash, expires_at, created_by, request_id, issued_by_studio)
         values ($1, $2, $3, $7, $4, now() + interval '7 days', $5, $6, $8) returning id`,
      [organizationId, options.projectId ?? null, options.email ?? `${token.slice(0, 8)}@example.com`, createHash('sha256').update(token).digest('hex'), options.createdBy ?? user, randomUUID(), options.role ?? 'viewer', options.studio ?? false],
    )
  ).rows[0]!.id;
}

async function aMembersRoot(organizationId: string): Promise<string> {
  const file = randomUUID();
  return (
    await db.query<{ id: string }>(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, ref, ref_key)
         values ($1, null, 'members', $2, 'brand', 'text', 'Members only', $3::jsonb, $4) returning id`,
      [organizationId, user, JSON.stringify({ kind: 'output', outputId: file }), `output:${file}`],
    )
  ).rows[0]!.id;
}

const insertRow = (messageId: string, inviteId: string, organizationId: string) =>
  db.query('insert into brand_room_pending_mentions (message_id, invite_id, organization_id) values ($1, $2, $3)', [messageId, inviteId, organizationId]);
const rows = async () => Number((await db.query<{ n: number }>('select count(*)::int as n from brand_room_pending_mentions')).rows[0]!.n);

beforeEach(async () => {
  db = await freshDb();
  user = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [user]);
  await db.query('insert into profiles (id, email) values ($1, $2)', [user, `${user.slice(0, 8)}@example.com`]);
  org = randomUUID();
  other = randomUUID();
  for (const id of [org, other]) await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, `Org ${id.slice(0, 4)}`, user, randomUUID()]);
  project = randomUUID();
  await db.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
      values ($1, $2, 'Spring launch', 'Launch the spring line', 'creator', $3, $4, true)`,
    [project, org, user, randomUUID()],
  );
  root = await aMembersRoot(org);
  teamLine = (
    await db.query<{ id: string }>(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'brand', 'text', 'Team line') returning id`,
      [org, project, project, user],
    )
  ).rows[0]!.id;
  invite = await anInvite(org);
});
afterEach(async () => {
  await db.close();
});

describe('0202 — core', () => {
  it('is in the chain, applies again over existing rows, and changes no existing table', async () => {
    expect(coreMigrationFiles()).toContain(CORE);
    await insertRow(root, invite, org);
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    expect(await rows()).toBe(1);
    const statements = readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8').replace(/--[^\n]*/g, '');
    // Only the new table (and its trigger and function) is created or altered; no existing table, column or check.
    for (const altered of statements.match(/alter\s+table\s+(\w+)/gi) ?? []) expect(altered.split(/\s+/).pop()).toBe('brand_room_pending_mentions');
    expect(statements).not.toMatch(/drop\s+(table|column|constraint)/i);
  });

  it('one row per line and invitation, of the line’s and the invitation’s own organization', async () => {
    await insertRow(root, invite, org);
    expect(await expectReject(() => insertRow(root, invite, org))).toMatch(/duplicate|unique|pkey/i);
    // Another organization's line: the line's key carries its organization.
    const foreignLine = await aMembersRoot(other);
    expect(await expectReject(() => insertRow(foreignLine, invite, org))).toMatch(/foreign key|violates|not a members line of this organization/);
    // Another organization's invitation, written with that organization: the line is not its.
    const foreignInvite = await anInvite(other);
    expect(await expectReject(() => insertRow(root, foreignInvite, other))).toMatch(/foreign key|violates|members line/);
    // Another organization's invitation, written with the line's organization: the guard.
    expect(await expectReject(() => insertRow(root, foreignInvite, org))).toMatch(/not an organization viewer invitation of this organization/);
    // A project invitation makes a guest, never a member: refused.
    const projectInvite = await anInvite(org, { projectId: project });
    expect(await expectReject(() => insertRow(root, projectInvite, org))).toMatch(/not an organization viewer invitation of this organization/);
    // A team channel's line never waits for anyone.
    expect(await expectReject(() => insertRow(teamLine, invite, org))).toMatch(/not a members line/);
    // Made-up ids.
    expect(await expectReject(() => insertRow(randomUUID(), invite, org))).toMatch(/foreign key|violates|members line/);
    expect(await expectReject(() => insertRow(root, randomUUID(), org))).toMatch(/foreign key|violates|organization viewer invitation/);
    // A row cannot be pointed somewhere else either.
    const second = await anInvite(org);
    const elsewhere = await anInvite(other);
    expect(await expectReject(() => db.query('update brand_room_pending_mentions set invite_id = $1', [elsewhere]))).toMatch(/organization viewer invitation|foreign key/);
    expect(await rows()).toBe(1);
    await insertRow(root, second, org);
    expect(await rows()).toBe(2);
  });

  it('the follow-up (M2, L1): only a viewer invitation the team did not issue; created_invite only with the line’s writer as the inviter', async () => {
    for (const [role, studio] of [['editor', false], ['owner', true], ['viewer', true]] as const) {
      const held = await anInvite(org, { role, studio });
      expect(await expectReject(() => insertRow(root, held, org)), `${role} ${studio}`).toMatch(/not an organization viewer invitation of this organization/);
    }
    // The line's writer issued it: a created row is accepted; the default is false.
    const own = await anInvite(org);
    await db.query('insert into brand_room_pending_mentions (message_id, invite_id, organization_id, created_invite) values ($1, $2, $3, true)', [root, own, org]);
    expect((await db.query<{ created_invite: boolean }>('select created_invite from brand_room_pending_mentions where invite_id = $1', [own])).rows).toEqual([{ created_invite: true }]);
    await insertRow(root, invite, org);
    expect((await db.query<{ created_invite: boolean }>('select created_invite from brand_room_pending_mentions where invite_id = $1', [invite])).rows).toEqual([{ created_invite: false }]);
    // Someone else issued it: a row cannot claim the line created it.
    const other = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [other]);
    await db.query('insert into profiles (id, email) values ($1, $2)', [other, `${other.slice(0, 8)}@example.com`]);
    const theirs = await anInvite(org, { createdBy: other });
    expect(await expectReject(() => db.query('insert into brand_room_pending_mentions (message_id, invite_id, organization_id, created_invite) values ($1, $2, $3, true)', [root, theirs, org]))).toMatch(
      /only the line whose writer issued the invitation created it/,
    );
    await insertRow(root, theirs, org);
    expect(await expectReject(() => db.query('update brand_room_pending_mentions set created_invite = true where invite_id = $1', [theirs]))).toMatch(/only the line whose writer/);
  });

  it('goes with its line, its invitation and its organization', async () => {
    await insertRow(root, invite, org);
    await db.query('delete from brand_room_messages where id = $1', [root]);
    expect(await rows()).toBe(0);
    root = await aMembersRoot(org);
    await insertRow(root, invite, org);
    await db.query('delete from brand_invites where id = $1', [invite]);
    expect(await rows()).toBe(0);
    invite = await anInvite(org);
    await insertRow(root, invite, org);
    // The organization: an organization with invitations cannot be deleted before them (0027 gave brand_invites no
    // cascade), and they take the rows with them; the row's own organization key cascades too.
    expect(await expectReject(() => db.query('delete from brand_organizations where id = $1', [org]))).toMatch(/foreign key|violates/);
    await db.query('delete from brand_invites where organization_id = $1', [org]);
    expect(await rows()).toBe(0);
    const fk = (
      await db.query<{ confdeltype: string; target: string }>(
        `select c.confdeltype, c.confrelid::regclass::text as target from pg_constraint c
          where c.conrelid = 'brand_room_pending_mentions'::regclass and c.contype = 'f' order by 2`,
      )
    ).rows;
    expect(fk).toEqual([
      { confdeltype: 'c', target: 'brand_invites' },
      { confdeltype: 'c', target: 'brand_organizations' },
      { confdeltype: 'c', target: 'brand_room_messages' },
    ]);
  });

  it('is closed from the moment it exists (RLS on and forced, no policy, PUBLIC revoked)', async () => {
    const row = (await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'brand_room_pending_mentions'")).rows[0];
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'brand_room_pending_mentions'")).rows[0]!.n)).toBe(0);
  });

  it('the guard runs as the trigger for a role that may not call it (a server-like role with BYPASSRLS)', async () => {
    await db.exec(`
      do $$ begin if not exists (select 1 from pg_roles where rolname = 'send_invite_probe') then create role send_invite_probe nologin bypassrls; end if; end $$;
      grant usage on schema public to send_invite_probe;
      grant select, insert, delete on brand_room_pending_mentions to send_invite_probe;
      grant select on brand_invites, brand_room_messages to send_invite_probe;
      revoke all on function brand_room_pending_mentions_guard() from public, send_invite_probe;
    `);
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege('send_invite_probe','brand_room_pending_mentions_guard()','EXECUTE') as allowed")).rows[0]?.allowed).toBe(false);
    await db.exec('set role send_invite_probe');
    try {
      await insertRow(root, invite, org);
      expect(await expectReject(() => insertRow(teamLine, invite, org))).toMatch(/not a members line/);
    } finally {
      await db.exec('reset role');
    }
    expect(await rows()).toBe(1);
  });
});

describe('0203 — glue', () => {
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
  const statements = glue.replace(/--[^\n]*/g, '');

  it('pairs with 0202, and both files start with the cloud marker', () => {
    expect(glueMigrationFiles()).toContain(GLUE);
    for (const file of [CORE, GLUE]) expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
  });

  it('closes the table to browser roles, gives the server role select, insert and delete only, and nobody the guard', () => {
    expect(glue).toContain("'brand_room_pending_mentions'");
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated,service_role');
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/grant[^;]*to\s+(anon|authenticated|public)\b/i);
    const grants = statements.match(/grant[^;]*;/gi)!.map((g) => g.replace(/\s+/g, ' ').trim());
    expect(grants).toEqual(["grant select,insert,delete on public.%I to service_role',t);"]);
    expect(statements).toMatch(/revoke all on function public\.brand_room_pending_mentions_guard\(\) from public, anon, authenticated, service_role;/);
  });

  it('applies (with the Supabase roles) and again', async () => {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
    await db.exec(glue);
    await db.exec(glue);
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','brand_room_pending_mentions','UPDATE') as allowed")).rows[0]?.allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role','brand_room_pending_mentions','DELETE') as allowed")).rows[0]?.allowed).toBe(true);
    expect((await db.query<{ allowed: boolean }>("select has_table_privilege('authenticated','brand_room_pending_mentions','SELECT') as allowed")).rows[0]?.allowed).toBe(false);
  });
});

/** The rollback the slice 4c report gives, statement for statement: with BRAND_SEND_INVITE off, drop the table and its guard. */
export const ROLLBACK_0202 = `
drop table if exists brand_room_pending_mentions;
drop function if exists brand_room_pending_mentions_guard();
`;

it('the report’s rollback runs verbatim: the table and its guard go, the invitations and lines stay, and 0202 applies again', async () => {
  await insertRow(root, invite, org);
  await db.exec(ROLLBACK_0202);
  expect((await db.query<{ t: string | null }>("select to_regclass('public.brand_room_pending_mentions')::text as t")).rows[0]?.t).toBeNull();
  expect(Number((await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'brand_room_pending_mentions_guard'")).rows[0]!.n)).toBe(0);
  expect(Number((await db.query<{ n: number }>('select count(*)::int as n from brand_invites where id = $1', [invite])).rows[0]!.n)).toBe(1);
  expect(Number((await db.query<{ n: number }>('select count(*)::int as n from brand_room_messages where id = $1', [root])).rows[0]!.n)).toBe(1);
  await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
  await insertRow(root, invite, org);
  expect(await rows()).toBe(1);
});
