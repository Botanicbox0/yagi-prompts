import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { assetFromOutput } from '@/lib/brand-studio/assets';
import { brandProjectForNew, resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import type { StudioBrandProject, StudioBrandProjectList, StudioBrandProjectMoved, StudioJobView, StudioState } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { generateReferenceMusic, generateSoundEffect } from '@/lib/brand-studio/music';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { submitUpscaleJob } from '@/lib/brand-studio/upscale';
import { studioMonthWindow, usedKrwIn } from '@/lib/brand-studio/usage';
import { loadVideoProjects, runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §3–§4, slice 1a (server only). Pinned here:
 *  - closed (switch off, organization not listed, or migration 0194 missing): the three new operations answer
 *    exactly like an unknown operation, a `brandProjectId` is not looked at, and no answer carries a new field;
 *  - `project.create` writes one hidden 'self' row and nothing else (no event, no team notice, no outbox row);
 *  - `project.list` lists only what new work may be filed in;
 *  - new work is filed by the server's rule (fill: none; made from an earlier result: that result's project;
 *    otherwise the chosen project, which must be selectable, else `not_found`), without touching the credit path;
 *  - `project.move` moves whole families in one transaction and checks every id against the organization;
 *  - a member of one organization can never list, file into, or move anything of another.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', BRAND_STUDIO_MUSIC_GENERATION: 'on' };
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

/** The spine is a server setting read from the environment, like `BRAND_STUDIO_PROJECTS`. */
const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};
const open = () => openFor(f.orgId);

const owner = () => viewerOf(f.ids.owner);
const image = { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, viewer, operation, input);

/** `job.create` as the studio's POST route runs it (the member's answer carries `brandProjectId` while open). */
async function create(input: Record<string, unknown>, viewer = owner()): Promise<StudioJobView> {
  const result = await op(viewer, 'job.create', { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok || !('job' in result)) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.job as StudioJobView;
}
async function state(viewer = owner(), scope?: Parameters<typeof loadStudioState>[3]): Promise<StudioState> {
  const loaded = await loadStudioState(deps, viewer, f.orgId, scope);
  if (!loaded.ok) throw new Error(loaded.code);
  return loaded;
}
async function selfProject(title: string, viewer = owner(), organizationId = f.orgId): Promise<string> {
  const made = await op(viewer, 'project.create', { organizationId, requestId: requestId(), title });
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
/** A second organization the owner of the first also owns (so only the ids decide). */
async function secondOrg(name = 'Second brand'): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, name, f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, $2)', [id, 1_000_000]);
  // Where the spine is open for the first organization, it is open for this one too (only the ids decide).
  if (process.env.BRAND_PROJECT_SPINE === 'on') vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', `${process.env.BRAND_PROJECT_SPINE_ORGS ?? ''},${id}`);
  return id;
}
const filed = async (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string) =>
  (await f.sql.query<{ brand_project_id: string | null }>(`select brand_project_id from ${table} where id = $1`, [id])).rows[0]!.brand_project_id;
