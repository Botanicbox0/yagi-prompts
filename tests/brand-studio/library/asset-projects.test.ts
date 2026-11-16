import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadAssetProjectLinks, type AssetProjectLinks } from '@/lib/brand-studio/asset-projects';
import { appendClip, emptyComposerProject, stackClipTake, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { createMemoryMediaStore, type StudioMediaStore } from '@/lib/brand-studio/media-store';
import { loadStudioState } from '@/lib/brand-studio/service';
import type { StudioDeps } from '@/lib/brand-studio/types';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { buildHubEntries, filterProjectView, groupByProject, type HubDeliverable, type HubEntry } from '@/components/brand-studio/asset-hub-model';
import { listedJobs } from '@/components/brand-studio/store';
import { asset, job, output } from '../ui/fixtures';
import { seedOutput } from '../review/fixtures';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * Assets by project (2026-11-16). No column says which project a file belongs to; the page derives it
 * from three existing links. These tests pin the derivation: the server half (which ids each project
 * names, who may ask, how many queries) and the page half (`groupByProject`: where each tile lands).
 */

const clip = (id: string, source: { assetId?: string; outputId?: string }) => ({
  id,
  label: id,
  sourceKind: source.assetId ? ('asset' as const) : ('output' as const),
  ...source,
  srcUrl: 'https://stale.example/x.mp4',
  thumbUrl: null,
  durationSec: 6,
  trimStartSec: 0,
  trimEndSec: 6,
  volume: 1,
  muted: false,
});

function timelineOf(clips: Array<{ id: string; assetId?: string; outputId?: string; takeOutputId?: string }>, referenceAssetIds: string[] = []): ComposerProject {
  let timeline = emptyComposerProject('9:16');
  for (const item of clips) {
    timeline = appendClip(timeline, clip(item.id, item.assetId ? { assetId: item.assetId } : { outputId: item.outputId }));
    if (item.takeOutputId) {
      timeline = stackClipTake(timeline, item.id, {
        label: `${item.id} take`,
        sourceKind: 'output',
        outputId: item.takeOutputId,
        srcUrl: 'https://stale.example/t.mp4',
        thumbUrl: null,
        durationSec: 6,
        trimStartSec: 0,
        trimEndSec: 6,
      });
    }
  }
  return referenceAssetIds.length ? { ...timeline, referenceAssetIds } : timeline;
}

function links(result: Awaited<ReturnType<typeof loadAssetProjectLinks>>): AssetProjectLinks {
  if (!result.ok) throw new Error(`expected links, got ${result.code}`);
  return result;
}

describe('loadAssetProjectLinks: which files each project names', () => {
  let f: StudioFixture;
  let media: StudioMediaStore;
  let deps: StudioDeps;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
    media = createMemoryMediaStore();
    deps = studioDeps(f.sql, { media });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  const owner = () => viewerOf(f.ids.owner);
  const createProject = async (title: string, timeline: ComposerProject) => {
    const made = await runVideoProjectOperation({ sql: f.sql, media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID().replace(/-/g, '')}`, title, timeline });
    if (!made.ok || !made.project) throw new Error('expected a project');
    return made.project.id;
  };
  const review = (subject: { assetId?: string; outputId?: string }, projectId: string | null, extra = '') =>
    f.sql.query(
      `insert into brand_studio_reviews (organization_id, asset_id, output_id, title, created_by, created_role, project_id, source${extra ? ', deleted_at' : ''})
         values ($1, $2, $3, 'Cut for review', $4, 'studio', $5, $6${extra ? ', now()' : ''})`,
      [f.orgId, subject.assetId ?? null, subject.outputId ?? null, f.ids.admin, projectId, projectId ? 'delivery' : 'studio'],
    );

  it('reads a video project from its timeline (clips, takes, reference files) and a team project from its reviewed files', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 8);
    const logo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });
    const delivered = await seedVideoAsset(deps, f.orgId, f.ids.owner, 12);
    const shotA = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const shotB = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const still = await seedOutput(deps, f.orgId, f.ids.owner, 'image');

    const launch = await createProject('Spring film', timelineOf([{ id: 'c1', assetId: film, takeOutputId: shotA }, { id: 'c2', outputId: shotB }], [logo]));
    const teaser = await createProject('Teaser cut', timelineOf([{ id: 'c1', outputId: shotA }]));
    await review({ assetId: delivered }, f.projectId);
    await review({ outputId: still }, f.projectId);

    const result = links(await loadAssetProjectLinks({ sql: f.sql }, owner(), f.orgId));
    const self = new Map(result.self.map((link) => [link.id, link]));
    expect([...self.keys()].sort()).toEqual([launch, teaser].sort());
    expect(self.get(launch)!.title).toBe('Spring film');
    expect([...self.get(launch)!.assetIds].sort()).toEqual([film, logo].sort());
    expect([...self.get(launch)!.outputIds].sort()).toEqual([shotA, shotB].sort());
    // The same result on two timelines is named by both projects.
    expect(self.get(teaser)!.outputIds).toEqual([shotA]);
    expect(self.get(teaser)!.assetIds).toEqual([]);

    expect(result.team).toHaveLength(1);
    expect(result.team[0]).toMatchObject({ id: f.projectId, title: 'Spring launch', assetIds: [delivered], outputIds: [still] });
  });

  it('leaves out deleted and archived video projects, deleted reviews, reviews with no project and projects the client cannot see', async () => {
    const shot = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const kept = await createProject('Kept', timelineOf([{ id: 'c1', outputId: shot }]));
    const removed = await createProject('Removed', timelineOf([{ id: 'c1', outputId: shot }]));
    const shelved = await createProject('Shelved', timelineOf([{ id: 'c1', outputId: shot }]));
    expect((await runVideoProjectOperation({ sql: f.sql, media }, owner(), 'delete', { organizationId: f.orgId, projectId: removed })).ok).toBe(true);
    expect((await runVideoProjectOperation({ sql: f.sql, media }, owner(), 'status', { organizationId: f.orgId, projectId: shelved, status: 'archived' })).ok).toBe(true);

    const a = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const b = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 80, height: 60 });
    const c = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    const d = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    await review({ assetId: a }, f.projectId, 'deleted');
    await review({ assetId: b }, null);
    const hidden = randomUUID();
    await f.sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible)
         values ($1, $2, 'Internal draft', 'Not shared yet', 'studio', $3, $4, false)`,
      [hidden, f.orgId, f.ids.admin, randomUUID()],
    );
    await review({ outputId: c }, hidden);
    await review({ outputId: d }, f.projectId);

    const result = links(await loadAssetProjectLinks({ sql: f.sql }, owner(), f.orgId));
    expect(result.self.map((link) => link.id)).toEqual([kept]);
    expect(result.team).toEqual([expect.objectContaining({ id: f.projectId, assetIds: [], outputIds: [d] })]);
    expect(JSON.stringify(result)).not.toContain('Internal draft');
  });

  it('runs the studio seat check first: closed organizations fail, outsiders see nothing, guests get empty lists, viewers may read', async () => {
    const shot = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    await createProject('Spring film', timelineOf([{ id: 'c1', outputId: shot }]));

    expect(links(await loadAssetProjectLinks({ sql: f.sql }, viewerOf(f.ids.viewer), f.orgId)).self).toHaveLength(1);
    expect(await loadAssetProjectLinks({ sql: f.sql }, viewerOf(f.ids.guest), f.orgId)).toEqual({ ok: true, self: [], team: [] });
    expect(await loadAssetProjectLinks({ sql: f.sql }, viewerOf(f.ids.outsider), f.orgId)).toEqual({ ok: false, code: 'not_found' });
    expect(await loadAssetProjectLinks({ sql: f.sql }, { userId: null }, f.orgId)).toEqual({ ok: false, code: 'sign_in_required' });

    const closed = [
      { id: [...SANDBOXED_CLIENT_ORG_IDS][0]!, name: 'Client' },
      { id: randomUUID(), name: 'Morphic Studio' },
      { id: randomUUID(), name: '모픽' },
    ];
    for (const org of closed) {
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org.id, org.name, f.ids.owner, randomUUID()]);
      await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, f.ids.owner]);
      // Even with a project row sitting in the table, a sandboxed organization learns nothing.
      await f.sql.query(
        `insert into brand_studio_video_projects (organization_id, title, aspect, timeline, created_by, request_id) values ($1, 'Should stay closed', '9:16', '{}'::jsonb, $2, $3)`,
        [org.id, f.ids.owner, requestId()],
      );
      expect(await loadAssetProjectLinks({ sql: f.sql }, owner(), org.id)).toEqual({ ok: false, code: 'feature_unavailable' });
    }
    const denied = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [denied, 'Policy Restricted Brand', f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [denied, f.ids.owner]);
    await f.sql.query(`insert into brand_feature_policies (organization_id, denied_features, updated_by) values ($1, array['generative_media']::text[], $2)`, [denied, f.ids.admin]);
    expect(await loadAssetProjectLinks({ sql: f.sql }, owner(), denied)).toEqual({ ok: false, code: 'feature_unavailable' });
  });

  it('only reads, and asks the same number of questions for one project as for six', async () => {
    const counted = (statements: string[]): SqlRunner => ({ ...f.sql, query: ((text: string, params?: unknown[]) => (statements.push(text), f.sql.query(text, params))) as SqlRunner['query'] });
    const shot = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    await createProject('First', timelineOf([{ id: 'c1', outputId: shot }]));
    const one: string[] = [];
    links(await loadAssetProjectLinks({ sql: counted(one) }, owner(), f.orgId));

    for (let i = 0; i < 5; i += 1) {
      await createProject(`Project ${i}`, timelineOf([{ id: 'c1', outputId: shot }]));
      const projectId = randomUUID();
      await f.sql.query(
        `insert into brand_projects (id, organization_id, title, objective, production_mode, created_by, request_id, client_visible) values ($1, $2, $3, 'More work', 'studio', $4, $5, true)`,
        [projectId, f.orgId, `Team ${i}`, f.ids.owner, randomUUID()],
      );
      await review({ outputId: await seedOutput(deps, f.orgId, f.ids.owner, 'image') }, projectId);
    }
    const six: string[] = [];
    const result = links(await loadAssetProjectLinks({ sql: counted(six) }, owner(), f.orgId));
    expect(result.self).toHaveLength(6);
    expect(result.team).toHaveLength(5);
    expect(six).toHaveLength(one.length);
    for (const statement of six) expect(statement.trim().toLowerCase()).toMatch(/^select\b/);
  });

  it('never surfaces a deleted file, a deleted run or an internal fill run through a project', async () => {
    const liveShot = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const deletedRunShot = await seedOutput(deps, f.orgId, f.ids.owner, 'video');
    const fillShot = await seedOutput(deps, f.orgId, f.ids.owner, 'image');
    const liveFile = await seedVideoAsset(deps, f.orgId, f.ids.owner, 8);
    const deletedFile = await seedVideoAsset(deps, f.orgId, f.ids.owner, 9);
    const untouched = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const project = await createProject(
      'Spring film',
      timelineOf([
        { id: 'c1', outputId: liveShot },
        { id: 'c2', outputId: deletedRunShot },
        { id: 'c3', outputId: fillShot },
        { id: 'c4', assetId: liveFile },
        { id: 'c5', assetId: deletedFile },
      ]),
    );
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = (select job_id from brand_studio_outputs where id = $1)', [deletedRunShot]);
    await f.sql.query(`update brand_studio_jobs set params = jsonb_build_object('purpose', 'fill') where id = (select job_id from brand_studio_outputs where id = $1)`, [fillShot]);
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [deletedFile]);

    const state = await loadStudioState(deps, owner(), f.orgId);
    if (!state.ok) throw new Error('expected studio state');
    const result = links(await loadAssetProjectLinks({ sql: f.sql }, owner(), f.orgId));
    // The link still names all five ids (it is a plain reading of the timeline) …
    expect(result.self[0]!.outputIds).toHaveLength(3);
    // … and the page places only what the studio state shows.
    const view = groupByProject(buildHubEntries(state.assets, listedJobs(state.jobs), 'Generated'), result);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]!.id).toBe(project);
    expect(view.groups[0]!.entries.map((entry) => entry.key).sort()).toEqual([`a:${liveFile}`, `o:${liveShot}`].sort());
    const everywhere = [...view.standing, ...view.loose, ...view.groups.flatMap((group) => group.entries)].map((entry) => entry.key);
    for (const gone of [`o:${deletedRunShot}`, `o:${fillShot}`, `a:${deletedFile}`]) expect(everywhere).not.toContain(gone);
    expect(view.loose.map((entry) => entry.key)).toEqual([`a:${untouched}`]);
  });
});

