import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { brandOrgListFilter, loadBrandOrgList } from '@/lib/admin/brand-org-list';
import { roomAudience } from '@/lib/brand-rooms/access';
import {
  loadRoomMessages,
  loadRoomSummary,
  refThreadCounts,
  runRoomOperation,
  staffAcknowledge,
  staffDeleteMessage,
  staffLoadRoomMessages,
  staffPinMessage,
  staffProjectDesk,
  staffRoomChannels,
  staffRoomOverview,
  staffSendMessage,
} from '@/lib/brand-rooms/messages';
import { loadRoomOverview, roomUnreadCounts } from '@/lib/brand-rooms/overview';
import { pulseStamp } from '@/lib/brand-rooms/pulse';
import { parseRefKey } from '@/lib/brand-rooms/message-contracts';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { as, closeWorld, code, libraryPicture, imageResult, membersLine, op, openSend, selfProject, sendWorld, staffViewer, type SendWorld } from './helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §8.2 — "멤버 칸은 저절로 숨겨지지 않는다". Members lines are written straight into the table
 * (as migration 0200 allows), on a team project's members channel, on an own project's and on the unfiled one, with a
 * reply and a mention, and then every reader that is NOT a workspace member reading the members channel is asked:
 *  - every team-side read (the admin rooms overview and its last line, one organization's channels, a project desk,
 *    the admin organization list's last-activity time, room audiences), every project guest's read, the brand's own
 *    team-channel reads (summary, a channel's stream, threads, refs, read marks, unread counts, the team home, the
 *    pulse) answer EXACTLY what they answered before the members lines existed;
 *  - a members channel reached by guessing its string, a members line reached by its id, on any existing door
 *    (customer or staff), is refused like a line that does not exist;
 *  - a members line never queues a team notice nor calls the team's Slack (./route.test.ts, over HTTP).
 * Each test fails on origin/main's code with a members line present (the slice 4a report records the red run).
 */
const NOW = new Date(Date.now() + 60_000);
let w: SendWorld;
beforeEach(async () => {
  w = await sendWorld();
});
afterEach(async () => {
  await closeWorld(w);
});

const owner = () => as(w.f.ids.owner);
const guest = () => as(w.f.ids.guest);
const rooms = () => ({ sql: w.f.sql, media: w.deps.media });

/** Ordinary life on the team side: lines in the team project's channel and in 일반 문의, one of them read. */
async function life(): Promise<void> {
  vi.stubEnv('BRAND_ROOMS', 'on');
  for (const projectId of [w.f.projectId, 'general']) {
    const sent = await runRoomOperation(rooms(), owner(), 'message.send', { organizationId: w.f.orgId, projectId, requestId: randomUUID(), body: 'When is the first cut?' });
    expect(sent.result.ok).toBe(true);
  }
  await w.f.sql.query(
    `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at) values ($1, $2, $3, $4, 'studio', 'text', 'Draft is up', now() - interval '5 minutes')`,
    [w.f.orgId, w.f.projectId, w.f.projectId, w.f.ids.admin],
  );
}

interface Files {
  own: string;
  outputs: Array<{ projectId: string | null; outputId: string }>;
  asset: string;
}

/** The files the members lines are about (made first: a new file moves activity times of its own, on purpose). */
async function files(): Promise<Files> {
  openSend(w.f.orgId);
  const own = await selfProject(w);
  vi.unstubAllEnvs();
  vi.stubEnv('BRAND_ROOMS', 'on');
  const outputs: Files['outputs'] = [];
  for (const projectId of [w.f.projectId, own, null]) outputs.push({ projectId, outputId: (await imageResult(w, projectId)).outputId });
  return { own, outputs, asset: await libraryPicture(w) };
}

/** Members lines everywhere they can be: a team project's members channel, an own project's, unfiled; a reply and a mention in each. */
async function membersLines(made?: Files): Promise<{ roots: string[]; replies: string[]; own: string }> {
  const { own, outputs, asset } = made ?? (await files());
  const later = new Date(Date.now() + 30_000).toISOString();
  const roots: string[] = [];
  const replies: string[] = [];
  for (const { projectId, outputId } of outputs) {
    const root = await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId, authorId: w.f.ids.editor, body: `SECRET-ROOT ${projectId ?? 'unfiled'}`, file: { kind: 'output', id: outputId }, mentions: [w.f.ids.owner], at: later });
    roots.push(root);
    replies.push(await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId, authorId: w.f.ids.owner, body: 'SECRET-REPLY', file: { kind: 'output', id: outputId }, parentId: root, mentions: [w.f.ids.viewer], at: later }));
  }
  roots.push(await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: null, authorId: w.f.ids.viewer, body: 'SECRET-ASSET', file: { kind: 'asset', id: asset }, at: later }));
  return { roots, replies, own };
}

