import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { studioSeat } from '@/lib/brand-studio/access';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import {
  BRAND_PROJECT_LIMITS,
  type BrandProjectFileKind,
  type BrandProjectFilesScope,
  type StudioAssetView,
  type StudioBrandProject,
  type StudioBrandProjectFiles,
  type StudioBrandProjectList,
  type StudioBrandProjectMoved,
  type StudioBrandProjectOverview,
  type StudioState,
} from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { dispatchMcpJsonRpc, MCP_TOOL_DEFINITIONS } from '@/lib/brand-studio/mcp/server';
import { NOT_FILL, VISIBLE_OUTPUT, assetView, assetsOf, jobsByIds, jobsOf, viewsOf } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import type { AssetRow } from '@/lib/brand-studio/types';
import { loadVideoProjects, runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { pngBytes, requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §7, slice 2a: the server reads the assets page needs (no screen). Pinned here:
 *  - `project.overview` and `project.files`: members only, the same refusals as `project.list` (closed: `invalid`;
 *    guests, outsiders, staff who are not members: `not_found`; sandboxed or generation-closed: `feature_unavailable`);
 *  - what is counted is exactly what a member can open (the studio state's own rules), filed by the SHOWN project
 *    (a project that can no longer take new work reads as 미분류), and every count equals its paged list;
 *  - `project.files` pages by (created_at, id), stable under inserts; a project that is not selectable is `not_found`;
 *  - library entries carry `brandProjectId` for members while open (state and asset answers), never otherwise;
 *  - while closed, every answer touched here is byte for byte what origin/main answers.
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
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, viewer, operation, input);
const films = () => ({ sql: f.sql, media: deps.media });
type Outcome = 'ok' | string;
const outcome = (r: { ok: boolean; code?: string }): Outcome => (r.ok ? 'ok' : (r.code as string));

async function overview(viewer = owner(), organizationId = f.orgId): Promise<StudioBrandProjectOverview> {
  const answer = await op(viewer, 'project.overview', { organizationId });
  if (!answer.ok) throw new Error(`project.overview: ${JSON.stringify(answer)}`);
  return answer as StudioBrandProjectOverview;
}
const files = (input: Record<string, unknown>, viewer = owner()) => op(viewer, 'project.files', { organizationId: f.orgId, ...input });
async function page(scope: BrandProjectFilesScope, extra: { kind?: BrandProjectFileKind; cursor?: string } = {}, viewer = owner()): Promise<StudioBrandProjectFiles> {
  const answer = await files({ scope, ...extra }, viewer);
  if (!answer.ok) throw new Error(`project.files: ${JSON.stringify(answer)}`);
  return answer as StudioBrandProjectFiles;
}
async function allPages(scope: BrandProjectFilesScope, kind?: BrandProjectFileKind): Promise<StudioBrandProjectFiles[]> {
  const pages: StudioBrandProjectFiles[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const next = await page(scope, { ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) });
    pages.push(next);
    if (!next.next) return pages;
    cursor = next.next;
  }
  throw new Error('too many pages');
}
const MEDIUM: Record<string, 'image' | 'video' | 'sound'> = { image: 'image', region_edit: 'image', video: 'video', video_remix: 'video', video_final: 'video', music: 'sound', sound_effect: 'sound' };
/** Items of one kind over all pages: a result is one item (a run counts its `outputs`). */
function itemsOf(pages: StudioBrandProjectFiles[], kind: BrandProjectFileKind): number {
  let n = 0;
  for (const p of pages) {
    if (kind === 'upload') n += p.assets.length;
    else if (kind === 'film') n += p.films.length;
    else for (const job of p.jobs) if (MEDIUM[job.kind] === kind) n += job.outputs.length;
  }
  return n;
}
const ids = (pages: StudioBrandProjectFiles[]) => pages.flatMap((p) => p.items.map((item) => `${item.type}:${item.id}`));

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

/** A run with `n` ready results (image or video by its kind). */
async function run(kind: 'image' | 'video' | 'region_edit' | 'video_final', organizationId = f.orgId, n = 1, extra: { model?: string; params?: Record<string, unknown> } = {}) {
  const seeded = await seedRun(deps, organizationId, f.ids.owner, { kind: kind as never, ...(extra.model ? { model: extra.model } : {}), ...(extra.params ? { params: extra.params as never } : {}) });
  const outputs = [seeded.outputId];
  for (let idx = 1; idx < n; idx += 1) {
    const media = kind === 'image' || kind === 'region_edit' ? 'image' : 'video';
    const { key } = await deps.media.put(new Uint8Array([idx, 1, 2, 3, randomUUID().charCodeAt(0)]), media === 'image' ? 'image/png' : 'video/mp4');
    const row = await f.sql.query<{ id: string }>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, width, height)
        values ($1, $2, $3, $4, 'ready', $5, $6, 720, 1280) returning id`,
      [seeded.jobId, organizationId, idx, media, key, media === 'image' ? 'image/png' : 'video/mp4'],
    );
    outputs.push(row.rows[0]!.id);
  }
  return { jobId: seeded.jobId, outputs };
}
/** A sound studio run (`music` or `sound_effect`) with one audio result. */
async function soundRun(kind: 'music' | 'sound_effect' = 'music', organizationId = f.orgId) {
  const params = { locale: 'ko', ...(kind === 'music' ? { music: { title: 'Jingle', vocal: false, mode: 'describe', careful: false, lyrics: null } } : {}) };
  const job = await f.sql.query<{ id: string }>(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs, finished_at)
      values ($1, $2, $3, $4, 'succeeded', 'sunra_api', 'suno-v6', 'calm piano', false, $5::jsonb, '[]'::jsonb, now()) returning id`,
    [organizationId, f.ids.owner, requestId(), kind, JSON.stringify(params)],
  );
  const { key } = await deps.media.put(new Uint8Array([73, 68, 51, randomUUID().charCodeAt(0)]), 'audio/mpeg');
  const output = await f.sql.query<{ id: string }>(
    `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, duration_ms)
      values ($1, $2, 0, 'audio', 'ready', $3, 'audio/mpeg', 30000) returning id`,
    [job.rows[0]!.id, organizationId, key],
  );
  return { jobId: job.rows[0]!.id, outputs: [output.rows[0]!.id] };
}
const upload = (role: string | null = null, organizationId = f.orgId) => seedImageAsset(deps, organizationId, f.ids.owner, role ? { role } : {});
async function film(title: string, organizationId = f.orgId): Promise<string> {
  const made = await runVideoProjectOperation(films(), owner(), 'create', { organizationId, requestId: `vp_${randomUUID()}`, title });
  if (!made.ok || !made.project) throw new Error(`film create: ${JSON.stringify(made)}`);
  return made.project.id;
}

