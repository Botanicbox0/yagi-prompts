import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { projectForNewJob, resetJobProjectProbe } from '@/lib/brand-studio/job-projects';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import type { StudioJobProjectAssigned, StudioJobView, StudioState } from '@/lib/brand-studio/contracts';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * docs/BRAND-STUDIO-V6-PLAN.md §7 row C (migration 0091, flag `BRAND_STUDIO_PROJECTS`).
 * A run can belong to a studio project. Pinned here:
 *  - closed (flag off, or the column missing) means every request and answer is what it was;
 *  - a new run takes the chosen project, a run made from an earlier result takes that result's project;
 *  - `job.assign_project` moves the whole family, in or out, and checks organization, deletion and seat;
 *  - a run whose project was deleted reads as being in no project.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
let f: StudioFixture;
let on: ReturnType<typeof studioDeps>;
let off: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetJobProjectProbe();
  f = await studioFixture();
  on = studioDeps(f.sql, { env: studioEnv({ ...ENV, BRAND_STUDIO_PROJECTS: 'on' }) });
  // The same stores, so both see the same media; only the flag differs.
  off = { ...on, env: studioEnv(ENV) };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
});

/** The flag lives in the server environment; the screens' job views read it there (lib/brand-studio/repo.ts). */
const flagOn = () => vi.stubEnv('BRAND_STUDIO_PROJECTS', 'on');