const used = () => usedKrwIn(f.sql, f.orgId, studioMonthWindow(new Date()));
/** Row counts of every public table: proof that an operation wrote nothing it should not. */
async function tableCounts(): Promise<Record<string, number>> {
  const tables = (await f.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows;
  const out: Record<string, number> = {};
  for (const { table_name } of tables) out[table_name] = Number((await f.sql.query<{ n: number }>(`select count(*)::int as n from "${table_name}"`)).rows[0]!.n);
  return out;
}
/** A job answer without the values that differ between two runs of the same request. */
function shape(job: StudioJobView): unknown {
  const { id: _id, createdAt: _c, outputs, ...rest } = job;
  return { ...rest, outputs: outputs.map(({ id: _o, jobId: _j, createdAt: _oc, ...o }) => o) };
}

describe('closed: switched off, not listed, or migration 0194 missing', () => {
  const closedStates: Array<[string, () => Promise<void>]> = [
    ['switch off', async () => {}],
    ['organization not listed', async () => openFor(randomUUID())],
    ['switch on with `*` but the columns missing', async () => {
      openFor('*');
      await f.sql.query('alter table brand_studio_jobs drop column brand_project_id cascade');
      resetSpineProbe();
    }],
  ];

  for (const [label, close] of closedStates) {
    it(`${label}: the three operations answer exactly what an unknown operation answers`, async () => {
      await close();
      const inputs: Record<string, Record<string, unknown>> = {
        'project.list': { organizationId: f.orgId },
        'project.create': { organizationId: f.orgId, requestId: requestId(), title: 'Spring' },
        'project.move': { organizationId: f.orgId, projectId: null, jobIds: [randomUUID()] },
      };
      const before = await tableCounts();
      for (const [name, input] of Object.entries(inputs)) {
        const unknown = await op(owner(), 'no.such.operation', input);
        expect(unknown).toEqual({ ok: false, code: 'invalid' });
        for (const viewer of [owner(), viewerOf(f.ids.viewer), viewerOf(f.ids.guest), viewerOf(f.ids.outsider)]) {
          expect(await op(viewer, name, input), `${label} ${name}`).toEqual(unknown);
        }
      }
      expect(await tableCounts()).toEqual(before);
    });
  }

  it('job.create answers and stores the same with brandProjectId absent, present or malformed', async () => {
    const hidden = await teamProject({ visible: false });
    const plain = await create(image);
    const sent = await create({ ...image, brandProjectId: f.projectId });
    const hiddenSent = await create({ ...image, brandProjectId: hidden });
    const malformed = await create({ ...image, brandProjectId: 'not-a-project' });
    for (const job of [plain, sent, hiddenSent, malformed]) {
      expect(shape(job)).toEqual(shape(plain));
      expect('brandProjectId' in job).toBe(false);
      expect(await filed('brand_studio_jobs', job.id)).toBeNull();
    }
    // A run that got a project while the spine was open (then it closed): nothing about it is answered.
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [plain.id, f.projectId]);
    const loaded = await state();
    for (const job of loaded.jobs) expect('brandProjectId' in job).toBe(false);
    const polled = await pollStudioJobs(deps, owner(), f.orgId, [plain.id]);
    if (!polled.ok) throw new Error(polled.code);
    expect('brandProjectId' in polled.jobs[0]!).toBe(false);
  });

  it('the state load is the same with or without a scope', async () => {
    const a = await create(image);
    await create(image);
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [a.id, f.projectId]);
    const plain = await state();
    expect(await state(owner(), { scope: { kind: 'project', brandProjectId: f.projectId } })).toEqual(plain);
    expect(await state(owner(), { scope: { kind: 'unfiled' } })).toEqual(plain);
    expect(await state(owner(), { scope: { kind: 'project', brandProjectId: randomUUID() } })).toEqual(plain);
    expect(plain.jobs).toHaveLength(2);
  });

  it('the music request keeps today’s strict answer: an unknown field is refused, nothing reserved', async () => {
    const music = { kind: 'music', organizationId: f.orgId, prompt: 'calm piano under a product shot', vocal: false };
    const before = await used();
    expect(await createStudioJob(deps, owner(), { ...music, requestId: requestId(), brandProjectId: f.projectId })).toEqual({ ok: false, code: 'invalid' });
    expect(await used()).toBe(before);
    const ok = await createStudioJob(deps, owner(), { ...music, requestId: requestId() });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect('brandProjectId' in ok.job).toBe(false);
  });

  it('films, uploads, exports and post-production ignore the field and answer without it', async () => {
    const film = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', brandProjectId: f.projectId });
    expect(film.ok && film.project && 'brandProjectId' in film.project).toBe(false);
    if (film.ok && film.project) expect(await filed('brand_studio_video_projects', film.project.id)).toBeNull();
    const listed = await loadVideoProjects({ sql: f.sql, media: deps.media }, owner(), f.orgId);
    expect(listed.ok && listed.projects.every((p) => !('brandProjectId' in p))).toBe(true);

    const reserved = await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'logo.png', mime: 'image/png', sizeBytes: 1000, brandProjectId: f.projectId });
    expect(reserved.ok).toBe(true);
    if (reserved.ok && 'id' in reserved) expect(await filed('brand_studio_assets', reserved.id)).toBeNull();

    const exported = await runComposeOperation(deps, owner(), 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, brandProjectId: f.projectId });
    expect(exported.ok).toBe(true);
    if (exported.ok && 'jobId' in exported) expect(await filed('brand_studio_jobs', exported.jobId as string)).toBeNull();

    const sfx = await generateSoundEffect(deps, owner(), { organizationId: f.orgId, requestId: requestId(), text: 'glass clink', durationSec: 2, brandProjectId: f.projectId }, { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' } });
    expect(sfx.ok).toBe(true);
    if (sfx.ok) {
      expect(await filed('brand_studio_jobs', sfx.jobId)).toBeNull();
      if (sfx.assetId) expect(await filed('brand_studio_assets', sfx.assetId)).toBeNull();
    }
  });
});

describe('project.create', () => {
  beforeEach(open);

  it('writes one hidden project of the brand’s own and nothing else: no event, no team notice, no outbox row', async () => {
    const before = await tableCounts();
    const made = await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: '  Spring film  ' });
    expect(made).toMatchObject({ ok: true, project: { title: 'Spring film', origin: 'self' } });
    const project = (made as { project: StudioBrandProject }).project;
    expect(Object.keys(project).sort()).toEqual(['id', 'lastActivityAt', 'origin', 'title']);
    const after = await tableCounts();
    expect(after).toEqual({ ...before, brand_projects: before.brand_projects! + 1 });
    const row = (await f.sql.query('select origin, status, client_visible, production_mode, objective, title, created_by, intake_brief from brand_projects where id = $1', [project.id])).rows[0];
    expect(row).toEqual({ origin: 'self', status: 'active', client_visible: false, production_mode: 'studio', objective: '', title: 'Spring film', created_by: f.ids.owner, intake_brief: null });
  });

  it('is idempotent on the request id, per member', async () => {
    const key = requestId();
    const first = await op(owner(), 'project.create', { organizationId: f.orgId, requestId: key, title: 'Spring' });
    const again = await op(owner(), 'project.create', { organizationId: f.orgId, requestId: key, title: 'Spring' });
    expect(again).toEqual(first);
    const editors = await op(viewerOf(f.ids.editor), 'project.create', { organizationId: f.orgId, requestId: key, title: 'Spring' });
    expect(editors).toMatchObject({ ok: true, project: { id: expect.any(String) } });
    expect((editors as { project: StudioBrandProject }).project.id).not.toBe((first as { project: StudioBrandProject }).project.id);
    expect((await f.sql.query("select count(*)::int as n from brand_projects where origin = 'self'")).rows[0]).toEqual({ n: 2 });
  });

  it('takes one to 120 characters after trimming', async () => {
    expect((await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'A' })).ok).toBe(true);
    expect((await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'x'.repeat(120) })).ok).toBe(true);
    for (const title of ['', '   ', 'x'.repeat(121)]) {
      expect(await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title })).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await op(owner(), 'project.create', { organizationId: f.orgId, requestId: 'short', title: 'Spring' })).toEqual({ ok: false, code: 'invalid' });
  });

  it('counts 20 of the brand’s own projects a day, team projects not included, and refuses the next with the studio’s rate code', async () => {
    // The fixture already has one team project made today; one more here. Neither counts against own projects
    // (tests/brand-studio/spine/daily-limit.test.ts: each side has its own count).
    await teamProject();
    for (let i = 0; i < 20; i += 1) await selfProject(`P${i}`);
    const before = await tableCounts();
    expect(await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'One too many' })).toEqual({ ok: false, code: 'too_many_running' });
    expect(await tableCounts()).toEqual(before);
    // Older rows do not count.
    await f.sql.query("update brand_projects set created_at = now() - interval '25 hours'");
    expect((await op(owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'Tomorrow' })).ok).toBe(true);
  });

  it('owners and editors make projects; viewers are refused; guests, outsiders and the team side learn nothing', async () => {
    expect((await op(viewerOf(f.ids.editor), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'Editor' })).ok).toBe(true);
    expect(await op(viewerOf(f.ids.viewer), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'Viewer' })).toEqual({ ok: false, code: 'forbidden' });
    for (const id of [f.ids.guest, f.ids.outsider, f.ids.admin]) {
      expect(await op(viewerOf(id), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: 'No' })).toEqual({ ok: false, code: 'not_found' });
    }
  });
});