/** Everything a non-member, the team side and the brand's own team-channel readers can see. */
async function outside(): Promise<Record<string, unknown>> {
  const staff = staffViewer(w);
  const out: Record<string, unknown> = {};
  out.staffOverview = await staffRoomOverview({ sql: w.f.sql }, staff);
  out.staffChannels = await staffRoomChannels({ sql: w.f.sql }, staff, w.f.orgId);
  out.staffDesk = await staffProjectDesk({ sql: w.f.sql }, staff, w.f.orgId, w.f.projectId);
  out.staffFeedProject = await staffLoadRoomMessages(rooms(), staff, { organizationId: w.f.orgId, projectId: w.f.projectId });
  out.staffFeedGeneral = await staffLoadRoomMessages(rooms(), staff, { organizationId: w.f.orgId, projectId: 'general' });
  out.adminOrgList = await loadBrandOrgList(w.f.sql, staff, brandOrgListFilter({}), { now: NOW });
  out.audienceTeam = await roomAudience(w.f.sql, w.f.orgId, w.f.projectId);
  out.audienceGeneral = await roomAudience(w.f.sql, w.f.orgId, null);
  for (const [name, viewer] of [['owner', owner()], ['guest', guest()], ['viewer', as(w.f.ids.viewer)]] as const) {
    out[`${name}Summary`] = await loadRoomSummary({ sql: w.f.sql }, viewer, w.f.orgId);
    out[`${name}Stream`] = await loadRoomMessages(rooms(), viewer, { organizationId: w.f.orgId, projectId: w.f.projectId });
    out[`${name}General`] = await loadRoomMessages(rooms(), viewer, { organizationId: w.f.orgId, projectId: 'general' });
    out[`${name}Unread`] = await roomUnreadCounts(w.f.sql, { organizationId: w.f.orgId, userId: viewer.userId, projectIds: [w.f.projectId] });
  }
  out.ownerTeamHome = await loadRoomOverview(w.f.sql, {
    organizationId: w.f.orgId,
    project: { id: w.f.projectId, status: 'active', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', title: 'Spring launch' },
    userId: w.f.ids.owner,
  });
  out.pulse = await pulseStamp(w.f.sql, { kind: 'project', organizationId: w.f.orgId, projectId: w.f.projectId, team: false, shares: false });
  out.pulseTeam = await pulseStamp(w.f.sql, { kind: 'project', organizationId: w.f.orgId, projectId: w.f.projectId, team: true, shares: true });
  out.teamNotices = (await w.f.sql.query('select count(*)::int as n from team_notice_deliveries')).rows[0];
  out.roomNoticesToStaff = (await w.f.sql.query('select count(*)::int as n from brand_room_notices where recipient_id = $1', [w.f.ids.admin])).rows[0];
  return out;
}

/** The answers with the poll cursors (a page's own "now") taken out: they move with the clock, not with the data. */
const steady = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'cursor' ? '<now>' : v)));

describe('§8.2 — members lines are invisible to every reader that is not a member reading the members channel', () => {
  it('every team-side, guest and team-channel answer is identical with and without members lines', async () => {
    await life();
    const made = await files();
    const before = steady(await outside());
    // Sanity: the snapshot is not empty where it matters.
    expect((before.staffOverview as { channels: unknown[] }).channels.length).toBeGreaterThan(0);
    expect((before.adminOrgList as { rows: Array<{ lastActivityAt: string | null }> }).rows[0]!.lastActivityAt).not.toBeNull();
    await membersLines(made);
    const after = steady(await outside());
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toMatch(/SECRET|members:/);
    // The same with 보내기 open for the organization: no existing reader depends on the switch.
    openSend(w.f.orgId);
    expect(steady(await outside())).toEqual(before);
  });

  it('the admin rooms overview never lists a members channel or quotes its last line (the second statement of staffRoomOverview)', async () => {
    await life();
    await membersLines();
    const overview = await staffRoomOverview({ sql: w.f.sql }, staffViewer(w));
    if (!overview.ok) throw new Error(overview.code);
    expect(overview.channels.map((c) => c.channel).sort()).toEqual(['general', w.f.projectId].sort());
    expect(overview.channels.every((c) => !/SECRET/.test(c.lastLine ?? ''))).toBe(true);
  });

  it('the admin organization list’s last activity never moves for a members line', async () => {
    await life();
    const made = await files();
    const before = await loadBrandOrgList(w.f.sql, staffViewer(w), brandOrgListFilter({}), { now: NOW });
    await membersLines(made);
    const after = await loadBrandOrgList(w.f.sql, staffViewer(w), brandOrgListFilter({}), { now: NOW });
    expect(after!.rows.map((r) => r.lastActivityAt)).toEqual(before!.rows.map((r) => r.lastActivityAt));
  });
});