/**
 * One organization with files everywhere (and another organization's beside it):
 *  P1 (own, active): image run ×2 results (+1 deleted result), video run, music run, an upload, a logo upload, a film;
 *  team (fixture, requested and shown): one image run;
 *  H (team, hidden) and A (own, archived): a run each, a product upload and a film in H — all read as 미분류 / 브랜드 자료;
 *  미분류: image, video, music, two uploads (no role, `other`), a film;
 *  브랜드 자료: logo, product, person;
 *  never counted: a fill strip, the editor's export, a removed run, a run with no result yet, a deleted and a
 *  pending upload, a deleted and an archived film.
 */
async function world() {
  open();
  const other = await secondOrg('Other brand');
  const P1 = await selfProject('Spring');
  const H = await teamProject({ visible: false, title: 'Hidden by staff' });
  const A = await selfProject('Archived');
  await f.sql.query("update brand_projects set status = 'completed' where id = $1", [A]);
  const Q = await selfProject('Theirs', other);

  const r1 = await run('image', f.orgId, 3);
  await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [r1.outputs[2]]);
  const r2 = await run('video');
  const s1 = await soundRun('music');
  const u1 = await upload();
  const u2 = await upload('logo');
  const F1 = await film('Cut one');
  for (const id of [r1.jobId, r2.jobId, s1.jobId]) await fileIn('brand_studio_jobs', id, P1);
  for (const id of [u1, u2]) await fileIn('brand_studio_assets', id, P1);
  await fileIn('brand_studio_video_projects', F1, P1);

  const r3 = await run('image');
  await fileIn('brand_studio_jobs', r3.jobId, f.projectId);

  const r4 = await run('image');
  await fileIn('brand_studio_jobs', r4.jobId, H);
  const u3 = await upload('product');
  await fileIn('brand_studio_assets', u3, H);
  const F2 = await film('Hidden cut');
  await fileIn('brand_studio_video_projects', F2, H);
  const r5 = await run('video');
  await fileIn('brand_studio_jobs', r5.jobId, A);

  const r6 = await run('image');
  const r7 = await run('video');
  const s2 = await soundRun('sound_effect');
  const u4 = await upload();
  const u5 = await upload('other');
  const F3 = await film('Loose cut');
  const u6 = await upload('logo');
  const u7 = await upload('product');
  const u8 = await upload('person');

  // Never counted, whatever their filing.
  const fill = await run('region_edit', f.orgId, 1, { params: { purpose: 'fill' } });
  const exported = await run('video_final', f.orgId, 1, { model: 'compose-1080p' });
  const removed = await run('image');
  await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [removed.jobId]);
  const pending = await run('video');
  await f.sql.query("update brand_studio_outputs set status = 'pending' where job_id = $1", [pending.jobId]);
  const gone = await upload();
  await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [gone]);
  const waiting = await upload();
  await f.sql.query("update brand_studio_assets set status = 'pending' where id = $1", [waiting]);
  const deletedFilm = await film('Deleted cut');
  await f.sql.query('update brand_studio_video_projects set deleted_at = now() where id = $1', [deletedFilm]);
  const archivedFilm = await film('Archived cut');
  await f.sql.query("update brand_studio_video_projects set status = 'archived' where id = $1", [archivedFilm]);
  for (const id of [fill.jobId, exported.jobId, removed.jobId, pending.jobId]) await fileIn('brand_studio_jobs', id, P1);

  // The other organization: a run, a logo and a film in its own project.
  const theirRun = await run('image', other);
  await fileIn('brand_studio_jobs', theirRun.jobId, Q);
  const theirLogo = await upload('logo', other);
  const theirFilm = await film('Their cut', other);
  await fileIn('brand_studio_video_projects', theirFilm, Q);

  return { other, P1, H, A, Q, r1, r2, s1, u1, u2, F1, r3, r4, u3, F2, r5, r6, r7, s2, u4, u5, F3, u6, u7, u8, fill, exported, removed, pending, gone, waiting, deletedFilm, archivedFilm, theirRun, theirLogo, theirFilm };
}

/* ----------------------------------------------------------------- overview */

describe('project.overview', () => {
  it('one group per project project.list lists (same set and order), then 미분류 and 브랜드 자료, counting only what a member can open', async () => {
    const w = await world();
    const listed = (await op(owner(), 'project.list', { organizationId: f.orgId })) as StudioBrandProjectList;
    const answer = await overview();
    expect(answer.projects.map((g) => g.project)).toEqual(listed.projects);
    expect(answer.projects.map((g) => g.project.id).sort()).toEqual([w.P1, f.projectId].sort());
    const group = (id: string) => answer.projects.find((g) => g.project.id === id)!;
    expect(group(w.P1).counts).toEqual({ image: 2, video: 1, sound: 1, upload: 2, film: 1 });
    expect(group(f.projectId).counts).toEqual({ image: 1, video: 0, sound: 0, upload: 0, film: 0 });
    // The hidden project reads as 미분류; the product upload filed in the hidden one is 브랜드 자료. Spine rules R-A: the
    // archived own project keeps its run (it is not listed here; `filter: 'all'` lists it), so 미분류 has one video less.
    expect(answer.unfiled.counts).toEqual({ image: 2, video: 1, sound: 1, upload: 2, film: 2 });
    expect(answer.brandMaterials.count).toBe(4);
    expect(answer.brandMaterials.byRole).toEqual({ product: 2, person: 1, logo: 1, style: 0, place: 0 });
    // Covers: image and video results only, newest first, at most the named limit.
    expect(group(w.P1).covers.map((c) => c.outputId).sort()).toEqual([w.r1.outputs[0], w.r1.outputs[1], w.r2.outputs[0]].sort());
    expect(group(w.P1).covers.every((c) => c.kind === 'image' || c.kind === 'video')).toBe(true);
    // 미분류 holds three image and video results here (2 + 1: the archived project keeps its video), fewer than the limit.
    expect(answer.unfiled.covers.length).toBe(Math.min(3, BRAND_PROJECT_LIMITS.overviewCovers));
    expect(answer.brandMaterials.covers.map((a) => a.id).sort()).toEqual([w.u3, w.u6, w.u7, w.u8].sort());
    for (const asset of answer.brandMaterials.covers) expect(asset.brandProjectId).toBeNull();
    // Nothing of the other organization, by id, title or address.
    const text = JSON.stringify(answer);
    for (const theirs of [w.Q, 'Theirs', w.theirRun.jobId, w.theirRun.outputs[0]!, w.theirLogo, w.theirFilm]) expect(text).not.toContain(theirs);
    for (const never of [w.H, 'Hidden by staff', w.A, 'Archived']) expect(answer.projects.some((g) => g.project.id === never || g.project.title === never)).toBe(false);
  });

  it('covers are the wall’s media addresses, newest first, at most the named limit', async () => {
    open();
    const P = await selfProject('Covers');
    const made: string[] = [];
    for (let i = 0; i < BRAND_PROJECT_LIMITS.overviewCovers + 2; i += 1) {
      const r = await run('image');
      await fileIn('brand_studio_jobs', r.jobId, P);
      await at('brand_studio_outputs', r.outputs[0]!, `2026-11-0${i + 1}T00:00:00.000Z`);
      made.push(r.outputs[0]!);
    }
    const group = (await overview()).projects.find((g) => g.project.id === P)!;
    expect(group.covers.map((c) => c.outputId)).toEqual(made.slice(2).reverse());
    const state = (await loadStudioState(deps, owner(), f.orgId)) as StudioState;
    for (const cover of group.covers) {
      const shown = state.jobs.flatMap((j) => j.outputs).find((o) => o.id === cover.outputId)!;
      expect({ url: cover.url, thumbUrl: cover.thumbUrl, kind: cover.kind, jobId: cover.jobId }).toEqual({ url: shown.url, thumbUrl: shown.thumbUrl, kind: shown.kind, jobId: shown.jobId });
    }
  });

  it('asks the database a fixed number of times whatever the number of projects', async () => {
    open();
    const recorded = async (): Promise<number> => {
      const texts: string[] = [];
      const wrap = (inner: SqlRunner): SqlRunner => ({
        query: (text, params) => {
          texts.push(text);
          return inner.query(text, params);
        },
        transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
      });
      const answer = await runStudioOperation({ ...deps, sql: wrap(f.sql) }, owner(), 'project.overview', { organizationId: f.orgId });
      expect(answer.ok).toBe(true);
      return texts.length;
    };
    await overview(); // the column probes are remembered after the first call
    const two = await recorded();
    for (let i = 0; i < 12; i += 1) {
      const P = await selfProject(`Project ${i}`);
      const r = await run('image');
      await fileIn('brand_studio_jobs', r.jobId, P);
      await fileIn('brand_studio_assets', await upload(), P);
    }
    expect(await recorded()).toBe(two);
  });
});

