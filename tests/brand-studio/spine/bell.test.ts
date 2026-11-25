import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { ROOM_BELL_LIMITS, bellRequested, type RoomBell, type RoomSummaryWithBell } from '@/lib/brand-rooms/bell';
import { loadRoomSummary, runRoomOperation } from '@/lib/brand-rooms/messages';
import { loadStoryboardList } from '@/lib/brand-rooms/storyboards';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadReviewList } from '@/lib/brand-studio/review';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §5.1, §8.1, §8.4, §11-5, slice 3a (server half): the 직접 만들기 bell. Pinned:
 *  - opt-in only: the rooms summary answers every existing caller exactly as before (same JSON, same statements);
 *    asked for the bell, a project guest or an organization without 직접 만들기 open gets that same plain summary;
 *  - the number counts the 알림함 page's items (alert cards + conversations with an unread badge), equal to the counted
 *    lines of the list when it is not cut (it is not the 야기 팀과 rail's message badge, which stays in the answer); the
 *    list is newest first, cut at its named limit, and every line opens where the 알림함 opens it, with the storyboard
 *    list's cover and the deliverable list's thumbnail; a failure in the bell's own reads gives the plain summary;
 *  - refusals are the summary's (rooms closed, sandboxed, generation-closed, outsiders, staff who are not members,
 *    made-up and other organizations); a hidden or own project leaves no line; no name or email of anyone;
 *  - marking read is the existing per channel mark: it clears that conversation's line, never an alert.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));
const summaryRoute = await import('@/app/api/brand-rooms/summary/route');

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetSpineProbe();
  f = await studioFixture();
  deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' }) });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
  mocks.sql = null;
  mocks.viewer = null;
});

/** Rooms, studio v2 and the spine open for this organization (or `orgs`). */
const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};
const open = () => openFor(f.orgId);
const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const rooms = () => ({ sql: f.sql, media: deps.media });
const plain = (viewer = owner(), organizationId = f.orgId) => loadRoomSummary({ sql: f.sql }, viewer, organizationId);
const withBell = (viewer = owner(), organizationId = f.orgId) => loadRoomSummary({ sql: f.sql }, viewer, organizationId, { bell: { media: deps.media } });
async function bellOf(viewer = owner()): Promise<RoomBell> {
  const answer = (await withBell(viewer)) as RoomSummaryWithBell;
  if (!answer.ok || !answer.bell) throw new Error(`no bell: ${JSON.stringify(answer)}`);
  return answer.bell;
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function teamProject(over: { visible?: boolean; status?: string; title?: string; organizationId?: string } = {}): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, $2, $3, 'A goal for the team', 'studio', $4, $5, $6, $7)`,
    [id, over.organizationId ?? f.orgId, over.title ?? 'Team work', over.status ?? 'active', over.visible ?? true, f.ids.admin, randomUUID()],
  );
  return id;
}
async function secondOrg(name: string): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  return id;
}
const teamSays = (projectId: string, body: string, when = ago(1)) =>
  f.sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at) values ($1, $2, $3, $4, 'studio', 'text', $5, $6)`, [
    f.orgId,
    projectId,
    projectId,
    f.ids.admin,
    body,
    when,
  ]);
async function say(projectId: string, body: string, viewer = owner()) {
  const sent = await runRoomOperation(rooms(), viewer, 'message.send', { organizationId: f.orgId, projectId, requestId: randomUUID(), body });
  if (!sent.result.ok) throw new Error(JSON.stringify(sent.result));
}
/** A shared storyboard with one ready cut (a picture), last changed `when`. */
async function sharedBoard(projectId: string, title: string, when: string): Promise<string> {
  const board = (
    await f.sql.query<{ id: string }>(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, status, created_by, created_role, shared_at, created_at, updated_at)
       values ($1, $2, gen_random_uuid(), 1, $3, 'shared', $4, 'studio', $5, $5, $5) returning id`,
      [f.orgId, projectId, title, f.ids.admin, when],
    )
  ).rows[0]!.id;
  const picture = await deps.media.put(new Uint8Array([137, 80, 78, 71, randomUUID().charCodeAt(0)]), 'image/png');
  const thumb = await deps.media.put(new Uint8Array([82, 73, 70, 70, randomUUID().charCodeAt(0)]), 'image/webp');
  await f.sql.query(
    `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, storage_key, thumb_key, mime, size_bytes, width, height)
     values ($1, $2, 0, 'ready', $3, $4, 'image/png', 5, 64, 48)`,
    [board, f.orgId, picture.key, thumb.key],
  );
  await f.sql.query('update brand_storyboards set updated_at = $2 where id = $1', [board, when]);
  return board;
}
/** A draft waiting for the brand (status open), its file an image in the library, last changed `when`. */
async function openDraft(projectId: string, title: string, when: string): Promise<string> {
  const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
  return (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, asset_id, title, status, created_by, created_role, project_id, version, source, created_at, updated_at)
       values ($1, $2, $3, 'open', $4, 'studio', $5, 1, 'delivery', $6, $6) returning id`,
      [f.orgId, asset, title, f.ids.admin, projectId, when],
    )
  ).rows[0]!.id;
}

