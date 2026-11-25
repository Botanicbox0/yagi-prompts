import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { brandOrgListFilter, loadBrandOrgList } from '@/lib/admin/brand-org-list';
import { roomAudience } from '@/lib/brand-rooms/access';
import { loadRoomSummary, runRoomOperation, staffRoomChannels, staffRoomOverview } from '@/lib/brand-rooms/messages';
import { staffStoryboardList } from '@/lib/brand-rooms/storyboards';
import { inspectProjectOnlyRetention, loadOrganizationStorageSummary, setOrganizationStorageQuota } from '@/lib/brands/storage-quota';
import { isOrganizationUploadApproved } from '@/lib/brands/upload-gate';
import { loadBrandWorkspace, loadBrandWorkspaceScope, loadStudioWorkspace } from '@/lib/brands/workspace/service';
import { loadAssetProjectLinks } from '@/lib/brand-studio/asset-projects';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import type { StudioBrandProject } from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { campaignsOf } from '@/lib/brand-studio/repo';
import { staffDeliveryProjects } from '@/lib/brand-studio/review';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §3.4 — a project the brand made for itself (`origin = 'self'`) never appears in,
 * is counted by, or notifies anything on the YAGI-team side, nor the brand's own team-channel lists. Every answer
 * below is compared on the SAME database before and after one self project (with a run, an upload and a film
 * filed in it) is added: they must be identical. The team-side reads must also keep working before migration
 * 0194 is applied (no `origin` column).
 */
/** One clock for both snapshots of a test (a minute ahead, so every row made during the test is in the past). */
const NOW = new Date(Date.now() + 60_000);
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetSpineProbe();
  f = await studioFixture();
  deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' }) });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const rooms = () => ({ sql: f.sql, media: deps.media });

/**
 * Some real life on both sides: lines in the team channel and the general one, a project the staff hid, and a
 * run, an upload and a film in the studio (unfiled for now: "the same database without the self project").
 */
async function life(): Promise<{ jobId: string; assetId: string; filmId: string }> {
  for (const projectId of [f.projectId, 'general']) {
    const sent = await runRoomOperation(rooms(), owner(), 'message.send', { organizationId: f.orgId, projectId, requestId: randomUUID(), body: 'When is the first cut?' });
    expect(sent.result.ok).toBe(true);
  }
  await f.sql.query(
    `insert into brand_projects (organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, 'Hidden by staff', 'Internal', 'studio', 'active', false, $2, $3)`,
    [f.orgId, f.ids.admin, randomUUID()],
  );
  const run = await createStudioJob(deps, owner(), { kind: 'image', organizationId: f.orgId, requestId: requestId(), model: 'seedream-5.5', prompt: 'a bottle', aspect: '1:1', resolution: '2K' });
  if (!run.ok) throw new Error(run.code);
  const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
  const film = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut' });
  if (!film.ok || !film.project) throw new Error('film');
  return { jobId: run.job.id, assetId, filmId: film.project.id };
}

/** A self project, made the way the studio makes it, with the run, the upload and the film filed in it. */
async function addSelfProject(filed?: { jobId: string; assetId: string; filmId: string }): Promise<string> {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', f.orgId);
  const made = await runStudioOperation(deps, owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'Our own spring board' });
  if (!made.ok || !('project' in made)) throw new Error(JSON.stringify(made));
  const id = (made.project as StudioBrandProject).id;
  if (filed) {
    const moved = await runStudioOperation(deps, owner(), 'project.move', { organizationId: f.orgId, projectId: id, jobIds: [filed.jobId], assetIds: [filed.assetId], filmIds: [filed.filmId] });
    expect(moved).toMatchObject({ ok: true, projectId: id, jobIds: [filed.jobId] });
  }
  // The YAGI team side is compared with the switch off again, so only the data differs, not the switch.
  vi.unstubAllEnvs();
  return id;
}

/** Everything the brand's team channel and the YAGI team side read about projects. */
async function teamSide(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out.customerRooms = await loadRoomSummary({ sql: f.sql }, owner(), f.orgId);
  out.staffOverview = await staffRoomOverview({ sql: f.sql }, staff());
  out.staffChannels = await staffRoomChannels({ sql: f.sql }, staff(), f.orgId);
  out.staffStoryboards = await staffStoryboardList({ sql: f.sql, media: deps.media }, staff());
  out.staffDelivery = await staffDeliveryProjects({ sql: f.sql, media: deps.media }, staff());
  out.adminOrgList = await loadBrandOrgList(f.sql, staff(), brandOrgListFilter({}), { now: NOW });
  out.studioWorkspace = await loadStudioWorkspace({ sql: f.sql }, staff());
  out.staffWorkspace = await loadBrandWorkspace({ sql: f.sql }, staff(), { organizationId: f.orgId, includeAllContent: true });
  out.customerWorkspace = await loadBrandWorkspace({ sql: f.sql }, owner(), { organizationId: f.orgId, includeAllContent: true });
  out.staffScope = await loadBrandWorkspaceScope({ sql: f.sql }, staff());
  out.customerScope = await loadBrandWorkspaceScope({ sql: f.sql }, owner());
  out.addToYagiProject = await campaignsOf(f.sql, f.orgId);
  out.assetHubTeam = await loadAssetProjectLinks({ sql: f.sql }, owner(), f.orgId);
  out.audienceTeam = await roomAudience(f.sql, f.orgId, f.projectId);
  out.audienceGeneral = await roomAudience(f.sql, f.orgId, null);
  out.storage = await loadOrganizationStorageSummary(f.sql, f.orgId, NOW);
  out.retention = await inspectProjectOnlyRetention(f.sql, f.orgId, NOW);
  out.uploadApproved = await isOrganizationUploadApproved(f.sql, f.orgId, NOW);
  return out;
}