/* -------------------------------------------------------------------- files */

describe('project.files', () => {
  it('every overview count equals the items its paged list returns, for every scope and kind, over all pages', async () => {
    const w = await world();
    // Enough 미분류 uploads for more than one page.
    for (let i = 0; i < BRAND_PROJECT_LIMITS.filesPage + 5; i += 1) await upload();
    const answer = await overview();
    const scopes: Array<[BrandProjectFilesScope, Record<BrandProjectFileKind, number>]> = [
      ...answer.projects.map((g) => [{ kind: 'project', brandProjectId: g.project.id }, g.counts] as [BrandProjectFilesScope, Record<BrandProjectFileKind, number>]),
      [{ kind: 'unfiled' }, answer.unfiled.counts],
      [{ kind: 'brand_materials' }, { image: 0, video: 0, sound: 0, upload: answer.brandMaterials.count, film: 0 }],
    ];
    for (const [scope, counts] of scopes) {
      const everything = await allPages(scope);
      for (const kind of ['image', 'video', 'sound', 'upload', 'film'] as const) {
        const narrowed = await allPages(scope, kind);
        expect(itemsOf(narrowed, kind), `${JSON.stringify(scope)} ${kind}`).toBe(counts[kind]);
        expect(itemsOf(everything, kind), `${JSON.stringify(scope)} ${kind} (all kinds)`).toBe(counts[kind]);
        // Narrowed to one kind, nothing of another kind comes along.
        for (const otherKind of ['image', 'video', 'sound', 'upload', 'film'] as const) if (otherKind !== kind) expect(itemsOf(narrowed, otherKind)).toBe(0);
      }
      const seen = ids(everything);
      expect(new Set(seen).size, `${JSON.stringify(scope)} no item twice`).toBe(seen.length);
    }
    expect((await allPages({ kind: 'unfiled' }, 'upload')).length).toBe(2);
    // The never-counted rows appear in no list.
    const everywhere = new Set((await Promise.all(scopes.map(([scope]) => allPages(scope)))).flatMap(ids));
    for (const id of [w.fill.jobId, w.exported.jobId, w.removed.jobId, w.pending.jobId]) expect(everywhere.has(`job:${id}`)).toBe(false);
    for (const id of [w.gone, w.waiting]) expect(everywhere.has(`asset:${id}`)).toBe(false);
    for (const id of [w.deletedFilm, w.archivedFilm]) expect(everywhere.has(`film:${id}`)).toBe(false);
    for (const id of [`job:${w.theirRun.jobId}`, `asset:${w.theirLogo}`, `film:${w.theirFilm}`]) expect(everywhere.has(id)).toBe(false);
  });

  it('agrees with the scoped studio state run for run, with the same view objects (but for a finished project’s runs, spine rules R-A)', async () => {
    const w = await world();
    for (const scope of [{ kind: 'project', brandProjectId: w.P1 }, { kind: 'unfiled' }] as const) {
      const state = (await loadStudioState(deps, owner(), f.orgId, { scope })) as StudioState;
      const listed = [...(await allPages(scope, 'image')), ...(await allPages(scope, 'video'))].flatMap((p) => p.jobs);
      // The studio's 미분류 wall keeps origin/main's rule (follow-up 1): the archived project's run is on it; the assets
      // page shows that run in its project instead. Nothing else differs.
      const withResults = state.jobs.filter((job) => job.outputs.length > 0 && !(scope.kind === 'unfiled' && job.id === w.r5.jobId));
      if (scope.kind === 'unfiled') expect(state.jobs.map((j) => j.id)).toContain(w.r5.jobId);
      expect(listed.map((j) => j.id).sort()).toEqual(withResults.map((j) => j.id).sort());
      for (const job of listed) expect(job).toEqual(withResults.find((j) => j.id === job.id));
      // The library entries are the state's own views too.
      for (const asset of (await allPages(scope, 'upload')).flatMap((p) => p.assets)) expect(asset).toEqual(state.assets.find((a) => a.id === asset.id));
    }
    // A film's view is the films' list's view.
    const listedFilms = await loadVideoProjects(films(), owner(), f.orgId);
    if (!listedFilms.ok) throw new Error(listedFilms.code);
    for (const one of (await allPages({ kind: 'project', brandProjectId: w.P1 }, 'film')).flatMap((p) => p.films)) {
      expect(one).toEqual(listedFilms.projects.find((p) => p.id === one.id));
      expect(one.brandProjectId).toBe(w.P1);
    }
  });

  it('sound results come through kind: sound; the studio state never lists them', async () => {
    const w = await world();
    const sounds = (await allPages({ kind: 'unfiled' }, 'sound')).flatMap((p) => p.jobs);
    expect(sounds.map((j) => j.id)).toEqual([w.s2.jobId]);
    expect(sounds[0]!.outputs.map((o) => o.kind)).toEqual(['audio']);
    const filed = (await allPages({ kind: 'project', brandProjectId: w.P1 }, 'sound')).flatMap((p) => p.jobs);
    expect(filed.map((j) => j.id)).toEqual([w.s1.jobId]);
    expect(filed[0]!.music?.title).toBe('Jingle');
    const state = (await loadStudioState(deps, owner(), f.orgId)) as StudioState;
    expect(state.jobs.some((j) => j.kind === 'music' || j.kind === 'sound_effect')).toBe(false);
  });

  it('pages newest first by (created_at, id), stable under inserts, ties broken by id across runs, uploads and films', async () => {
    open();
    const P = await selfProject('Paged');
    const expected: string[] = [];
    const tie = '2020-10-01T00:00:00.000000Z';
    // 44 uploads a second apart, then a run, an upload and a film at the very same instant.
    for (let i = 0; i < 44; i += 1) {
      const id = await upload();
      await fileIn('brand_studio_assets', id, P);
      await at('brand_studio_assets', id, new Date(Date.UTC(2020, 9, 2, 0, 0, 44 - i)).toISOString());
      expected.push(`asset:${id}`);
    }
    const tied: string[] = [];
    const r = await run('image');
    await fileIn('brand_studio_jobs', r.jobId, P);
    await at('brand_studio_jobs', r.jobId, tie);
    tied.push(`job:${r.jobId}`);
    const u = await upload();
    await fileIn('brand_studio_assets', u, P);
    await at('brand_studio_assets', u, tie);
    tied.push(`asset:${u}`);
    const F = await film('Tied cut');
    await fileIn('brand_studio_video_projects', F, P);
    await at('brand_studio_video_projects', F, tie);
    tied.push(`film:${F}`);
    // Same instant: newest first means the larger id first.
    expected.push(...tied.sort((a, b) => (a.split(':')[1]! < b.split(':')[1]! ? 1 : -1)));
    // Microseconds count: two uploads one microsecond apart keep their order.
    const early = await upload();
    const earlier = await upload();
    for (const [id, when] of [[early, '2020-09-01T00:00:00.000002Z'], [earlier, '2020-09-01T00:00:00.000001Z']] as const) {
      await fileIn('brand_studio_assets', id, P);
      await at('brand_studio_assets', id, when);
      expected.push(`asset:${id}`);
    }

    const scope = { kind: 'project', brandProjectId: P } as const;
    const first = await page(scope);
    expect(first.items).toHaveLength(BRAND_PROJECT_LIMITS.filesPage);
    expect(first.next).toEqual(expect.any(String));
    // New files arrive between the two pages: the second page neither repeats nor skips anything.
    for (let i = 0; i < 3; i += 1) await fileIn('brand_studio_assets', await upload(), P);
    const second = await page(scope, { cursor: first.next! });
    expect(second.next).toBeNull();
    expect([...ids([first]), ...ids([second])]).toEqual(expected);
    // The views follow the items' order.
    expect(second.jobs.map((j) => j.id)).toEqual(second.items.filter((i) => i.type === 'job').map((i) => i.id));
    expect(second.assets.map((a) => a.id)).toEqual(second.items.filter((i) => i.type === 'asset').map((i) => i.id));
    expect(second.films.map((x) => x.id)).toEqual(second.items.filter((i) => i.type === 'film').map((i) => i.id));
    // Read again from the start, the new files come first.
    expect((await page(scope)).items.slice(0, 3).every((item) => item.type === 'asset' && !expected.includes(`asset:${item.id}`))).toBe(true);
  });

  it('a project members may not see is not_found, exactly as the scoped state read answers; a finished one opens here only; malformed input is invalid', async () => {
    open();
    const other = await secondOrg();
    const hidden = await teamProject({ visible: false });
    const hiddenDone = await teamProject({ visible: false, status: 'completed' });
    const completed = await teamProject({ status: 'completed' });
    const cancelled = await teamProject({ status: 'cancelled' });
    const archived = await selfProject('Archived');
    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [archived]);
    const theirs = await selfProject('Theirs', other);
    for (const bad of [hidden, hiddenDone, theirs, randomUUID()]) {
      const scope = { kind: 'project', brandProjectId: bad } as const;
      expect(await files({ scope }), bad).toEqual({ ok: false, code: 'not_found' });
      expect(await files({ scope }), bad).toEqual(await loadStudioState(deps, owner(), f.orgId, { scope }));
    }
    // Spine rules R-A: a finished project's files can be browsed on the assets page; the studio still does not open it
    // (it takes no new work).
    for (const done of [completed, cancelled, archived]) {
      const scope = { kind: 'project', brandProjectId: done } as const;
      expect((await files({ scope })).ok, done).toBe(true);
      expect(await loadStudioState(deps, owner(), f.orgId, { scope }), done).toEqual({ ok: false, code: 'not_found' });
    }
    // This organization's project, named under the other organization (whose owner the viewer also is).
    const mine = await selfProject('Mine');
    expect(await files({ organizationId: other, scope: { kind: 'project', brandProjectId: mine } })).toEqual({ ok: false, code: 'not_found' });
    expect(await files({ scope: { kind: 'project', brandProjectId: 'not-a-project' } })).toEqual({ ok: false, code: 'invalid' });
    expect(await files({ scope: { kind: 'project', brandProjectId: 'not-a-project' } })).toEqual(
      await loadStudioState(deps, owner(), f.orgId, { scope: { kind: 'project', brandProjectId: 'not-a-project' } }),
    );
    for (const input of [
      { scope: { kind: 'everything' } },
      { scope: { kind: 'unfiled' }, kind: 'photo' },
      { scope: { kind: 'unfiled' }, cursor: 'garbage' },
      { scope: { kind: 'unfiled' }, cursor: Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000', randomUUID()])).toString('base64url') },
      { scope: { kind: 'unfiled' }, cursor: Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000000', 'x'])).toString('base64url') },
      { scope: { kind: 'unfiled' }, cursor: 'x'.repeat(BRAND_PROJECT_LIMITS.cursorMax + 1) },
      {},
    ]) {
      expect(await files(input), JSON.stringify(input)).toEqual({ ok: false, code: 'invalid' });
    }
    // Outside the organization nothing about the input is judged: the seat answers first.
    expect(await files({ scope: { kind: 'project', brandProjectId: 'not-a-project' } }, viewerOf(f.ids.outsider))).toEqual({ ok: false, code: 'not_found' });
    // 브랜드 자료 holds library entries only.
    for (const kind of ['image', 'video', 'sound', 'film'] as const) expect((await page({ kind: 'brand_materials' }, { kind })).items).toEqual([]);
  });

  it('a project that stops taking work between the two reads: its files stay in it (a role-tagged upload goes under 브랜드 자료, as before), and it is listed with filter all', async () => {
    open();
    const P = await selfProject('Soon archived');
    const r = await run('image');
    await fileIn('brand_studio_jobs', r.jobId, P);
    const loose = await upload();
    const logo = await upload('logo');
    for (const id of [loose, logo]) await fileIn('brand_studio_assets', id, P);
    const F = await film('Cut');
    await fileIn('brand_studio_video_projects', F, P);
    const before = await overview();
    expect(before.projects.find((g) => g.project.id === P)!.counts).toEqual({ image: 1, video: 0, sound: 0, upload: 2, film: 1 });

    await f.sql.query("update brand_projects set status = 'completed' where id = $1", [P]);
    // Spine rules R-A: the page opens it; the run, the role-less upload and the film are still in it.
    expect(ids(await allPages({ kind: 'project', brandProjectId: P })).sort()).toEqual([`job:${r.jobId}`, `asset:${loose}`, `film:${F}`].sort());
    const after = await overview();
    // Without a filter it is not listed (it takes no new work), and its files are NOT 미분류.
    expect(after.projects.some((g) => g.project.id === P)).toBe(false);
    expect(after.unfiled.counts).toEqual(before.unfiled.counts);
    expect(after.brandMaterials.byRole.logo).toBe(before.brandMaterials.byRole.logo + 1);
    const unfiled = ids(await allPages({ kind: 'unfiled' }));
    for (const id of [`job:${r.jobId}`, `asset:${loose}`, `film:${F}`]) expect(unfiled).not.toContain(id);
    expect(ids(await allPages({ kind: 'brand_materials' }))).toContain(`asset:${logo}`);
    for (const item of (await allPages({ kind: 'project', brandProjectId: P })).flatMap((p) => [...p.jobs, ...p.assets, ...p.films])) expect(item.brandProjectId).toBe(P);
    // With filter all it is listed with the same counts, marked archived.
    const all = (await op(owner(), 'project.overview', { organizationId: f.orgId, filter: 'all' })) as StudioBrandProjectOverview;
    expect(all.projects.find((g) => g.project.id === P)).toMatchObject({ counts: { image: 1, video: 0, sound: 0, upload: 1, film: 1 }, status: 'archived', selectable: false });
    expect(all.finished).toEqual({ counts: { image: 1, video: 0, sound: 0, upload: 1, film: 1 } });
    // The stored filing is untouched: brought back, everything is in the project again.
    await f.sql.query("update brand_projects set status = 'active' where id = $1", [P]);
    expect((await overview()).projects.find((g) => g.project.id === P)!.counts).toEqual({ image: 1, video: 0, sound: 0, upload: 2, film: 1 });
  });
});

/* ------------------------------------------------------------ who may read */

describe('who may read: the same answers as project.list', () => {
  const ROLES = ['owner', 'editor', 'viewer', 'guest', 'outsider', 'admin'] as const;
  const viewerFor = (role: (typeof ROLES)[number]): Viewer => (role === 'admin' ? staff() : viewerOf(f.ids[role]));

  for (const spine of ['open', 'switched off', 'organization not listed', 'column missing'] as const) {
    it(`project.overview and project.files × role × organization (${spine})`, async () => {
      openFor('*');
      const target = await selfProject('Target');
      const other = await secondOrg('Matrix second');
      const otherProject = await teamProject({ organizationId: other });
      if (spine === 'switched off') vi.unstubAllEnvs();
      if (spine === 'organization not listed') openFor(randomUUID());
      if (spine === 'column missing') {
        await f.sql.query('alter table brand_studio_video_projects drop column brand_project_id cascade');
        resetSpineProbe();
      }
      for (const role of ROLES) {
        const viewer = viewerFor(role);
        for (const [org, project] of [[f.orgId, target], [other, otherProject]] as const) {
          const list = outcome(await op(viewer, 'project.list', { organizationId: org }));
          const results = {
            overview: outcome(await op(viewer, 'project.overview', { organizationId: org })),
            unfiled: outcome(await op(viewer, 'project.files', { organizationId: org, scope: { kind: 'unfiled' } })),
            materials: outcome(await op(viewer, 'project.files', { organizationId: org, scope: { kind: 'brand_materials' }, kind: 'upload' })),
          };
          const label = `${spine} ${role} ${org === other ? 'B' : 'A'}`;
          expect(results, label).toEqual({ overview: list, unfiled: list, materials: list });
          const expected = spine !== 'open' ? 'invalid' : ['owner', 'editor', 'viewer'].includes(role) && (org === f.orgId || role === 'owner') ? 'ok' : 'not_found';
          expect(list, label).toBe(expected);
          // A project id under its own organization: selectable there only for that organization's members.
          const scoped = outcome(await op(viewer, 'project.files', { organizationId: org, scope: { kind: 'project', brandProjectId: project } }));
          expect(scoped, label).toBe(expected);
          // The other organization's project named under this one: never found.
          const crossed = outcome(await op(viewer, 'project.files', { organizationId: org, scope: { kind: 'project', brandProjectId: org === f.orgId ? otherProject : target } }));
          expect(crossed, label).toBe(expected === 'ok' ? 'not_found' : expected);
        }
      }
      // A made-up organization: whatever project.list answers.
      const madeUp = randomUUID();
      for (const role of ROLES) {
        const list = outcome(await op(viewerFor(role), 'project.list', { organizationId: madeUp }));
        expect(list).toBe(spine === 'open' ? 'not_found' : 'invalid');
        expect(outcome(await op(viewerFor(role), 'project.overview', { organizationId: madeUp }))).toBe(list);
        expect(outcome(await op(viewerFor(role), 'project.files', { organizationId: madeUp, scope: { kind: 'unfiled' } }))).toBe(list);
      }
      // Closed: an unknown operation's answer, before anything is judged.
      if (spine !== 'open') expect(await op(owner(), 'project.overview', { organizationId: f.orgId })).toEqual(await op(owner(), 'no.such.operation', { organizationId: f.orgId }));
    });
  }

  /** Requests the schema refuses: only a seated member may learn that (`invalid`); everyone else gets the seat's answer. */
  const MALFORMED: Array<Record<string, unknown>> = [
    {},
    { scope: { kind: 'everything' } },
    { scope: { kind: 'unfiled' }, kind: 'photo' },
    { scope: { kind: 'project', brandProjectId: 'x'.repeat(65) } },
    { scope: { kind: 'project', brandProjectId: 7 } },
    { scope: { kind: 'unfiled' }, cursor: '' },
    { scope: { kind: 'unfiled' }, cursor: 'x'.repeat(BRAND_PROJECT_LIMITS.cursorMax + 1) },
  ];

  it('malformed requests are judged after the seat: invalid for members, the seat’s answer for everyone else', async () => {
    open();
    for (const input of MALFORMED) {
      const label = JSON.stringify(input).slice(0, 80);
      for (const role of ['owner', 'editor', 'viewer'] as const) expect(await files(input, viewerOf(f.ids[role])), `${role} ${label}`).toEqual({ ok: false, code: 'invalid' });
      for (const viewer of [viewerOf(f.ids.guest), viewerOf(f.ids.outsider), staff()]) {
        expect(await files(input, viewer), label).toEqual({ ok: false, code: 'not_found' });
        expect(await files(input, viewer), label).toEqual(await op(viewer, 'project.list', { organizationId: f.orgId }));
      }
    }
  });

  it('sandboxed and generation-closed organizations: the same 404 as project.list on both reads', async () => {
    openFor('*');
    const orgs: string[] = [];
    // A sandboxed organization by id (the by-name rule is the same seat, pinned in operations.test.ts).
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
      expect(await op(owner(), 'project.overview', { organizationId: org })).toEqual(list);
      expect(await op(owner(), 'project.files', { organizationId: org, scope: { kind: 'unfiled' } })).toEqual(list);
      expect(await op(owner(), 'project.files', { organizationId: org, scope: { kind: 'project', brandProjectId: randomUUID() } })).toEqual(list);
      for (const input of MALFORMED) expect(await op(owner(), 'project.files', { organizationId: org, ...input }), JSON.stringify(input).slice(0, 80)).toEqual(list);
    }
  });

  it('MCP and workflows never reach the new reads and never receive brandProjectId; the team side cannot import them', async () => {
    open();
    const P = await selfProject('Filed');
    const asset = await upload();
    await fileIn('brand_studio_assets', asset, P);
    const r = await run('image');
    await fileIn('brand_studio_jobs', r.jobId, P);
    const seat = await studioSeat(f.sql, f.ids.owner, f.orgId);
    const rpc = await dispatchMcpJsonRpc({ deps, seat, viewer: owner() }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'twings_list_assets', arguments: {} } });
    expect(JSON.stringify(rpc)).toContain(asset);
    expect(JSON.stringify(rpc)).not.toContain('brandProjectId');
    expect(MCP_TOOL_DEFINITIONS.map((tool) => tool.name).some((name) => /project/i.test(name))).toBe(false);

    const ROOT = process.cwd();
    const under = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir)).flatMap((name) => {
        const rel = `${dir}/${name}`;
        return statSync(path.join(ROOT, rel)).isDirectory() ? under(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
      });
    const sources = [...under('lib'), ...under('app'), ...under('components')];
    const importing = (pattern: RegExp) => sources.filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8'))).sort();
    // The two reads are dispatched by the studio service only (the POST route's member gate).
    expect(importing(/from ['"][^'"]*brand-project-files['"]/)).toEqual(['lib/brand-studio/service.ts']);
    // Library entries get brandProjectId only where the studio's member answers are built.
    expect(importing(/withAssetBrandProjects/)).toEqual(['lib/brand-studio/brand-project-files.ts', 'lib/brand-studio/brand-projects.ts', 'lib/brand-studio/service.ts']);
    // The spine's own-project-aware pieces stay inside the spine: no team, admin, MCP or workflow file can list or
    // join a brand's own projects through them (they carry no TEAM_PROJECTS on purpose).
    for (const name of [
      'selectableProjects',
      'SHOWN_PROJECT_JOIN',
      'UNFILED_ROWS',
      'spineSeat',
      'spineOrganization',
      // Spine rules R-A: the visible-project reads and the saved-result rule's listing stay in the spine too.
      'visibleBrandProjects',
      'visibleProjectOf',
      'brandProjectTotals',
      'SHOWN_ASSET_PROJECT_JOIN',
      'UNFILED_ASSETS',
      'LISTED_LIBRARY_ASSETS',
    ]) {
      expect(importing(new RegExp(`\\b${name}\\b`)), name).toEqual(['lib/brand-studio/brand-project-files.ts', 'lib/brand-studio/brand-projects.ts']);
    }
    // The visible-project predicate: the spine and 보내기's member gate (as `SELECTABLE_PROJECTS`); the saved-result rule:
    // the spine and the result's delete.
    expect(importing(/\bVISIBLE_PROJECTS\b/)).toEqual(['lib/brand-rooms/members-channel.ts', 'lib/brand-studio/brand-project-files.ts', 'lib/brand-studio/brand-projects.ts']);
    expect(importing(/\bSHADOWED_SAVED_COPY\b/)).toEqual(['lib/brand-studio/assets.ts', 'lib/brand-studio/brand-projects.ts']);
  });
});

