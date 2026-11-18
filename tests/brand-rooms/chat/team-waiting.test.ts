import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import type { Viewer } from '@/lib/auth/identity';
import { loadRoomSummary, runRoomOperation, staffAcknowledge, staffLoadRoomMessages, staffProjectDesk, staffRoomChannels, staffRoomOverview } from '@/lib/brand-rooms/messages';
import { createShare, guestComment } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { staffAddComment } from '@/lib/brand-studio/review';
import { adminTransport } from '@/components/brand-rooms/chat/transport';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
import { roomDraft, reviewDeps } from '../review/fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §3 (as changed 2026-11-18) — the team's "waiting" count is what the team has not
 * ANSWERED: a customer's line, and a customer's note, approval or change request on the work (a guest's note
 * through a share link included), counts until the team writes in the channel, answers through the work (a note
 * the brand can see, a new version, a shared board), or a team member presses 확인함. Opening the conversation
 * clears nothing. A team note (§5) leaves no line, so it neither adds to the count nor clears it; a team line
 * taken down is no answer. 확인함 is team-only: no line, no notice, nothing the brand reads.
 * "New requests" are the client-visible projects of open brands the team has not said anything in yet.
 */
let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
  clock = Date.parse('2020-01-01T01:00:00Z');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
// Lines written here sit in the past, so 확인함 (the database's now) lands after any of them; `afterNow` moves
// the clock past it for the lines that must come later.
let clock = Date.parse('2020-01-01T01:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();
const afterNow = () => {
  clock = Math.max(clock, Date.now() + 60_000);
};
const ack = (viewer: Viewer = admin(), projectId = f.projectId) => staffAcknowledge({ sql: f.sql }, viewer, { organizationId: f.orgId, projectId });

/** A line in the fixture project's channel at a known moment (the team and the brand never write at once). */
async function line(input: { role: 'brand' | 'studio'; body?: string; deleted?: boolean; projectId?: string }): Promise<void> {
  const projectId = input.projectId ?? f.projectId;
  await f.sql.query(
    `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at, deleted_at)
       values ($1, $2::uuid, $8::text, $3, $4, 'text', $5, $6::timestamptz, case when $7::boolean then $6::timestamptz else null end)`,
    [f.orgId, projectId, input.role === 'brand' ? f.ids.owner : f.ids.admin, input.role, input.body ?? 'hello', tick(), input.deleted === true, projectId],
  );
}

/** An event line the way postRoomEvent stores it, at a known moment. */
async function event(kind: string, actorRole: 'brand' | 'studio', projectId = f.projectId): Promise<void> {
  const reviewId = randomUUID();
  const isBoard = kind.startsWith('storyboard_');
  const ref = isBoard ? { kind: 'storyboard', storyboardId: reviewId } : { kind: 'review', reviewId };
  await f.sql.query(
    `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, event, detail, ref, ref_key, created_at)
       values ($1, $2::uuid, $8::text, null, 'system', 'event', $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)`,
    [f.orgId, projectId, kind, JSON.stringify({ actorRole, title: 'Spring film' }), JSON.stringify(ref), `${ref.kind}:${reviewId}`, tick(), projectId],
  );
}

async function waiting(projectId = f.projectId): Promise<number> {
  const overview = await staffRoomOverview({ sql: f.sql }, admin());
  if (!overview.ok) throw new Error(overview.code);
  const fromList = [...overview.channels, ...overview.newRequests].find((c) => c.projectId === projectId)?.teamUnread ?? 0;
  const room = await staffRoomChannels({ sql: f.sql }, admin(), f.orgId);
  if (!room.ok) throw new Error(room.code);
  const fromRoom = room.channels.find((c) => c.projectId === projectId)?.teamUnread ?? 0;
  // The two screens count the same way.
  expect(fromRoom).toBe(fromList);
  return fromList;
}

describe('the team waiting count', () => {
  it('counts each customer decision and note on the work, not only their lines', async () => {
    await line({ role: 'studio', body: 'Kick-off' });
    expect(await waiting()).toBe(0);
    for (const kind of ['review_commented', 'review_changes_requested', 'review_approved', 'storyboard_approved', 'storyboard_changes_requested']) {
      const before = await waiting();
      await event(kind, 'brand');
      expect(await waiting(), kind).toBe(before + 1);
    }
    await line({ role: 'brand' });
    expect(await waiting()).toBe(6);
  });

  it('does not count what the brand is only told about, a taken-down line, or the team own events', async () => {
    await line({ role: 'studio' });
    await event('review_posted', 'brand');
    await event('review_version', 'brand');
    await event('storyboard_shared', 'brand');
    await event('storyboard_version', 'brand');
    await line({ role: 'brand', deleted: true });
    expect(await waiting()).toBe(0);
  });

  it('is cleared by a team line or a team event (a note the brand sees, a new version, a shared board)', async () => {
    await event('review_commented', 'brand');
    await event('storyboard_changes_requested', 'brand');
    expect(await waiting()).toBe(2);
    // The team answered on the note: a studio event clears what came before it.
    await event('review_commented', 'studio');
    expect(await waiting()).toBe(0);
    await event('review_approved', 'brand');
    expect(await waiting()).toBe(1);
    await event('review_version', 'studio');
    expect(await waiting()).toBe(0);
    await event('storyboard_changes_requested', 'brand');
    expect(await waiting()).toBe(1);
    await event('storyboard_version', 'studio');
    expect(await waiting()).toBe(0);
    await line({ role: 'brand' });
    expect(await waiting()).toBe(1);
    await line({ role: 'studio' });
    expect(await waiting()).toBe(0);
    await event('review_changes_requested', 'brand');
    expect(await waiting()).toBe(1);
  });

  it('is not answered by a team line that was taken down', async () => {
    await line({ role: 'brand' });
    await line({ role: 'studio', deleted: true });
    expect(await waiting()).toBe(1);
  });

  it('is not cleared by opening the conversation: the team reads it, and has no read mark to send', async () => {
    await line({ role: 'brand', body: 'When is the first cut?' });
    await event('review_changes_requested', 'brand');
    expect(await waiting()).toBe(2);
    const page = await staffLoadRoomMessages({ sql: f.sql, media: createMemoryMediaStore() }, admin(), { organizationId: f.orgId, projectId: f.projectId });
    expect(page).toMatchObject({ ok: true, team: true });
    expect(await waiting()).toBe(2);
    // The old "the team read it" operation is gone, and the team's transport marks nothing on view.
    expect(ADMIN_OPERATION_NAMES).not.toContain('brand_rooms.channel.read');
    const ctx: AdminContext = { sql: f.sql, storage: {} as never, viewer: admin() };
    const form = new FormData();
    for (const [k, v] of Object.entries({ _op: 'brand_rooms.channel.read', organizationId: f.orgId, projectId: f.projectId })) form.set(k, v);
    expect(await dispatchAdmin('brand_rooms.channel.read', form, ctx)).toMatchObject({ ok: false, code: 'unknownOperation' });
    expect(adminTransport(f.orgId).read).toBeUndefined();
    expect(await waiting()).toBe(2);
    expect((await f.sql.query('select count(*)::int as n from brand_room_reads')).rows[0]).toEqual({ n: 0 });
  });

  it('counts a guest note through a share link (its line carries actorRole brand)', async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    expect(await ack()).toMatchObject({ ok: true });
    afterNow();
    const before = await waiting();
    const created = (await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: reviewId })) as ShareCreated;
    expect(await guestComment({ sql: f.sql, media: deps.media }, { token: created.token, name: 'Jin', body: 'Brighter please' }, { get: () => undefined })).toMatchObject({ ok: true });
    const stored = (await f.sql.query<{ actor: string; event: string }>("select detail ->> 'actorRole' as actor, event from brand_room_messages where kind = 'event' order by created_at desc limit 1")).rows[0];
    expect(stored).toEqual({ actor: 'brand', event: 'review_commented' });
    expect(await waiting()).toBe(before + 1);
  });

  it('is neither raised nor cleared by a team note (no line)', async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    await line({ role: 'brand' });
    expect(await waiting()).toBe(1);
    const lines = async () => Number((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_messages')).rows[0]!.n);
    const count = await lines();
    expect(await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'Ask the colourist', visibility: 'team' })).toMatchObject({ ok: true, comment: { team: true } });
    expect(await lines()).toBe(count);
    expect(await waiting()).toBe(1);
  });
});

