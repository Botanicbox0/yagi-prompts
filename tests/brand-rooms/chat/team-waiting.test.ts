import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { staffMarkRead, staffProjectDesk, staffRoomChannels, staffRoomOverview } from '@/lib/brand-rooms/messages';
import { createShare, guestComment } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { staffAddComment } from '@/lib/brand-studio/review';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../../brand-studio/server/helpers';
import { roomDraft, reviewDeps } from '../review/fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §3 — the team's "waiting" count tells the truth: a customer's line, and a
 * customer's note, approval or change request on the work (a guest's note through a share link included),
 * counts until the team reads the channel, writes in it, or answers through the work (a reply on a note, a
 * new version). A team note (§5) leaves no line, so it neither adds to the count nor clears it.
 * "New requests" are the client-visible projects of open brands the team has not said anything in yet.
 */
let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  f = await studioFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
// Lines written here sit in the past, so a read mark (capped at now) can land after any of them.
let clock = Date.parse('2020-01-01T01:00:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();

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

  it('is cleared by a team line, a team event (a reply on a note, a new version) or a read mark', async () => {
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
    await line({ role: 'brand' });
    expect(await waiting()).toBe(1);
    await line({ role: 'studio' });
    expect(await waiting()).toBe(0);
    await event('review_changes_requested', 'brand');
    expect(await waiting()).toBe(1);
    expect(await staffMarkRead({ sql: f.sql, media: createMemoryMediaStore() }, admin(), { organizationId: f.orgId, projectId: f.projectId, at: tick() })).toMatchObject({ ok: true });
    expect(await waiting()).toBe(0);
  });

  it('counts a guest note through a share link (its line carries actorRole brand)', async () => {
    const deps = studioDeps(f.sql);
    const reviewId = await roomDraft(f, deps);
    await staffMarkRead({ sql: f.sql, media: deps.media }, admin(), { organizationId: f.orgId, projectId: f.projectId });
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
