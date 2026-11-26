import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadRoomSummary } from '@/lib/brand-rooms/messages';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { as, closeWorld, imageResult, libraryPicture, membersLine, op, openSend, sendWorld, staffViewer, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §8, the coordinator's decisions 1–2 and 4: when 보내기 is open, and for whom.
 *  - Closed (BRAND_SEND, BRAND_ROOMS or BRAND_ROOM_NOTIFY off, the spine off or the organization not on its list, the
 *    tables of 0200 absent): every `send.*` answers exactly what an unknown operation answers (`invalid`), and nothing
 *    is read (no statement beyond the remembered schema probes) or written.
 *  - A closed organization (sandboxed, generation denied, `self_studio` denied, a project-only plan), a project guest,
 *    staff who are not members, an outsider: the rooms' `not_found`, nothing written.
 *  - A viewer may send and reply (today's rule for a project's conversation: every member may talk).
 *  - In every one of those cases the rooms summary, with and without `bell=1`, is byte for byte what origin/main
 *    answers: the snapshot in __snapshots__ was recorded by origin/main's code on this same world (members lines
 *    present), before slice 4a's code existed (the slice 4a report records that run).
 */
let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const T = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute, 0)).toISOString();

/** A deterministic world: team lines, a general line, members lines (a root naming the owner and a reply) at fixed times. */
async function world(): Promise<{ file: string; root: string }> {
  const sql = w.f.sql;
  await sql.query("update brand_projects set created_at = $2, updated_at = $2 where id = $1", [w.f.projectId, T(0)]);
  await sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at, updated_at) values ($1, $2, $3, $4, 'studio', 'text', 'Draft is up', $5, $5)`, [
    w.f.orgId,
    w.f.projectId,
    w.f.projectId,
    w.f.ids.admin,
    T(1),
  ]);
  await sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at, updated_at) values ($1, null, 'general', $2, 'brand', 'text', 'A general question', $3, $3)`, [
    w.f.orgId,
    w.f.ids.owner,
    T(2),
  ]);
  const file = (await imageResult(w, w.f.projectId)).outputId;
  const root = await membersLine(sql, { organizationId: w.f.orgId, projectId: w.f.projectId, authorId: w.f.ids.editor, body: 'Members only root', file: { kind: 'output', id: file }, mentions: [w.f.ids.owner], at: T(3) });
  await membersLine(sql, { organizationId: w.f.orgId, projectId: w.f.projectId, authorId: w.f.ids.viewer, body: 'Members only reply', file: { kind: 'output', id: file }, parentId: root, at: T(4) });
  const asset = await libraryPicture(w);
  await membersLine(sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.editor, body: 'Unfiled members root', file: { kind: 'asset', id: asset }, mentions: [w.f.ids.owner], at: T(5) });
  return { file, root };
}

/** Ids and media keys in an answer replaced by their order of appearance, so a snapshot holds across runs. */
function normal(value: unknown): unknown {
  const seen = new Map<string, string>();
  const text = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|st\/[0-9a-f]{64}\.[a-z0-9]+/g, (hit) => {
    if (!seen.has(hit)) seen.set(hit, `<${hit.startsWith('st/') ? 'key' : 'id'}${seen.size + 1}>`);
    return seen.get(hit)!;
  });
  return JSON.parse(text);
}