describe('groupByProject: where each tile lands', () => {
  const entriesOf = () =>
    buildHubEntries(
      [
        asset(1, { name: 'Wordmark', role: 'logo', createdAt: '2026-11-10T01:00:00Z' }),
        asset(2, { kind: 'video', name: 'Runway reference', seconds: 8, createdAt: '2026-11-10T02:00:00Z' }),
        asset(3, { name: 'Moodboard scan', createdAt: '2026-11-10T03:00:00Z' }),
        asset(4, { kind: 'video', name: 'Master delivery', seconds: 30, createdAt: '2026-11-12T01:00:00Z' }),
        asset(5, { name: 'Saved still', createdAt: '2026-11-11T05:00:00Z' }),
      ],
      [
        job(1, { prompt: 'Opening shot', outputs: [output(1, { kind: 'video', createdAt: '2026-11-11T01:00:00Z' })] }),
        job(2, { prompt: 'Closing shot', outputs: [output(2, { kind: 'video', createdAt: '2026-11-11T02:00:00Z' })] }),
        job(3, { prompt: 'Loose picture', outputs: [output(3, { createdAt: '2026-11-11T03:00:00Z' })] }),
        job(4, { prompt: 'Key visual', outputs: [output(4, { createdAt: '2026-11-11T04:00:00Z', savedAssetId: asset(5).id })] }),
      ],
      'Generated',
    );
  const keys = (list: readonly HubEntry[]) => list.map((entry) => entry.key);
  const link = (n: number, title: string, assetIds: string[], outputIds: string[]) => ({ id: `p${n}`, title, updatedAt: '2026-11-01T00:00:00Z', assetIds, outputIds });
  const deliverable = (n: number, projectId: string, patch: Partial<HubDeliverable> = {}): HubDeliverable => ({
    id: `d${n}`,
    projectId,
    projectTitle: 'Winter campaign',
    title: `Creator cut ${n}`,
    kind: 'video',
    url: 'https://media.example/d.mp4',
    createdAt: '2026-11-09T00:00:00Z',
    ...patch,
  });

  it('places each of the three links, shows a shared file in both projects and keeps placed files out of the loose group', () => {
    const entries = entriesOf();
    const view = groupByProject(
      entries,
      {
        self: [link(1, 'Spring film', [asset(2).id], [output(1).id, output(2).id]), link(2, 'Teaser cut', [], [output(1).id])],
        team: [link(3, 'Winter campaign', [asset(4).id], [])],
      },
      [deliverable(1, 'p3'), deliverable(2, 'p9', { projectTitle: 'Summer seeding' })],
    );
    const byKey = new Map(view.groups.map((group) => [group.key, group]));
    expect([...byKey.keys()].sort()).toEqual(['self:p1', 'self:p2', 'team:p3', 'team:p9']);
    // 1) a video project: what its timeline uses
    expect(keys(byKey.get('self:p1')!.entries).sort()).toEqual([`a:${asset(2).id}`, `o:${output(1).id}`, `o:${output(2).id}`].sort());
    // … and the same result on a second timeline is in both
    expect(keys(byKey.get('self:p2')!.entries)).toEqual([`o:${output(1).id}`]);
    // 2) a team project: its reviewed files, 3) and its campaign deliverables
    expect(keys(byKey.get('team:p3')!.entries)).toEqual([`a:${asset(4).id}`]);
    expect(byKey.get('team:p3')!.deliverables.map((item) => item.id)).toEqual(['d1']);
    // A project known only through its deliverables still gets a group, named by them.
    expect(byKey.get('team:p9')).toMatchObject({ origin: 'team', title: 'Summer seeding', entries: [] });
    // Newest content first.
    expect(view.groups.map((group) => group.key)).toEqual(['team:p3', 'self:p1', 'self:p2', 'team:p9']);

    // Standing material is the role-tagged upload, whatever uses it; it is not repeated below.
    expect(keys(view.standing)).toEqual([`a:${asset(1).id}`]);
    // Nothing placed is loose, nothing loose is placed, and every entry is somewhere.
    const placed = new Set(view.groups.flatMap((group) => keys(group.entries)));
    expect(keys(view.loose).sort()).toEqual([`a:${asset(3).id}`, `a:${asset(5).id}`, `o:${output(3).id}`, `o:${output(4).id}`].sort());
    for (const key of keys(view.loose)) expect(placed.has(key)).toBe(false);
    expect(new Set([...placed, ...keys(view.loose), ...keys(view.standing)]).size).toBe(entries.length);
  });

  it('keeps a result and the library copy saved from it together, in either direction', () => {
    const entries = entriesOf();
    const byOutput = groupByProject(entries, { self: [link(1, 'Key visual', [], [output(4).id])], team: [] });
    expect(keys(byOutput.groups[0]!.entries).sort()).toEqual([`a:${asset(5).id}`, `o:${output(4).id}`].sort());
    const byAsset = groupByProject(entries, { self: [], team: [link(2, 'Winter campaign', [asset(5).id], [])] });
    expect(keys(byAsset.groups[0]!.entries).sort()).toEqual([`a:${asset(5).id}`, `o:${output(4).id}`].sort());
    expect(keys(byAsset.loose)).not.toContain(`o:${output(4).id}`);
  });

  it('has no groups without links: empty projects are dropped and ids that are not on the page are ignored', () => {
    const entries = entriesOf();
    expect(groupByProject(entries, null).groups).toEqual([]);
    expect(groupByProject(entries, { self: [], team: [] }).groups).toEqual([]);
    const ghost = groupByProject(entries, { self: [link(1, 'Old project', ['00000000-0000-4000-8000-00000000dead'], ['00000000-0000-4000-8000-00000000beef'])], team: [link(2, 'Empty room', [], [])] });
    expect(ghost.groups).toEqual([]);
    // With no project at all, everything that is not standing material is loose.
    expect(ghost.loose).toHaveLength(entries.length - 1);
    // A role-tagged upload used by a project is in the project and still in the standing row.
    const used = groupByProject(entries, { self: [link(1, 'Spring film', [asset(1).id], [])], team: [] });
    expect(keys(used.groups[0]!.entries)).toEqual([`a:${asset(1).id}`]);
    expect(keys(used.standing)).toEqual([`a:${asset(1).id}`]);
  });

  it('filters inside the groups, drops a group with nothing left, and keeps a whole project when the search names it', () => {
    const view = groupByProject(
      entriesOf(),
      { self: [link(1, 'Spring film', [asset(2).id], [output(1).id, output(2).id])], team: [link(3, 'Winter campaign', [asset(4).id], [])] },
      [deliverable(1, 'p3', { kind: 'image' })],
    );
    const base = { liked: new Set<string>(), query: '', kind: 'all' as const, role: 'all' as const };

    const closing = filterProjectView(view, { ...base, query: 'closing' });
    expect(closing.groups.map((group) => group.key)).toEqual(['self:p1']);
    expect(keys(closing.groups[0]!.entries)).toEqual([`o:${output(2).id}`]);
    expect(closing.loose).toEqual([]);

    const named = filterProjectView(view, { ...base, query: 'spring' });
    expect(named.groups.map((group) => group.key)).toEqual(['self:p1']);
    expect(named.groups[0]!.entries).toHaveLength(3);

    const images = filterProjectView(view, { ...base, kind: 'image' });
    expect(images.groups.map((group) => group.key)).toEqual(['team:p3']);
    expect(images.groups[0]!.entries).toEqual([]);
    expect(images.groups[0]!.deliverables).toHaveLength(1);

    // A role only exists on uploads: deliverables and studio results fall away, the standing row keeps its match.
    const logos = filterProjectView(view, { ...base, role: 'logo' });
    expect(logos.groups).toEqual([]);
    expect(keys(logos.standing)).toEqual([`a:${asset(1).id}`]);
  });
});