describe('확인함', () => {
  it('sets the count to 0 until the next customer line, and a team note after it does not clear that line', async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    await line({ role: 'brand' });
    await event('review_changes_requested', 'brand');
    expect(await waiting()).toBe(2);
    expect(await ack()).toMatchObject({ ok: true, acknowledgedAt: expect.any(String) });
    expect(await waiting()).toBe(0);
    // A second press with nothing waiting is harmless.
    expect(await ack()).toMatchObject({ ok: true });
    afterNow();
    await line({ role: 'brand', body: 'One more thing' });
    expect(await waiting()).toBe(1);
    expect(await staffAddComment(reviewDeps(deps), admin(), { reviewId, body: 'Ask the colourist', visibility: 'team' })).toMatchObject({ ok: true, comment: { team: true } });
    expect(await waiting()).toBe(1);
    await event('review_commented', 'brand');
    expect(await waiting()).toBe(2);
  });

  it('is the project desk count, with who pressed it and when', async () => {
    await line({ role: 'brand' });
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId)).toMatchObject({ ok: true, teamUnread: 1, acknowledged: null });
    const done = await ack();
    if (!done.ok) throw new Error(done.code);
    const desk = await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId);
    expect(desk).toMatchObject({ ok: true, teamUnread: 0, acknowledged: { at: done.acknowledgedAt, by: 'admin' } });
    await f.sql.query("update profiles set display_name = 'Jisoo' where id = $1", [f.ids.admin]);
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId)).toMatchObject({ acknowledged: { by: 'Jisoo' } });
    const room = await staffRoomChannels({ sql: f.sql }, admin(), f.orgId);
    if (!room.ok) throw new Error(room.code);
    expect(room.channels.find((c) => c.projectId === f.projectId)).toMatchObject({ teamUnread: 0, acknowledged: { at: done.acknowledgedAt, by: 'Jisoo' } });
    expect(room.channels.find((c) => c.channel === 'general')).toMatchObject({ acknowledged: null });
  });

  it('works on the general conversation too', async () => {
    await f.sql.query(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at) values ($1, null, 'general', $2, 'brand', 'text', 'hi', $3::timestamptz)`,
      [f.orgId, f.ids.owner, tick()],
    );
    const general = async () => {
      const room = await staffRoomChannels({ sql: f.sql }, admin(), f.orgId);
      if (!room.ok) throw new Error(room.code);
      return room.channels.find((c) => c.channel === 'general')!.teamUnread;
    };
    expect(await general()).toBe(1);
    expect(await ack(admin(), 'general')).toMatchObject({ ok: true });
    expect(await general()).toBe(0);
  });

  it('is team-only: no line, no notice, and the brand member’s own unread count does not move', async () => {
    await line({ role: 'studio', body: 'First cut is up' });
    const rows = async () =>
      (await f.sql.query<{ messages: number; notices: number }>('select (select count(*)::int from brand_room_messages) as messages, (select count(*)::int from brand_room_notices) as notices')).rows[0];
    const before = await rows();
    const summary = await loadRoomSummary({ sql: f.sql }, viewerOf(f.ids.owner), f.orgId);
    expect(summary).toMatchObject({ ok: true, unread: 1 });
    expect(await ack()).toMatchObject({ ok: true });
    expect(await rows()).toEqual(before);
    expect(await loadRoomSummary({ sql: f.sql }, viewerOf(f.ids.owner), f.orgId)).toEqual(summary);
  });

  it('is for the team only: a brand member, a session flag the profile does not carry and the brand-side operations are refused', async () => {
    await line({ role: 'brand' });
    expect(await ack(viewerOf(f.ids.owner))).toEqual({ ok: false, code: 'forbidden' });
    expect(await ack({ ...viewerOf(f.ids.owner), isAdmin: true })).toEqual({ ok: false, code: 'forbidden' });
    const form = (fields: Record<string, string>) => {
      const data = new FormData();
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      return data;
    };
    const fields = { _op: 'brand_rooms.channel.ack', organizationId: f.orgId, projectId: f.projectId };
    const ctx = (userId: string, isAdmin: boolean): AdminContext => ({ sql: f.sql, storage: {} as never, viewer: { ...viewerOf(userId), isAdmin } });
    expect(await dispatchAdmin('brand_rooms.channel.ack', form(fields), ctx(f.ids.owner, false))).toEqual({ ok: false, code: 'forbidden' });
    expect(await dispatchAdmin('brand_rooms.channel.ack', form(fields), ctx(f.ids.owner, true))).toMatchObject({ ok: false, code: 'forbidden' });
    // The brand's own operation door has no 확인함.
    const brandSide = await runRoomOperation({ sql: f.sql, media: createMemoryMediaStore() }, viewerOf(f.ids.owner), 'channel.ack', { organizationId: f.orgId, projectId: f.projectId });
    expect(brandSide.result).toEqual({ ok: false, code: 'invalid' });
    expect(await waiting()).toBe(1);
    // Another brand's project through this organization, or an unknown one, is not found.
    expect(await ack(admin(), randomUUID())).toEqual({ ok: false, code: 'not_found' });
    // The team's own press through the registry lands back on the form's page.
    expect(ADMIN_OPERATION_NAMES).toContain('brand_rooms.channel.ack');
    expect(await dispatchAdmin('brand_rooms.channel.ack', form(fields), ctx(f.ids.admin, true))).toEqual({ ok: true, code: 'saved' });
    expect(await waiting()).toBe(0);
  });
});

describe('new requests', () => {
  it('lists client-visible projects of open brands with no team line or team event yet, newest first, apart from the rest', async () => {
    const later = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible, created_at)
        values ($1, $2, 'Autumn film', 'Launch', 'creator', $3, $4, true, now() + interval '1 hour')`,
      [later, f.orgId, f.ids.owner, randomUUID()],
    );
    const hidden = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
        values ($1, $2, 'Hidden work', 'Launch', 'creator', $3, $4, false)`,
      [hidden, f.orgId, f.ids.owner, randomUUID()],
    );
    const morphic = (await f.sql.query<{ id: string }>(`insert into brand_organizations (id, name, created_by, request_id) values (gen_random_uuid(), 'Morphic Korea', $1, gen_random_uuid()) returning id`, [f.ids.owner])).rows[0]!.id;
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible) values (gen_random_uuid(), $1, 'Sandbox project', 'Launch', 'creator', $2, gen_random_uuid(), true)`,
      [morphic, f.ids.owner],
    );
    // The customer has already asked something in the newer one: still new, and its count shows.
    await line({ role: 'brand', projectId: later });

    let overview = await staffRoomOverview({ sql: f.sql }, admin());
    if (!overview.ok) throw new Error(overview.code);
    expect(overview.newRequests.map((r) => r.title)).toEqual(['Autumn film', 'Spring launch']);
    expect(overview.newRequests[0]).toMatchObject({ projectId: later, organizationName: 'Studio fixture brand', status: 'requested', teamUnread: 1 });

    // A team event (a delivered draft) or a team line takes a project out of the group.
    await event('review_posted', 'studio');
    await line({ role: 'studio', projectId: later });
    overview = await staffRoomOverview({ sql: f.sql }, admin());
    if (!overview.ok) throw new Error(overview.code);
    expect(overview.newRequests).toEqual([]);
    expect(overview.channels.map((c) => c.projectId)).toEqual(expect.arrayContaining([later, f.projectId]));
  });

  it('leaves out cancelled and completed projects', async () => {
    await f.sql.query("update brand_projects set status = 'cancelled' where id = $1", [f.projectId]);
    const overview = await staffRoomOverview({ sql: f.sql }, admin());
    expect(overview.ok && overview.newRequests).toEqual([]);
  });
});