/* ------------------------------------------------- library entries say where */

describe('library entries carry brandProjectId for members while open', () => {
  it('the studio state: members see the shown project; a project guest sees no key', async () => {
    open();
    const P = await selfProject('Spring');
    const hidden = await teamProject({ visible: false });
    const filed = await upload();
    const loose = await upload('logo');
    const inHidden = await upload();
    await fileIn('brand_studio_assets', filed, P);
    await fileIn('brand_studio_assets', inHidden, hidden);
    for (const role of ['owner', 'editor', 'viewer'] as const) {
      const state = (await loadStudioState(deps, viewerOf(f.ids[role]), f.orgId)) as StudioState;
      const of = (id: string) => state.assets.find((a) => a.id === id)!;
      expect([of(filed).brandProjectId, of(loose).brandProjectId, of(inHidden).brandProjectId], role).toEqual([P, null, null]);
    }
    const guest = (await loadStudioState(deps, viewerOf(f.ids.guest), f.orgId)) as StudioState;
    expect(guest.assets.length).toBeGreaterThan(0);
    for (const asset of guest.assets) expect('brandProjectId' in asset).toBe(false);
    for (const id of [f.ids.outsider, f.ids.admin]) expect(await loadStudioState(deps, viewerOf(id), f.orgId)).toEqual({ ok: false, code: 'not_found' });
    // assetView itself never adds the key (opt-in, like jobView).
    const row = (await f.sql.query<AssetRow>('select * from brand_studio_assets where id = $1', [filed])).rows[0]!;
    expect('brandProjectId' in assetView(row, deps.media)).toBe(false);
  });

  it('asset.update, asset.complete and asset.from_output answer members with the shown project', async () => {
    open();
    const P = await selfProject('Spring');
    const filed = await upload();
    await fileIn('brand_studio_assets', filed, P);
    const updated = await op(owner(), 'asset.update', { organizationId: f.orgId, assetId: filed, name: 'Renamed' });
    expect(updated.ok && 'asset' in updated && (updated.asset as StudioAssetView).brandProjectId).toBe(P);

    const png = await pngBytes();
    const reserved = await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'shot.png', mime: 'image/png', sizeBytes: png.byteLength, brandProjectId: P });
    if (!reserved.ok || !('id' in reserved)) throw new Error(JSON.stringify(reserved));
    deps.staging.objects.set(`brand-studio/${f.orgId}/${reserved.id}`, png);
    const completed = await op(owner(), 'asset.complete', { organizationId: f.orgId, assetId: reserved.id });
    expect(completed.ok && 'asset' in completed && (completed.asset as StudioAssetView).brandProjectId).toBe(P);

    const r = await run('image');
    await fileIn('brand_studio_jobs', r.jobId, P);
    const saved = await op(owner(), 'asset.from_output', { organizationId: f.orgId, outputId: r.outputs[0] });
    expect(saved.ok && 'asset' in saved && (saved.asset as StudioAssetView).brandProjectId).toBe(P);
    const loose = await run('image');
    const savedLoose = await op(owner(), 'asset.from_output', { organizationId: f.orgId, outputId: loose.outputs[0] });
    expect(savedLoose.ok && 'asset' in savedLoose && (savedLoose.asset as StudioAssetView).brandProjectId).toBeNull();
  });
});