const owner = () => viewerOf(f.ids.owner);
const image = { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
const video = { kind: 'video', model: 'seedance-2.5', prompt: 'slow push in on the bottle', aspect: '9:16', seconds: 5, audio: 'native' };

async function create(deps: typeof on, input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function state(deps: typeof on): Promise<StudioState> {
  const loaded = await loadStudioState(deps, owner(), f.orgId);
  if (!loaded.ok) throw new Error(loaded.code);
  return loaded;
}
async function project(title: string, organizationId = f.orgId): Promise<string> {
  const made = await runVideoProjectOperation({ sql: f.sql, media: on.media }, owner(), 'create', { organizationId, requestId: `vp_${randomUUID().replace(/-/g, '')}`, title });
  if (!made.ok || !made.project) throw new Error('expected a project');
  return made.project.id;
}
const stored = async (jobId: string) => (await f.sql.query<{ project_id: string | null }>('select project_id from brand_studio_jobs where id = $1', [jobId])).rows[0]!.project_id;
const assign = (deps: typeof on, jobId: string, projectId: string | null, viewer = owner()) =>
  runStudioOperation(deps, viewer, 'job.assign_project', { organizationId: f.orgId, jobId, projectId });

describe('closed: the flag off, or the column not there yet', () => {
  it('answers and stores exactly as before with the flag off, even for rows that already have a project', async () => {
    const p = await project('Spring film');
    const before = await create(off, image);
    // A client that sends a project while the feature is closed: the field is not looked at.
    const sent = await create(off, { ...image, projectId: p });
    expect(await stored(sent.id)).toBeNull();
    expect('projectId' in sent).toBe(false);
    // A project that does not exist is not even validated while closed.
    expect((await createStudioJob(off, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, projectId: randomUUID() })).ok).toBe(true);

    // A row that got a project while the flag was on (then the flag went off again).
    await f.sql.query('update brand_studio_jobs set project_id = $2 where id = $1', [before.id, p]);
    const closed = await state(off);
    expect('projects' in closed).toBe(false);
    for (const job of closed.jobs) expect('projectId' in job).toBe(false);
    const polled = await pollStudioJobs(off, owner(), f.orgId, [before.id]);
    if (!polled.ok) throw new Error(polled.code);
    expect('projectId' in polled.jobs[0]!).toBe(false);

    expect(await assign(off, before.id, null)).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(await stored(before.id)).toBe(p);
  });

  it('stays closed with the flag on until migration 0091 is applied, and nothing breaks', async () => {
    flagOn();
    const p = await project('Spring film');
    await f.sql.query('alter table brand_studio_jobs drop column project_id');
    resetJobProjectProbe();
    const job = await create(on, { ...image, projectId: p });
    expect('projectId' in job).toBe(false);
    const loaded = await state(on);
    expect('projects' in loaded).toBe(false);
    expect(loaded.jobs.map((j) => j.id)).toContain(job.id);
    expect(await assign(on, job.id, p)).toEqual({ ok: false, code: 'feature_unavailable' });
  });
});

describe('open: a new run takes a project', () => {
  beforeEach(flagOn);
  it('stores the chosen project, lists the live projects, and refuses a project that is not this organization\'s or is gone', async () => {
    const p = await project('Spring film');
    const plain = await create(on, image);
    const placed = await create(on, { ...image, projectId: p });
    expect(await stored(plain.id)).toBeNull();
    expect(await stored(placed.id)).toBe(p);
    expect(placed.projectId).toBe(p);
    expect('projectId' in plain).toBe(false);

    const loaded = await state(on);
    expect(loaded.projects).toEqual([{ id: p, title: 'Spring film' }]);
    expect(loaded.jobs.find((j) => j.id === placed.id)!.projectId).toBe(p);

    // Another organization's project, a project that does not exist, a deleted one, an archived one.
    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Another brand', f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrg, f.ids.owner]);
    const foreign = await project('Their film', otherOrg);
    const deleted = await project('Deleted');
    const archived = await project('Archived');
    await runVideoProjectOperation({ sql: f.sql, media: on.media }, owner(), 'delete', { organizationId: f.orgId, projectId: deleted });
    await runVideoProjectOperation({ sql: f.sql, media: on.media }, owner(), 'status', { organizationId: f.orgId, projectId: archived, status: 'archived' });
    for (const bad of [foreign, randomUUID(), deleted, archived]) {
      expect(await createStudioJob(on, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, projectId: bad })).toEqual({ ok: false, code: 'not_found' });
    }
  });

  it('a run made from an earlier result takes that result\'s project, whatever the request says; a fill run takes none', async () => {
    const p = await project('Spring film');
    const other = await project('Teaser cut');

    // 1080p finish of a draft that is in a project.
    const draft = await create(on, { ...video, resolution: 'draft', projectId: p });
    await advanceStudioJobsWith(on, { jobIds: [draft.id] });
    const draftOutput = (await state(on)).jobs.find((j) => j.id === draft.id)!.outputs[0]!.id;
    const final = await create(on, { kind: 'video_final', draftOutputId: draftOutput });
    expect(await stored(final.id)).toBe(p);

    // A partial edit of a picture that is in a project, sent while another project is chosen in the bar.
    const picture = await create(on, { ...image, projectId: p });
    await advanceStudioJobsWith(on, { jobIds: [picture.id] });
    const pictureOutput = (await state(on)).jobs.find((j) => j.id === picture.id)!.outputs[0]!.id;
    const edit = await create(on, { kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: pictureOutput }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, projectId: other });
    expect(await stored(edit.id)).toBe(p);

    // … and of a picture in no project: it stays in none (the family is never split).
    const loose = await create(on, image);
    await advanceStudioJobsWith(on, { jobIds: [loose.id] });
    const looseOutput = (await state(on)).jobs.find((j) => j.id === loose.id)!.outputs[0]!.id;
    const looseEdit = await create(on, { kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: looseOutput }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, projectId: other });
    expect(await stored(looseEdit.id)).toBeNull();

    // The internal strips of "빈 곳 채우기" never get a project, chosen or inherited.
    expect(await projectForNewJob(f.sql, f.orgId, { requested: p, parentOutputId: null, fill: true })).toBeNull();
    expect(await projectForNewJob(f.sql, f.orgId, { requested: null, parentOutputId: pictureOutput, fill: true })).toBeNull();
    expect(await projectForNewJob(f.sql, f.orgId, { requested: null, parentOutputId: pictureOutput, fill: false })).toBe(p);
  });
});

