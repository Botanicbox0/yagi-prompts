import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { staffCreateStoryboard } from '@/lib/brand-rooms/storyboards';
import { loadStudioShortlist } from '@/lib/brands/shortlist/service';
import { loadBrandUsage } from '@/lib/brands/usage/service';
import { loadBrandProject, loadStudioProject, setBrandProjectVisibility } from '@/lib/brands/workspace/service';
import { memberSeesBrandProjects, resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import type { StudioBrandProject, StudioBrandProjectMoved, StudioJobView, StudioState } from '@/lib/brand-studio/contracts';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { generateReferenceMusic, generateSoundEffect } from '@/lib/brand-studio/music';
import { jobView, viewsOf } from '@/lib/brand-studio/repo';
import { loadStudioState, runStudioOperation } from '@/lib/brand-studio/service';
import { loadSoundStudio } from '@/lib/brand-studio/sound/load';
import type { JobRow } from '@/lib/brand-studio/types';
import { submitUpscaleJob } from '@/lib/brand-studio/upscale';
import { loadVideoProjects, runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * Slice 1a, review fix round (F1–F6). Pinned here:
 *  F1 the team side opens no brand's own project by id; `brandProjectId` is opt-in (no shared view builder adds it);
 *  F2 a project that can no longer take new work reads as 미분류 everywhere the customer looks, the filing is kept;
 *  F3 a request's `brandProjectId` is judged only after the seat: nobody outside learns whether the spine is open;
 *  F4 (tests/brand-studio/spine/team-side.test.ts) the upload gate with the switch off;
 *  F5 organization ids compared without regard to case;
 *  F6 the missing cases: making paths × hidden / archived / requested targets, families with a removed member or a
 *     planted cross-organization parent, the film revive and replay branches.
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

const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};
const open = () => openFor(f.orgId);
const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const image = { kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, viewer, operation, input);
const films = () => ({ sql: f.sql, media: deps.media });

async function create(input: Record<string, unknown>, viewer = owner()): Promise<StudioJobView> {
  const result = await op(viewer, 'job.create', { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok || !('job' in result)) throw new Error(`create failed: ${JSON.stringify(result)}`);
  return result.job as StudioJobView;
}
async function state(scope?: Parameters<typeof loadStudioState>[3]): Promise<StudioState> {
  const loaded = await loadStudioState(deps, owner(), f.orgId, scope);
  if (!loaded.ok) throw new Error(loaded.code);
  return loaded;
}
async function selfProject(title: string, organizationId = f.orgId): Promise<string> {
  const made = await op(owner(), 'project.create', { organizationId, requestId: requestId(), title });
  if (!made.ok || !('project' in made)) throw new Error(`project.create failed: ${JSON.stringify(made)}`);
  return (made.project as StudioBrandProject).id;
}
async function teamProject(over: { visible?: boolean; status?: string } = {}): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, $2, 'Team work', 'A goal for the team', 'studio', $3, $4, $5, $6)`,
    [id, f.orgId, over.status ?? 'active', over.visible ?? true, f.ids.admin, randomUUID()],
  );
  return id;
}
async function secondOrg(): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, 'Second brand', f.ids.owner, randomUUID()]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [id, f.ids.owner]);
  await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, $2)', [id, 1_000_000]);
  return id;
}
const filed = async (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string) =>
  (await f.sql.query<{ brand_project_id: string | null }>(`select brand_project_id from ${table} where id = $1`, [id])).rows[0]!.brand_project_id;

/* --------------------------------------------------------------------- F1 */

describe('F1 the team side never opens a brand’s own project, and brandProjectId is opt-in', () => {
  it('staff who are not members get for an own project exactly what they get for a missing one', async () => {
    open();
    const mine = await selfProject('Mine');
    const missing = randomUUID();
    const sql = { sql: f.sql };
    // The project page loaders (customer-then-staff and studio branches).
    expect(await loadBrandProject(sql, staff(), mine)).toBeNull();
    expect(await loadBrandProject(sql, staff(), mine)).toEqual(await loadBrandProject(sql, staff(), missing));
    expect(await loadStudioProject(sql, staff(), mine)).toBeNull();
    expect(await loadStudioProject(sql, staff(), f.projectId)).not.toBeNull();
    // The usage page and the shortlist page.
    expect(await loadBrandUsage(sql, staff(), mine)).toEqual(await loadBrandUsage(sql, staff(), missing));
    expect(await loadBrandUsage(sql, staff(), mine)).toBeNull();
    expect(await loadStudioShortlist(sql, staff(), mine)).toEqual(await loadStudioShortlist(sql, staff(), missing));
    // Staff writes by id.
    expect(await setBrandProjectVisibility(sql, staff(), { projectId: mine, visible: true, expectedRevision: 0 })).toEqual(
      await setBrandProjectVisibility(sql, staff(), { projectId: missing, visible: true, expectedRevision: 0 }),
    );
    expect(await staffCreateStoryboard({ sql: f.sql, media: deps.media }, staff(), { projectId: mine, title: 'Board one' })).toEqual(
      await staffCreateStoryboard({ sql: f.sql, media: deps.media }, staff(), { projectId: missing, title: 'Board one' }),
    );
    expect((await f.sql.query('select origin, client_visible from brand_projects where id = $1', [mine])).rows[0]).toEqual({ origin: 'self', client_visible: false });
  });

  it('jobView and viewsOf never add the key, even with the spine open and the row filed', async () => {
    openFor('*');
    const mine = await selfProject('Mine');
    const run = await create({ ...image, brandProjectId: mine });
    expect(run.brandProjectId).toBe(mine);
    const row = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [run.id])).rows[0]!;
    expect(row.brand_project_id).toBe(mine);
    expect('brandProjectId' in jobView(row, [], deps.media)).toBe(false);
    for (const view of await viewsOf(f.sql, [row], deps.media)) expect('brandProjectId' in view).toBe(false);
    // Called directly (MCP, workflows), the create answer carries nothing either.
    const direct = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...image, brandProjectId: mine });
    expect(direct.ok && 'brandProjectId' in direct.job).toBe(false);
  });

  it('the sound studio page: a member sees where runs are filed, staff who are not members do not', async () => {
    open();
    const mine = await selfProject('Jingles');
    const made = await op(owner(), 'job.create', { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano under a product shot', vocal: false, brandProjectId: mine });
    if (!made.ok || !('job' in made)) throw new Error(JSON.stringify(made));
    const member = await loadSoundStudio(f.sql, deps.media, deps.env, f.orgId, f.ids.owner, { member: memberSeesBrandProjects({ staff: false, role: 'owner' }) });
    expect(member.jobs.find((job) => job.id === made.job.id)!.brandProjectId).toBe(mine);
    const asStaff = await loadSoundStudio(f.sql, deps.media, deps.env, f.orgId, f.ids.admin, { member: memberSeesBrandProjects({ staff: true, role: 'studio' }) });
    const byDefault = await loadSoundStudio(f.sql, deps.media, deps.env, f.orgId, f.ids.owner);
    for (const job of [...asStaff.jobs, ...byDefault.jobs]) expect('brandProjectId' in job).toBe(false);
    expect(asStaff.jobs.map((job) => job.id)).toContain(made.job.id);
    for (const role of ['owner', 'editor', 'viewer']) expect(memberSeesBrandProjects({ staff: false, role })).toBe(true);
    for (const seat of [{ staff: true, role: 'owner' }, { staff: true, role: 'studio' }, { staff: false, role: 'guest' }, { staff: false, role: 'studio' }]) {
      expect(memberSeesBrandProjects(seat), JSON.stringify(seat)).toBe(false);
    }
    const page = readFileSync(join(process.cwd(), 'app/(brand)/brand/studio/sound/page.tsx'), 'utf8');
    // The page computes the member flag once (the project chip uses it too) and hands it to the loader.
    expect(page).toContain('const member = memberSeesBrandProjects({ staff: access.staff, role: choice.role });');
    expect(page).toContain('choice.id, viewer.userId ?? null, { member })');
  });
});

/* --------------------------------------------------------------------- F2 */

// Spine rules R-A follow-up: in the STUDIO (state, poll, create answers, films) this is origin/main's rule, unchanged: a run
// of a project that can no longer take work stays on the 미분류 wall. The assets page keeps a finished project's files in
// it (the next block).
describe('F2 a project that can no longer take new work reads as 미분류 in the studio; the filing is kept', () => {
  const cases: Array<[string, () => Promise<string>, (id: string) => Promise<void>, (id: string) => Promise<void>]> = [
    ['a team project the staff hide', () => teamProject(), (id) => f.sql.query('update brand_projects set client_visible = false where id = $1', [id]).then(() => {}), (id) => f.sql.query('update brand_projects set client_visible = true where id = $1', [id]).then(() => {})],
    ['a team project completed', () => teamProject(), (id) => f.sql.query("update brand_projects set status = 'completed' where id = $1", [id]).then(() => {}), (id) => f.sql.query("update brand_projects set status = 'active' where id = $1", [id]).then(() => {})],
    ['an own project completed (보관)', () => selfProject('Archive me'), (id) => f.sql.query("update brand_projects set status = 'completed' where id = $1", [id]).then(() => {}), (id) => f.sql.query("update brand_projects set status = 'active' where id = $1", [id]).then(() => {})],
  ];
  for (const [label, make, close, reopen] of cases) {
    it(label, async () => {
      open();
      const project = await make();
      const run = await create({ ...image, brandProjectId: project });
      await advanceStudioJobsWith(deps, { jobIds: [run.id] });
      const output = (await state()).jobs.find((job) => job.id === run.id)!.outputs[0]!.id;
      const film = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', brandProjectId: project });
      const filmId = film.ok ? film.project!.id : '';
      const loose = await create(image);

      await close(project);
      // The answers say 미분류; the stored filing is untouched.
      expect((await state()).jobs.find((job) => job.id === run.id)!.brandProjectId).toBeNull();
      expect((await state({ scope: { kind: 'unfiled' } })).jobs.map((job) => job.id).sort()).toEqual([run.id, loose.id].sort());
      expect(await loadStudioState(deps, owner(), f.orgId, { scope: { kind: 'project', brandProjectId: project } })).toEqual({ ok: false, code: 'not_found' });
      const listed = await loadVideoProjects(films(), owner(), f.orgId, filmId);
      expect(listed.ok && listed.projects.find((p) => p.id === filmId)!.brandProjectId).toBeNull();
      expect(listed.ok && listed.project?.brandProjectId).toBeNull();
      expect(await filed('brand_studio_jobs', run.id)).toBe(project);
      expect(await filed('brand_studio_video_projects', filmId)).toBe(project);

      // A new version of its result keeps the family together (stored) and shows under 미분류 too.
      const edit = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: output }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
      expect(await filed('brand_studio_jobs', edit.id)).toBe(project);
      expect(edit.brandProjectId).toBeNull();
      expect((await state({ scope: { kind: 'unfiled' } })).jobs.map((job) => job.id)).toContain(edit.id);

      // Brought back: everything is under the project again.
      await reopen(project);
      const back = await state({ scope: { kind: 'project', brandProjectId: project } });
      expect(back.jobs.map((job) => job.id).sort()).toEqual([run.id, edit.id].sort());
      expect(back.jobs.every((job) => job.brandProjectId === project)).toBe(true);
      expect((await state({ scope: { kind: 'unfiled' } })).jobs.map((job) => job.id)).toEqual([loose.id]);
      const relisted = await loadVideoProjects(films(), owner(), f.orgId);
      expect(relisted.ok && relisted.projects.find((p) => p.id === filmId)!.brandProjectId).toBe(project);
    });
  }
});

/**
 * Spine rules R-A (the founder's decision 1) on the ASSETS PAGE: a finished project keeps its files there, while the studio
 * reads them as 미분류 as before (the block above). A run made from one of its results keeps the family's project (kept as
 * today), is on the studio's 미분류 wall, and is in the project on the assets page. New work cannot be filed in it.
 */
describe('F2 after R-A: the assets page keeps a finished project’s files; the studio reads them as before', () => {
  const cases: Array<[string, () => Promise<string>, (id: string) => Promise<void>]> = [
    ['a team project completed', () => teamProject(), (id) => f.sql.query("update brand_projects set status = 'completed' where id = $1", [id]).then(() => {})],
    ['a team project cancelled', () => teamProject(), (id) => f.sql.query("update brand_projects set status = 'cancelled' where id = $1", [id]).then(() => {})],
    ['an own project completed (보관)', () => selfProject('Archive me'), (id) => f.sql.query("update brand_projects set status = 'completed' where id = $1", [id]).then(() => {})],
  ];
  for (const [label, make, close] of cases) {
    it(label, async () => {
      open();
      const project = await make();
      const run = await create({ ...image, brandProjectId: project });
      await advanceStudioJobsWith(deps, { jobIds: [run.id] });
      const output = (await state()).jobs.find((job) => job.id === run.id)!.outputs[0]!.id;
      const film = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', brandProjectId: project });
      const filmId = film.ok ? film.project!.id : '';
      const loose = await create(image);
      await advanceStudioJobsWith(deps, { jobIds: [loose.id] });
      await close(project);

      // New work cannot be filed in it: a new run naming it is refused, and so is moving into it; moving out is allowed.
      expect(await op(owner(), 'job.create', { organizationId: f.orgId, requestId: requestId(), ...image, brandProjectId: project })).toEqual({ ok: false, code: 'not_found' });
      expect(await op(owner(), 'project.move', { organizationId: f.orgId, projectId: project, jobIds: [loose.id] })).toEqual({ ok: false, code: 'not_found' });
      expect((await op(owner(), 'project.move', { organizationId: f.orgId, projectId: null, jobIds: [run.id], preview: true })).ok).toBe(true);

      // A new version of its result keeps the family together; the studio puts it on the 미분류 wall.
      const edit = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: output }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
      await advanceStudioJobsWith(deps, { jobIds: [edit.id] });
      expect(await filed('brand_studio_jobs', edit.id)).toBe(project);
      expect(edit.brandProjectId).toBeNull();
      expect((await state({ scope: { kind: 'unfiled' } })).jobs.map((job) => job.id).sort()).toEqual([run.id, edit.id, loose.id].sort());

      // The assets page: the run, its new version and the film are in the project, with its id.
      const page = await op(owner(), 'project.files', { organizationId: f.orgId, scope: { kind: 'project', brandProjectId: project } });
      if (!page.ok || !('items' in page)) throw new Error(JSON.stringify(page));
      expect(page.items.map((item) => `${item.type}:${item.id}`).sort()).toEqual([`job:${run.id}`, `job:${edit.id}`, `film:${filmId}`].sort());
      for (const view of [...page.jobs, ...page.films]) expect(view.brandProjectId).toBe(project);
      const unfiled = await op(owner(), 'project.files', { organizationId: f.orgId, scope: { kind: 'unfiled' } });
      expect(unfiled.ok && 'items' in unfiled && unfiled.items.map((item) => item.id)).toEqual([loose.id]);
    });
  }
});

/* --------------------------------------------------------------------- F3 */

describe('F3 the value is judged only after the seat: outsiders get today’s answer whether the spine is open or not', () => {
  type Answer = { ok: boolean; code?: string };
  const outcome = (r: Answer) => (r.ok ? 'ok' : r.code);
  const fake = { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' } };
  const paths = (picture: string): Record<string, (v: Viewer, x: Record<string, unknown>) => Promise<Answer>> => ({
    'job.create (route)': (v, x) => op(v, 'job.create', { organizationId: f.orgId, requestId: requestId(), ...image, ...x }),
    'job.create (direct)': (v, x) => createStudioJob(deps, v, { organizationId: f.orgId, requestId: requestId(), ...image, ...x }),
    'music run (route)': (v, x) => op(v, 'job.create', { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false, ...x }),
    'music run (direct)': (v, x) => createStudioJob(deps, v, { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false, ...x }),
    'job.create_group': (v, x) => op(v, 'job.create_group', { kind: 'image', organizationId: f.orgId, requestId: `grp_${randomUUID().slice(0, 12)}`, prompt: 'a bottle', aspect: '1:1', resolution: '2K', runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro' }], ...x }),
    'asset.reserve': (v, x) => op(v, 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 1000, ...x }),
    'film create': (v, x) => runVideoProjectOperation(films(), v, 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', ...x }),
    'music.generate': (v, x) => generateReferenceMusic(deps, v, { organizationId: f.orgId, requestId: requestId(), durationSec: 8, bpm: 120, ...x }, fake),
    'sfx.generate': (v, x) => generateSoundEffect(deps, v, { organizationId: f.orgId, requestId: requestId(), text: 'glass clink', durationSec: 2, ...x }, fake),
    'upscale.submit': (v, x) => submitUpscaleJob(deps, v, { organizationId: f.orgId, requestId: requestId(), assetId: picture, kind: 'image', resolution: 1440, ...x }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } }),
    'render.reserve': (v, x) => runComposeOperation(deps, v, 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, ...x }),
  });

  it('per making path, for an outsider, a project guest and staff who are not members', async () => {
    const picture = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const values: unknown[] = ['nope', 7, { id: 'x' }, randomUUID(), f.projectId];
    for (const [name, call] of Object.entries(paths(picture))) {
      for (const who of ['outsider', 'guest', 'admin'] as const) {
        const viewer = viewerOf(f.ids[who]);
        for (const value of values) {
          vi.unstubAllEnvs();
          const closed = outcome(await call(viewer, { brandProjectId: value }));
          openFor('*');
          const opened = outcome(await call(viewer, { brandProjectId: value }));
          expect(opened, `${name} ${who} ${JSON.stringify(value)}`).toBe(closed);
          expect(opened, `${name} ${who}`).not.toBe('ok');
        }
      }
    }
  });

  it('a seated member gets `invalid` for a malformed value, judged inside the transaction (nothing reserved)', async () => {
    open();
    const before = (await f.sql.query('select count(*)::int as n from brand_studio_jobs')).rows[0];
    for (const value of ['nope', 7, { id: 'x' }]) {
      expect(await op(owner(), 'job.create', { organizationId: f.orgId, requestId: requestId(), ...image, brandProjectId: value })).toEqual({ ok: false, code: 'invalid' });
      expect(await runComposeOperation(deps, owner(), 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, brandProjectId: value })).toEqual({ ok: false, code: 'invalid' });
    }
    expect((await f.sql.query('select count(*)::int as n from brand_studio_jobs')).rows[0]).toEqual(before);
  });
});

/* --------------------------------------------------------------------- F5 */

describe('F5 organization ids are compared without regard to case', () => {
  it('an upper-case id in the switch list or in the request opens the spine for that organization', async () => {
    openFor(f.orgId.toUpperCase());
    expect((await op(owner(), 'project.list', { organizationId: f.orgId })).ok).toBe(true);
    expect((await op(owner(), 'project.list', { organizationId: f.orgId.toUpperCase() })).ok).toBe(true);
    const mine = await selfProject('Case');
    const run = await create({ ...image, brandProjectId: mine.toUpperCase() });
    expect(run.brandProjectId).toBe(mine);
    expect(await filed('brand_studio_jobs', run.id)).toBe(mine);
  });
});

/* --------------------------------------------------------------------- F6 */

describe('F6 making paths × a hidden team project, an archived own project and a requested team project', () => {
  const fake = { env: { BRAND_STUDIO_MUSIC_PROVIDER: 'fake' } };
  it('hidden and archived are not_found and file nothing; requested files the run', async () => {
    open();
    const hidden = await teamProject({ visible: false });
    const archived = await selfProject('Archived');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [archived]);
    const requested = f.projectId; // the fixture's team project: shown, `requested`
    expect((await f.sql.query('select status, client_visible from brand_projects where id = $1', [requested])).rows[0]).toEqual({ status: 'requested', client_visible: true });
    const picture = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const settle = () => f.sql.query("update brand_studio_jobs set status = 'canceled', finished_at = now() where status in ('held','queued','running','finishing')");
    const paths: Record<string, { call: (x: Record<string, unknown>) => Promise<{ ok: boolean; code?: string } & Record<string, unknown>>; table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects'; id: (r: Record<string, unknown>) => string }> = {
      'job.create': { call: (x) => op(owner(), 'job.create', { organizationId: f.orgId, requestId: requestId(), ...image, ...x }) as never, table: 'brand_studio_jobs', id: (r) => (r.job as StudioJobView).id },
      'music run': { call: (x) => op(owner(), 'job.create', { kind: 'music', organizationId: f.orgId, requestId: requestId(), prompt: 'calm piano', vocal: false, ...x }) as never, table: 'brand_studio_jobs', id: (r) => (r.job as StudioJobView).id },
      'job.create_group': { call: (x) => op(owner(), 'job.create_group', { kind: 'image', organizationId: f.orgId, requestId: `grp_${randomUUID().slice(0, 12)}`, prompt: 'a bottle', aspect: '1:1', resolution: '2K', runs: [{ model: 'seedream-5.5' }, { model: 'nano-banana-pro' }], ...x }) as never, table: 'brand_studio_jobs', id: (r) => (r.jobs as StudioJobView[])[1]!.id },
      'asset.reserve': { call: (x) => op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 1000, ...x }) as never, table: 'brand_studio_assets', id: (r) => r.id as string },
      'film create': { call: (x) => runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title: 'Cut', ...x }) as never, table: 'brand_studio_video_projects', id: (r) => (r.project as { id: string }).id },
      'music.generate': { call: (x) => generateReferenceMusic(deps, owner(), { organizationId: f.orgId, requestId: requestId(), durationSec: 8, bpm: 120, ...x }, fake) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
      'sfx.generate': { call: (x) => generateSoundEffect(deps, owner(), { organizationId: f.orgId, requestId: requestId(), text: 'glass clink', durationSec: 2, ...x }, fake) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
      'upscale.submit': { call: (x) => submitUpscaleJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), assetId: picture, kind: 'image', resolution: 1440, ...x }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } }) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
      'render.reserve': { call: (x) => runComposeOperation(deps, owner(), 'render.reserve', { organizationId: f.orgId, requestId: requestId(), durationSec: 6, ...x }) as never, table: 'brand_studio_jobs', id: (r) => r.jobId as string },
    };
    for (const [name, path] of Object.entries(paths)) {
      for (const bad of [hidden, archived]) {
        await settle();
        expect(await path.call({ brandProjectId: bad }), `${name} ${bad === hidden ? 'hidden' : 'archived'}`).toMatchObject({ ok: false, code: 'not_found' });
      }
      await settle();
      const made = await path.call({ brandProjectId: requested });
      expect(made.ok, name).toBe(true);
      expect(await filed(path.table, path.id(made)), name).toBe(requested);
    }
    for (const bad of [hidden, archived]) {
      for (const table of ['brand_studio_jobs', 'brand_studio_assets', 'brand_studio_video_projects']) {
        expect((await f.sql.query(`select count(*)::int as n from ${table} where brand_project_id = $1`, [bad])).rows[0], `${table}`).toEqual({ n: 0 });
      }
    }
  });
});

describe('F6 project.move families: a removed member and a planted parent of another organization', () => {
  const move = (input: Record<string, unknown>) => op(owner(), 'project.move', { organizationId: f.orgId, ...input });

  it('a run a member removed from the wall is neither moved nor listed (and cannot be the handle)', async () => {
    open();
    const mine = await selfProject('Spring');
    const root = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const kept = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputId });
    const removed = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputId, status: 'failed' });
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [removed.jobId]);
    const moved = (await move({ projectId: mine, jobIds: [kept.jobId] })) as StudioBrandProjectMoved;
    expect([...moved.jobIds].sort()).toEqual([root.jobId, kept.jobId].sort());
    expect(await filed('brand_studio_jobs', removed.jobId)).toBeNull();
    expect(await move({ projectId: null, jobIds: [removed.jobId] })).toEqual({ ok: false, code: 'not_found' });
  });

  it('a parent_output_id pointing at another organization never pulls that organization’s run in, either way', async () => {
    openFor('*');
    const mine = await selfProject('Spring');
    const other = await secondOrg();
    const theirs = await seedRun(deps, other, f.ids.owner, { kind: 'image' });
    // Our run planted on their result (the column's foreign key is not organization-scoped).
    const ours = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: theirs.outputId });
    const up = (await move({ projectId: mine, jobIds: [ours.jobId] })) as StudioBrandProjectMoved;
    expect(up.jobIds).toEqual([ours.jobId]);
    expect(await filed('brand_studio_jobs', theirs.jobId)).toBeNull();
    // Their run planted on our result.
    const ourRoot = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const theirChild = await seedRun(deps, other, f.ids.owner, { kind: 'video_remix', parentOutputId: ourRoot.outputId });
    const down = (await move({ projectId: mine, jobIds: [ourRoot.jobId] })) as StudioBrandProjectMoved;
    expect(down.jobIds).toEqual([ourRoot.jobId]);
    expect(await filed('brand_studio_jobs', theirChild.jobId)).toBeNull();
    for (const preview of [true, false]) {
      expect((await move({ projectId: null, jobIds: [ourRoot.jobId], preview })) as StudioBrandProjectMoved).toMatchObject({ jobIds: [ourRoot.jobId] });
    }
  });
});

describe('F6 films: the revive branch and the live replay', () => {
  it('a deleted film made again with the same request id takes the new filing; a live replay never un-files it', async () => {
    open();
    const first = await selfProject('First');
    const second = await selfProject('Second');
    const key = `vp_${randomUUID()}`;
    const made = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: key, title: 'Cut', brandProjectId: first });
    if (!made.ok || !made.project) throw new Error('film');
    const id = made.project.id;
    // Live replay without the field, and with another project: the film keeps its filing.
    for (const extra of [{}, { brandProjectId: second }]) {
      const again = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: key, title: 'Cut', ...extra });
      expect(again).toMatchObject({ ok: true, created: false, project: { id, brandProjectId: first } });
      expect(await filed('brand_studio_video_projects', id)).toBe(first);
    }
    // Deleted, then made again with the same key: the new request decides (another project, then none).
    expect((await runVideoProjectOperation(films(), owner(), 'delete', { organizationId: f.orgId, projectId: id })).ok).toBe(true);
    const revived = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: key, title: 'Cut', brandProjectId: second });
    expect(revived).toMatchObject({ ok: true, created: true, project: { id, brandProjectId: second } });
    expect(await filed('brand_studio_video_projects', id)).toBe(second);
    expect((await runVideoProjectOperation(films(), owner(), 'delete', { organizationId: f.orgId, projectId: id })).ok).toBe(true);
    const plain = await runVideoProjectOperation(films(), owner(), 'create', { organizationId: f.orgId, requestId: key, title: 'Cut' });
    expect(plain).toMatchObject({ ok: true, created: true, project: { id, brandProjectId: null } });
    expect(await filed('brand_studio_video_projects', id)).toBeNull();
  });
});