describe('project.list', () => {
  beforeEach(open);

  it('lists what new work can be filed in, most recent activity first, with the newest result as the cover', async () => {
    const hidden = await teamProject({ visible: false, title: 'Hidden by staff' });
    const done = await teamProject({ status: 'completed', title: 'Done' });
    const cancelled = await teamProject({ status: 'cancelled', title: 'Cancelled' });
    const activeTeam = await teamProject({ title: 'Running with the team' });
    const archived = await selfProject('Archived');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [archived]);
    const other = await secondOrg();
    await selfProject('Theirs', owner(), other);
    const older = await selfProject('Older');
    const newer = await selfProject('Newer');
    await f.sql.query("update brand_projects set updated_at = now() - interval '3 days' where id = any($1::uuid[])", [[older, f.projectId, activeTeam]]);
    await f.sql.query("update brand_projects set updated_at = now() - interval '2 days' where id = $1", [newer]);

    // A run filed in the older project makes it the most recent.
    const run = await create({ ...image, brandProjectId: older });
    await advanceStudioJobsWith(deps, { jobIds: [run.id] });
    const listed = (await op(owner(), 'project.list', { organizationId: f.orgId })) as StudioBrandProjectList;
    expect(listed.ok).toBe(true);
    expect(listed.projects.map((p) => p.title)).toEqual(['Older', 'Newer', ...listed.projects.slice(2).map((p) => p.title)]);
    expect(new Set(listed.projects.map((p) => p.id))).toEqual(new Set([older, newer, f.projectId, activeTeam]));
    for (const gone of [hidden, done, cancelled, archived]) expect(listed.projects.some((p) => p.id === gone)).toBe(false);
    const top = listed.projects[0]!;
    expect(top.origin).toBe('self');
    expect(top.cover?.kind).toBe('image');
    expect(top.cover?.url).toBeTruthy();
    expect(listed.projects.find((p) => p.id === f.projectId)).toMatchObject({ origin: 'team', title: 'Spring launch' });
    expect('cover' in listed.projects.find((p) => p.id === newer)!).toBe(false);
  });

  it('answers at most 100', async () => {
    const values = Array.from({ length: 105 }, (_, i) => `('${randomUUID()}', '${f.orgId}', 'P${i}', '', 'studio', 'active', false, 'self', '${f.ids.owner}', '${randomUUID()}')`).join(',');
    await f.sql.query(`insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id) values ${values}`);
    const listed = (await op(owner(), 'project.list', { organizationId: f.orgId })) as StudioBrandProjectList;
    expect(listed.projects).toHaveLength(100);
  });

  it('members read it; guests, outsiders and the team side get not_found', async () => {
    for (const id of [f.ids.owner, f.ids.editor, f.ids.viewer]) expect((await op(viewerOf(id), 'project.list', { organizationId: f.orgId })).ok).toBe(true);
    for (const id of [f.ids.guest, f.ids.outsider, f.ids.admin]) expect(await op(viewerOf(id), 'project.list', { organizationId: f.orgId })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('filing new work', () => {
  beforeEach(open);

  it('files a run in the chosen project and says so; nothing chosen is unfiled', async () => {
    const mine = await selfProject('Spring');
    const plain = await create(image);
    const placed = await create({ ...image, brandProjectId: mine });
    const nulled = await create({ ...image, brandProjectId: null });
    const team = await create({ ...image, brandProjectId: f.projectId });
    expect(await filed('brand_studio_jobs', plain.id)).toBeNull();
    expect(await filed('brand_studio_jobs', placed.id)).toBe(mine);
    expect(await filed('brand_studio_jobs', nulled.id)).toBeNull();
    expect(await filed('brand_studio_jobs', team.id)).toBe(f.projectId);
    expect(plain.brandProjectId).toBeNull();
    expect(placed.brandProjectId).toBe(mine);
    expect((await state()).jobs.find((j) => j.id === placed.id)!.brandProjectId).toBe(mine);
  });

  it('refuses a project that cannot take new work, exactly like one that does not exist, and reserves nothing', async () => {
    const hidden = await teamProject({ visible: false });
    const cancelled = await teamProject({ status: 'cancelled' });
    const completed = await teamProject({ status: 'completed' });
    const archived = await selfProject('Archived');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [archived]);
    const other = await secondOrg();
    const theirs = await selfProject('Theirs', owner(), other);
    const before = await used();
    const jobsBefore = (await f.sql.query('select count(*)::int as n from brand_studio_jobs')).rows[0];
    for (const bad of [hidden, cancelled, completed, archived, theirs, randomUUID()]) {
      expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, brandProjectId: bad })).toEqual({ ok: false, code: 'not_found' });
    }
    expect(await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, brandProjectId: 'nope' })).toEqual({ ok: false, code: 'invalid' });
    expect(await used()).toBe(before);
    expect((await f.sql.query('select count(*)::int as n from brand_studio_jobs')).rows[0]).toEqual(jobsBefore);
  });

  it('does not touch the credit path: the same request costs the same filed or not', async () => {
    const mine = await selfProject('Spring');
    const a0 = await used();
    const plain = await create(image);
    const a1 = await used();
    const placed = await create({ ...image, brandProjectId: mine });
    const a2 = await used();
    expect(placed.estimateKrw).toBe(plain.estimateKrw);
    expect(a2 - a1).toBe(a1 - a0);
  });

  it('a run made from an earlier result takes that result’s project, whatever the request says; a fill run takes none', async () => {
    const mine = await selfProject('Spring');
    const elsewhere = await selfProject('Elsewhere');
    // Partial edit of a filed picture, sent while another project is chosen.
    const picture = await create({ ...image, brandProjectId: mine });
    await advanceStudioJobsWith(deps, { jobIds: [picture.id] });
    const pictureOutput = (await state()).jobs.find((j) => j.id === picture.id)!.outputs[0]!.id;
    const edit = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: pictureOutput }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, brandProjectId: elsewhere });
    expect(await filed('brand_studio_jobs', edit.id)).toBe(mine);
    // … of an unfiled picture: stays unfiled.
    const loose = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [loose.id] });
    const looseOutput = (await state()).jobs.find((j) => j.id === loose.id)!.outputs[0]!.id;
    const looseEdit = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: looseOutput }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, brandProjectId: elsewhere });
    expect(await filed('brand_studio_jobs', looseEdit.id)).toBeNull();
    // A 1080p finish of a filed draft.
    const draft = await create({ kind: 'video', model: 'seedance-2.5', prompt: 'slow push in', aspect: '9:16', seconds: 5, audio: 'native', resolution: 'draft', brandProjectId: mine });
    await advanceStudioJobsWith(deps, { jobIds: [draft.id] });
    const draftOutput = (await state()).jobs.find((j) => j.id === draft.id)!.outputs[0]!.id;
    const final = await create({ kind: 'video_final', draftOutputId: draftOutput, brandProjectId: elsewhere });
    expect(await filed('brand_studio_jobs', final.id)).toBe(mine);
    // A new version of a filed clip.
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle turns', seconds: 6 });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [root.jobId, mine]);
    const version = await create({ kind: 'video_revise', outputId: root.outputId, mode: 'edit', prompt: '병을 파란색으로', references: [], brandProjectId: elsewhere });
    expect(await filed('brand_studio_jobs', version.id)).toBe(mine);
    // Inheritance holds even when the parent's project could not be chosen any more (the family is never split).
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [mine]);
    const late = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '로고도', source: { outputId: pictureOutput }, box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } });
    expect(await filed('brand_studio_jobs', late.id)).toBe(mine);
    // The internal strips of "빈 곳 채우기" never get a project, chosen or inherited.
    expect(await brandProjectForNew(f.sql, f.orgId, { requested: elsewhere, parentOutputId: null, fill: true })).toBeNull();
    expect(await brandProjectForNew(f.sql, f.orgId, { requested: null, parentOutputId: pictureOutput, fill: true })).toBeNull();
    expect(await brandProjectForNew(f.sql, f.orgId, { requested: null, parentOutputId: pictureOutput, fill: false })).toBe(mine);
    await expect(brandProjectForNew(f.sql, f.orgId, { requested: mine, parentOutputId: null, fill: false })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('job.create_group files every run of the group, or refuses the whole group', async () => {
    const mine = await selfProject('Spring');
    const group = { kind: 'image', organizationId: f.orgId, prompt: 'a bottle', aspect: '1:1', resolution: '2K', count: 1, runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro' }] };
    const made = await op(owner(), 'job.create_group', { ...group, requestId: `grp_${randomUUID().slice(0, 12)}`, brandProjectId: mine });
    expect(made.ok).toBe(true);
    const jobs = (made as { jobs: StudioJobView[] }).jobs;
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.brandProjectId).toBe(mine);
      expect(await filed('brand_studio_jobs', job.id)).toBe(mine);
    }
    const hidden = await teamProject({ visible: false });
    const before = await used();
    expect(await op(owner(), 'job.create_group', { ...group, requestId: `grp_${randomUUID().slice(0, 12)}`, brandProjectId: hidden })).toEqual({ ok: false, code: 'not_found' });
    expect(await used()).toBe(before);
  });

  it('a music run is filed too, and its strict request accepts the field only while open', async () => {
    const mine = await selfProject('Jingles');
    const made = await op(owner(), 'job.create', { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano under a product shot', vocal: false, brandProjectId: mine });
    expect(made.ok).toBe(true);
    if (made.ok && 'job' in made) {
      expect(made.job.brandProjectId).toBe(mine);
      expect(await filed('brand_studio_jobs', made.job.id)).toBe(mine);
    }
    // Called directly (as MCP and workflows call it), the answer never carries the field: opt-in at the route only.
    const direct = await createStudioJob(deps, owner(), { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'soft strings', vocal: false, brandProjectId: mine });
    expect(direct.ok && 'brandProjectId' in direct.job).toBe(false);
    const hidden = await teamProject({ visible: false });
    expect(await createStudioJob(deps, owner(), { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false, brandProjectId: hidden })).toEqual({ ok: false, code: 'not_found' });
    expect(await createStudioJob(deps, owner(), { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false, brandProjectId: 7 })).toEqual({ ok: false, code: 'invalid' });
  });

  it('uploads: asset.reserve takes a project; a saved result takes its run’s', async () => {
    const mine = await selfProject('Spring');
    const reserved = await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'logo.png', mime: 'image/png', sizeBytes: 1000, brandProjectId: mine });
    expect(reserved.ok).toBe(true);
    if (reserved.ok && 'id' in reserved) expect(await filed('brand_studio_assets', reserved.id)).toBe(mine);
    const plainReserved = await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'b.png', mime: 'image/png', sizeBytes: 1000 });
    if (plainReserved.ok && 'id' in plainReserved) expect(await filed('brand_studio_assets', plainReserved.id)).toBeNull();
    const hidden = await teamProject({ visible: false });
    expect(await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'c.png', mime: 'image/png', sizeBytes: 1000, brandProjectId: hidden })).toEqual({ ok: false, code: 'not_found' });

    const run = await create({ ...image, brandProjectId: mine });
    await advanceStudioJobsWith(deps, { jobIds: [run.id] });
    const outputId = (await state()).jobs.find((j) => j.id === run.id)!.outputs[0]!.id;
    const saved = await assetFromOutput(deps, owner(), { organizationId: f.orgId, outputId });
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(await filed('brand_studio_assets', saved.asset.id)).toBe(mine);
  });

  it('films: create takes a project, and list and read answers carry it', async () => {
    const mine = await selfProject('Spring');
    const film = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', brandProjectId: mine });
    expect(film.ok && film.project?.brandProjectId).toBe(mine);
    const plain = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Loose' });
    expect(plain.ok && plain.project?.brandProjectId).toBeNull();
    const hidden = await teamProject({ visible: false });
    expect(await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'No', brandProjectId: hidden })).toEqual({ ok: false, code: 'not_found' });
    const listed = await loadVideoProjects({ sql: f.sql, media: deps.media }, owner(), f.orgId, film.ok ? film.project!.id : null);
    if (!listed.ok) throw new Error(listed.code);
    expect(listed.projects.find((p) => p.title === 'Cut')!.brandProjectId).toBe(mine);
    expect(listed.projects.find((p) => p.title === 'Loose')!.brandProjectId).toBeNull();
    expect(listed.project?.brandProjectId).toBe(mine);
  });

  it('post-production and the export file their runs, and the stored results follow their run', async () => {
    const mine = await selfProject('Sound');
    const fake = { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' } };
    const sfx = await generateSoundEffect(deps, owner(), { organizationId: f.orgId, requestId: requestId(), text: 'glass clink', durationSec: 2, brandProjectId: mine }, fake);
    if (!sfx.ok) throw new Error(JSON.stringify(sfx));
    expect(await filed('brand_studio_jobs', sfx.jobId)).toBe(mine);
    expect(sfx.assetId).toBeTruthy();
    expect(await filed('brand_studio_assets', sfx.assetId!)).toBe(mine);

    const music = await generateReferenceMusic(deps, owner(), { organizationId: f.orgId, requestId: requestId(), durationSec: 8, bpm: 120, brandProjectId: mine }, fake);
    if (!music.ok) throw new Error(JSON.stringify(music));
    expect(await filed('brand_studio_jobs', music.jobId)).toBe(mine);
    if (music.assetId) expect(await filed('brand_studio_assets', music.assetId)).toBe(mine);

    // An upscale of a filed result takes the result's project; of a library picture, the chosen one.
    const elsewhere = await selfProject('Elsewhere');
    const source = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [source.jobId, mine]);
    const up = await submitUpscaleJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), outputId: source.outputId, kind: 'image', resolution: 1440, brandProjectId: elsewhere }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } });
    if (!up.ok) throw new Error(JSON.stringify(up));
    expect(await filed('brand_studio_jobs', up.jobId)).toBe(mine);
    if (up.assetId) expect(await filed('brand_studio_assets', up.assetId)).toBe(mine);
    const picture = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const up2 = await submitUpscaleJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), assetId: picture, kind: 'image', resolution: 1440, brandProjectId: elsewhere }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } });
    if (!up2.ok) throw new Error(JSON.stringify(up2));
    expect(await filed('brand_studio_jobs', up2.jobId)).toBe(elsewhere);

    const exported = await runComposeOperation(deps, owner(), 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, brandProjectId: mine });
    if (!exported.ok || !('jobId' in exported)) throw new Error(JSON.stringify(exported));
    expect(await filed('brand_studio_jobs', exported.jobId as string)).toBe(mine);

    const hidden = await teamProject({ visible: false });
    const before = await used();
    expect(await generateSoundEffect(deps, owner(), { organizationId: f.orgId, requestId: requestId(), text: 'clink', durationSec: 2, brandProjectId: hidden }, fake)).toEqual({ ok: false, code: 'not_found' });
    expect(await runComposeOperation(deps, owner(), 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, brandProjectId: hidden })).toEqual({ ok: false, code: 'not_found' });
    expect(await used()).toBe(before);
  });
});

