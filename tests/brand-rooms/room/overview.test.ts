import { afterEach, describe, expect, it } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  initialsOf,
  isSchemaGap,
  loadRoomOverview,
  loadRoomPeople,
  loadRoomProject,
  roomTab,
  roomTrack,
  roomUnreadCounts,
} from '@/lib/brand-rooms/overview';
import { seedImageAsset, studioDeps, studioFixture, type StudioFixture } from '../../brand-studio/server/helpers';

/**
 * docs/BRAND-ROOMS.md §7 — the room's overview from the real tables (PGlite with every migration), and
 * the tolerance the room needs while the other slices' migrations are not applied yet.
 */
let f: StudioFixture | null = null;
afterEach(async () => {
  await f?.db.close();
  f = null;
});

describe('small rules', () => {
  it('derives the commission track the way the request forms write it', () => {
    expect(roomTrack({ productionMode: 'creator', objective: 'x' })).toBe('creator_campaign');
    expect(roomTrack({ productionMode: 'studio', objective: '[TRACK: CUSTOM STUDIO TEMPLATE BUILD]\nCategory…' })).toBe('template_build');
    expect(roomTrack({ productionMode: 'studio', objective: '[TRACK: MASTER VIDEO PRODUCTION ONLY]\n…' })).toBe('studio_film');
    expect(roomTrack({ productionMode: 'studio', objective: 'A spring film' })).toBe('studio_film');
  });

  it('reads ?tab= and falls back to the overview', () => {
    expect(roomTab('storyboard')).toBe('storyboard');
    expect(roomTab(['chat', 'review'])).toBe('chat');
    expect(roomTab('settings')).toBe('overview');
    expect(roomTab(undefined)).toBe('overview');
  });

  it('makes initials without ever showing an address', () => {
    expect(initialsOf('김하늘', 'x@example.test')).toBe('김');
    expect(initialsOf('Ada Lovelace', null)).toBe('AL');
    expect(initialsOf('ada', null)).toBe('AD');
    expect(initialsOf(null, 'owner@example.test')).toBe('O');
    expect(initialsOf('  ', '')).toBe('·');
  });

  it('knows a missing table or column from a real failure', () => {
    expect(isSchemaGap({ code: '42P01' })).toBe(true);
    expect(isSchemaGap({ code: '42703' })).toBe(true);
    expect(isSchemaGap(new Error('relation "brand_storyboards" does not exist'))).toBe(true);
    expect(isSchemaGap(new Error('column "project_id" does not exist'))).toBe(true);
    expect(isSchemaGap(new Error('connection terminated'))).toBe(false);
    expect(isSchemaGap({ code: '23505' })).toBe(false);
  });
});

/** A runner whose room tables do not exist yet (before 0082–0084). Everything else answers empty. */
function preMigrationRunner(failure: { code?: string; message: string } = { code: '42P01', message: 'relation does not exist' }): SqlRunner {
  const runner: SqlRunner = {
    async query(text: string) {
      if (/brand_storyboards|brand_room_messages|brand_room_reads|brand_studio_review_comments|project_id = \$2 and deleted_at/.test(text)) {
        throw Object.assign(new Error(failure.message), failure.code ? { code: failure.code } : {});
      }
      return { rows: [] };
    },
    transaction: (fn) => fn(runner),
  };
  return runner;
}

