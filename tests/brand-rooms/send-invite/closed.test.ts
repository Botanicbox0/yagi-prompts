import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadBrandMembers } from '@/lib/brands/workspace/service';
import { as, closeWorld, imageResult, membersLine, openSend, sendWorld, type SendWorld } from '../send/helpers';
import { invitation, normalizer, person, recording, tokenOf, waiting } from './helpers';

/**
 * 초대하고 보내기 while CLOSED (the coordinator's decision 3; docs/BRAND-PROJECT-SPINE.md §8.5): every send operation and
 * every invitation operation answers byte for byte what origin/main answers, runs the same statements (the remembered
 * `information_schema` probes aside) and leaves the database in the same state, in a world where lines already wait for
 * invitations (the switch turned off after use):
 *  - `BRAND_SEND_INVITE` unset, off, or anything but exactly `on`; on, but the 0202 table absent; on, but 보내기 itself
 *    closed (BRAND_SEND off, the organization not on the spine's list);
 *  - a send that carries `invites` is refused as today's unknown field is (`invalid`), and nothing is written;
 *  - an organization invitation an editor issued through 보내기 is honoured no more (origin/main: only an owner's);
 *  - an acceptance delivers nothing and keeps the waiting rows.
 * Sandboxed and generation- or self_studio-denied organizations: the same answers and the same database as origin/main
 * with the switch ON (their statements may add read-only checks; the report says which).
 *
 * The snapshot was recorded by running THIS file on origin/main's code (the slice's source files checked out from
 * origin/main, its migrations and tests in place), before the slice's code existed; the slice 4c report records that run.
 * `send.lookup` is a new operation: origin/main answers it as an unknown one (`invalid`, before anything), and so does
 * this slice whenever the invitation switch is closed (the follow-up's L4), for everyone: it is recorded in every closed
 * state. In a closed ORGANIZATION with the switch on it exists and answers what every send operation answers there
 * (`not_found`), so it is left out of those snapshots (origin/main: `invalid`).
 * Spine rules R-A (slice R-A server) changed three of 보내기's own statements while it is open, and the four "보내기 open"
 * snapshots were updated for those lines only (the answers are unchanged): the file statement carries the entry's role,
 * the shown-projects statement reads `VISIBLE_PROJECTS` and says whether each can take work, and `send.file` asks one
 * more (the other reference of a saved result's pair).
 */
const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  verified: new Map<string, string>(),
  after: [] as Array<() => unknown>,
}));
vi.mock('next/server', async (original) => ({ ...(await original<typeof import('next/server')>()), after: (callback: () => unknown) => mocks.after.push(callback) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async (userId: string | null | undefined) => (userId ? mocks.verified.get(userId) : undefined) }));
vi.mock('@/lib/notify/service', async (original) => ({ ...(await original<typeof import('@/lib/notify/service')>()), getMailer: () => null }));
vi.mock('@/lib/brands/concierge-slack', () => ({ notifySlackBrandConcierge: async () => ({ sent: false }) }));

const rooms = await import('@/app/api/brand-rooms/messages/route');
const workspace = await import('@/app/api/brand-workspace/route');

let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
  mocks.after.length = 0;
  mocks.verified.clear();
});
afterEach(async () => {
  await closeWorld(w);
  mocks.sql = null;
  mocks.viewer = null;
});

const T = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute, 0)).toISOString();

interface World {
  organizationId: string;
  file: string;
  root: string;
  reply: string;
  invitee: string;
  second: string;
  third: string;
}

/**
 * A deterministic world: a team line, members lines (a root by the editor naming the owner, a reply by the viewer), and
 * two invitations with lines waiting for them, as 초대하고 보내기 leaves them: the owner's invitation of
 * `invitee@example.com` (the root waits for it) and the editor's viewer invitation of `second@example.com` (the reply
 * waits for it).
 */