describe('project.move', () => {
  beforeEach(open);
  const move = (input: Record<string, unknown>, viewer = owner()) => op(viewer, 'project.move', { organizationId: f.orgId, ...input });

  it('moves a whole family, in and out, and nothing else; a fill run never moves', async () => {
    const mine = await selfProject('Spring');
    const root = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const edit = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputId });
    const editOfEdit = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: edit.outputId });
    const strip = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputId, params: { purpose: 'fill' } as never });
    const bystander = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });

    const moved = (await move({ projectId: mine, jobIds: [edit.jobId] })) as StudioBrandProjectMoved;
    expect(moved).toMatchObject({ ok: true, projectId: mine, assetIds: [], filmIds: [] });
    expect([...moved.jobIds].sort()).toEqual([root.jobId, edit.jobId, editOfEdit.jobId].sort());
    for (const id of [root.jobId, edit.jobId, editOfEdit.jobId]) expect(await filed('brand_studio_jobs', id)).toBe(mine);
    expect(await filed('brand_studio_jobs', bystander.jobId)).toBeNull();
    expect(await filed('brand_studio_jobs', strip.jobId)).toBeNull();
    expect(await move({ projectId: mine, jobIds: [strip.jobId] })).toEqual({ ok: false, code: 'not_found' });

    const out = (await move({ projectId: null, jobIds: [root.jobId] })) as StudioBrandProjectMoved;
    expect(out.projectId).toBeNull();
    for (const id of [root.jobId, edit.jobId, editOfEdit.jobId]) expect(await filed('brand_studio_jobs', id)).toBeNull();
  });

  it('moves uploads and films by id, in one call with runs', async () => {
    const mine = await selfProject('Spring');
    const run = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const film = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut' });
    const filmId = film.ok ? film.project!.id : '';
    const moved = (await move({ projectId: mine, jobIds: [run.jobId], assetIds: [asset], filmIds: [filmId] })) as StudioBrandProjectMoved;
    expect(moved).toEqual({ ok: true, projectId: mine, jobIds: [run.jobId], assetIds: [asset], filmIds: [filmId] });
    expect(await filed('brand_studio_assets', asset)).toBe(mine);
    expect(await filed('brand_studio_video_projects', filmId)).toBe(mine);
  });

  it('preview writes nothing and answers the same', async () => {
    const mine = await selfProject('Spring');
    const root = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const edit = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputId });
    const before = await tableCounts();
    const rows = async () => (await f.sql.query('select id, brand_project_id from brand_studio_jobs order by id')).rows;
    const snapshot = await rows();
    const preview = (await move({ projectId: mine, jobIds: [root.jobId], preview: true })) as StudioBrandProjectMoved;
    expect(await rows()).toEqual(snapshot);
    expect(await tableCounts()).toEqual(before);
    const real = (await move({ projectId: mine, jobIds: [root.jobId] })) as StudioBrandProjectMoved;
    expect({ ...preview, jobIds: [...preview.jobIds].sort() }).toEqual({ ...real, jobIds: [...real.jobIds].sort() });
    expect([...real.jobIds].sort()).toEqual([root.jobId, edit.jobId].sort());
  });

  it('one bad id stops the whole call: another organization’s, a deleted one, or one that does not exist', async () => {
    const mine = await selfProject('Spring');
    const other = await secondOrg();
    const theirsProject = await selfProject('Theirs', owner(), other);
    const ours = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const theirs = await seedRun(deps, other, f.ids.owner, { kind: 'image' });
    const ourAsset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const deletedAsset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [deletedAsset]);
    const deletedRun = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', status: 'failed' });
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [deletedRun.jobId]);
    const theirAsset = await seedImageAsset(deps, other, f.ids.owner);

    for (const input of [
      { projectId: mine, jobIds: [ours.jobId, theirs.jobId] },
      { projectId: mine, jobIds: [ours.jobId, deletedRun.jobId] },
      { projectId: mine, jobIds: [ours.jobId, randomUUID()] },
      { projectId: mine, jobIds: [ours.jobId], assetIds: [ourAsset, deletedAsset] },
      { projectId: mine, jobIds: [ours.jobId], assetIds: [theirAsset] },
      { projectId: mine, filmIds: [randomUUID()] },
      // Another organization's project with this organization's run.
      { projectId: theirsProject, jobIds: [ours.jobId] },
    ]) {
      expect(await move(input), JSON.stringify(input)).toEqual({ ok: false, code: 'not_found' });
    }
    // This organization's project, named under the other organization, with this organization's run.
    expect(await op(owner(), 'project.move', { organizationId: other, projectId: theirsProject, jobIds: [ours.jobId] })).toEqual({ ok: false, code: 'not_found' });
    expect(await op(owner(), 'project.move', { organizationId: other, projectId: mine, jobIds: [theirs.jobId] })).toEqual({ ok: false, code: 'not_found' });
    expect(await filed('brand_studio_jobs', ours.jobId)).toBeNull();
    expect(await filed('brand_studio_jobs', theirs.jobId)).toBeNull();
    expect(await filed('brand_studio_assets', ourAsset)).toBeNull();
  });

  it('the target must be selectable; moving out of a hidden or archived project is allowed', async () => {
    const run = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const hidden = await teamProject({ visible: false });
    const archived = await selfProject('Archived');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [archived]);
    for (const target of [hidden, archived, randomUUID()]) expect(await move({ projectId: target, jobIds: [run.jobId] })).toEqual({ ok: false, code: 'not_found' });
    for (const from of [hidden, archived]) {
      await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [run.jobId, from]);
      expect(await move({ projectId: null, jobIds: [run.jobId] })).toMatchObject({ ok: true, projectId: null });
      expect(await filed('brand_studio_jobs', run.jobId)).toBeNull();
    }
  });

  it('takes 1 to 200 ids; viewers are refused; guests and outsiders learn nothing', async () => {
    const mine = await selfProject('Spring');
    expect(await move({ projectId: mine, jobIds: Array.from({ length: 201 }, () => randomUUID()) })).toEqual({ ok: false, code: 'invalid' });
    expect(await move({ projectId: mine, jobIds: Array.from({ length: 101 }, () => randomUUID()), assetIds: Array.from({ length: 100 }, () => randomUUID()) })).toEqual({ ok: false, code: 'invalid' });
    expect(await move({ projectId: mine, jobIds: [] })).toEqual({ ok: false, code: 'invalid' });
    expect(await move({ projectId: mine })).toEqual({ ok: false, code: 'invalid' });
    const run = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    expect(await move({ projectId: mine, jobIds: [run.jobId] }, viewerOf(f.ids.viewer))).toEqual({ ok: false, code: 'forbidden' });
    for (const id of [f.ids.guest, f.ids.outsider, f.ids.admin]) expect(await move({ projectId: mine, jobIds: [run.jobId] }, viewerOf(id))).toEqual({ ok: false, code: 'not_found' });
    expect((await move({ projectId: mine, jobIds: [run.jobId] }, viewerOf(f.ids.editor))).ok).toBe(true);
  });
});

