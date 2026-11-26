import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, coreMigrationFiles, expectReject, freshDb, glueMigrationFiles } from '../../helpers/pglite';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.6, slice 4a — migrations 0198 (core) and 0199 (glue). Pinned:
 *  - 0198 applies on the full chain, twice; every check it replaces still accepts every shape the rooms write today
 *    (team text lines, event lines, storyboard and review refs, replies, the general channel, every notice kind);
 *  - the members channel's shapes are accepted, and the bad ones are refused by the named check: a malformed members
 *    channel, a ref_key of an unknown kind, a file ref on a team channel, a storyboard ref on a members channel, an event
 *    or a team line or a team call or an attachment on a members channel, a member_reply notice without its channel;
 *  - a reply stays in its root's channel; a thread read mark belongs to a line of its own organization;
 *  - brand_room_thread_reads is closed from the moment it exists (RLS on and forced, no policy), and 0199 gives the
 *    server role select, insert and update on it only.
 */
const CORE = '0198_core_brand_send.sql';
const GLUE = '0199_glue_brand_send.sql';

let db: PGlite;
let org: string;
let other: string;
let user: string;
let project: string;

beforeEach(async () => {
  db = await freshDb();
  user = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [user]);
  await db.query('insert into profiles (id, email) values ($1, $2)', [user, `${user}@fixture.invalid`]);
  org = randomUUID();
  other = randomUUID();
  for (const id of [org, other]) await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, `Org ${id.slice(0, 4)}`, user, randomUUID()]);
  project = randomUUID();
  await db.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
      values ($1, $2, 'Spring launch', 'Launch the spring line', 'creator', $3, $4, true)`,
    [project, org, user, randomUUID()],
  );
});
afterEach(async () => {
  await db.close();
});

type Row = Record<string, unknown>;
async function insertLine(over: Row = {}): Promise<string> {
  const row: Row = { id: randomUUID(), organization_id: org, project_id: null, channel: 'general', author_id: user, author_role: 'brand', kind: 'text', body: 'Hello', ...over };
  const keys = Object.keys(row);
  await db.query(
    `insert into brand_room_messages (${keys.join(', ')}) values (${keys.map((k, i) => (k === 'ref' || k === 'detail' || k === 'attachments' ? `$${i + 1}::jsonb` : k === 'mentions' ? `$${i + 1}::uuid[]` : `$${i + 1}`)).join(', ')})`,
    keys.map((k) => (k === 'ref' || k === 'detail' || k === 'attachments' ? JSON.stringify(row[k]) : row[k])),
  );
  return String(row.id);
}
const fileRef = (kind: 'output' | 'asset' = 'output', id = randomUUID()) => ({ ref: kind === 'output' ? { kind, outputId: id } : { kind, assetId: id }, ref_key: `${kind}:${id}` });
const membersRoot = (over: Row = {}) => insertLine({ project_id: project, channel: `members:${project}`, ...fileRef(), ...over });
async function refused(over: Row, constraint: RegExp): Promise<void> {
  expect(await expectReject(() => insertLine(over)), JSON.stringify(over)).toMatch(constraint);
}

describe('0198 — the members channel on brand_room_messages', () => {
  it('applies after every earlier core file, and a second time without error', async () => {
    const files = coreMigrationFiles();
    expect(files).toContain(CORE);
    expect(files.indexOf(CORE)).toBeGreaterThan(files.indexOf('0196_core_brand_news.sql'));
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    await membersRoot();
  });

  it('every shape the rooms write today still passes (the replaced checks are supersets)', async () => {
    const general = await insertLine();
    await insertLine({ parent_id: general, body: 'A reply in general' });
    const team = await insertLine({ project_id: project, channel: project, author_role: 'studio', body: 'Team line' });
    await insertLine({ project_id: project, channel: project, parent_id: team, body: 'Brand reply', mentions: [user], mentions_team: true });
    await insertLine({ project_id: project, channel: project, ref: { kind: 'storyboard', storyboardId: randomUUID() }, ref_key: `storyboard:${randomUUID()}` });
    await insertLine({ project_id: project, channel: project, ref: { kind: 'review', reviewId: randomUUID() }, ref_key: `review:${randomUUID()}:${randomUUID()}` });
    await insertLine({ project_id: project, channel: project, author_id: null, author_role: 'system', kind: 'event', event: 'storyboard_shared', body: '', detail: { title: 'Board' }, ref: { kind: 'storyboard', storyboardId: randomUUID() }, ref_key: `storyboard:${randomUUID()}` });
    await insertLine({ body: '', attachments: [{ key: 'st/x', name: 'brief.pdf' }] });
    // Re-applying 0198 over these rows succeeds: every existing row passes every new check.
    await db.exec(readFileSync(join(MIGRATIONS_DIR, CORE), 'utf8'));
    expect(Number((await db.query<{ n: number }>('select count(*)::int as n from brand_room_messages')).rows[0]!.n)).toBe(8);
  });

  it('accepts a members root for a filed and for an unfiled file, and a reply in its root channel', async () => {
    const root = await membersRoot();
    await insertLine({ project_id: project, channel: `members:${project}`, parent_id: root, ...fileRef(), mentions: [user] });
    const unfiled = await insertLine({ project_id: null, channel: 'members', ...fileRef('asset') });
    await insertLine({ project_id: null, channel: 'members', parent_id: unfiled, ...fileRef('asset') });
  });

  it('refuses a malformed members channel, or one that names another project', async () => {
    await refused({ project_id: project, channel: 'members:not-a-uuid', ...fileRef() }, /brand_room_messages_channel/);
    await refused({ project_id: project, channel: `members:${randomUUID()}`, ...fileRef() }, /brand_room_messages_channel/);
    await refused({ project_id: project, channel: `members:${project.toUpperCase()}`, ...fileRef() }, /brand_room_messages_channel/);
    await refused({ project_id: null, channel: `members:${project}`, ...fileRef() }, /brand_room_messages_channel/);
    await refused({ project_id: project, channel: 'members', ...fileRef() }, /brand_room_messages_channel/);
    await refused({ project_id: null, channel: 'membersx', ...fileRef() }, /brand_room_messages_channel/);
  });

  it('refuses a ref_key of an unknown kind or with a sub-key on a file', async () => {
    await refused({ project_id: project, channel: project, ref: { kind: 'film' }, ref_key: `film:${randomUUID()}` }, /brand_room_messages_ref_key/);
    await refused({ project_id: project, channel: `members:${project}`, ref: { kind: 'film' }, ref_key: `film:${randomUUID()}` }, /brand_room_messages_(ref_key|members_ref|members_line)/);
    await refused({ project_id: project, channel: `members:${project}`, ref: { kind: 'output' }, ref_key: `output:${randomUUID()}:${randomUUID()}` }, /brand_room_messages_ref_key/);
    await refused({ project_id: project, channel: `members:${project}`, ref: { kind: 'output' }, ref_key: 'output:nope' }, /brand_room_messages_ref_key/);
  });

  it('keeps file refs on members channels and team refs off them', async () => {
    await refused({ project_id: project, channel: project, ...fileRef() }, /brand_room_messages_members_ref/);
    await refused({ project_id: null, channel: 'general', ...fileRef() }, /brand_room_messages_ref_project|brand_room_messages_members_ref/);
    await refused({ project_id: project, channel: `members:${project}`, ref: { kind: 'storyboard' }, ref_key: `storyboard:${randomUUID()}` }, /brand_room_messages_members_ref/);
  });

  it('a members line is a brand member’s text line with its file and nothing else', async () => {
    const members = { project_id: project, channel: `members:${project}`, ...fileRef() };
    await refused({ ...members, author_role: 'studio' }, /brand_room_messages_members_line/);
    await refused({ ...members, mentions_team: true }, /brand_room_messages_members_line/);
    await refused({ ...members, attachments: [{ key: 'st/x', name: 'a.pdf' }] }, /brand_room_messages_members_line/);
    await refused({ project_id: project, channel: `members:${project}` }, /brand_room_messages_members_line/);
    await refused({ ...members, author_id: null, author_role: 'system', kind: 'event', event: 'storyboard_shared', body: '' }, /brand_room_messages_(members_line|event)/);
  });

  it('a reply cannot leave its root channel (the parent key of 0082)', async () => {
    const root = await membersRoot();
    await refused({ project_id: project, channel: project, parent_id: root }, /brand_room_messages_parent_fk/);
    await refused({ project_id: null, channel: 'members', parent_id: root, ...fileRef() }, /brand_room_messages_parent_fk/);
  });

  it('moving a thread is one statement for its root and its replies (the key is checked at its end)', async () => {
    const root = await membersRoot();
    await insertLine({ project_id: project, channel: `members:${project}`, parent_id: root, ...fileRef() });
    await db.query(`update brand_room_messages set project_id = null, channel = 'members' where id = $1 or parent_id = $1`, [root]);
    expect((await db.query<{ channel: string }>('select distinct channel from brand_room_messages')).rows).toEqual([{ channel: 'members' }]);
    // The root alone cannot move: its reply would be left in the old channel.
    expect(await expectReject(() => db.query(`update brand_room_messages set project_id = $2::uuid, channel = 'members:' || $2::text where id = $1`, [root, project]))).toMatch(/brand_room_messages_parent_fk/);
  });
});

describe('0198 — reads, notices and the thread read marks', () => {
  it('brand_room_reads accepts the members forms besides today’s, and nothing else', async () => {
    for (const channel of ['general', project, 'members', `members:${project}`]) {
      await db.query('insert into brand_room_reads (organization_id, channel, user_id) values ($1, $2, $3)', [org, channel, user]);
    }
    expect(await expectReject(() => db.query('insert into brand_room_reads (organization_id, channel, user_id) values ($1, $2, $3)', [org, 'members:x', user]))).toMatch(/brand_room_reads_channel/);
  });

  const notice = async (over: Row) => {
    const row: Row = { organization_id: org, project_id: project, recipient_id: user, kind: 'mention', message_id: await membersRoot(), timing: 'now', due_at: new Date().toISOString(), ...over };
    const keys = Object.keys(row);
    await db.query(`insert into brand_room_notices (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => row[k]));
  };

  it('accepts member_reply with its members channel, on a project or unfiled; older rows keep a null channel', async () => {
    await notice({ kind: 'member_reply', channel: `members:${project}`, timing: 'none', state: 'skipped', skip_reason: 'rule' });
    await notice({ kind: 'member_reply', project_id: null, channel: 'members', timing: 'none', state: 'skipped', skip_reason: 'rule' });
    await notice({ kind: 'mention', project_id: null, channel: 'members' });
    await notice({ kind: 'team_message', project_id: project });
    await notice({ kind: 'mention', project_id: null });
  });

  it('refuses a member_reply without a members channel, and a channel that does not fit the project', async () => {
    expect(await expectReject(() => notice({ kind: 'member_reply', timing: 'none', state: 'skipped', skip_reason: 'rule' }))).toMatch(/brand_room_notices_member_reply/);
    expect(await expectReject(() => notice({ kind: 'member_reply', channel: project, timing: 'none', state: 'skipped', skip_reason: 'rule' }))).toMatch(/brand_room_notices_member_reply/);
    expect(await expectReject(() => notice({ kind: 'mention', channel: `members:${randomUUID()}` }))).toMatch(/brand_room_notices_channel/);
    expect(await expectReject(() => notice({ kind: 'mention', project_id: null, channel: `members:${project}` }))).toMatch(/brand_room_notices_channel/);
    expect(await expectReject(() => notice({ kind: 'storyboard', project_id: null, channel: 'members' }))).toMatch(/brand_room_notices_general/);
    expect(await expectReject(() => notice({ kind: 'nudge' }))).toMatch(/brand_room_notices_kind/);
  });

  it('a thread read mark names a line of its own organization, one per person and thread', async () => {
    const root = await membersRoot();
    await db.query('insert into brand_room_thread_reads (organization_id, root_message_id, user_id) values ($1, $2, $3)', [org, root, user]);
    expect(await expectReject(() => db.query('insert into brand_room_thread_reads (organization_id, root_message_id, user_id) values ($1, $2, $3)', [org, root, user]))).toMatch(/duplicate|pkey/);
    expect(await expectReject(() => db.query('insert into brand_room_thread_reads (organization_id, root_message_id, user_id) values ($1, $2, $3)', [other, root, randomUUID()]))).toMatch(/foreign key|violates/);
    await db.query('delete from brand_room_messages where id = $1', [root]);
    expect(Number((await db.query<{ n: number }>('select count(*)::int as n from brand_room_thread_reads')).rows[0]!.n)).toBe(0);
  });

  it('brand_room_thread_reads is closed from the moment it exists (RLS on and forced, no policy)', async () => {
    const row = (await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'brand_room_thread_reads'")).rows[0];
    expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect(Number((await db.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'brand_room_thread_reads'")).rows[0]!.n)).toBe(0);
  });
});

describe('0199 — glue', () => {
  const glue = readFileSync(join(MIGRATIONS_DIR, GLUE), 'utf8');
  const statements = glue.replace(/--[^\n]*/g, '');

  it('pairs with 0198, and both files start with the cloud marker', () => {
    expect(glueMigrationFiles()).toContain(GLUE);
    for (const file of [CORE, GLUE]) expect(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').startsWith('-- 클라우드 적용 필요'), file).toBe(true);
  });

  it('closes the new table to browser roles and gives the server role select, insert and update only', () => {
    expect(glue).toContain("'brand_room_thread_reads'");
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated,service_role');
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
    const grants = statements.match(/grant[^;]*;/gi)!.map((g) => g.replace(/\s+/g, ' ').trim());
    expect(grants).toEqual(["grant select,insert,update on public.%I to service_role',t);"]);
    expect(statements).not.toMatch(/delete/i);
  });

  it('re-asserts the posture of the three tables 0198 changed, without touching the server role', () => {
    for (const table of ['brand_room_messages', 'brand_room_reads', 'brand_room_notices']) expect(glue).toContain(`'${table}'`);
    expect(glue).toContain('revoke all on public.%I from public,anon,authenticated\'');
  });
});