async function world(organizationId = w.f.orgId, options: { pending?: boolean } = {}): Promise<World> {
  const sql = w.f.sql;
  await sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at, updated_at) values ($1, $2, $3, $4, 'studio', 'text', 'Draft is up', $5, $5)`, [
    w.f.orgId,
    w.f.projectId,
    w.f.projectId,
    w.f.ids.admin,
    T(1),
  ]);
  const file = (await imageResult(w, organizationId === w.f.orgId ? w.f.projectId : null, organizationId)).outputId;
  const projectId = organizationId === w.f.orgId ? w.f.projectId : null;
  const root = await membersLine(sql, { organizationId, projectId, authorId: w.f.ids.editor, body: 'Members only root', file: { kind: 'output', id: file }, mentions: [w.f.ids.owner], at: T(3) });
  const reply = await membersLine(sql, { organizationId, projectId, authorId: w.f.ids.viewer, body: 'Members only reply', file: { kind: 'output', id: file }, parentId: root, at: T(4) });
  // Lists sort by creation time: distinct times keep them deterministic.
  await sql.query(
    `update brand_memberships set created_at = $2::timestamptz + (case role when 'owner' then 0 when 'editor' then 1 else 2 end) * interval '1 second' where organization_id = $1`,
    [organizationId, T(0)],
  );
  const invitee = await person(sql, 'invitee@example.com');
  const second = await person(sql, 'second@example.com');
  const third = await person(sql, 'third@example.com');
  mocks.verified.set(invitee, 'invitee@example.com');
  mocks.verified.set(second, 'second@example.com');
  mocks.verified.set(third, 'third@example.com');
  const a = await invitation(sql, { organizationId, email: 'invitee@example.com', createdBy: w.f.ids.owner, token: tokenOf('a'), ageSeconds: 300 });
  const b = await invitation(sql, { organizationId, email: 'second@example.com', createdBy: w.f.ids.editor, token: tokenOf('b'), ageSeconds: 200 });
  if (options.pending !== false) {
    await waiting(sql, { organizationId, messageId: root, inviteId: a });
    await waiting(sql, { organizationId, messageId: reply, inviteId: b });
  }
  return { organizationId, file, root, reply, invitee, second, third };
}

const roomPost = (operation: string, input: unknown) =>
  rooms.POST(new NextRequest('http://localhost:3000/api/brand-rooms/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));
const workspacePost = (operation: string, input: unknown) =>
  workspace.POST(new NextRequest('http://localhost:3000/api/brand-workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, input }) }));

interface Step {
  name: string;
  status: number;
  body: unknown;
  statements: string[];
}

/** One request as `who`, recorded: the status, the answer and the statements (the remembered schema probes left out). */
async function step(name: string, who: string, run: () => Promise<Response>): Promise<Step> {
  const texts: string[] = [];
  mocks.sql = recording(w.f.sql, texts);
  mocks.viewer = as(who);
  const response = await run();
  const body = await response.json();
  return { name, status: response.status, body, statements: texts.filter((t) => !/information_schema/.test(t)) };
}

/** The database after the steps: lines and their mentions, notices, memberships, invitations, waiting rows. */
async function state(v: World): Promise<unknown> {
  const sql = w.f.sql;
  const lines = (await sql.query('select id::text as id, mentions::text[] as mentions from brand_room_messages where id = any($1::uuid[]) order by created_at', [[v.root, v.reply]])).rows;
  const counts = (
    await sql.query(
      `select (select count(*)::int from brand_room_messages) as messages, (select count(*)::int from brand_room_notices) as notices,
              (select count(*)::int from brand_memberships where organization_id = $1 and status = 'active') as members,
              (select count(*)::int from brand_room_thread_reads) as reads, (select count(*)::int from team_notice_deliveries) as team`,
      [v.organizationId],
    )
  ).rows[0];
  const invites = (
    await sql.query(
      `select email, role, accepted_at is not null as accepted, revoked_at is not null as revoked, mail_state, project_id is null as organization_wide
         from brand_invites where organization_id = $1 order by email, created_at`,
      [v.organizationId],
    )
  ).rows;
  const present = (await sql.query<{ t: string | null }>("select to_regclass('public.brand_room_pending_mentions')::text as t")).rows[0]?.t;
  const pending = present
    ? (
        await sql.query(
          `select pm.message_id::text as message_id, pm.invite_id::text as invite_id from brand_room_pending_mentions pm
             join brand_room_messages m on m.id = pm.message_id join brand_invites i on i.id = pm.invite_id
            order by m.created_at, i.created_at`,
        )
      ).rows
    : null;
  return { lines, counts, invites, pending };
}

/**
 * Every send operation (with valid input, and post/reply carrying `invites`), then every invitation operation: the
 * members page's issue and cancel (owner; an editor refused), the members list, acceptance of the owner's invitation
 * (its line waiting) and of the editor's (its reply waiting).
 */
async function everything(v: World, options: { lookup: boolean }): Promise<{ steps: Step[]; state: unknown }> {
  const org = v.organizationId;
  const steps: Step[] = [];
  const send = (name: string, who: string, operation: string, input: Record<string, unknown>) => step(name, who, () => roomPost(operation, { organizationId: org, ...input }));
  steps.push(await send('people', w.f.ids.owner, 'send.people', {}));
  steps.push(await send('inbox', w.f.ids.owner, 'send.inbox', {}));
  steps.push(await send('thread', w.f.ids.owner, 'send.thread', { rootId: v.root }));
  steps.push(await send('file', w.f.ids.owner, 'send.file', { file: { kind: 'output', outputId: v.file } }));
  steps.push(await send('read', w.f.ids.owner, 'send.read', { rootId: v.root }));
  steps.push(await send('read_all', w.f.ids.editor, 'send.read_all', {}));
  steps.push(await send('post', w.f.ids.editor, 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: v.file }, body: 'hi', mentions: [w.f.ids.owner] }));
  steps.push(await send('reply', w.f.ids.editor, 'send.reply', { requestId: randomUUID(), rootId: v.root, body: 'answer' }));
  steps.push(await send('post with invites', w.f.ids.editor, 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: v.file }, body: 'for you', invites: ['new@example.com'] }));
  steps.push(await send('reply with invites', w.f.ids.owner, 'send.reply', { requestId: randomUUID(), rootId: v.root, body: 'for you', invites: ['new@example.com'] }));
  steps.push(await send('post with an empty invites list', w.f.ids.editor, 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: v.file }, body: 'none', invites: [] }));
  if (options.lookup) steps.push(await send('lookup', w.f.ids.editor, 'send.lookup', { email: 'new@example.com' }));
  steps.push(await step('members page issue (owner)', w.f.ids.owner, () => workspacePost('invitation.create', { organizationId: org, email: 'third@example.com', role: 'viewer', requestId: randomUUID() })));
  steps.push(await step('members page issue (editor)', w.f.ids.editor, () => workspacePost('invitation.create', { organizationId: org, email: 'fourth@example.com', role: 'viewer', requestId: randomUUID() })));
  steps.push(await step('accept the owner’s invitation', v.invitee, () => workspacePost('invitation.accept', { token: tokenOf('a') })));
  steps.push(await step('accept the editor’s invitation', v.second, () => workspacePost('invitation.accept', { token: tokenOf('b') })));
  steps.push(await step('accept with another account', v.third, () => workspacePost('invitation.accept', { token: tokenOf('b') })));
  const third = (await w.f.sql.query<{ id: string }>("select id::text as id from brand_invites where organization_id = $1 and email = 'third@example.com' and revoked_at is null", [org])).rows[0]?.id;
  if (third) steps.push(await step('members page cancel (owner)', w.f.ids.owner, () => workspacePost('invitation.cancel', { organizationId: org, invitationId: third })));
  const members = await loadBrandMembers({ sql: w.f.sql }, as(w.f.ids.owner), org);
  const normal = normalizer();
  return { steps: normal(steps) as Step[], state: normal({ members, state: await state(v) }) };
}

describe('closed: every send and invitation operation as origin/main, in a world where lines already wait', () => {
  const OPEN_SEND: Array<[string, () => Promise<void> | void]> = [
    ['BRAND_SEND_INVITE unset', () => void vi.stubEnv('BRAND_SEND_INVITE', '')],
    ['BRAND_SEND_INVITE off', () => void vi.stubEnv('BRAND_SEND_INVITE', 'off')],
    ['BRAND_SEND_INVITE ON (not exactly on)', () => void vi.stubEnv('BRAND_SEND_INVITE', 'ON')],
    [
      'BRAND_SEND_INVITE on, the 0202 table absent',
      async () => {
        vi.stubEnv('BRAND_SEND_INVITE', 'on');
        await w.f.sql.query('drop table brand_room_pending_mentions');
      },
    ],
  ];
  for (const [name, close] of OPEN_SEND) {
    it(`보내기 open, ${name}`, async () => {
      const v = await world();
      openSend(w.f.orgId);
      await close();
      expect(await everything(v, { lookup: true })).toMatchSnapshot();
    });
  }

  const CLOSED_SEND: Array<[string, () => void]> = [
    ['BRAND_SEND off', () => void vi.stubEnv('BRAND_SEND', 'off')],
    ['the organization not on the spine’s list', () => void vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID())],
  ];
  for (const [name, close] of CLOSED_SEND) {
    it(`BRAND_SEND_INVITE on, 보내기 closed: ${name}`, async () => {
      const v = await world();
      openSend(w.f.orgId);
      vi.stubEnv('BRAND_SEND_INVITE', 'on');
      close();
      expect(await everything(v, { lookup: true })).toMatchSnapshot();
    });
  }
});

describe('closed organizations, the switch on: the answers and the database as origin/main', () => {
  async function closedOrg(how: 'sandboxed' | 'generation' | 'self_studio' | 'project_only'): Promise<string> {
    const sql = w.f.sql;
    const organizationId = how === 'sandboxed' ? [...SANDBOXED_CLIENT_ORG_IDS][0]! : randomUUID();
    await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [organizationId, 'Closed brand', w.f.ids.owner, randomUUID()]);
    for (const role of ['owner', 'editor', 'viewer'] as const) await sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [organizationId, w.f.ids[role], role]);
    if (how === 'generation') await sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])", [organizationId]);
    if (how === 'self_studio') await sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio']::text[])", [organizationId]);
    if (how === 'project_only') await sql.query("insert into brand_plan_assignments (organization_id, plan_id, started_on) values ($1, 'project_only', ((now() at time zone 'Asia/Seoul')::date - 1))", [organizationId]);
    await sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 1000000) on conflict do nothing', [organizationId]);
    return organizationId;
  }

  for (const how of ['sandboxed', 'generation', 'self_studio', 'project_only'] as const) {
    it(`${how}`, async () => {
      openSend('*');
      vi.stubEnv('BRAND_SEND_INVITE', 'on');
      const v = await world(await closedOrg(how));
      const out = await everything(v, { lookup: false });
      // Answers and the database: byte for byte origin/main's. Statements: recorded for the report, not pinned here.
      expect({ steps: (out.steps as Step[]).map(({ name, status, body }) => ({ name, status, body })), state: out.state }).toMatchSnapshot();
    });
  }
});
