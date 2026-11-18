import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postRoomEvent } from '@/lib/brand-rooms/events';
import { enqueueNotices } from '@/lib/brand-rooms/notices';
import { seedProfile } from '../../helpers/billing';
import { memberLine, minutesFromNow, noticeEnv, noticeFixture, noticeRows, teamLine, type NoticeFixture } from './helpers';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §2.1–§2.2 — what gets queued, for whom, and that queueing never breaks
 * the write that caused it. Real PGlite: the hooks run inside `staffSendMessage`, `message.send` and
 * `postRoomEvent` exactly as the routes call them.
 */
let f: NoticeFixture;

beforeEach(async () => {
  noticeEnv();
  f = await noticeFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const reviewEvent = (overrides: Partial<Parameters<typeof postRoomEvent>[1]> = {}) => ({
  organizationId: f.orgId,
  projectId: f.projectId,
  event: 'review_posted' as const,
  ref: { kind: 'review' as const, reviewId: randomUUID() },
  actorId: f.ids.admin,
  actorRole: 'studio' as const,
  detail: { title: 'Spring film', version: 1 },
  ...overrides,
});

describe('who hears about a room line', () => {
  it('queues a team line, bundled, for every member and this project’s guest — never the author, an outsider or another project’s guest', async () => {
    // A guest of a different project of the same brand, and an inactive member.
    const otherGuest = randomUUID();
    const revoked = randomUUID();
    await seedProfile(f.sql, { id: otherGuest });
    await seedProfile(f.sql, { id: revoked });
    const otherProject = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
        values ($1, $2, 'Autumn', 'Launch the autumn line', 'creator', $3, $4, true)`,
      [otherProject, f.orgId, f.ids.owner, randomUUID()],
    );
    await f.sql.query('insert into brand_project_members (organization_id, project_id, user_id) values ($1, $2, $3)', [f.orgId, otherProject, otherGuest]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role, status) values ($1, $2, 'viewer', 'revoked')", [f.orgId, revoked]);

    const before = Date.now();
    const line = await teamLine(f, 'The first cut is up.');
    const rows = await noticeRows(f.sql);
    expect(rows.map((r) => r.recipient_id).sort()).toEqual([f.ids.owner, f.ids.editor, f.ids.viewer, f.ids.guest].sort());
    for (const row of rows) {
      expect(row).toMatchObject({ kind: 'team_message', message_id: line.id, timing: 'bundle', state: 'pending', push_state: 'pending', attempts: 0 });
      const wait = new Date(row.due_at).getTime() - before;
      expect(wait).toBeGreaterThanOrEqual(10 * 60_000 - 1_000);
      expect(wait).toBeLessThanOrEqual(10 * 60_000 + 60_000);
    }
  });

  it('gives the person a team line names one mention (mailed now) instead of the team line', async () => {
    const line = await teamLine(f, 'Can you check the logo?', { mentions: [f.ids.owner] });
    const rows = await noticeRows(f.sql);
    expect(rows.filter((r) => r.recipient_id === f.ids.owner)).toEqual([expect.objectContaining({ kind: 'mention', timing: 'now', message_id: line.id })]);
    expect(rows.filter((r) => r.kind === 'team_message').map((r) => r.recipient_id).sort()).toEqual([f.ids.editor, f.ids.viewer, f.ids.guest].sort());
  });

  it('tells nobody about a colleague’s plain line, and only the named colleague about a mention', async () => {
    await memberLine(f, f.ids.owner, 'Looks good to me');
    expect(await noticeRows(f.sql)).toEqual([]);
    const line = await memberLine(f, f.ids.owner, 'What do you think?', { mentions: [f.ids.editor, f.ids.owner] });
    expect(await noticeRows(f.sql)).toEqual([expect.objectContaining({ recipient_id: f.ids.editor, kind: 'mention', message_id: line.id, timing: 'now' })]);
  });

  it('queues the team’s new draft and storyboard for everyone but the actor, and nothing for the brand’s own approvals or notes', async () => {
    await postRoomEvent(f.sql, reviewEvent());
    let rows = await noticeRows(f.sql);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.kind === 'new_version' && r.timing === 'now')).toBe(true);
    expect(rows.map((r) => r.recipient_id)).not.toContain(f.ids.admin);

    await postRoomEvent(f.sql, reviewEvent({ event: 'storyboard_shared', ref: { kind: 'storyboard', storyboardId: randomUUID() } }));
    rows = await noticeRows(f.sql);
    expect(rows.filter((r) => r.kind === 'storyboard')).toHaveLength(4);

    const count = rows.length;
    await postRoomEvent(f.sql, reviewEvent({ event: 'review_approved', actorId: f.ids.owner, actorRole: 'brand' }));
    await postRoomEvent(f.sql, reviewEvent({ event: 'review_commented', actorId: f.ids.owner, actorRole: 'brand' }));
    // The rule expects the team: a brand-side "new draft" is not a notice either.
    await postRoomEvent(f.sql, reviewEvent({ actorId: f.ids.owner, actorRole: 'brand' }));
    expect(await noticeRows(f.sql)).toHaveLength(count);

    await postRoomEvent(f.sql, reviewEvent({ event: 'review_commented' }));
    expect((await noticeRows(f.sql)).filter((r) => r.kind === 'team_reply' && r.timing === 'bundle')).toHaveLength(4);
  });

  it('sends the intake receipt to the person who asked, once, mail only', async () => {
    const source = { type: 'intake' as const, organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.editor };
    expect(await enqueueNotices(f.sql, source)).toBe(1);
    expect(await enqueueNotices(f.sql, source)).toBe(0);
    expect(await noticeRows(f.sql)).toEqual([
      expect.objectContaining({ recipient_id: f.ids.editor, kind: 'intake_received', message_id: null, timing: 'now', push_state: 'none' }),
    ]);
    expect(await enqueueNotices(f.sql, { ...source, actorId: f.ids.outsider })).toBe(0);
  });

  it('ignores a second queue for the same line', async () => {
    const line = await teamLine(f, 'Once');
    const source = { type: 'message' as const, organizationId: f.orgId, projectId: f.projectId, messageId: line.id, actorId: f.ids.admin, actorRole: 'studio' as const, mentions: [] };
    expect(await enqueueNotices(f.sql, source)).toBe(0);
    expect(await noticeRows(f.sql)).toHaveLength(4);
  });

  it('queues a team line in the general channel for the brand’s members — not the author, not a project guest', async () => {
    const line = await teamLine(f, 'General hello', { projectId: 'general' });
    expect(line.projectId).toBeNull();
    const rows = await noticeRows(f.sql);
    expect(rows.map((r) => r.recipient_id).sort()).toEqual([f.ids.owner, f.ids.editor, f.ids.viewer].sort());
    for (const row of rows) expect(row).toMatchObject({ project_id: null, kind: 'team_message', timing: 'bundle', message_id: line.id, push_state: 'pending' });
  });

  it('follows the same mention rule in the general channel', async () => {
    const line = await memberLine(f, f.ids.owner, 'Quick question', { projectId: 'general', mentions: [f.ids.editor] });
    expect(await noticeRows(f.sql)).toEqual([expect.objectContaining({ recipient_id: f.ids.editor, project_id: null, kind: 'mention', timing: 'now', message_id: line.id })]);
    await teamLine(f, 'Answering you', { projectId: 'general', mentions: [f.ids.owner] });
    const rows = (await noticeRows(f.sql)).slice(1);
    expect(rows.find((r) => r.recipient_id === f.ids.owner)).toMatchObject({ kind: 'mention', timing: 'now' });
    expect(rows.filter((r) => r.kind === 'team_message').map((r) => r.recipient_id).sort()).toEqual([f.ids.editor, f.ids.viewer].sort());
  });

  it('queues nothing in the general channel of a closed organization', async () => {
    const source = {
      type: 'message' as const,
      organizationId: f.orgId,
      projectId: null,
      messageId: (
        await f.sql.query<{ id: string }>("insert into brand_room_messages (organization_id, channel, author_id, author_role, body) values ($1, 'general', $2, 'studio', 'x') returning id::text as id", [
          f.orgId,
          f.ids.admin,
        ])
      ).rows[0]!.id,
      actorId: f.ids.admin,
      actorRole: 'studio' as const,
      mentions: [],
    };
    await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media'])`, [f.orgId]);
    expect(await enqueueNotices(f.sql, source)).toBe(0);
    await f.sql.query('delete from brand_feature_policies where organization_id = $1', [f.orgId]);
    // The same line with the brand open again does queue: the refusal above was the guard, not the row.
    expect(await enqueueNotices(f.sql, source)).toBe(3);
  });
});

describe('when nothing is queued', () => {
  it('queues nothing with BRAND_ROOM_NOTIFY off, or with rooms off', async () => {
    vi.stubEnv('BRAND_ROOM_NOTIFY', '');
    await teamLine(f, 'quiet');
    await postRoomEvent(f.sql, reviewEvent());
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
    vi.stubEnv('BRAND_ROOMS', 'off');
    await postRoomEvent(f.sql, reviewEvent());
    expect(await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner })).toBe(0);
    expect(await noticeRows(f.sql)).toEqual([]);
  });

  it('queues nothing for an organization whose rooms are closed (generation policy)', async () => {
    await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media'])`, [f.orgId]);
    await postRoomEvent(f.sql, reviewEvent());
    expect(await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner })).toBe(0);
    expect(await noticeRows(f.sql)).toEqual([]);
  });

  it('queues nothing for a sandboxed organization (the Morphic hardline)', async () => {
    const closed = await noticeFixture({ orgName: 'Morphic Korea' });
    try {
      await postRoomEvent(closed.sql, {
        organizationId: closed.orgId,
        projectId: closed.projectId,
        event: 'review_posted',
        ref: { kind: 'review', reviewId: randomUUID() },
        actorId: closed.ids.admin,
        actorRole: 'studio',
      });
      expect(await enqueueNotices(closed.sql, { type: 'intake', organizationId: closed.orgId, projectId: closed.projectId, actorId: closed.ids.owner })).toBe(0);
      expect(await noticeRows(closed.sql)).toEqual([]);
    } finally {
      await closed.db.close();
    }
  });

  it('queues nothing for a project the brand cannot see', async () => {
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    await postRoomEvent(f.sql, reviewEvent());
    expect(await noticeRows(f.sql)).toEqual([]);
  });
});