/* ------------------------------------------------------------ closed parity */

describe('closed: every answer touched here is byte for byte origin/main’s', () => {
  // Each starts open (to file things while it can), then closes.
  const closedStates: Array<[string, () => Promise<void>]> = [
    ['switch off', async () => {
      vi.unstubAllEnvs();
    }],
    ['organization not listed', async () => openFor(randomUUID())],
    ['columns missing', async () => {
      await f.sql.query('alter table brand_studio_assets drop column brand_project_id cascade');
      resetSpineProbe();
    }],
  ];
  const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
  /** origin/main's statements of the reads whose predicates now come from one place. */
  const MAIN_SQL = {
    images: "select * from brand_studio_jobs where organization_id = $1 and kind in ('image', 'region_edit') and coalesce(params ->> 'purpose', '') <> 'fill' and deleted_at is null order by created_at desc, id limit $2",
    videos: "select * from brand_studio_jobs where organization_id = $1 and kind in ('video', 'video_remix', 'video_final') and model <> 'compose-1080p' and deleted_at is null order by created_at desc, id limit $2",
    assets: "select * from brand_studio_assets where organization_id = $1 and status = 'ready' and deleted_at is null order by created_at desc, id limit $2",
    films: "select * from brand_studio_video_projects where organization_id = $1 and deleted_at is null and status in ('active', 'completed') order by updated_at desc, id desc limit 100",
  };
  const recordingDeps = () => {
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(norm(text));
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    return { texts, deps: { ...deps, sql: wrap(f.sql) } };
  };

  it('the shared rules generate origin/main’s text, and a result is shown exactly when the SQL twin says so', async () => {
    expect(NOT_FILL).toBe("coalesce(params ->> 'purpose', '') <> 'fill'");
    const recorded = recordingDeps();
    await jobsOf(recorded.deps.sql, f.orgId);
    expect(recorded.texts).toContain(
      "select * from brand_studio_jobs where organization_id = $1 and model <> 'compose-1080p' and coalesce(params ->> 'purpose', '') <> 'fill' and deleted_at is null order by created_at desc, id limit $2",
    );
    // One run, results in every state a row can be in.
    const r = await run('image', f.orgId, 1);
    const extra = async (idx: number, status: string, key: string | null, deleted: boolean) =>
      f.sql.query(
        `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, deleted_at)
          values ($1, $2, $3, 'image', $4, $5, 'image/png', ${deleted ? 'now()' : 'null'})`,
        [r.jobId, f.orgId, idx, status, key],
      );
    // (A ready result always has a key: table check brand_studio_outputs_ready. An empty key is the edge left.)
    await extra(1, 'pending', null, false);
    await extra(2, 'failed', null, false);
    await extra(4, 'ready', '', false);
    await extra(5, 'ready', `brand-studio/${randomUUID()}`, true);
    await extra(6, 'pending', `brand-studio/${randomUUID()}`, false);
    await extra(7, 'ready', `brand-studio/${randomUUID()}`, false);
    const [view] = await viewsOf(f.sql, await jobsByIds(f.sql, f.orgId, [r.jobId]), deps.media);
    const shown = (await f.sql.query<{ idx: number }>(`select o.idx from brand_studio_outputs o where o.job_id = $1 and ${VISIBLE_OUTPUT('o')} order by o.idx`, [r.jobId])).rows.map((row) => Number(row.idx));
    expect(shown).toEqual([0, 7]);
    expect(view!.outputs.map((o) => o.id)).toEqual(
      (await f.sql.query<{ id: string }>('select id from brand_studio_outputs where job_id = $1 and idx = any($2::int[]) order by idx', [r.jobId, shown])).rows.map((row) => row.id),
    );
  });

  for (const [label, close] of closedStates) {
    it(`${label}: the poll answers as before`, async () => {
      openFor('*');
      const P = await selfProject('Spring');
      const r = await run('image');
      await fileIn('brand_studio_jobs', r.jobId, P);
      await close();
      const polled = await pollStudioJobs(deps, owner(), f.orgId, [r.jobId]);
      if (!polled.ok) throw new Error(polled.code);
      expect(JSON.stringify(polled)).not.toContain('brandProjectId');
      expect(JSON.stringify(polled.jobs)).toBe(JSON.stringify(await viewsOf(f.sql, await jobsByIds(f.sql, f.orgId, [r.jobId]), deps.media)));
    });

    it(`${label}: the state, the asset answers and the films' list`, async () => {
      openFor('*');
      const P = await selfProject('Spring');
      const filed = await upload();
      await fileIn('brand_studio_assets', filed, P);
      const r = await run('image');
      await fileIn('brand_studio_jobs', r.jobId, P);
      await film('Cut');
      await close();

      const recorded = recordingDeps();
      const state = (await loadStudioState(recorded.deps, owner(), f.orgId)) as StudioState;
      expect(state.ok).toBe(true);
      expect(JSON.stringify(state)).not.toContain('brandProjectId');
      expect(JSON.stringify(state.assets)).toBe(JSON.stringify((await assetsOf(f.sql, f.orgId)).map((row) => assetView(row, deps.media))));
      for (const statement of [MAIN_SQL.images, MAIN_SQL.videos, MAIN_SQL.assets]) expect(recorded.texts).toContain(statement);
      const listed = await loadVideoProjects({ sql: recorded.deps.sql, media: deps.media }, owner(), f.orgId);
      expect(listed.ok && JSON.stringify(listed)).not.toContain('brandProjectId');
      expect(recorded.texts).toContain(MAIN_SQL.films);

      const row = async (id: string) => (await f.sql.query<AssetRow>('select * from brand_studio_assets where id = $1', [id])).rows[0]!;
      const updated = await op(owner(), 'asset.update', { organizationId: f.orgId, assetId: filed, name: 'Renamed' });
      expect(JSON.stringify(updated)).toBe(JSON.stringify({ ok: true, asset: assetView(await row(filed), deps.media) }));
      const saved = await op(owner(), 'asset.from_output', { organizationId: f.orgId, outputId: r.outputs[0] });
      if (!saved.ok || !('asset' in saved)) throw new Error(JSON.stringify(saved));
      expect(JSON.stringify(saved)).toBe(JSON.stringify({ ok: true, asset: assetView(await row((saved.asset as StudioAssetView).id), deps.media) }));
      const png = await pngBytes(80, 60);
      const reserved = await op(owner(), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'shot.png', mime: 'image/png', sizeBytes: png.byteLength });
      if (!reserved.ok || !('id' in reserved)) throw new Error(JSON.stringify(reserved));
      deps.staging.objects.set(`brand-studio/${f.orgId}/${reserved.id}`, png);
      const completed = await op(owner(), 'asset.complete', { organizationId: f.orgId, assetId: reserved.id });
      if (!completed.ok || !('asset' in completed)) throw new Error(JSON.stringify(completed));
      const { asset: _a, ...rest } = completed as { asset: StudioAssetView } & Record<string, unknown>;
      expect(JSON.stringify(completed)).toBe(JSON.stringify({ ok: true, asset: assetView(await row(reserved.id), deps.media), ...(rest.roleCheck ? { roleCheck: true } : {}) }));

      // The new reads answer what an unknown operation answers, for every caller.
      const unknown = await op(owner(), 'no.such.operation', { organizationId: f.orgId });
      for (const viewer of [owner(), viewerOf(f.ids.viewer), viewerOf(f.ids.guest), viewerOf(f.ids.outsider), staff()]) {
        expect(await op(viewer, 'project.overview', { organizationId: f.orgId })).toEqual(unknown);
        expect(await op(viewer, 'project.files', { organizationId: f.orgId, scope: { kind: 'project', brandProjectId: P } })).toEqual(unknown);
      }
    });
  }
});