describe('a self project is invisible to the team side', () => {
  it('every team-side list, count and audience is identical with and without it', async () => {
    const filed = await life();
    const before = await teamSide();
    // Sanity: the snapshot is not empty where it matters.
    expect((before.staffDelivery as { projects: unknown[] }).projects.length).toBeGreaterThan(0);
    expect((before.customerRooms as { channels: unknown[] }).channels.length).toBeGreaterThan(0);
    expect((before.staffOverview as { channels: unknown[] }).channels.length).toBeGreaterThan(0);
    const selfId = await addSelfProject(filed);
    expect(await teamSide()).toEqual(before);
    // The same with the switch on for the brand: the team side never depends on it.
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', '*');
    expect(await teamSide()).toEqual(before);
    // Its own channel has no audience, like a project that does not exist.
    expect(await roomAudience(f.sql, f.orgId, selfId)).toEqual([]);
    // And the row is really there, hidden.
    expect((await f.sql.query('select origin, client_visible from brand_projects where id = $1', [selfId])).rows[0]).toEqual({ origin: 'self', client_visible: false });
  });

  it('the same holds for an archived self project (it does not move the retention clock)', async () => {
    const init = await loadOrganizationStorageSummary(f.sql, f.orgId);
    const set = await setOrganizationStorageQuota({ sql: f.sql }, staff(), { organizationId: f.orgId, quotaBytes: 30 * 1024 ** 3, retentionDays: 90, note: 'project-only 90d retention', expectedRevision: init.revision });
    expect(set.ok).toBe(true);
    await f.sql.query("update brand_projects set status = 'completed', updated_at = now() - interval '95 days' where id = $1", [f.projectId]);
    const filed = await life();
    await f.sql.query("update brand_projects set status = 'cancelled' where title = 'Hidden by staff'");
    const before = await teamSide();
    expect((before.retention as { expired: boolean }).expired).toBe(true);
    const active = await addSelfProject(filed);
    const archived = await addSelfProject();
    await f.sql.query("update brand_projects set status = 'completed', updated_at = now() where id = $1", [archived]);
    expect(await teamSide()).toEqual(before);
    expect(active).not.toBe(archived);
  });

  for (const spine of ['switched off (columns present)', 'switched on'] as const) {
  it(`a self project made by a team account does not approve the upload gate (${spine})`, async () => {
    // origin/main's statement runs unchanged (tests/brands/workspace-approval-parity.test.ts pins it); a row it finds
    // approves only when a second statement finds a team project, whatever the switch says.
    if (spine === 'switched on') {
      vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
      vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', '*');
    }
    const fresh = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [fresh, 'Fresh brand', f.ids.admin, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [fresh, f.ids.admin]);
    expect(await isOrganizationUploadApproved(f.sql, fresh)).toBe(false);
    await f.sql.query(
      `insert into brand_projects (organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id)
        values ($1, 'Mine', '', 'studio', 'active', false, 'self', $2, $3)`,
      [fresh, f.ids.admin, randomUUID()],
    );
    expect(await isOrganizationUploadApproved(f.sql, fresh)).toBe(false);
    // A team project made by the team account does approve it, as before.
    await f.sql.query(
      `insert into brand_projects (organization_id, title, objective, production_mode, created_by, request_id)
        values ($1, 'Commissioned', 'Made by the team', 'studio', $2, $3)`,
      [fresh, f.ids.admin, randomUUID()],
    );
    expect(await isOrganizationUploadApproved(f.sql, fresh)).toBe(true);
  });
  }

  it('posting to the room channel named by a self project is refused and tells nobody', async () => {
    const filed = await life();
    const selfId = await addSelfProject(filed);
    const counts = async () =>
      (await f.sql.query<{ messages: number; notices: number; outbox: number }>(
        `select (select count(*)::int from brand_room_messages) as messages,
                (select count(*)::int from brand_room_notices) as notices,
                (select count(*)::int from team_notice_deliveries) as outbox`,
      )).rows[0];
    const before = await counts();
    for (const viewer of [owner(), viewerOf(f.ids.editor)]) {
      const sent = await runRoomOperation(rooms(), viewer, 'message.send', { organizationId: f.orgId, projectId: selfId, requestId: randomUUID(), body: '@야기 팀 hello' });
      expect(sent.result).toMatchObject({ ok: false, code: 'not_found' });
    }
    const read = await runRoomOperation(rooms(), owner(), 'channel.read', { organizationId: f.orgId, projectId: selfId });
    expect(read.result.ok).toBe(false);
    expect(await counts()).toEqual(before);
  });
});

describe('before migration 0194 (no origin column), the team-side reads work and answer the same', () => {
  it('drops the column and compares', async () => {
    await life();
    const withColumn = await teamSide();
    await f.sql.query('alter table brand_projects drop column origin cascade');
    resetSpineProbe();
    expect(await teamSide()).toEqual(withColumn);
  });
});