/**
 * The team project of the fixture with two unread team lines, a second team project with a storyboard and a draft
 * waiting, a general line of the owner's own, a hidden team project and an own project with lines of their own.
 */
async function world() {
  open();
  const T0 = f.projectId;
  await teamSays(T0, 'New cut is up', ago(12));
  await teamSays(T0, 'And the sound', ago(10));
  const T2 = await teamProject({ title: 'Second film' });
  const board = await sharedBoard(T2, 'Board one', ago(50));
  const draft = await openDraft(T2, 'Hero cut', ago(40));
  await say('general', 'Hello there');
  const H = await teamProject({ title: 'Hidden by staff' });
  await teamSays(H, 'Internal line', ago(5));
  await sharedBoard(H, 'Hidden board', ago(6));
  await f.sql.query('update brand_projects set client_visible = false where id = $1', [H]);
  const made = await runStudioOperation(deps, owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'Own thing' });
  if (!made.ok || !('project' in made)) throw new Error(JSON.stringify(made));
  const S = (made.project as { id: string }).id;
  await f.sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'studio', 'text', 'Own line')`, [
    f.orgId,
    S,
    S,
    f.ids.admin,
  ]);
  return { T0, T2, board, draft, H, S };
}

/* ------------------------------------------------------------------- opt-in */

describe('opt-in only: every existing caller of the summary gets exactly what it got', () => {
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  /** origin/main (3aaba735), the same call on the fixture alone (slice3a-origin-sql.json in the slice notes). */
  const ORIGIN_SUMMARY = [
    'select id from profiles where id = $1',
    'select id, name from brand_organizations where id = $1',
    "select role from brand_memberships where organization_id = $1 and user_id = $2 and status = 'active'",
    'select id, name from brand_organizations where id = any($1::uuid[])',
    'select denied_features from brand_feature_policies where organization_id = $1',
    "with chans as ( select p.id::text as channel, p.id as project_id, p.title, p.created_at from brand_projects p where p.organization_id = $1 and p.client_visible and ($2::uuid[] is null or p.id = any($2::uuid[])) union all select 'general', null, null, null where $3::boolean ) select c.channel, c.project_id::text as project_id, c.title, c.created_at, greatest( (select max(m.created_at) from brand_room_messages m where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null), (select max(b.created_at) from brand_messages b where b.organization_id = $1 and c.project_id is not null and b.project_id = c.project_id) ) as last_at, coalesce( (select coalesce(nullif(m.body, ''), m.attachments -> 0 ->> 'name') from brand_room_messages m where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null and m.kind = 'text' order by m.created_at desc limit 1), (select b.body from brand_messages b where b.organization_id = $1 and c.project_id is not null and b.project_id = c.project_id order by b.created_at desc limit 1) ) as last_line, (select count(*)::int from brand_room_messages m where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null and m.author_id is distinct from $4::uuid and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)) as unread from chans c left join brand_room_reads r on r.organization_id = $1 and r.channel = c.channel and r.user_id = $4::uuid",
    'savepoint brand_room_alerts',
    'select to_regclass($1)::text as t',
    "select distinct on (coalesce(s.lineage_id, s.id)) s.id::text as id, s.project_id::text as project_id, s.title, s.version, s.status, s.updated_at from brand_storyboards s where s.organization_id = $1 and s.project_id = any($2::uuid[]) and s.deleted_at is null and s.status <> 'draft' order by coalesce(s.lineage_id, s.id), s.version desc",
    'select to_regclass($1)::text as t',
    'select to_regclass($1)::text as t',
    "select exists (select 1 from pg_attribute where attrelid = to_regclass('public.brand_studio_review_comments') and attname = 'visibility' and not attisdropped) as ready",
    "select distinct on (coalesce(r.stack_id, r.id)) r.id::text as id, r.project_id::text as project_id, r.title, r.version, r.status, r.updated_at, (select count(*)::int from brand_studio_review_comments c where c.review_id = r.id and c.parent_id is null and c.deleted_at is null and c.resolved_at is null and c.visibility = 'public') as open_notes from brand_studio_reviews r where r.organization_id = $1 and r.project_id = any($2::uuid[]) and r.deleted_at is null order by coalesce(r.stack_id, r.id), coalesce(r.version, 1) desc",
    'release savepoint brand_room_alerts',
  ];

  it('without the opt-in: origin/main’s statements and no bell, spine open or not', async () => {
    open();
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(norm(text));
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    const answer = await loadRoomSummary({ sql: wrap(f.sql) }, owner(), f.orgId);
    expect(texts).toEqual(ORIGIN_SUMMARY);
    expect(answer.ok && 'bell' in answer).toBe(false);
    await world();
    for (const viewer of [owner(), viewerOf(f.ids.viewer), viewerOf(f.ids.guest)]) expect(JSON.stringify(await plain(viewer))).not.toContain('"bell"');
    expect(bellRequested(new URLSearchParams('bell=1'))).toBe(true);
    for (const query of ['', 'bell=0', 'bell=true', 'bell=', 'bell=1 ', 'Bell=1']) expect(bellRequested(new URLSearchParams(query)), query).toBe(false);
  });

  const NO_BELL: Array<[string, () => Promise<Viewer>]> = [
    ['a project guest', async () => viewerOf(f.ids.guest)],
    ['the spine switched off', async () => {
      vi.stubEnv('BRAND_PROJECT_SPINE', 'off');
      return owner();
    }],
    ['the organization not listed', async () => {
      vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID());
      return owner();
    }],
    ['the spine columns missing', async () => {
      await f.sql.query('alter table brand_studio_video_projects drop column brand_project_id cascade');
      resetSpineProbe();
      return owner();
    }],
    ['studio v2 off', async () => {
      vi.stubEnv('BRAND_STUDIO_V2', 'off');
      return owner();
    }],
    ['self_studio closed by the policy', async () => {
      await f.sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['self_studio']::text[])", [f.orgId]);
      return owner();
    }],
  ];
  for (const [label, arrange] of NO_BELL) {
    it(`asked for the bell, ${label}: the plain summary, byte for byte`, async () => {
      await world();
      const viewer = await arrange();
      const asked = await withBell(viewer);
      expect(asked.ok).toBe(true);
      expect(JSON.stringify(asked)).toBe(JSON.stringify(await plain(viewer)));
      expect(JSON.stringify(asked)).not.toContain('"bell"');
    });
  }
});

/* --------------------------------------------------------- number and list */

describe('the bell: one number, one list', () => {
  it('the number counts the 알림함 page’s items (alert cards + conversations with an unread badge) and equals the counted lines; newest first; each line opens where the 알림함 opens it', async () => {
    const w = await world();
    const summary = (await withBell()) as RoomSummaryWithBell;
    if (!summary.ok || !summary.bell) throw new Error(JSON.stringify(summary));
    const bell = summary.bell;
    // What the 알림함 page (components/brand-rooms/chat/inbox.tsx) draws from the same summary: an alert card per alert
    // ("확인할 것"), and a conversation per channel with an unread badge.
    const inbox = (summary.alerts ?? []).length + summary.channels.filter((c) => c.unread > 0).length;
    expect(bell.unread).toBe(3);
    expect(bell.unread).toBe(inbox);
    expect(bell.unread).toBe(bell.items.filter((line) => line.unread).length);
    expect(bell.more).toBe(false);
    // Not the 야기 팀과 rail's badge: that one is the summary's `unread` (messages, no alerts), still in the same answer
    // and unchanged. The two differ here on purpose (2 messages vs 3 lines); which one 직접 만들기 shows is an open question.
    expect(summary.unread).toBe(2);
    expect(summary.unread).toBe(bell.items.reduce((n, line) => n + line.unreadCount, 0));
    // The rest of the answer is the plain summary's.
    const { bell: _bell, ...rest } = summary;
    expect(JSON.stringify(rest)).toBe(JSON.stringify(await plain()));

    expect(bell.items.map((line) => [line.kind, line.id, line.unread])).toEqual([
      ['conversation', 'channel:general', false],
      ['conversation', `channel:${w.T0}`, true],
      ['review', `review:${w.draft}`, true],
      ['storyboard', `storyboard:${w.board}`, true],
    ]);
    for (let i = 1; i < bell.items.length; i += 1) expect(bell.items[i - 1]!.at >= bell.items[i]!.at).toBe(true);
    const line = (id: string) => bell.items.find((item) => item.id === id)!;
    expect(line(`channel:${w.T0}`)).toMatchObject({ projectId: w.T0, projectTitle: 'Spring launch', title: null, line: 'And the sound', unreadCount: 2, version: null, thumbUrl: null });
    expect(line('channel:general')).toMatchObject({ projectId: null, projectTitle: null, line: 'Hello there', unreadCount: 0 });
    expect(line(`channel:${w.T0}`).href).toBe(`/brand/rooms?organizationId=${f.orgId}&channel=${w.T0}`);
    expect(line('channel:general').href).toBe(`/brand/rooms?organizationId=${f.orgId}&channel=general`);
    expect(line(`storyboard:${w.board}`)).toMatchObject({ projectId: w.T2, projectTitle: 'Second film', title: 'Board one', version: 1, openNotes: 0, unreadCount: 0 });
    expect(line(`review:${w.draft}`)).toMatchObject({ projectId: w.T2, projectTitle: 'Second film', title: 'Hero cut', version: 1 });
    // The 알림함's alert links (components/brand-rooms/chat/inbox.tsx) and the team home's (roomHref).
    const inboxHref = (projectId: string, tab: string, key: string, id: string) =>
      `/brand/rooms/${encodeURIComponent(projectId)}?${new URLSearchParams({ organizationId: f.orgId, tab, [key]: id }).toString()}`;
    expect(line(`storyboard:${w.board}`).href).toBe(inboxHref(w.T2, 'storyboard', 'board', w.board));
    expect(line(`storyboard:${w.board}`).href).toBe(roomHref(w.T2, f.orgId, 'storyboard', { board: w.board }));
    expect(line(`review:${w.draft}`).href).toBe(inboxHref(w.T2, 'review', 'review', w.draft));
    // Pictures as the storyboard list and the deliverable list show them.
    const boards = await loadStoryboardList({ sql: f.sql, media: deps.media, staging: deps.staging }, owner(), f.orgId, w.T2);
    const reviews = await loadReviewList({ sql: f.sql, media: deps.media }, owner(), f.orgId);
    if (!boards.ok || !reviews.ok) throw new Error('lists');
    const cover = boards.boards.find((b) => b.id === w.board)!.coverUrl;
    const thumb = reviews.reviews.find((r) => r.id === w.draft)!.thumbUrl;
    expect(cover).toBeTruthy();
    expect(thumb).toBeTruthy();
    expect(line(`storyboard:${w.board}`).thumbUrl).toBe(cover);
    expect(line(`review:${w.draft}`).thumbUrl).toBe(thumb);
    // Nothing of the hidden project or the own one; no name, no email of anyone.
    const text = JSON.stringify(summary);
    for (const never of [w.H, 'Hidden by staff', 'Hidden board', 'Internal line', w.S, 'Own thing', 'Own line', '@example.test']) expect(text).not.toContain(never);
  });

  it('another member counts their own unread lines; a viewer gets the bell too', async () => {
    await world();
    await f.sql.query("update profiles set display_name = 'Owner Kim' where id = $1", [f.ids.owner]);
    const viewerBell = await bellOf(viewerOf(f.ids.viewer));
    // The viewer has not read the general line the owner wrote: four counted lines.
    expect(viewerBell.unread).toBe(4);
    expect(viewerBell.items.find((line) => line.id === 'channel:general')!.unread).toBe(true);
    expect(JSON.stringify(viewerBell)).not.toContain('Owner Kim');
  });

  it('cut at the named limit; the number still counts every counted line', async () => {
    open();
    for (let i = 0; i < ROOM_BELL_LIMITS.items + 4; i += 1) await teamSays(await teamProject({ title: `Project ${i}` }), `Line ${i}`, ago(100 - i));
    const bell = await bellOf();
    const summary = await plain();
    if (!summary.ok) throw new Error(summary.code);
    expect(bell.items).toHaveLength(ROOM_BELL_LIMITS.items);
    expect(bell.more).toBe(true);
    expect(bell.unread).toBe(ROOM_BELL_LIMITS.items + 4);
    expect(bell.unread).toBe(summary.channels.filter((c) => c.unread > 0).length + (summary.alerts ?? []).length);
    expect(bell.items[0]!.projectTitle).toBe(`Project ${ROOM_BELL_LIMITS.items + 3}`);
  });

  it('a failure in the bell’s own reads gives the plain summary, never a failed one', async () => {
    await world();
    await f.sql.query('alter table brand_storyboard_frames rename to brand_storyboard_frames_gone');
    const asked = await withBell();
    expect(asked.ok).toBe(true);
    expect(JSON.stringify(asked)).toBe(JSON.stringify(await plain()));
    expect((await plain()).ok && ((await plain()) as RoomSummaryWithBell).alerts?.length).toBe(2);
  });

  it('marking a conversation read (the existing per channel mark) clears its line; an alert has no read mark and stays', async () => {
    const w = await world();
    const before = await bellOf();
    const read = await runRoomOperation(rooms(), owner(), 'channel.read', { organizationId: f.orgId, projectId: w.T0, at: new Date().toISOString() });
    expect(read.result.ok).toBe(true);
    const after = await bellOf();
    expect(after.unread).toBe(before.unread - 1);
    expect(after.items.find((line) => line.id === `channel:${w.T0}`)).toMatchObject({ unread: false, unreadCount: 0 });
    expect(after.items.filter((line) => line.kind !== 'conversation')).toEqual(before.items.filter((line) => line.kind !== 'conversation'));
  });
});

/* ----------------------------------------------------------------- refusals */

describe('refusals: exactly the summary’s', () => {
  it('outsiders, staff who are not members, made-up and other organizations, malformed ids', async () => {
    await world();
    const other = await secondOrg('Other brand');
    await f.sql.query('insert into brand_projects (organization_id, title, objective, production_mode, status, client_visible, created_by, request_id) values ($1, $2, $3, $4, $5, true, $6, $7)', [
      other,
      'Their project',
      'Theirs',
      'studio',
      'active',
      f.ids.owner,
      randomUUID(),
    ]);
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', `${f.orgId},${other}`);
    for (const viewer of [viewerOf(f.ids.outsider), staff(), viewerOf(f.ids.editor)]) {
      for (const org of [other, randomUUID(), 'not-a-uuid', '']) {
        const asked = await withBell(viewer, org);
        expect(asked, `${viewer.userId} ${org}`).toEqual(await plain(viewer, org));
        if (org === other) expect(asked.ok).toBe(false);
      }
    }
    for (const viewer of [viewerOf(f.ids.outsider), staff()]) expect(await withBell(viewer)).toEqual({ ok: false, code: 'not_found' });
    // The owner of both reads each organization's own bell; nothing of one shows in the other.
    const theirs = JSON.stringify(await withBell(owner(), other));
    for (const ours of ['Spring launch', 'Second film', 'New cut is up', f.projectId]) expect(theirs).not.toContain(ours);
    expect(JSON.stringify(await withBell())).not.toContain('Their project');
  });

  it('sandboxed and generation-closed organizations: the summary’s 404, bell or not', async () => {
    openFor('*');
    const sandboxed = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [sandboxed, 'Client', f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [sandboxed, f.ids.owner]);
    const closed = await secondOrg('Closed generation');
    await f.sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])", [closed]);
    for (const org of [sandboxed, closed]) {
      expect(await plain(owner(), org)).toEqual({ ok: false, code: 'not_found' });
      expect(await withBell(owner(), org)).toEqual({ ok: false, code: 'not_found' });
    }
  });

  it('over HTTP: rooms closed is the same 404 with or without the opt-in; open, only the opt-in adds the bell', async () => {
    await world();
    const get = (query: string) => summaryRoute.GET(new NextRequest(`http://localhost:3000/api/brand-rooms/summary?${query}`));
    const withIt = await get(`organizationId=${f.orgId}&bell=1`);
    expect(withIt.status).toBe(200);
    expect(withIt.headers.get('cache-control')).toBe('private, no-store');
    const body = (await withIt.json()) as RoomSummaryWithBell;
    expect(body.ok && body.bell?.unread).toBe(3);
    const without = await get(`organizationId=${f.orgId}`);
    expect(Object.keys(await without.json())).toEqual(['ok', 'unread', 'channels', 'alerts']);
    for (const query of [`organizationId=${randomUUID()}&bell=1`, 'organizationId=x&bell=1']) {
      const a = await get(query);
      const b = await get(query.replace('&bell=1', ''));
      expect([a.status, await a.json()]).toEqual([b.status, await b.json()]);
    }
    vi.stubEnv('BRAND_ROOMS', 'off');
    const shut = await get(`organizationId=${f.orgId}&bell=1`);
    expect(shut.status).toBe(404);
    expect(await shut.json()).toEqual({ ok: false, code: 'rooms_closed' });
    mocks.viewer = null;
    vi.stubEnv('BRAND_ROOMS', 'on');
    const anon = await get(`organizationId=${f.orgId}&bell=1`);
    expect([anon.status, await anon.json()]).toEqual([401, { ok: false, code: 'sign_in_required' }]);
  });
});