/* ------------------------------------------------------- moving from the page */

describe('moving from the assets page (project.move)', () => {
  const move = (input: Record<string, unknown>, viewer = owner()) => op(viewer, 'project.move', { organizationId: f.orgId, ...input });

  it('an upload moves alone, a film moves alone, a run moves with its family and (spine rules R-A) with the library copy saved from it', async () => {
    open();
    const P = await selfProject('Target');
    const root = await run('image');
    const edit = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video_remix', parentOutputId: root.outputs[0] });
    const saved = await op(owner(), 'asset.from_output', { organizationId: f.orgId, outputId: root.outputs[0] });
    if (!saved.ok || !('asset' in saved)) throw new Error(JSON.stringify(saved));
    const copy = (saved.asset as StudioAssetView).id;
    const F = await film('Cut');
    const filedNow = async (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string) =>
      (await f.sql.query<{ brand_project_id: string | null }>(`select brand_project_id from ${table} where id = $1`, [id])).rows[0]!.brand_project_id;

    const asset = (await move({ projectId: P, assetIds: [copy] })) as StudioBrandProjectMoved;
    expect(asset).toEqual({ ok: true, projectId: P, jobIds: [], assetIds: [copy], filmIds: [] });
    expect(await filedNow('brand_studio_jobs', root.jobId)).toBeNull();

    const one = (await move({ projectId: P, filmIds: [F] })) as StudioBrandProjectMoved;
    expect(one).toEqual({ ok: true, projectId: P, jobIds: [], assetIds: [], filmIds: [F] });

    const family = (await move({ projectId: P, jobIds: [edit.jobId], preview: true })) as StudioBrandProjectMoved;
    expect([...family.jobIds].sort()).toEqual([root.jobId, edit.jobId].sort());
    // The saved copy is shown as the root's result, so it goes with the family (named apart from the uploads).
    expect(family.savedCopyIds).toEqual([copy]);
    expect(family.assetIds).toEqual([]);
    expect(await filedNow('brand_studio_jobs', root.jobId)).toBeNull();
    await move({ projectId: P, jobIds: [edit.jobId] });
    for (const id of [root.jobId, edit.jobId]) expect(await filedNow('brand_studio_jobs', id)).toBe(P);
    // Spine rules R-A: taking the run out takes the library copy with it (it used to stay where it was).
    const out = (await move({ projectId: null, jobIds: [root.jobId] })) as StudioBrandProjectMoved;
    expect(out.savedCopyIds).toEqual([copy]);
    expect(await filedNow('brand_studio_assets', copy)).toBeNull();
    // The pair shows once: the root's result (now 미분류), not the copy; P keeps the film.
    const group = (await overview()).projects.find((g) => g.project.id === P)!;
    expect(group.counts).toEqual({ image: 0, video: 0, sound: 0, upload: 0, film: 1 });
    expect(await move({ projectId: P, assetIds: [copy] }, viewerOf(f.ids.viewer))).toEqual({ ok: false, code: 'forbidden' });
  });

  it('a brand material moved into a project counts there and not as 브랜드 자료; taken out, it is 브랜드 자료 again', async () => {
    open();
    const P = await selfProject('Target');
    const logo = await upload('logo');
    const before = await overview();
    expect(before.brandMaterials).toMatchObject({ count: 1, byRole: { logo: 1 } });
    expect(ids(await allPages({ kind: 'brand_materials' }))).toEqual([`asset:${logo}`]);

    await move({ projectId: P, assetIds: [logo] });
    const inside = await overview();
    expect(inside.brandMaterials).toMatchObject({ count: 0, byRole: { logo: 0 } });
    expect(inside.projects.find((g) => g.project.id === P)!.counts.upload).toBe(1);
    expect(ids(await allPages({ kind: 'project', brandProjectId: P }, 'upload'))).toEqual([`asset:${logo}`]);
    expect(ids(await allPages({ kind: 'brand_materials' }))).toEqual([]);
    expect(ids(await allPages({ kind: 'unfiled' }))).toEqual([]);

    await move({ projectId: null, assetIds: [logo] });
    const out = await overview();
    expect(out.brandMaterials).toEqual(before.brandMaterials);
    expect(out.projects.find((g) => g.project.id === P)!.counts.upload).toBe(0);
    expect(ids(await allPages({ kind: 'brand_materials' }))).toEqual([`asset:${logo}`]);
  });
});

