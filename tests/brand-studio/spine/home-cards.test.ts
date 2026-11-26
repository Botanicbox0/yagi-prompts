import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadBrandAttachmentAccess, loadBrandWorkspace } from '@/lib/brands/workspace/service';
import { loadRoomSummary, runRoomOperation } from '@/lib/brand-rooms/messages';
import { loadRoomOverview, roomUnreadCounts } from '@/lib/brand-rooms/overview';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import {
  BRAND_PROJECT_CARD_LIMITS,
  BRAND_PROJECT_LIMITS,
  type StudioBrandProject,
  type StudioBrandProjectCards,
  type StudioBrandProjectFiles,
  type StudioBrandProjectList,
  type StudioBrandProjectOverview,
} from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadProjectCards, runStudioOperation } from '@/lib/brand-studio/service';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §5, slice 3a (server half): `project.cards`, the 직접 만들기 home's project cards. Pinned:
 *  - the same set and order as `project.list`, the overview's own counts and 미분류 (one computation);
 *  - pictures: the overview's result covers (at most three), else library pictures, else a team project's cover image
 *    exactly as the project list links it (a member may open it);
 *  - the newest file is what `project.files` lists first, and the name beside it is a fellow member's display name
 *    only, never anyone else's and never an email;
 *  - a team project's unread count and stage line are the room's own (the 알림함's channel count, the team home's
 *    stage line), and absent while rooms are closed;
 *  - members only, with exactly `project.list`'s refusals; a hidden team project leaves no trace; bounded statements;
 *  - the overview and the room overview still send origin/main's statements (they now share their rules with this).
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetSpineProbe();
  f = await studioFixture();
  deps = studioDeps(f.sql, { env: studioEnv(ENV) });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
});

const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};
const open = () => openFor(f.orgId);
const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, viewer, operation, input);
type Outcome = 'ok' | string;
const outcome = (r: { ok: boolean; code?: string }): Outcome => (r.ok ? 'ok' : (r.code as string));
const rooms = () => ({ sql: f.sql, media: deps.media });

async function cards(viewer = owner(), organizationId = f.orgId): Promise<StudioBrandProjectCards> {
  const answer = await op(viewer, 'project.cards', { organizationId });
  if (!answer.ok) throw new Error(`project.cards: ${JSON.stringify(answer)}`);
  return answer as StudioBrandProjectCards;
}
async function overview(viewer = owner()): Promise<StudioBrandProjectOverview> {
  const answer = await op(viewer, 'project.overview', { organizationId: f.orgId });
  if (!answer.ok) throw new Error(`project.overview: ${JSON.stringify(answer)}`);
  return answer as StudioBrandProjectOverview;
}
async function firstFile(projectId: string): Promise<StudioBrandProjectFiles> {
  const answer = await op(owner(), 'project.files', { organizationId: f.orgId, scope: { kind: 'project', brandProjectId: projectId } });
  if (!answer.ok) throw new Error(`project.files: ${JSON.stringify(answer)}`);
  return answer as StudioBrandProjectFiles;
}
async function selfProject(title: string, organizationId = f.orgId): Promise<string> {
  const made = await op(owner(), 'project.create', { organizationId, requestId: requestId(), title });
  if (!made.ok || !('project' in made)) throw new Error(`project.create failed: ${JSON.stringify(made)}`);
  return (made.project as StudioBrandProject).id;
}
async function teamProject(over: { visible?: boolean; status?: string; organizationId?: string; title?: string } = {}): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, $2, $3, 'A goal for the team', 'studio', $4, $5, $6, $7)`,
    [id, over.organizationId ?? f.orgId, over.title ?? 'Team work', over.status ?? 'active', over.visible ?? true, f.ids.admin, randomUUID()],
  );
  return id;
}
async function secondOrg(name = 'Second brand'): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, $2)', [id, 1_000_000]);
  if (process.env.BRAND_PROJECT_SPINE === 'on') vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', `${process.env.BRAND_PROJECT_SPINE_ORGS ?? ''},${id}`);
  return id;
}
const fileIn = (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string, projectId: string | null) =>
  f.sql.query(`update ${table} set brand_project_id = $2 where id = $1`, [id, projectId]);
const at = (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects' | 'brand_studio_outputs', id: string, iso: string) =>
  f.sql.query(`update ${table} set created_at = $2::timestamptz where id = $1`, [id, iso]);
const run = (kind: 'image' | 'video' = 'image', by = f.ids.owner, organizationId = f.orgId) => seedRun(deps, organizationId, by, { kind });
async function soundRun(organizationId = f.orgId) {
  const job = await f.sql.query<{ id: string }>(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs, finished_at)
      values ($1, $2, $3, 'sound_effect', 'succeeded', 'sunra_api', 'sfx', 'rain', false, '{"locale":"ko"}'::jsonb, '[]'::jsonb, now()) returning id`,
    [organizationId, f.ids.owner, requestId()],
  );
  const { key } = await deps.media.put(new Uint8Array([73, 68, 51, randomUUID().charCodeAt(0)]), 'audio/mpeg');
  await f.sql.query(
    `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, duration_ms) values ($1, $2, 0, 'audio', 'ready', $3, 'audio/mpeg', 3000)`,
    [job.rows[0]!.id, organizationId, key],
  );
  return job.rows[0]!.id;
}
async function film(title: string, viewer = owner(), organizationId = f.orgId): Promise<string> {
  const made = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, viewer, 'create', { organizationId, requestId: `vp_${randomUUID()}`, title });
  if (!made.ok || !made.project) throw new Error(`film create: ${JSON.stringify(made)}`);
  return made.project.id;
}
const named = (userId: string, name: string) => f.sql.query('update profiles set display_name = $2 where id = $1', [userId, name]);
const say = async (projectId: string, body: string, viewer = owner()) => {
  const sent = await runRoomOperation(rooms(), viewer, 'message.send', { organizationId: f.orgId, projectId, requestId: randomUUID(), body });
  if (!sent.result.ok) throw new Error(JSON.stringify(sent.result));
};
const teamSays = (projectId: string, body: string) =>
  f.sql.query(`insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body) values ($1, $2, $3, $4, 'studio', 'text', $5)`, [
    f.orgId,
    projectId,
    projectId,
    f.ids.admin,
    body,
  ]);