/* ---------------------------------------------------------------------- pins */

describe('who can reach the bell', () => {
  const ROOT = process.cwd();
  const under = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? under(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
    });
  const importing = (pattern: RegExp) =>
    [...under('lib'), ...under('app'), ...under('components')].filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8'))).sort();

  it('the bell is reached through the rooms summary only; its picture reads only through the bell', () => {
    expect(importing(/from ['"][^'"]*brand-rooms\/bell['"]|from ['"]\.\/bell['"]/)).toEqual([
      'app/api/brand-rooms/summary/route.ts',
      'components/brand-rooms/chat/transport.ts',
      'lib/brand-rooms/messages.ts',
    ]);
    expect(importing(/\bstoryboardCoverUrls\b/)).toEqual(['lib/brand-rooms/bell.ts', 'lib/brand-rooms/storyboards.ts']);
    expect(importing(/\breviewThumbUrls\b/)).toEqual(['lib/brand-rooms/bell.ts', 'lib/brand-studio/review.ts']);
    // The bell reads no project row of its own: everything comes from the summary's channels and alerts.
    expect(readFileSync(path.join(ROOT, 'lib/brand-rooms/bell.ts'), 'utf8')).not.toContain('brand_projects');
  });

  it('the typed client asks the summary with the opt-in and hands back the answer or a failure code', async () => {
    const { loadRoomBell } = await import('@/components/brand-rooms/chat/transport');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, unread: 0, channels: [], alerts: [], bell: { unread: 0, items: [], more: false } } };
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
    }) as never;
    expect(await loadRoomBell('org 1', fake)).toEqual(reply.body);
    expect(calls[0]!.url).toBe('/api/brand-rooms/summary?organizationId=org%201&bell=1');
    expect(calls[0]!.init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    reply = { status: 404, body: { ok: false, code: 'rooms_closed' } };
    expect(await loadRoomBell('org-1', fake)).toEqual({ ok: false, code: 'rooms_closed' });
    reply = { status: 404, body: 'nope' };
    expect(await loadRoomBell('org-1', fake)).toEqual({ ok: false, code: 'failed' });
    expect(await loadRoomBell('org-1', (async () => Promise.reject(new Error('down'))) as never)).toEqual({ ok: false, code: 'offline' });
  });
});