describe('§8.2 — guessed channels and line ids on the existing doors', () => {
  it('a members channel string is refused on every customer read and write that takes a channel', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { own } = await membersLines();
    openSend(w.f.orgId);
    for (const channel of ['members', `members:${w.f.projectId}`, `members:${own}`, `MEMBERS:${own}`]) {
      for (const viewer of [owner(), guest()]) {
        expect(await loadRoomMessages(rooms(), viewer, { organizationId: w.f.orgId, projectId: channel }), channel).toMatchObject({ ok: false, code: 'invalid' });
        for (const operation of ['message.send', 'channel.read', 'message.edit', 'message.delete', 'message.pin', 'reaction.toggle', 'attachment.reserve']) {
          const { result } = await runRoomOperation(rooms(), viewer, operation, { organizationId: w.f.orgId, projectId: channel, requestId: randomUUID(), body: 'x', messageId: randomUUID(), emoji: 'heart', pinned: true, name: 'a.png', mime: 'image/png', size: 10 });
          expect(result, `${operation} ${channel}`).toMatchObject({ ok: false, code: 'invalid' });
        }
      }
    }
    // An own project's id is not a team channel either (client_visible = false): the room's 404.
    expect(await loadRoomMessages(rooms(), owner(), { organizationId: w.f.orgId, projectId: own })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('a members line reached by its id on a team channel or 일반 문의 does not exist', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { roots, replies } = await membersLines();
    openSend(w.f.orgId);
    for (const id of [...roots, ...replies]) {
      for (const channel of [w.f.projectId, 'general']) {
        expect(await loadRoomMessages(rooms(), owner(), { organizationId: w.f.orgId, projectId: channel, thread: id }), `thread ${id}`).toMatchObject({ ok: false, code: 'not_found' });
        for (const [operation, extra] of [
          ['message.edit', { body: 'changed' }],
          ['message.delete', {}],
          ['message.pin', { pinned: true }],
          ['reaction.toggle', { emoji: 'heart' }],
        ] as const) {
          const { result } = await runRoomOperation(rooms(), owner(), operation, { organizationId: w.f.orgId, projectId: channel, messageId: id, ...extra });
          expect(result, `${operation} ${id}`).toMatchObject({ ok: false, code: 'not_found' });
        }
        const reply = await runRoomOperation(rooms(), owner(), 'message.send', { organizationId: w.f.orgId, projectId: channel, requestId: randomUUID(), body: 'Answering', parentId: id });
        expect(reply.result).toMatchObject({ ok: false, code: 'not_found' });
      }
    }
    // A file ref read through `?ref=` on a team channel: not a room ref.
    expect(parseRefKey(`output:${randomUUID()}`)).toBeNull();
    expect(await loadRoomMessages(rooms(), owner(), { organizationId: w.f.orgId, projectId: w.f.projectId, ref: `output:${randomUUID()}` })).toMatchObject({ ok: false, code: 'invalid' });
    // Nothing moved: no reaction, no edit, no pin, no deletion, no new line.
    const rows = (await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where channel like 'members%' and (edited_at is not null or pinned_at is not null or deleted_at is not null)")).rows[0]!;
    expect(rows.n).toBe(0);
    expect((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_reactions')).rows[0]!.n).toBe(0);
  });

  it('staff cannot open, write in, pin, delete or acknowledge a members channel or line (the admin console and the staff CLI)', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { roots, own } = await membersLines();
    openSend(w.f.orgId);
    const staff = staffViewer(w);
    for (const channel of ['members', `members:${w.f.projectId}`, `members:${own}`, own]) {
      const feed = await staffLoadRoomMessages(rooms(), staff, { organizationId: w.f.orgId, projectId: channel });
      expect(feed.ok, channel).toBe(false);
      expect(await staffSendMessage(rooms(), staff, { organizationId: w.f.orgId, projectId: channel, requestId: randomUUID(), body: 'Team' })).toMatchObject({ ok: false });
      expect(await staffAcknowledge({ sql: w.f.sql }, staff, { organizationId: w.f.orgId, projectId: channel })).toMatchObject({ ok: false });
    }
    for (const id of roots) {
      for (const channel of [w.f.projectId, 'general']) {
        expect(await staffLoadRoomMessages(rooms(), staff, { organizationId: w.f.orgId, projectId: channel, thread: id })).toMatchObject({ ok: false, code: 'not_found' });
        expect(await staffPinMessage(rooms(), staff, { organizationId: w.f.orgId, projectId: channel, messageId: id, pinned: true })).toMatchObject({ ok: false, code: 'not_found' });
        expect(await staffDeleteMessage(rooms(), staff, { organizationId: w.f.orgId, projectId: channel, messageId: id })).toMatchObject({ ok: false, code: 'not_found' });
        expect(await staffSendMessage(rooms(), staff, { organizationId: w.f.orgId, projectId: channel, requestId: randomUUID(), body: 'Team', parentId: id })).toMatchObject({ ok: false, code: 'not_found' });
      }
    }
    expect((await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where channel like 'members%' and (pinned_at is not null or deleted_at is not null)")).rows[0]!.n).toBe(0);
    expect((await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_reads where channel like 'members%'")).rows[0]!.n).toBe(0);
  });

  it('staff, a project guest, an outsider and another organization’s member get not_found on every send operation, and no line', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { roots } = await membersLines();
    openSend(w.f.orgId);
    const other = randomUUID();
    await w.f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', w.f.ids.outsider, randomUUID()]);
    await w.f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [other, w.f.ids.outsider]);
    const file = (await imageResult(w)).outputId;
    const inputs: Array<[string, Record<string, unknown>]> = [
      ['send.post', { requestId: randomUUID(), file: { kind: 'output', outputId: file }, body: 'hi' }],
      ['send.reply', { requestId: randomUUID(), rootId: roots[0]!, body: 'hi' }],
      ['send.thread', { rootId: roots[0]! }],
      ['send.file', { file: { kind: 'output', outputId: file } }],
      ['send.inbox', {}],
      ['send.read', { rootId: roots[0]! }],
      ['send.read_all', {}],
      ['send.people', {}],
    ];
    for (const viewer of [staffViewer(w), guest(), as(w.f.ids.outsider)]) {
      for (const [operation, input] of inputs) {
        const { result, notice } = await op(w, viewer, operation, input);
        expect(result, `${viewer.userId} ${operation}`).toEqual({ ok: false, code: 'not_found' });
        expect(notice).toBeNull();
      }
    }
    expect((await w.f.sql.query<{ n: number }>("select count(*)::int as n from brand_room_messages where channel like 'members%'")).rows[0]!.n).toBe(7);
    expect((await w.f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_thread_reads')).rows[0]!.n).toBe(0);
  });

  it('a removed member is an outsider: not_found everywhere, nothing read', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { roots } = await membersLines();
    openSend(w.f.orgId);
    await w.f.sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [w.f.orgId, w.f.ids.editor]);
    for (const operation of ['send.thread', 'send.read']) expect(await code(w, as(w.f.ids.editor), operation, { rootId: roots[0]! })).toBe('not_found');
    expect(await code(w, as(w.f.ids.editor), 'send.inbox', {})).toBe('not_found');
  });
});

describe('a thread count by key never counts a members line', () => {
  it('refThreadCounts (no caller today) is scoped to the team channels', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const { roots } = await membersLines();
    const keys = (await w.f.sql.query<{ ref_key: string }>('select distinct ref_key from brand_room_messages where id = any($1::uuid[])', [roots])).rows.map((r) => r.ref_key);
    expect(await refThreadCounts(w.f.sql, w.f.orgId, keys)).toEqual({});
  });
});

describe('the studio and the spine never hand a members line to anyone', () => {
  it('project.cards keeps its team unread count and its own projects at 0 with members lines present', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    openSend(w.f.orgId);
    const cards = async () => {
      const answer = await runStudioOperation(w.deps, owner(), 'project.cards', { organizationId: w.f.orgId });
      if (!answer.ok) throw new Error(JSON.stringify(answer));
      return (answer as unknown as { projects: Array<{ project: { id: string }; unread: number }> }).projects.map((c) => [c.project.id, c.unread]);
    };
    const own = await selfProject(w, 'Own');
    const file = (await imageResult(w, own)).outputId;
    const teamFile = (await imageResult(w, w.f.projectId)).outputId;
    const before = await cards();
    await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: own, authorId: w.f.ids.editor, body: 'x', file: { kind: 'output', id: file }, mentions: [w.f.ids.owner] });
    await membersLine(w.f.sql, { organizationId: w.f.orgId, projectId: w.f.projectId, authorId: w.f.ids.editor, body: 'x', file: { kind: 'output', id: teamFile } });
    expect(await cards()).toEqual(before);
  });
});