/** A ready image attachment of `projectId`, made its cover (the database checks: same project, ready image). */
async function coverOf(projectId: string): Promise<string> {
  const id = randomUUID();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await f.sql.query(
    "insert into brand_attachments(id,organization_id,project_id,name,mime,size_bytes,storage_key,status,sha256,created_by,request_id) values($1,$2,$3,'cover.png','image/png',$4,$5,'ready',$6,$7,$8)",
    [id, f.orgId, projectId, bytes.length, `brands/${id}`, createHash('sha256').update(bytes).digest('hex'), f.ids.admin, randomUUID()],
  );
  await f.sql.query('update brand_projects set cover_attachment_id = $1 where id = $2', [id, projectId]);
  return id;
}

/* -------------------------------------------------------------------- cards */

describe('project.cards: what a card shows', () => {
  it('one card per project project.list lists (same set and order), with the overview’s own counts and 미분류', async () => {
    open();
    const other = await secondOrg('Other brand');
    const P1 = await selfProject('Spring');
    const H = await teamProject({ visible: false, title: 'Hidden by staff' });
    const A = await selfProject('Archived one');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [A]);
    const Q = await selfProject('Theirs', other);
    const r1 = await run('image');
    const r2 = await run('video');
    const s1 = await soundRun();
    const u1 = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const F1 = await film('Cut one');
    for (const id of [r1.jobId, r2.jobId, s1]) await fileIn('brand_studio_jobs', id, P1);
    await fileIn('brand_studio_assets', u1, P1);
    await fileIn('brand_studio_video_projects', F1, P1);
    const r3 = await run('image');
    await fileIn('brand_studio_jobs', r3.jobId, f.projectId);
    const r4 = await run('image');
    await fileIn('brand_studio_jobs', r4.jobId, H);
    await fileIn('brand_studio_jobs', (await run('video')).jobId, A);
    await run('image');
    await seedImageAsset(deps, f.orgId, f.ids.owner);
    const theirs = await run('image', f.ids.owner, other);
    await fileIn('brand_studio_jobs', theirs.jobId, Q);

    const listed = (await op(owner(), 'project.list', { organizationId: f.orgId })) as StudioBrandProjectList;
    const answer = await cards();
    const groups = await overview();
    expect(answer.projects.map((c) => c.project)).toEqual(listed.projects);
    expect(answer.projects.map((c) => c.project.id).sort()).toEqual([P1, f.projectId].sort());
    for (const card of answer.projects) {
      const group = groups.projects.find((g) => g.project.id === card.project.id)!;
      expect(card.counts, card.project.title).toEqual(group.counts);
      expect(card.covers.length).toBeLessThanOrEqual(BRAND_PROJECT_CARD_LIMITS.covers);
      expect(card.covers.map((c) => c.id)).toEqual(group.covers.slice(0, BRAND_PROJECT_CARD_LIMITS.covers).map((c) => c.outputId));
    }
    expect(answer.projects.find((c) => c.project.id === P1)!.counts).toEqual({ image: 1, video: 1, sound: 1, upload: 1, film: 1 });
    expect(answer.unfiled).toEqual(groups.unfiled);
    expect(BRAND_PROJECT_CARD_LIMITS.covers).toBeLessThanOrEqual(BRAND_PROJECT_LIMITS.overviewCovers);
    // Nothing of the hidden or archived project (their files read as 미분류), nor of the other organization.
    const text = JSON.stringify(answer);
    for (const never of [H, 'Hidden by staff', A, 'Archived one', Q, 'Theirs', theirs.jobId, theirs.outputId]) expect(text).not.toContain(never);
    expect(answer.projects.some((c) => c.covers.some((cover) => cover.id === r4.outputId))).toBe(false);
  });

  it('pictures: the overview’s result covers (three at most), else library pictures, else a team project’s cover image as the project list links it', async () => {
    open();
    const P = await selfProject('Results');
    const made: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await run(i % 2 ? 'video' : 'image');
      await fileIn('brand_studio_jobs', r.jobId, P);
      await at('brand_studio_outputs', r.outputId, `2026-11-0${i + 1}T00:00:00.000Z`);
      made.push(r.outputId);
    }
    const L = await selfProject('Library only');
    await fileIn('brand_studio_jobs', await soundRun(), L); // a sound result has no picture
    const pictures: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = await seedImageAsset(deps, f.orgId, f.ids.owner);
      await fileIn('brand_studio_assets', id, L);
      await at('brand_studio_assets', id, `2026-10-0${i + 1}T00:00:00.000Z`);
      pictures.push(id);
    }
    const T = await teamProject({ title: 'Team with a cover' });
    const cover = await coverOf(T);
    const E = await teamProject({ title: 'Team, nothing yet' });

    const answer = await cards();
    const card = (id: string) => answer.projects.find((c) => c.project.id === id)!;
    const state = (await overview()).projects.find((g) => g.project.id === P)!;
    expect(card(P).covers.map((c) => [c.source, c.id])).toEqual(made.slice(2).reverse().map((id) => ['result', id]));
    for (const c of card(P).covers) {
      const tile = state.covers.find((t) => t.outputId === c.id)!;
      expect(c).toEqual({ source: 'result', id: tile.outputId, kind: tile.kind, url: tile.url, thumbUrl: tile.thumbUrl, width: tile.width, height: tile.height });
    }
    expect(card(L).covers.map((c) => [c.source, c.id])).toEqual(pictures.slice(1).reverse().map((id) => ['library', id]));
    const state2 = (await op(owner(), 'project.files', { organizationId: f.orgId, scope: { kind: 'project', brandProjectId: L }, kind: 'upload' })) as StudioBrandProjectFiles;
    for (const c of card(L).covers) {
      const entry = state2.assets.find((a) => a.id === c.id)!;
      expect({ url: c.url, thumbUrl: c.thumbUrl, kind: c.kind, width: c.width, height: c.height }).toEqual({ url: entry.url, thumbUrl: entry.thumbUrl, kind: entry.kind, width: entry.width, height: entry.height });
    }
    // The team project's cover: the very address the project list gives members, which a member may open.
    const listedTeam = (await loadBrandWorkspace({ sql: f.sql }, owner(), { organizationId: f.orgId })).projects.find((p) => p.id === T)!;
    expect(card(T).covers).toEqual([{ source: 'team_cover', id: cover, kind: 'image', url: listedTeam.coverUrl, thumbUrl: null, width: null, height: null }]);
    expect(await loadBrandAttachmentAccess({ sql: f.sql }, viewerOf(f.ids.viewer), cover)).toMatchObject({ mime: 'image/png' });
    expect(card(E).covers).toEqual([]);
  });

  it('the newest file is what project.files lists first; the name beside it is a fellow member’s display name, never anyone else’s and never an email', async () => {
    open();
    const other = await secondOrg('Elsewhere');
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [other, f.ids.outsider]);
    await named(f.ids.owner, 'Owner Kim');
    await named(f.ids.editor, '  Editor Lee  ');
    await named(f.ids.outsider, 'Stranger Park');
    await named(f.ids.admin, 'Staff Choi');
    const P = await selfProject('Activity');
    expect((await cards()).projects.find((c) => c.project.id === P)!.lastActivity).toBeNull();

    const check = async (expected: { kind: string; actorName: string | null }) => {
      const card = (await cards()).projects.find((c) => c.project.id === P)!;
      const first = (await firstFile(P)).items[0]!;
      expect(card.lastActivity).toMatchObject({ ...expected, item: first });
      return card;
    };
    const r = await run('image');
    await fileIn('brand_studio_jobs', r.jobId, P);
    await at('brand_studio_jobs', r.jobId, '2026-11-01T00:00:00.000Z');
    const c1 = await check({ kind: 'image', actorName: 'Owner Kim' });
    expect(c1.lastActivity!.at).toBe('2026-11-01T00:00:00.000Z');

    const u = await seedImageAsset(deps, f.orgId, f.ids.editor);
    await fileIn('brand_studio_assets', u, P);
    await at('brand_studio_assets', u, '2026-11-02T00:00:00.000Z');
    await check({ kind: 'upload', actorName: 'Editor Lee' });

    const F = await film('Cut', viewerOf(f.ids.editor));
    await fileIn('brand_studio_video_projects', F, P);
    await at('brand_studio_video_projects', F, '2026-11-03T00:00:00.000Z');
    await check({ kind: 'film', actorName: 'Editor Lee' });

    // A run of a person who is not a member here (a member of another organization; the team): no name at all.
    for (const [by, when] of [[f.ids.outsider, '2026-11-04'], [f.ids.admin, '2026-11-05']] as const) {
      const s = await run('video', by);
      await fileIn('brand_studio_jobs', s.jobId, P);
      await at('brand_studio_jobs', s.jobId, `${when}T00:00:00.000Z`);
      const card = await check({ kind: 'video', actorName: null });
      expect(JSON.stringify(card)).not.toMatch(/Stranger Park|Staff Choi/);
    }
    // A member who left: no name either. A member with no display name: no name, never the email.
    await f.sql.query("update brand_memberships set status = 'revoked' where organization_id = $1 and user_id = $2", [f.orgId, f.ids.editor]);
    const late = await seedImageAsset(deps, f.orgId, f.ids.editor);
    await fileIn('brand_studio_assets', late, P);
    await at('brand_studio_assets', late, '2026-11-06T00:00:00.000Z');
    await check({ kind: 'upload', actorName: null });
    await named(f.ids.owner, '   ');
    const mine = await run('image');
    await fileIn('brand_studio_jobs', mine.jobId, P);
    await at('brand_studio_jobs', mine.jobId, '2026-11-07T00:00:00.000Z');
    await check({ kind: 'image', actorName: null });
    const all = JSON.stringify(await cards());
    expect(all).not.toContain('@example.test');
    expect(all).not.toMatch(/Stranger Park|Staff Choi/);
  });

  it('a team project: its room’s unread count and the team home’s stage line; an own project: 0 and none; rooms closed: 0 and none', async () => {
    open();
    vi.stubEnv('BRAND_ROOMS', 'on');
    await f.sql.query("update brand_projects set status = 'active' where id = $1", [f.projectId]);
    const T = f.projectId;
    const E = await teamProject({ status: 'requested', title: 'Just asked' });
    const S = await selfProject('Mine');
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    await f.sql.query('update brand_projects set created_at = $2 where id = $1', [T, ago(1000)]);
    const lineage = randomUUID();
    await f.sql.query(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, status, created_by, created_role, shared_at, status_changed_at, created_at, updated_at)
       values ($1, $2, $3, 1, 'Board', 'approved', $4, 'studio', $5, $6, $5, $6),
              ($1, $2, $3, 2, 'Board', 'shared', $4, 'studio', $7, null, $7, $7),
              ($1, $2, gen_random_uuid(), 1, 'Hidden draft', 'draft', $4, 'studio', null, null, $8, $8)`,
      [f.orgId, T, lineage, f.ids.admin, ago(600), ago(500), ago(300), ago(10)],
    );
    const a1 = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const a2 = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const v1 = (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, asset_id, title, status, created_by, created_role, project_id, version, source, status_changed_at, created_at, updated_at)
         values ($1, $2, 'Hero cut', 'changes_requested', $3, 'studio', $4, 1, 'delivery', $5, $6, $5) returning id`,
        [f.orgId, a1, f.ids.admin, T, ago(200), ago(250)],
      )
    ).rows[0]!.id;
    await f.sql.query(
      `insert into brand_studio_reviews (organization_id, asset_id, title, status, created_by, created_role, project_id, stack_id, version, source, created_at, updated_at)
       values ($1, $2, 'Hero cut', 'open', $3, 'studio', $4, $5, 2, 'delivery', $6, $6)`,
      [f.orgId, a2, f.ids.admin, T, v1, ago(100)],
    );
    await teamSays(T, 'New cut is up');
    await teamSays(T, 'And the sound');
    await say(T, 'Thanks');

    const answer = await cards();
    const card = (id: string) => answer.projects.find((c) => c.project.id === id)!;
    // The stage line: exactly what the team home computes for the same project (app/(brand)/brand/home/page.tsx).
    const workspace = await loadBrandWorkspace({ sql: f.sql }, owner(), { organizationId: f.orgId });
    for (const id of [T, E]) {
      const p = workspace.projects.find((row) => row.id === id)!;
      const room = await loadRoomOverview(f.sql, { organizationId: f.orgId, project: { id: p.id, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, title: p.title }, userId: f.ids.owner });
      expect(card(id).stage, id).toEqual({ stage: room.stage, steps: room.steps });
    }
    expect(card(T).stage!.stage).toBe('revision');
    expect(card(E).stage!.stage).toBe('requested');
    // Unread: the room's own rule, the same number the 알림함 shows for the channel.
    const counted = await roomUnreadCounts(f.sql, { organizationId: f.orgId, userId: f.ids.owner, projectIds: [T, E] });
    const summary = await loadRoomSummary({ sql: f.sql }, owner(), f.orgId);
    if (!summary.ok) throw new Error(summary.code);
    expect(card(T).unread).toBe(2);
    expect(card(T).unread).toBe(counted[T]);
    expect(card(T).unread).toBe(summary.channels.find((c) => c.projectId === T)!.unread);
    expect(card(E).unread).toBe(0);
    expect(card(S)).toMatchObject({ unread: 0, stage: null });
    // Another member reads their own number.
    expect((await cards(viewerOf(f.ids.viewer))).projects.find((c) => c.project.id === T)!.unread).toBe(3);

    // Rooms closed: no unread number, no stage line; the rest is unchanged.
    vi.stubEnv('BRAND_ROOMS', 'off');
    const closed = await cards();
    for (const c of closed.projects) expect(c).toMatchObject({ unread: 0, stage: null });
    expect(closed.projects.map(({ project, counts, covers, lastActivity }) => ({ project, counts, covers, lastActivity }))).toEqual(
      answer.projects.map(({ project, counts, covers, lastActivity }) => ({ project, counts, covers, lastActivity })),
    );
  });

  it('a team project the staff hid: no card, no unread number, its title nowhere', async () => {
    open();
    vi.stubEnv('BRAND_ROOMS', 'on');
    const H = await teamProject({ title: 'Hidden by staff' });
    await teamSays(H, 'Internal line');
    const lineage = randomUUID();
    await f.sql.query(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, status, created_by, created_role, shared_at)
       values ($1, $2, $3, 1, 'Hidden board', 'shared', $4, 'studio', now())`,
      [f.orgId, H, lineage, f.ids.admin],
    );
    const before = await cards();
    expect(before.projects.some((c) => c.project.id === H)).toBe(true);
    await f.sql.query('update brand_projects set client_visible = false where id = $1', [H]);
    const after = JSON.stringify(await cards());
    for (const never of [H, 'Hidden by staff', 'Hidden board', 'Internal line']) expect(after).not.toContain(never);
  });

  it('asks the database a fixed number of times whatever the number of projects', async () => {
    open();
    vi.stubEnv('BRAND_ROOMS', 'on');
    const recorded = async (): Promise<number> => {
      const texts: string[] = [];
      const wrap = (inner: SqlRunner): SqlRunner => ({
        query: (text, params) => {
          texts.push(text);
          return inner.query(text, params);
        },
        transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
      });
      const answer = await runStudioOperation({ ...deps, sql: wrap(f.sql) }, owner(), 'project.cards', { organizationId: f.orgId });
      expect(answer.ok).toBe(true);
      return texts.length;
    };
    const add = async (i: number) => {
      const P = i % 2 ? await selfProject(`Project ${i}`) : await teamProject({ title: `Team ${i}` });
      await fileIn('brand_studio_jobs', (await run('image')).jobId, P);
      await fileIn('brand_studio_assets', await seedImageAsset(deps, f.orgId, f.ids.owner), P);
      if (i % 2 === 0) await teamSays(P, `Line ${i}`);
    };
    await add(0);
    await cards(); // the column probes are remembered after the first call
    const few = await recorded();
    for (let i = 1; i < 13; i += 1) await add(i);
    expect((await cards()).projects.length).toBe(14);
    expect(await recorded()).toBe(few);
  });
});

/* ------------------------------------------------------------- who may read */

describe('project.cards: who may read (exactly project.list’s answers)', () => {
  const ROLES = ['owner', 'editor', 'viewer', 'guest', 'outsider', 'admin'] as const;
  const viewerFor = (role: (typeof ROLES)[number]): Viewer => (role === 'admin' ? staff() : viewerOf(f.ids[role]));

  for (const spine of ['open', 'switched off', 'organization not listed', 'column missing'] as const) {
    it(`role × organization (${spine})`, async () => {
      openFor('*');
      vi.stubEnv('BRAND_ROOMS', 'on');
      await selfProject('Target');
      const other = await secondOrg('Matrix second');
      await teamProject({ organizationId: other, title: 'Their team work' });
      if (spine === 'switched off') {
        vi.unstubAllEnvs();
        vi.stubEnv('BRAND_ROOMS', 'on');
      }
      if (spine === 'organization not listed') openFor(randomUUID());
      if (spine === 'column missing') {
        await f.sql.query('alter table brand_studio_video_projects drop column brand_project_id cascade');
        resetSpineProbe();
      }
      for (const role of ROLES) {
        const viewer = viewerFor(role);
        for (const org of [f.orgId, other]) {
          const list = await op(viewer, 'project.list', { organizationId: org });
          const answer = await op(viewer, 'project.cards', { organizationId: org });
          const label = `${spine} ${role} ${org === other ? 'B' : 'A'}`;
          expect(outcome(answer), label).toBe(outcome(list));
          if (!list.ok) expect(answer, label).toEqual(list);
          const expected = spine !== 'open' ? 'invalid' : ['owner', 'editor', 'viewer'].includes(role) && (org === f.orgId || role === 'owner') ? 'ok' : 'not_found';
          expect(outcome(answer), label).toBe(expected);
          if (answer.ok) {
            // A member of B (the owner) sees B's cards only; nothing of A in them, and the other way round.
            const text = JSON.stringify(answer);
            expect(text, label).not.toContain(org === f.orgId ? 'Their team work' : 'Target');
          }
        }
      }
      const madeUp = randomUUID();
      for (const role of ROLES) {
        const list = await op(viewerFor(role), 'project.list', { organizationId: madeUp });
        expect(await op(viewerFor(role), 'project.cards', { organizationId: madeUp })).toEqual(list);
      }
      for (const bad of [{}, { organizationId: 'not-a-uuid' }, { organizationId: 7 }]) {
        expect(await op(owner(), 'project.cards', bad)).toEqual(await op(owner(), 'project.list', bad));
      }
      if (spine !== 'open') expect(await op(owner(), 'project.cards', { organizationId: f.orgId })).toEqual(await op(owner(), 'no.such.operation', { organizationId: f.orgId }));
    });
  }

  it('sandboxed, generation-closed and self-studio-closed organizations: the same 404 as project.list', async () => {
    openFor('*');
    const orgs: string[] = [];
    for (const org of [{ id: [...SANDBOXED_CLIENT_ORG_IDS][0]!, name: 'Client' }]) {
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org.id, org.name, f.ids.owner, randomUUID()]);
      await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, f.ids.owner]);
      orgs.push(org.id);
    }
    for (const denied of ['generative_media', 'self_studio']) {
      const id = await secondOrg(`Closed ${denied}`);
      await f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, array[$2]::text[])', [id, denied]);
      orgs.push(id);
    }
    for (const org of orgs) {
      const list = await op(owner(), 'project.list', { organizationId: org });
      expect(list).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await op(owner(), 'project.cards', { organizationId: org })).toEqual(list);
    }
  });

  it('the server page helper answers what the POST answers, the route’s studio flag included', async () => {
    open();
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    await selfProject('Helper');
    for (const viewer of [owner(), viewerOf(f.ids.viewer), viewerOf(f.ids.guest), viewerOf(f.ids.outsider), staff()]) {
      expect(await loadProjectCards(deps, viewer, f.orgId)).toEqual(await op(viewer, 'project.cards', { organizationId: f.orgId }));
    }
    // app/api/brand-studio/route.ts answers this body (404) whatever the operation while studio v2 is off.
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect(await loadProjectCards(deps, owner(), f.orgId)).toEqual({ ok: false, code: 'studio_closed' });
    vi.unstubAllEnvs();
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    expect(await loadProjectCards(deps, owner(), f.orgId)).toEqual({ ok: false, code: 'invalid' });
  });
});

/* ------------------------------------------------------------- what stays put */

describe('the reads that now share their rules send origin/main’s statements, changed only by spine rules R-A', () => {
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  const recording = () => {
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(norm(text));
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    return { texts, sql: wrap(f.sql) };
  };
  /** Captured from origin/main (3aaba735) with the same calls (slice3a-origin-sql.json in the slice notes). */
  const ORIGIN = {
    overview: [
      "select p.id, p.title, p.origin, greatest(p.updated_at, coalesce(r.newest, p.updated_at)) as last_activity_at, c.kind as cover_kind, c.storage_key as cover_key, c.thumb_key as cover_thumb_key from brand_projects p left join lateral ( select max(j.created_at) as newest from brand_studio_jobs j where j.organization_id = p.organization_id and j.brand_project_id = p.id and coalesce(j.params ->> 'purpose', '') <> 'fill' ) r on true left join lateral ( select o.kind, o.storage_key, o.thumb_key from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id and o.organization_id = j.organization_id where j.organization_id = p.organization_id and j.brand_project_id = p.id and coalesce(j.params ->> 'purpose', '') <> 'fill' and o.status = 'ready' and o.deleted_at is null and o.storage_key is not null and o.kind in ('image', 'video') order by o.created_at desc, o.id desc limit 1 ) c on true where p.organization_id = $1 and ((p.origin = 'self' and p.status = 'active') or (p.origin = 'team' and p.client_visible and p.status in ('requested', 'active'))) order by last_activity_at desc, p.id desc limit $2",
      "select sp.id::text as bucket, case when j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill' then 'image' when j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p' then 'video' when j.kind in ('music', 'sound_effect') then 'sound' end as kind, count(*)::int as n from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id left join brand_projects sp on sp.id = j.brand_project_id and sp.organization_id = j.organization_id and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p') or (j.kind in ('music', 'sound_effect'))) and j.deleted_at is null and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '' group by 1, 2",
      "select sp.id::text as bucket, a.role, count(*)::int as n from brand_studio_assets a left join brand_projects sp on sp.id = a.brand_project_id and sp.organization_id = a.organization_id and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null group by 1, 2",
      "select sp.id::text as bucket, count(*)::int as n from brand_studio_video_projects f left join brand_projects sp on sp.id = f.brand_project_id and sp.organization_id = f.organization_id and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) where f.organization_id = $1 and f.deleted_at is null and f.status in ('active', 'completed') group by 1",
      "select c.* from ( select sp.id::text as bucket, o.id, o.job_id, o.kind, o.storage_key, o.thumb_key, o.width, o.height, o.created_at, row_number() over (partition by sp.id order by o.created_at desc, o.id desc) as rn from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id left join brand_projects sp on sp.id = j.brand_project_id and sp.organization_id = j.organization_id and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p')) and j.deleted_at is null and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '' and o.kind in ('image', 'video') ) c where c.rn <= $2 order by c.rn",
      "select a.* from brand_studio_assets a where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and (a.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = a.brand_project_id and sp.organization_id = $1 and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))))) and a.role in ('product', 'person', 'logo', 'style', 'place') order by a.created_at desc, a.id desc limit $2",
    ],
    roomOverview: [
      "select id, lineage_id, title, version, status, created_role, shared_at, status_changed_at, updated_at from brand_storyboards where organization_id = $1 and project_id = $2 and deleted_at is null and (status <> 'draft' or created_role = 'brand') order by updated_at desc limit 100",
      "select id, coalesce(stack_id, id)::text as stack_key, title, version, status, status_changed_at, created_at from brand_studio_reviews where organization_id = $1 and project_id = $2 and deleted_at is null order by created_at desc limit 100",
      "select m.id, m.author_role, p.display_name, m.body, m.created_at from brand_room_messages m left join profiles p on p.id = m.author_id where m.organization_id = $1 and m.channel = $2 and m.kind = 'text' and m.deleted_at is null order by m.created_at desc limit 5",
      "select m.channel, count(*)::int as unread from brand_room_messages m left join brand_room_reads r on r.organization_id = m.organization_id and r.channel = m.channel and r.user_id = $2 where m.organization_id = $1 and m.channel = any($3::text[]) and m.deleted_at is null and m.author_id is distinct from $2::uuid and (r.last_read_at is null or m.created_at > r.last_read_at) group by m.channel",
    ],
  };

  /** origin/main's `project.files` page statement for `scope: unfiled`, no kind (slice3a-origin-sql-files.json). */
  const ORIGIN_FILES_UNFILED =
    "select u.type, u.id::text as id, u.k from ((select 'job'::text as type, j.id, j.created_at, to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_jobs j where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p') or (j.kind in ('music', 'sound_effect'))) and j.deleted_at is null and (j.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = j.brand_project_id and sp.organization_id = $1 and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))))) and exists (select 1 from brand_studio_outputs o where o.job_id = j.id and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '') order by j.created_at desc, j.id desc limit $2) union all (select 'asset'::text as type, a.id, a.created_at, to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_assets a where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and (a.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = a.brand_project_id and sp.organization_id = $1 and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))))) and (a.role is null or a.role not in ('product', 'person', 'logo', 'style', 'place')) order by a.created_at desc, a.id desc limit $2) union all (select 'film'::text as type, f.id, f.created_at, to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_video_projects f where f.organization_id = $1 and f.deleted_at is null and f.status in ('active', 'completed') and (f.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = f.brand_project_id and sp.organization_id = $1 and ((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))))) order by f.created_at desc, f.id desc limit $2)) u order by u.created_at desc, u.id desc limit $2";

  /** Spine rules R-A (recorded from this branch): the overview's statements after the seat with no `filter`. */
  const R_A_OVERVIEW = [
    "select p.id, p.title, p.origin, greatest(p.updated_at, coalesce(r.newest, p.updated_at)) as last_activity_at, c.kind as cover_kind, c.storage_key as cover_key, c.thumb_key as cover_thumb_key from brand_projects p left join lateral ( select max(j.created_at) as newest from brand_studio_jobs j where j.organization_id = p.organization_id and j.brand_project_id = p.id and coalesce(j.params ->> 'purpose', '') <> 'fill' ) r on true left join lateral ( select o.kind, o.storage_key, o.thumb_key from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id and o.organization_id = j.organization_id where j.organization_id = p.organization_id and j.brand_project_id = p.id and coalesce(j.params ->> 'purpose', '') <> 'fill' and o.status = 'ready' and o.deleted_at is null and o.storage_key is not null and o.kind in ('image', 'video') order by o.created_at desc, o.id desc limit 1 ) c on true where p.organization_id = $1 and ((p.origin = 'self' and p.status = 'active') or (p.origin = 'team' and p.client_visible and p.status in ('requested', 'active'))) order by last_activity_at desc, p.id desc limit $2",
    "select sp.id::text as bucket, coalesce(((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))), false) as selectable, case when j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill' then 'image' when j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p' then 'video' when j.kind in ('music', 'sound_effect') then 'sound' end as kind, count(*)::int as n from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id left join brand_projects sp on sp.id = j.brand_project_id and sp.organization_id = j.organization_id and (sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p') or (j.kind in ('music', 'sound_effect'))) and j.deleted_at is null and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '' group by 1, 2, 3",
    "select sp.id::text as bucket, coalesce(((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))), false) as selectable, a.role, count(*)::int as n from brand_studio_assets a left join brand_projects sp on sp.id = a.brand_project_id and sp.organization_id = a.organization_id and (((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) or ((sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) and (a.role is null or a.role not in ('product', 'person', 'logo', 'style', 'place')))) where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and not (a.source = 'generation' and a.source_output_id is not null and coalesce(( select true from brand_studio_outputs so join brand_studio_jobs sr on sr.id = so.job_id and sr.organization_id = so.organization_id where so.id = a.source_output_id and so.organization_id = a.organization_id and so.saved_asset_id = a.id and so.status = 'ready' and so.deleted_at is null and coalesce(so.storage_key, '') <> '' and ((sr.kind in ('image', 'region_edit') and coalesce(sr.params ->> 'purpose', '') <> 'fill') or (sr.kind in ('video', 'video_remix', 'video_final') and sr.model <> 'compose-1080p') or (sr.kind in ('music', 'sound_effect'))) and sr.deleted_at is null limit 1), false)) group by 1, 2, 3",
    "select sp.id::text as bucket, coalesce(((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))), false) as selectable, count(*)::int as n from brand_studio_video_projects f left join brand_projects sp on sp.id = f.brand_project_id and sp.organization_id = f.organization_id and (sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) where f.organization_id = $1 and f.deleted_at is null and f.status in ('active', 'completed') group by 1, 2",
    "select c.* from ( select sp.id::text as bucket, o.id, o.job_id, o.kind, o.storage_key, o.thumb_key, o.width, o.height, o.created_at, row_number() over (partition by sp.id order by o.created_at desc, o.id desc) as rn from brand_studio_jobs j join brand_studio_outputs o on o.job_id = j.id left join brand_projects sp on sp.id = j.brand_project_id and sp.organization_id = j.organization_id and (sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p')) and j.deleted_at is null and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '' and o.kind in ('image', 'video') ) c where c.rn <= $2 order by c.rn",
    "select a.* from brand_studio_assets a where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and not (a.source = 'generation' and a.source_output_id is not null and coalesce(( select true from brand_studio_outputs so join brand_studio_jobs sr on sr.id = so.job_id and sr.organization_id = so.organization_id where so.id = a.source_output_id and so.organization_id = a.organization_id and so.saved_asset_id = a.id and so.status = 'ready' and so.deleted_at is null and coalesce(so.storage_key, '') <> '' and ((sr.kind in ('image', 'region_edit') and coalesce(sr.params ->> 'purpose', '') <> 'fill') or (sr.kind in ('video', 'video_remix', 'video_final') and sr.model <> 'compose-1080p') or (sr.kind in ('music', 'sound_effect'))) and sr.deleted_at is null limit 1), false)) and (a.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = a.brand_project_id and sp.organization_id = $1 and (((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) or ((sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) and (a.role is null or a.role not in ('product', 'person', 'logo', 'style', 'place')))))) and a.role in ('product', 'person', 'logo', 'style', 'place') order by a.created_at desc, a.id desc limit $2",
  ];
  /** Spine rules R-A: `project.files`' page statement for `scope: unfiled`, no kind. */
  const R_A_FILES_UNFILED =
    "select u.type, u.id::text as id, u.k from ((select 'job'::text as type, j.id, j.created_at, to_char(j.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_jobs j where j.organization_id = $1 and ((j.kind in ('image', 'region_edit') and coalesce(j.params ->> 'purpose', '') <> 'fill') or (j.kind in ('video', 'video_remix', 'video_final') and j.model <> 'compose-1080p') or (j.kind in ('music', 'sound_effect'))) and j.deleted_at is null and (j.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = j.brand_project_id and sp.organization_id = $1 and (sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)))) and exists (select 1 from brand_studio_outputs o where o.job_id = j.id and o.status = 'ready' and o.deleted_at is null and coalesce(o.storage_key, '') <> '') order by j.created_at desc, j.id desc limit $2) union all (select 'asset'::text as type, a.id, a.created_at, to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_assets a where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and not (a.source = 'generation' and a.source_output_id is not null and coalesce(( select true from brand_studio_outputs so join brand_studio_jobs sr on sr.id = so.job_id and sr.organization_id = so.organization_id where so.id = a.source_output_id and so.organization_id = a.organization_id and so.saved_asset_id = a.id and so.status = 'ready' and so.deleted_at is null and coalesce(so.storage_key, '') <> '' and ((sr.kind in ('image', 'region_edit') and coalesce(sr.params ->> 'purpose', '') <> 'fill') or (sr.kind in ('video', 'video_remix', 'video_final') and sr.model <> 'compose-1080p') or (sr.kind in ('music', 'sound_effect'))) and sr.deleted_at is null limit 1), false)) and (a.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = a.brand_project_id and sp.organization_id = $1 and (((sp.origin = 'self' and sp.status = 'active') or (sp.origin = 'team' and sp.client_visible and sp.status in ('requested', 'active'))) or ((sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)) and (a.role is null or a.role not in ('product', 'person', 'logo', 'style', 'place')))))) and (a.role is null or a.role not in ('product', 'person', 'logo', 'style', 'place')) order by a.created_at desc, a.id desc limit $2) union all (select 'film'::text as type, f.id, f.created_at, to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as k from brand_studio_video_projects f where f.organization_id = $1 and f.deleted_at is null and f.status in ('active', 'completed') and (f.brand_project_id is null or not exists (select 1 from brand_projects sp where sp.id = f.brand_project_id and sp.organization_id = $1 and (sp.origin = 'self' or (sp.origin = 'team' and sp.client_visible)))) order by f.created_at desc, f.id desc limit $2)) u order by u.created_at desc, u.id desc limit $2";

  it('project.overview: origin/main’s statements after the seat, but for spine rules R-A (visible projects, the finished flag, saved results once)', async () => {
    open();
    await overview();
    const recorded = recording();
    expect((await runStudioOperation({ ...deps, sql: recorded.sql }, owner(), 'project.overview', { organizationId: f.orgId })).ok).toBe(true);
    const start = recorded.texts.findIndex((text) => text.startsWith('select p.id, p.title, p.origin'));
    expect(recorded.texts.slice(start)).toEqual(R_A_OVERVIEW);
    // The project list itself is origin/main's statement; the five that follow are the intended R-A changes.
    expect(R_A_OVERVIEW[0]).toBe(ORIGIN.overview[0]);
    expect(R_A_OVERVIEW.length).toBe(ORIGIN.overview.length);
  });

  it('project.files: the page statement of spine rules R-A (its "a run is a file" rule is shared with the cards)', async () => {
    open();
    await firstFile(await selfProject('Warm up'));
    const recorded = recording();
    expect((await runStudioOperation({ ...deps, sql: recorded.sql }, owner(), 'project.files', { organizationId: f.orgId, scope: { kind: 'unfiled' } })).ok).toBe(true);
    expect(recorded.texts.filter((text) => text.startsWith('select u.type'))).toEqual([R_A_FILES_UNFILED]);
    expect(R_A_FILES_UNFILED).not.toBe(ORIGIN_FILES_UNFILED);
  });

  // The stage line itself, on a seeded room, keeps origin/main's expected values in origin/main's own test
  // (tests/brand-rooms/room/overview.test.ts "fills the stage line…", unchanged and green); the cards test above shows the
  // batched read gives exactly what `loadRoomOverview` gives for the same rooms.
  it('the room overview: the same statements, and the same stage line as the shared rule', async () => {
    const recorded = recording();
    const room = await loadRoomOverview(recorded.sql, { organizationId: f.orgId, project: { id: f.projectId, status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: 'x' }, userId: f.ids.owner });
    expect(recorded.texts).toEqual(ORIGIN.roomOverview);
    expect(room.stage).toBe('requested');
  });
});

/* ---------------------------------------------------------------------- pins */

describe('who can reach the new pieces', () => {
  const ROOT = process.cwd();
  const under = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? under(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
    });
  const sources = () => [...under('lib'), ...under('app'), ...under('components')];
  const importing = (pattern: RegExp) => sources().filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8'))).sort();
  const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);
  /** Files that name `name` on a line of code (not a comment line). */
  const usingInCode = (name: string) =>
    sources()
      .filter((file) =>
        readFileSync(path.join(ROOT, file), 'utf8')
          .split('\n')
          .some((line) => !isComment(line) && new RegExp(`\\b${name}\\b`).test(line)),
      )
      .sort();

  it('the cards are reached through the studio service only, and nothing on the team or admin side calls them', () => {
    expect(importing(/from ['"][^'"]*brand-project-files['"]/)).toEqual(['lib/brand-studio/service.ts']);
    expect(importing(/\bloadBrandProjectCards\b/)).toEqual(['components/brand-studio/api.ts', 'lib/brand-studio/brand-project-files.ts']);
    // The server page helper: only brand pages may use it (none yet; the screen half adds the home).
    expect(importing(/\bloadProjectCards\b/).filter((file) => !file.startsWith('app/(brand)/'))).toEqual(['lib/brand-studio/service.ts']);
    // The batched stage read is the spine's; the shared rule stays in the room overview. Any use counts (a named or a
    // namespace import alike), comments aside.
    expect(usingInCode('loadRoomStages')).toEqual(['lib/brand-rooms/overview.ts', 'lib/brand-studio/brand-project-files.ts']);
    expect(usingInCode('roomStageOf')).toEqual(['lib/brand-rooms/overview.ts']);
    expect(usingInCode('loadProjectCards').filter((file) => !file.startsWith('app/(brand)/'))).toEqual(['lib/brand-studio/service.ts']);
    const admin = sources().filter((file) => /^(app\/\(admin\)|lib\/admin|app\/api\/admin)/.test(file));
    for (const file of admin) expect(readFileSync(path.join(ROOT, file), 'utf8'), file).not.toMatch(/project\.cards|loadProjectCards|loadRoomStages/);
  });

  it('the typed client posts project.cards with the organization and hands back the answer or a failure code', async () => {
    const { createStudioApi } = await import('@/components/brand-studio/api');
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, projects: [], unfiled: {} } };
    const api = createStudioApi({
      organizationId: 'org-1',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as never,
    });
    expect(await api.loadBrandProjectCards()).toEqual({ ok: true, projects: [], unfiled: {} });
    expect(calls).toEqual([{ url: '/api/brand-studio', method: 'POST', body: { operation: 'project.cards', input: { organizationId: 'org-1' } } }]);
    reply = { status: 400, body: { ok: false, code: 'invalid' } };
    expect(await api.loadBrandProjectCards()).toEqual({ ok: false, code: 'invalid' });
    reply = { status: 404, body: { ok: false, code: 'feature_unavailable' } };
    expect(await api.loadBrandProjectCards()).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});