/* ------------------------------------------------------------ client methods */

describe('typed client methods', () => {
  it('post the two reads with the organization, and hand back the answer or a failure code', async () => {
    const { createStudioApi } = await import('@/components/brand-studio/api');
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true } };
    const api = createStudioApi({
      organizationId: 'org-1',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as never,
    });
    reply = { status: 200, body: { ok: true, projects: [], unfiled: {}, brandMaterials: {} } };
    expect((await api.loadBrandProjectOverview()).ok).toBe(true);
    await api.listBrandProjectFiles({ scope: { kind: 'project', brandProjectId: 'p-1' }, kind: 'image', cursor: 'c1' });
    expect(calls).toEqual([
      { url: '/api/brand-studio', method: 'POST', body: { operation: 'project.overview', input: { organizationId: 'org-1' } } },
      { url: '/api/brand-studio', method: 'POST', body: { operation: 'project.files', input: { organizationId: 'org-1', scope: { kind: 'project', brandProjectId: 'p-1' }, kind: 'image', cursor: 'c1' } } },
    ]);
    reply = { status: 404, body: { ok: false, code: 'not_found' } };
    expect(await api.listBrandProjectFiles({ scope: { kind: 'unfiled' } })).toEqual({ ok: false, code: 'not_found' });
    reply = { status: 400, body: { ok: false, code: 'invalid' } };
    expect(await api.loadBrandProjectOverview()).toEqual({ ok: false, code: 'invalid' });
  });
});