describe('the studio state, scoped', () => {
  beforeEach(open);

  it('members can load one project’s runs or the unfiled ones; every run says where it is filed', async () => {
    const mine = await selfProject('Spring');
    const placed = await create({ ...image, brandProjectId: mine });
    const team = await create({ ...image, brandProjectId: f.projectId });
    const loose = await create(image);
    const all = await state();
    expect(all.jobs.map((j) => [j.id, j.brandProjectId])).toEqual(
      expect.arrayContaining([[placed.id, mine], [team.id, f.projectId], [loose.id, null]]),
    );
    for (const viewer of [owner(), viewerOf(f.ids.editor), viewerOf(f.ids.viewer)]) {
      expect((await state(viewer, { scope: { kind: 'project', brandProjectId: mine } })).jobs.map((j) => j.id)).toEqual([placed.id]);
      expect((await state(viewer, { scope: { kind: 'unfiled' } })).jobs.map((j) => j.id)).toEqual([loose.id]);
    }
    const hidden = await teamProject({ visible: false });
    for (const bad of [hidden, randomUUID()]) {
      expect(await loadStudioState(deps, owner(), f.orgId, { scope: { kind: 'project', brandProjectId: bad } })).toEqual({ ok: false, code: 'not_found' });
    }
    // Everything outside the runs is today's answer.
    const scoped = await state(owner(), { scope: { kind: 'unfiled' } });
    const { jobs: _a, ...restAll } = all;
    const { jobs: _b, ...restScoped } = scoped;
    expect(restScoped).toEqual(restAll);
  });

  it('a project guest gets exactly today’s answer: the scope is ignored and no run says where it is filed', async () => {
    const mine = await selfProject('Spring');
    await create({ ...image, brandProjectId: mine });
    await create(image);
    const guest = viewerOf(f.ids.guest);
    const plain = await state(guest);
    expect(await state(guest, { scope: { kind: 'project', brandProjectId: mine } })).toEqual(plain);
    expect(await state(guest, { scope: { kind: 'project', brandProjectId: randomUUID() } })).toEqual(plain);
    for (const job of plain.jobs) expect('brandProjectId' in job).toBe(false);
    vi.unstubAllEnvs();
    expect(await state(guest)).toEqual(plain);
  });

  it('outsiders and the team side are refused as today', async () => {
    for (const id of [f.ids.outsider, f.ids.admin]) {
      expect(await loadStudioState(deps, viewerOf(id), f.orgId, { scope: { kind: 'unfiled' } })).toEqual({ ok: false, code: 'not_found' });
    }
  });
});