describe('before the room migrations', () => {
  const ORG = '0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11';
  const PROJECT = '1c7b5ce7-7054-4c6b-8a7d-3b2f1f8f7d22';
  const USER = '2d8c6df8-8165-4d7c-9b8e-4c3a2a9a8e33';
  const project = { id: PROJECT, status: 'active' as const, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' };

  it('shows an empty room instead of an error', async () => {
    const overview = await loadRoomOverview(preMigrationRunner(), { organizationId: ORG, project, userId: USER });
    expect(overview).toMatchObject({ stage: 'requested', todos: [], activity: [], counts: { storyboard: 0, review: 0, chat: 0 }, empty: true });
    expect(overview.steps.map((s) => s.state)).toEqual(['current', 'ahead', 'ahead', 'ahead', 'ahead']);
    expect(overview.steps[0]!.at).toBe(project.createdAt);
    expect(await roomUnreadCounts(preMigrationRunner(), { organizationId: ORG, userId: USER, projectIds: [PROJECT] })).toEqual({});
    // A missing column (the deliverables' project_id before 0084) is the same.
    expect((await loadRoomOverview(preMigrationRunner({ code: '42703', message: 'column does not exist' }), { organizationId: ORG, project, userId: USER })).empty).toBe(true);
  });

  it('still fails loudly on anything that is not a missing table or column', async () => {
    await expect(loadRoomOverview(preMigrationRunner({ message: 'connection terminated' }), { organizationId: ORG, project, userId: USER })).rejects.toThrow('connection terminated');
  });
});

describe('the overview from the real tables', () => {
  async function seed() {
    f = await studioFixture({ capKrw: 1_000_000 });
    const { sql, orgId, projectId, ids } = f;
    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
    // Storyboards: v1 approved, v2 shared (waiting), and a team draft the brand must not see.
    const lineage = '3e9d7e09-9276-4e8e-8c9f-5d4b3b0b9f44';
    await sql.query(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, status, created_by, created_role, shared_at, status_changed_at, created_at, updated_at)
       values ($1, $2, $3, 1, 'Spring board', 'approved', $4, 'studio', $5, $6, $5, $6),
              ($1, $2, $3, 2, 'Spring board', 'shared', $4, 'studio', $7, null, $7, $7),
              ($1, $2, gen_random_uuid(), 1, 'Hidden draft', 'draft', $4, 'studio', null, null, $8, $8)`,
      [orgId, projectId, lineage, ids.admin, at(600), at(500), at(300), at(10)],
    );
    // Deliverables: v1 sent back for changes, v2 waiting with one open note (and one resolved).
    const deps = studioDeps(sql);
    const a1 = await seedImageAsset(deps, orgId, ids.owner);
    const a2 = await seedImageAsset(deps, orgId, ids.owner);
    const v1 = (
      await sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, asset_id, title, status, created_by, created_role, project_id, version, source, status_changed_at, created_at, updated_at)
         values ($1, $2, 'Hero cut', 'changes_requested', $3, 'studio', $4, 1, 'delivery', $5, $6, $5) returning id`,
        [orgId, a1, ids.admin, projectId, at(200), at(250)],
      )
    ).rows[0]!.id;
    const v2 = (
      await sql.query<{ id: string }>(
        `insert into brand_studio_reviews (organization_id, asset_id, title, status, created_by, created_role, project_id, stack_id, version, source, created_at, updated_at)
         values ($1, $2, 'Hero cut', 'open', $3, 'studio', $4, $5, 2, 'delivery', $6, $6) returning id`,
        [orgId, a2, ids.admin, projectId, v1, at(100)],
      )
    ).rows[0]!.id;
    await sql.query(
      `insert into brand_studio_review_comments (review_id, organization_id, author_id, author_role, body, resolved_at)
       values ($1, $2, $3, 'brand', 'Logo smaller', null), ($1, $2, $3, 'brand', 'Done already', now())`,
      [v2, orgId, ids.owner],
    );
    // Messages: the owner read the channel 60 minutes ago; the team wrote after that, the owner too.
    await sql.query(
      `insert into brand_room_messages (organization_id, project_id, channel, author_id, author_role, kind, body, created_at)
       values ($1, $2, $8, $3, 'studio', 'text', 'Before you read', $5),
              ($1, $2, $8, $3, 'studio', 'text', 'New cut is up', $6),
              ($1, $2, $8, $4, 'brand', 'text', 'Thanks!', $7)`,
      [orgId, projectId, ids.admin, ids.owner, at(90), at(30), at(5), String(projectId)],
    );
    await sql.query(`insert into brand_room_reads (organization_id, channel, user_id, last_read_at) values ($1, $2, $3, $4)`, [orgId, String(projectId), ids.owner, at(60)]);
    return { v1, v2, at };
  }

  it('fills the stage line, the to-do list, the counts and the recent activity', async () => {
    const { v2 } = await seed();
    const { sql, orgId, projectId, ids } = f!;
    const project = await loadRoomProject(sql, orgId, projectId);
    expect(project).toMatchObject({ id: projectId, organizationId: orgId, title: 'Spring launch', track: 'creator_campaign' });
    const overview = await loadRoomOverview(sql, { organizationId: orgId, project: project!, userId: ids.owner });

    expect(overview.stage).toBe('revision');
    expect(overview.steps.map((s) => [s.stage, s.state])).toEqual([
      ['requested', 'done'],
      ['storyboard', 'done'],
      ['draft', 'done'],
      ['revision', 'current'],
      ['done', 'ahead'],
    ]);
    expect(overview.steps.slice(0, 4).every((s) => s.at)).toBe(true);
    expect(overview.steps[4]!.at).toBeNull();

    expect(overview.todos).toEqual([
      { kind: 'storyboard', id: expect.any(String), title: 'Spring board', version: 2 },
      { kind: 'review', id: v2, title: 'Hero cut', version: 2, openNotes: 1, waiting: true },
      { kind: 'chat', unread: 1 },
    ]);
    expect(overview.counts).toEqual({ storyboard: 1, review: 1, chat: 1 });
    expect(overview.empty).toBe(false);

    expect(overview.activity).toHaveLength(5);
    expect(overview.activity.map((a) => a.kind)).toEqual(['message', 'message', 'message', 'reviewPosted', 'reviewChanges']);
    expect(overview.activity[0]).toMatchObject({ kind: 'message', authorRole: 'brand', line: 'Thanks!' });
    expect(overview.activity[1]).toMatchObject({ kind: 'message', authorRole: 'studio', authorName: null, line: 'New cut is up' });
    // Newest first, and the team's hidden draft never shows.
    const times = overview.activity.map((a) => a.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(JSON.stringify(overview)).not.toContain('Hidden draft');
  });

  it('counts unread per person: their own messages and what they already read never count', async () => {
    await seed();
    const { sql, orgId, projectId, ids } = f!;
    expect(await roomUnreadCounts(sql, { organizationId: orgId, userId: ids.owner, projectIds: [projectId] })).toEqual({ [projectId]: 1 });
    // The editor never opened the channel: all three messages are new to them.
    expect(await roomUnreadCounts(sql, { organizationId: orgId, userId: ids.editor, projectIds: [projectId] })).toEqual({ [projectId]: 3 });
    expect(await roomUnreadCounts(sql, { organizationId: orgId, userId: null, projectIds: [projectId] })).toEqual({});
    expect(await roomUnreadCounts(sql, { organizationId: orgId, userId: ids.owner, projectIds: ['not-a-uuid'] })).toEqual({});
  });

  it('opens an empty project as an empty room, and finds only a visible project of this brand', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    const { sql, orgId, projectId, ids } = f;
    const project = await loadRoomProject(sql, orgId, projectId);
    const overview = await loadRoomOverview(sql, { organizationId: orgId, project: project!, userId: ids.owner });
    expect(overview).toMatchObject({ stage: 'requested', todos: [], activity: [], empty: true });
    expect(await loadRoomProject(sql, '0b6a4bd6-6f43-4b5a-9f6c-2a1f0e7f6c11', projectId)).toBeNull();
    expect(await loadRoomProject(sql, orgId, 'not-a-uuid')).toBeNull();
    await sql.query('update brand_projects set client_visible = false where id = $1', [projectId]);
    expect(await loadRoomProject(sql, orgId, projectId)).toBeNull();
  });

  it('lists members and the project guest as initials and names, never an address', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    const { sql, orgId, projectId, ids } = f;
    await sql.query(`update profiles set display_name = 'Ada Lovelace' where id = $1`, [ids.owner]);
    const people = await loadRoomPeople(sql, orgId, projectId);
    expect(people.map((p) => p.id).sort()).toEqual([ids.owner, ids.editor, ids.viewer, ids.guest].sort());
    expect(people.find((p) => p.id === ids.owner)).toEqual({ id: ids.owner, initials: 'AL', name: 'Ada Lovelace' });
    expect(people.at(-1)!.id).toBe(ids.guest);
    expect(JSON.stringify(people)).not.toContain('@');
  });
});