describe('a failing queue never fails the write', () => {
  beforeEach(async () => {
    // As if 0094 were not applied: every insert into the notice table fails.
    await f.sql.query('alter table brand_room_notices rename to brand_room_notices_missing');
  });

  it('keeps the team line and the member line, inside their transactions', async () => {
    const team = await teamLine(f, 'Still sent');
    const member = await memberLine(f, f.ids.owner, 'Still mine', { mentions: [f.ids.editor] });
    const stored = (await f.sql.query<{ id: string }>("select id::text as id from brand_room_messages where kind = 'text' order by created_at")).rows.map((r) => r.id);
    expect(stored).toEqual([team.id, member.id]);
  });

  it('keeps the event line, outside a transaction and inside one that goes on writing', async () => {
    await postRoomEvent(f.sql, reviewEvent());
    await f.sql.transaction(async (tx) => {
      await postRoomEvent(tx, reviewEvent({ event: 'storyboard_shared', ref: { kind: 'storyboard', storyboardId: randomUUID() } }));
      // The caller's transaction is still usable after the failed notice insert.
      await tx.query("update brand_projects set title = 'Spring launch v2' where id = $1", [f.projectId]);
    });
    const events = (await f.sql.query<{ event: string }>("select event from brand_room_messages where kind = 'event' order by created_at")).rows.map((r) => r.event);
    expect(events).toEqual(['review_posted', 'storyboard_shared']);
    expect((await f.sql.query<{ title: string }>('select title from brand_projects where id = $1', [f.projectId])).rows[0]!.title).toBe('Spring launch v2');
    expect(await enqueueNotices(f.sql, { type: 'intake', organizationId: f.orgId, projectId: f.projectId, actorId: f.ids.owner }, { now: minutesFromNow(0) })).toBe(0);
  });
});