describe('job.assign_project', () => {
  beforeEach(flagOn);
  it('moves the whole family in and out: the first run, what was made from it, and nothing else', async () => {
    const p = await project('Spring film');
    const root = await create(on, { ...image, count: 2 });
    await advanceStudioJobsWith(on, { jobIds: [root.id] });
    const rootOutputs = (await state(on)).jobs.find((j) => j.id === root.id)!.outputs;
    expect(rootOutputs).toHaveLength(2);
    const edit = await create(on, { kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: rootOutputs[0]!.id }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    await advanceStudioJobsWith(on, { jobIds: [edit.id] });
    const editOutput = (await state(on)).jobs.find((j) => j.id === edit.id)!.outputs[0]!.id;
    const editOfEdit = await create(on, { kind: 'region_edit', model: 'nano-banana-pro', prompt: '로고도', source: { outputId: editOutput }, box: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } });
    const bystander = await create(on, image);
    // An internal fill strip made from the root: it never gets a project.
    const strip = await create(on, { kind: 'region_edit', model: 'nano-banana-pro', prompt: 'fill', source: { outputId: rootOutputs[1]!.id }, box: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    await f.sql.query(`update brand_studio_jobs set params = params || jsonb_build_object('purpose', 'fill') where id = $1`, [strip.id]);

    // Asked on the middle of the chain: the family is found upward and downward.
    const moved = (await assign(on, edit.id, p)) as StudioJobProjectAssigned;
    expect(moved.ok).toBe(true);
    expect([...moved.jobIds].sort()).toEqual([root.id, edit.id, editOfEdit.id].sort());
    expect(moved.projectId).toBe(p);
    for (const id of [root.id, edit.id, editOfEdit.id]) expect(await stored(id)).toBe(p);
    expect(await stored(bystander.id)).toBeNull();
    expect(await stored(strip.id)).toBeNull();
    const placed = await state(on);
    expect(placed.jobs.filter((j) => j.projectId === p).map((j) => j.id).sort()).toEqual([root.id, edit.id, editOfEdit.id].sort());

    // Out again.
    const out = (await assign(on, root.id, null)) as StudioJobProjectAssigned;
    expect(out.ok).toBe(true);
    expect(out.projectId).toBeNull();
    for (const id of [root.id, edit.id, editOfEdit.id]) expect(await stored(id)).toBeNull();
    // A fill strip cannot be the handle either.
    expect(await assign(on, strip.id, p)).toEqual({ ok: false, code: 'not_found' });
  });

  it('checks the seat, the organization and the project on the server', async () => {
    const p = await project('Spring film');
    const job = await create(on, image);
    // Viewers read; they do not file. Guests and outsiders do not learn the studio exists.
    expect(await assign(on, job.id, p, viewerOf(f.ids.viewer))).toEqual({ ok: false, code: 'forbidden' });
    expect((await assign(on, job.id, p, viewerOf(f.ids.outsider))).ok).toBe(false);
    expect(await stored(job.id)).toBeNull();

    const otherOrg = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [otherOrg, 'Another brand', f.ids.owner, randomUUID()]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [otherOrg, f.ids.owner]);
    const foreign = await project('Their film', otherOrg);
    const deleted = await project('Deleted');
    await runVideoProjectOperation({ sql: f.sql, media: on.media }, owner(), 'delete', { organizationId: f.orgId, projectId: deleted });
    for (const bad of [foreign, randomUUID(), deleted]) expect(await assign(on, job.id, bad)).toEqual({ ok: false, code: 'not_found' });
    // A run of another organization, named under this one.
    expect(await runStudioOperation(on, owner(), 'job.assign_project', { organizationId: otherOrg, jobId: job.id, projectId: foreign })).toEqual({ ok: false, code: 'not_found' });
    expect(await assign(on, randomUUID(), p)).toEqual({ ok: false, code: 'not_found' });
    expect(await runStudioOperation(on, owner(), 'job.assign_project', { organizationId: f.orgId, jobId: job.id })).toEqual({ ok: false, code: 'invalid' });
    expect(await stored(job.id)).toBeNull();
  });

  it('is closed for sandboxed organizations before anything else is judged', async () => {
    for (const org of [{ id: [...SANDBOXED_CLIENT_ORG_IDS][0]!, name: 'Client' }, { id: randomUUID(), name: 'Morphic Studio' }]) {
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org.id, org.name, f.ids.owner, randomUUID()]);
      await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [org.id, f.ids.owner]);
      expect(await runStudioOperation(on, owner(), 'job.assign_project', { organizationId: org.id, jobId: randomUUID(), projectId: null })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await createStudioJob(on, owner(), { organizationId: org.id, requestId: requestId(), ...image, projectId: randomUUID() })).toEqual({ ok: false, code: 'feature_unavailable' });
    }
  });
});

describe('a deleted project', () => {
  beforeEach(flagOn);
  it('leaves its runs in place and reads them as being in no project', async () => {
    const p = await project('Spring film');
    const job = await create(on, { ...image, projectId: p });
    expect((await state(on)).jobs.find((j) => j.id === job.id)!.projectId).toBe(p);
    await runVideoProjectOperation({ sql: f.sql, media: on.media }, owner(), 'delete', { organizationId: f.orgId, projectId: p });
    const after = await state(on);
    expect(after.projects).toEqual([]);
    expect('projectId' in after.jobs.find((j) => j.id === job.id)!).toBe(false);
    // The row keeps what it had: bringing the project back would bring the runs back with it.
    expect(await stored(job.id)).toBe(p);
  });
});