function recording(sql: SqlRunner, texts: string[]): SqlRunner {
  const wrap = (inner: SqlRunner): SqlRunner => ({
    query: (text, params) => {
      texts.push(text.replace(/\s+/g, ' ').trim());
      return inner.query(text, params);
    },
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(sql);
}

/** The summary three ways for three readers, and the statements of the owner's plain summary and bell. */
async function answers(): Promise<{ answers: unknown; statements: string[] }> {
  const out: Record<string, unknown> = {};
  const statements: string[] = [];
  for (const [name, viewer] of [['owner', owner()], ['viewer', as(w.f.ids.viewer)], ['guest', as(w.f.ids.guest)]] as const) {
    out[`${name}Plain`] = await loadRoomSummary({ sql: w.f.sql }, viewer, w.f.orgId);
    out[`${name}Bell`] = await loadRoomSummary({ sql: w.f.sql }, viewer, w.f.orgId, { bell: { media: w.deps.media } });
  }
  // A first read so the remembered probes are warm, then the recorded ones.
  await loadRoomSummary({ sql: w.f.sql }, owner(), w.f.orgId, { bell: { media: w.deps.media } });
  await loadRoomSummary({ sql: recording(w.f.sql, statements) }, owner(), w.f.orgId);
  await loadRoomSummary({ sql: recording(w.f.sql, statements) }, owner(), w.f.orgId, { bell: { media: w.deps.media } });
  return { answers: normal(out), statements };
}

const counts = async () => {
  const row = (
    await w.f.sql.query<Record<string, number>>(
      `select (select count(*)::int from brand_room_messages) as messages, (select count(*)::int from brand_room_notices) as notices,
              (select count(*)::int from team_notice_deliveries) as team, (select count(*)::int from brand_room_reads) as channel_reads`,
    )
  ).rows[0]!;
  // The thread read marks, when the table is there (one closed case drops it).
  const present = (await w.f.sql.query<{ t: string | null }>("select to_regclass('public.brand_room_thread_reads')::text as t")).rows[0]?.t;
  return { ...row, reads: present ? Number((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_thread_reads')).rows[0]!.n) : null };
};

/** Every send operation, with valid input. */
function everyOperation(file: string, root: string): Array<[string, Record<string, unknown>]> {
  return [
    ['send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'hi', mentions: [w.f.ids.editor] }],
    ['send.reply', { requestId: randomUUID(), rootId: root, body: 'hi' }],
    ['send.thread', { rootId: root }],
    ['send.file', { file: { kind: 'output', outputId: file } }],
    ['send.inbox', {}],
    ['send.read', { rootId: root }],
    ['send.read_all', {}],
    ['send.people', {}],
  ];
}

describe('closed: the unknown operation’s answer, nothing read or written, the summary as origin/main', () => {
  const CLOSED: Array<[string, () => Promise<void> | void]> = [
    ['BRAND_SEND off', () => void vi.stubEnv('BRAND_SEND', 'off')],
    ['BRAND_SEND unset', () => void vi.stubEnv('BRAND_SEND', '')],
    ['BRAND_ROOM_NOTIFY off', () => void vi.stubEnv('BRAND_ROOM_NOTIFY', 'off')],
    ['BRAND_ROOMS off (the route says rooms_closed before; the service still refuses)', () => void vi.stubEnv('BRAND_ROOMS', 'off')],
    ['the spine off', () => void vi.stubEnv('BRAND_PROJECT_SPINE', 'off')],
    ['the organization not on the spine list', () => void vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID())],
    [
      '0200 not applied (no thread read table)',
      async () => {
        await w.f.sql.query('drop table brand_room_thread_reads');
        resetBrandSendProbe();
      },
    ],
    [
      '0200 not applied (no notice channel column)',
      async () => {
        await w.f.sql.query('alter table brand_room_notices drop column channel cascade');
        resetBrandSendProbe();
      },
    ],
  ];

  it('records origin/main’s answers on this world (the snapshot)', async () => {
    await world();
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', w.f.orgId);
    expect(await answers()).toMatchSnapshot();
  });

  for (const [name, close] of CLOSED) {
    it(name, async () => {
      const { file, root } = await world();
      openSend(w.f.orgId);
      await close();
      const before = await counts();
      for (const viewer of [owner(), as(w.f.ids.viewer), as(w.f.ids.guest), staffViewer(w), as(w.f.ids.outsider)]) {
        for (const [operation, input] of everyOperation(file, root)) {
          const texts: string[] = [];
          const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
          const { result, notice } = await runRoomOperation({ sql: recording(w.f.sql, texts), media: w.deps.media }, viewer, operation, { organizationId: w.f.orgId, ...input });
          expect(result, `${operation} ${viewer.userId}`).toEqual({ ok: false, code: 'invalid' });
          expect(notice).toBeNull();
          // Nothing but the remembered schema probes (information_schema), and never a row.
          expect(texts.filter((t) => !/information_schema/.test(t)), operation).toEqual([]);
        }
      }
      expect(await counts()).toEqual(before);
      // Same answers as recorded from origin/main (the first test of this block).
      const now = await answers();
      expect(now).toMatchSnapshot();
    });
  }
});

describe('closed organizations and people who are not members: the rooms’ not_found, nothing written', () => {
  async function closedOrg(how: 'sandboxed' | 'generation' | 'self_studio' | 'project_only'): Promise<{ organizationId: string; file: string }> {
    const sql = w.f.sql;
    const organizationId = how === 'sandboxed' ? [...SANDBOXED_CLIENT_ORG_IDS][0]! : randomUUID();
    await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [organizationId, 'Closed brand', w.f.ids.owner, randomUUID()]);
    await sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [organizationId, w.f.ids.owner]);
    if (how === 'generation') await sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])", [organizationId]);
    if (how === 'self_studio') await sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio']::text[])", [organizationId]);
    if (how === 'project_only') {
      await sql.query("insert into brand_plan_assignments (organization_id, plan_id, started_on) values ($1, 'project_only', ((now() at time zone 'Asia/Seoul')::date - 1))", [organizationId]);
    }
    const file = (await imageResult(w, null, organizationId)).outputId;
    return { organizationId, file };
  }

  for (const how of ['sandboxed', 'generation', 'self_studio', 'project_only'] as const) {
    it(`${how}: every send operation is not_found for its own owner, before any line is read`, async () => {
      openSend('*');
      const { organizationId, file } = await closedOrg(how);
      const root = await membersLine(w.f.sql, { organizationId, projectId: null, authorId: w.f.ids.owner, body: 'Closed', file: { kind: 'output', id: file } });
      const before = await counts();
      for (const [operation, input] of everyOperation(file, root)) {
        const texts: string[] = [];
        const { runRoomOperation } = await import('@/lib/brand-rooms/messages');
        const { result } = await runRoomOperation({ sql: recording(w.f.sql, texts), media: w.deps.media }, owner(), operation, { ...input, organizationId });
        expect(result, `${how} ${operation}`).toEqual({ ok: false, code: 'not_found' });
        // The remembered schema probe names the table (information_schema); no statement reads a line, a mark or a file.
        expect(texts.some((t) => !/information_schema/.test(t) && /brand_room_messages|brand_room_thread_reads|brand_studio_outputs|brand_studio_assets/.test(t)), `${operation} read a line or a file`).toBe(false);
      }
      expect(await counts()).toEqual(before);
    });
  }

  it('a project guest, staff who are not members and an outsider: not_found on every operation; staff who are members are members', async () => {
    const { file, root } = await world();
    openSend(w.f.orgId);
    for (const viewer of [as(w.f.ids.guest), staffViewer(w), as(w.f.ids.outsider)]) {
      for (const [operation, input] of everyOperation(file, root)) expect((await op(w, viewer, operation, input)).result, operation).toEqual({ ok: false, code: 'not_found' });
    }
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'viewer')", [w.f.orgId, w.f.ids.admin]);
    expect((await op(w, staffViewer(w), 'send.inbox', {})).result.ok).toBe(true);
    expect((await op(w, staffViewer(w), 'send.thread', { rootId: root })).result.ok).toBe(true);
  });

  it('a viewer may send and reply (every member may talk in a project’s conversation today)', async () => {
    const { file, root } = await world();
    openSend(w.f.orgId);
    const viewer = as(w.f.ids.viewer);
    expect((await op(w, viewer, 'send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'From a viewer' })).result.ok).toBe(true);
    expect((await op(w, viewer, 'send.reply', { requestId: randomUUID(), rootId: root, body: 'A viewer answers' })).result.ok).toBe(true);
  });

  it('only the organization is read before the seat: a bad input of a closed organization is not_found, of an open one invalid', async () => {
    openSend('*');
    const { organizationId } = await closedOrg('generation');
    for (const input of [{ file: 'nope' }, { rootId: 'nope' }, { cursor: 'x'.repeat(500) }, { projectId: w.f.projectId }]) {
      expect((await op(w, owner(), 'send.post', { ...input, organizationId })).result).toEqual({ ok: false, code: 'not_found' });
      expect((await op(w, owner(), 'send.post', input)).result).toEqual({ ok: false, code: 'invalid' });
    }
    for (const organizationId of ['not-a-uuid', '', 42]) expect((await op(w, owner(), 'send.inbox', { organizationId })).result).toEqual({ ok: false, code: 'invalid' });
    expect((await op(w, owner(), 'send.inbox', { organizationId: randomUUID() })).result).toEqual({ ok: false, code: 'not_found' });
  });
});

it('the probes are remembered: a closed table costs one lookup per minute, not one per request', async () => {
  resetSpineProbe();
  resetBrandSendProbe();
  openSend(w.f.orgId);
  await w.f.sql.query('drop table brand_room_thread_reads');
  const texts: string[] = [];
  for (let i = 0; i < 3; i += 1) await op({ ...w, f: { ...w.f, sql: recording(w.f.sql, texts) } }, owner(), 'send.inbox', {});
  expect(texts.filter((t) => /brand_room_thread_reads/.test(t)).length).toBe(1);
});

export type { Viewer };