describe('the desk gate', () => {
  it('opens a client-visible project of an open brand with its status and waiting count', async () => {
    await line({ role: 'brand' });
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId)).toMatchObject({
      ok: true,
      organization: { id: f.orgId, name: 'Studio fixture brand' },
      project: { id: f.projectId, title: 'Spring launch', status: 'requested' },
      teamUnread: 1,
    });
  });

  it('is not_found for another brand project, a closed brand and a hidden project, and forbidden for a non-admin', async () => {
    const otherOrg = (await f.sql.query<{ id: string }>(`insert into brand_organizations (id, name, created_by, request_id) values (gen_random_uuid(), 'Other brand', $1, gen_random_uuid()) returning id`, [f.ids.owner])).rows[0]!.id;
    const otherProject = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible) values ($1, $2, 'Their film', 'Launch', 'creator', $3, gen_random_uuid(), true)`,
      [otherProject, otherOrg, f.ids.owner],
    );
    expect(await staffProjectDesk({ sql: f.sql }, admin(), otherOrg, otherProject)).toMatchObject({ ok: true });
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, otherProject)).toEqual({ ok: false, code: 'not_found' });
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, randomUUID())).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_organizations set name = $2 where id = $1', [f.orgId, 'Morphic Korea']);
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId)).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_organizations set name = $2 where id = $1', [f.orgId, 'Studio fixture brand']);
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [f.projectId]);
    expect(await staffProjectDesk({ sql: f.sql }, admin(), f.orgId, f.projectId)).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_projects set client_visible = true where id = $1', [f.projectId]);
    expect(await staffProjectDesk({ sql: f.sql }, viewerOf(f.ids.owner), f.orgId, f.projectId)).toEqual({ ok: false, code: 'forbidden' });
  });
});