describe('sandboxed organizations stay 404 whatever the switch says', () => {
  it('answers feature_unavailable to every new operation and field', async () => {
    openFor('*');
    for (const org of [{ id: [...SANDBOXED_CLIENT_ORG_IDS][0]!, name: 'Client' }, { id: randomUUID(), name: 'Morphic Studio' }]) {
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org.id, org.name, f.ids.owner, randomUUID()]);
      await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, f.ids.owner]);
      expect(await op(owner(), 'project.list', { organizationId: org.id })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await op(owner(), 'project.create', { organizationId: org.id, requestId: requestId(), title: 'X' })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await op(owner(), 'project.move', { organizationId: org.id, projectId: null, jobIds: [randomUUID()] })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await createStudioJob(deps, owner(), { organizationId: org.id, requestId: requestId(), ...image, brandProjectId: randomUUID() })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await loadStudioState(deps, owner(), org.id, { scope: { kind: 'unfiled' } })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect((await f.sql.query("select count(*)::int as n from brand_projects where organization_id = $1", [org.id])).rows[0]).toEqual({ n: 0 });
    }
  });
});

describe('authorization matrix', () => {
  type Expect = 'ok' | 'forbidden' | 'not_found' | 'invalid';
  const ROLES = ['owner', 'editor', 'viewer', 'guest', 'outsider', 'admin'] as const;
  const READ: Record<(typeof ROLES)[number], Expect> = { owner: 'ok', editor: 'ok', viewer: 'ok', guest: 'not_found', outsider: 'not_found', admin: 'not_found' };
  const WRITE: Record<(typeof ROLES)[number], Expect> = { owner: 'ok', editor: 'ok', viewer: 'forbidden', guest: 'not_found', outsider: 'not_found', admin: 'not_found' };
  const outcome = (r: { ok: boolean; code?: string }): Expect => (r.ok ? 'ok' : (r.code as Expect));

  for (const spine of ['open', 'closed', 'column missing'] as const) {
    it(`project.* × role × organization (${spine})`, async () => {
      if (spine === 'open') openFor('*');
      if (spine === 'column missing') {
        openFor('*');
        await f.sql.query('alter table brand_studio_assets drop column brand_project_id cascade');
        resetSpineProbe();
      }
      const other = await secondOrg('Matrix second');
      // The other organization's own project, made directly (its own members only).
      const otherProject = await teamProject({ organizationId: other });
      const target = spine === 'open' ? await selfProject('Target') : f.projectId;
      for (const role of ROLES) {
        const viewer = viewerOf(f.ids[role]);
        const run = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
        const results = {
          list: outcome(await op(viewer, 'project.list', { organizationId: f.orgId })),
          create: outcome(await op(viewer, 'project.create', { organizationId: f.orgId, requestId: requestId(), title: `${role}` })),
          move: outcome(await op(viewer, 'project.move', { organizationId: f.orgId, projectId: target, jobIds: [run.jobId] })),
          listOther: outcome(await op(viewer, 'project.list', { organizationId: other })),
          moveOther: outcome(await op(viewer, 'project.move', { organizationId: other, projectId: otherProject, jobIds: [run.jobId] })),
        };
        if (spine !== 'open') {
          expect(results, `${spine} ${role}`).toEqual({ list: 'invalid', create: 'invalid', move: 'invalid', listOther: 'invalid', moveOther: 'invalid' });
          continue;
        }
        // The owner also owns the second organization: there, the run of the first one does not exist.
        const otherList: Expect = role === 'owner' ? 'ok' : 'not_found';
        expect(results, `${spine} ${role}`).toEqual({ list: READ[role], create: WRITE[role], move: WRITE[role], listOther: otherList, moveOther: 'not_found' });
      }
    });
  }

  /**
   * `brandProjectId` on every path that makes something: for every role and both organizations, the answer with
   * the field is the answer without it (the field never widens or narrows who may do what), and only a success
   * while the spine is open files anything, and only into the chosen project.
   */
  const fake = { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' } };
  type Entry = (viewer: Viewer, organizationId: string, extra: Record<string, unknown>) => Promise<{ ok: boolean; code?: string } & Record<string, unknown>>;
  const entries = (picture: string): Record<string, { call: Entry; table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects'; id: (r: Record<string, unknown>) => string }> => ({
    'job.create': { call: (v, org, x) => createStudioJob(deps, v, { organizationId: org, requestId: requestId(), ...image, ...x }) as never, table: 'brand_studio_jobs', id: (r) => (r.job as StudioJobView).id },
    'job.create_group': {
      call: (v, org, x) => op(v, 'job.create_group', { kind: 'image', organizationId: org, requestId: `grp_${randomUUID().slice(0, 12)}`, prompt: 'a bottle', aspect: '1:1', resolution: '2K', runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro' }], ...x }) as never,
      table: 'brand_studio_jobs',
      id: (r) => (r.jobs as StudioJobView[])[0]!.id,
    },
    'asset.reserve': { call: (v, org, x) => op(v, 'asset.reserve', { organizationId: org, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 1000, ...x }) as never, table: 'brand_studio_assets', id: (r) => r.id as string },
    'film.create': {
      call: (v, org, x) => runVideoProjectOperation({ sql: f.sql, media: deps.media }, v, 'create', { organizationId: org, requestId: `vp_${randomUUID()}`, title: 'Cut', ...x }) as never,
      table: 'brand_studio_video_projects',
      id: (r) => (r.project as { id: string }).id,
    },
    'music.generate': { call: (v, org, x) => generateReferenceMusic(deps, v, { organizationId: org, requestId: requestId(), durationSec: 8, bpm: 120, ...x }, fake) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
    'sfx.generate': { call: (v, org, x) => generateSoundEffect(deps, v, { organizationId: org, requestId: requestId(), text: 'glass clink', durationSec: 2, ...x }, fake) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
    'upscale.submit': {
      call: (v, org, x) => submitUpscaleJob(deps, v, { organizationId: org, requestId: requestId(), assetId: picture, kind: 'image', resolution: 1440, ...x }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } }) as never,
      table: 'brand_studio_jobs',
      id: (r) => r.jobId as string,
    },
    'render.reserve': { call: (v, org, x) => runComposeOperation(deps, v, 'render.reserve', { organizationId: org, requestId: requestId(), durationSec: 6, ...x }) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
  });
  /** Open runs would hit the open-run ceiling between calls; settle them (the matrix is about who may file). */
  const settle = () => f.sql.query("update brand_studio_jobs set status = 'canceled', finished_at = now() where status in ('held','queued','running','finishing')");

  for (const spine of ['open', 'closed', 'column missing'] as const) {
    it(`brandProjectId on every making path × role × organization (${spine})`, async () => {
      openFor('*');
      const target = await selfProject('Target');
      if (spine === 'closed') vi.unstubAllEnvs();
      if (spine === 'column missing') {
        await f.sql.query('alter table brand_studio_assets drop column brand_project_id cascade');
        resetSpineProbe();
      }
      const other = await secondOrg('Matrix second');
      const picture = await seedImageAsset(deps, f.orgId, f.ids.owner);
      for (const [name, entry] of Object.entries(entries(picture))) {
        for (const role of ROLES) {
          for (const org of [f.orgId, other]) {
            await settle();
            const viewer = viewerOf(f.ids[role]);
            const without = outcome(await entry.call(viewer, org, {}));
            await settle();
            const result = await entry.call(viewer, org, { brandProjectId: target });
            // In the second organization the target is not that organization's project.
            const expected = spine === 'open' && org === other && without === 'ok' ? 'not_found' : without;
            expect(outcome(result), `${spine} ${name} ${role} ${org === other ? 'B' : 'A'}`).toBe(expected);
            if (result.ok && spine !== 'column missing') {
              const stored = (await f.sql.query<{ brand_project_id: string | null }>(`select brand_project_id from ${entry.table} where id = $1`, [entry.id(result)])).rows[0]!.brand_project_id;
              expect(stored, `${spine} ${name} ${role}`).toBe(spine === 'open' ? target : null);
            }
          }
        }
      }
    });
  }
});
