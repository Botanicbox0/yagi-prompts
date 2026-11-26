import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { buildHubEntries } from '@/components/brand-studio/asset-hub-model';
import { loadRoomSummary, runRoomOperation } from '@/lib/brand-rooms/messages';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import type { SendFileThreads } from '@/lib/brand-rooms/send-contracts';
import { SHADOWED_SAVED_COPY, resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import {
  BRAND_PROJECT_LIMITS,
  type BrandProjectFileKind,
  type BrandProjectFilesScope,
  type StudioAssetView,
  type StudioBrandProject,
  type StudioBrandProjectCards,
  type StudioBrandProjectCounts,
  type StudioBrandProjectFiles,
  type StudioBrandProjectMoved,
  type StudioBrandProjectOverview,
  type StudioJobView,
  type StudioOutputView,
  type StudioState,
} from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { rememberOpenProject } from '@/lib/brand-studio/open-project';
import { loadStudioSpine } from '@/lib/brand-studio/open-project-server';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { submitUpscaleJob } from '@/lib/brand-studio/upscale';
import { runRoomNoticePass } from '@/lib/brand-rooms/notices';
import { createFakeMailer } from '@/lib/notify/mailer-fake';
import { minutesFromNow } from '../../brand-rooms/notices/helpers';
import { loadSoundStudio } from '@/lib/brand-studio/sound/load';
import { loadVideoProjects, runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { membersLine } from '../../brand-rooms/send/helpers';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * Spine rules, slice R-A (server): two founder decisions on what a workspace member sees.
 *  A. A saved result shows once: while a studio result is shown, the library copy saved from it is neither listed nor
 *     counted on the assets surfaces (groups, 미분류, 브랜드 자료, cards, `project.files`, the 모든 파일 merge); the result is
 *     the one tile. Its run's project is where it shows. Deleting the result shows the copy again; an upload with a
 *     result's bytes and post-production files are never hidden; the studio's reference rail keeps the copy;
 *     `project.move` carries the copy; `output.delete` `withSavedCopy` deletes both; `send.file` answers both references.
 *  B. Finished projects keep their files: `VISIBLE_PROJECTS` for reads, `SELECTABLE_PROJECTS` for writes. A team project
 *     the staff hid leaks nowhere. A role-tagged upload of a finished project stays 브랜드 자료 (as before).
 * Closed answers are pinned against origin/main in ./rules-ra-closed.test.ts.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', BRAND_STUDIO_MUSIC_GENERATION: 'on' };
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetSpineProbe();
  resetBrandSendProbe();
  f = await studioFixture();
  deps = studioDeps(f.sql, { env: studioEnv(ENV) });
  const switches: Array<[string, string]> = [['BRAND_SEND', 'on'], ['BRAND_ROOMS', 'on'], ['BRAND_ROOM_NOTIFY', 'on'], ['BRAND_STUDIO_V2', 'on'], ['BRAND_PROJECT_SPINE', 'on'], ['BRAND_PROJECT_SPINE_ORGS', f.orgId]];
  for (const [name, value] of switches) vi.stubEnv(name, value);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  resetBrandSendProbe();
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, viewer, operation, { organizationId: f.orgId, ...input });
const room = async (viewer: Viewer, operation: string, input: Record<string, unknown>) =>
  (await runRoomOperation({ sql: f.sql, media: deps.media }, viewer, operation, { organizationId: f.orgId, ...input })).result;

async function ok<T>(answer: Promise<unknown>): Promise<T> {
  const got = (await answer) as { ok: boolean };
  if (!got.ok) throw new Error(JSON.stringify(got));
  return got as T;
}
const overview = (filter?: 'active' | 'all') => ok<StudioBrandProjectOverview>(op(owner(), 'project.overview', filter ? { filter } : {}));
const cards = (filter?: 'active' | 'all') => ok<StudioBrandProjectCards>(op(owner(), 'project.cards', filter ? { filter } : {}));
const page = (scope: BrandProjectFilesScope, extra: { kind?: BrandProjectFileKind; cursor?: string } = {}) => ok<StudioBrandProjectFiles>(op(owner(), 'project.files', { scope, ...extra }));
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
function itemsOf(pages: StudioBrandProjectFiles[], kind: BrandProjectFileKind): number {
  let n = 0;
  for (const p of pages) {
    if (kind === 'upload') n += p.assets.length;
    else if (kind === 'film') n += p.films.length;
    else for (const job of p.jobs) if (MEDIUM[job.kind] === kind) n += job.outputs.length;
  }
  return n;
}
const idsOf = (pages: StudioBrandProjectFiles[]) => pages.flatMap((p) => p.items.map((item) => `${item.type}:${item.id}`));
const KINDS = ['image', 'video', 'sound', 'upload', 'film'] as const;

/** Every count equals the items its paged list returns, per kind and all kinds together, nothing twice. */
async function countsEqualLists(scope: BrandProjectFilesScope, counts: StudioBrandProjectCounts, label: string): Promise<void> {
  const everything = await allPages(scope);
  for (const kind of KINDS) {
    expect(itemsOf(await allPages(scope, kind), kind), `${label} ${kind}`).toBe(counts[kind]);
    expect(itemsOf(everything, kind), `${label} ${kind} (all kinds)`).toBe(counts[kind]);
  }
  const seen = idsOf(everything);
  expect(new Set(seen).size, `${label} no item twice`).toBe(seen.length);
}

async function selfProject(title: string): Promise<string> {
  return ((await ok<{ project: StudioBrandProject }>(op(owner(), 'project.create', { requestId: requestId(), title }))).project).id;
}
async function teamProject(over: { visible?: boolean; status?: string; title?: string; organizationId?: string } = {}): Promise<string> {
  const id = randomUUID();
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, $2, $3, 'A goal for the team', 'studio', $4, $5, $6, $7)`,
    [id, over.organizationId ?? f.orgId, over.title ?? 'Team work', over.status ?? 'active', over.visible ?? true, f.ids.admin, randomUUID()],
  );
  return id;
}
const setStatus = (id: string, status: string) => f.sql.query('update brand_projects set status = $2 where id = $1', [id, status]);
const fileIn = (table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string, projectId: string | null) =>
  f.sql.query(`update ${table} set brand_project_id = $2 where id = $1`, [id, projectId]);
let clock = 0;
/** Strictly increasing creation times, so "newest" never ties by accident. */
const nextTime = () => new Date(Date.UTC(2026, 10, 1, 0, 0, clock++)).toISOString();
async function stamp(table: 'brand_studio_jobs' | 'brand_studio_assets' | 'brand_studio_video_projects', id: string): Promise<void> {
  const at = nextTime();
  await f.sql.query(`update ${table} set created_at = $2 where id = $1`, [id, at]);
  if (table === 'brand_studio_jobs') await f.sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [id, at]);
}
async function run(kind: 'image' | 'video', projectId: string | null = null, organizationId = f.orgId): Promise<{ jobId: string; outputId: string }> {
  const r = await seedRun(deps, organizationId, f.ids.owner, { kind, prompt: `${kind} ${clock}` });
  await stamp('brand_studio_jobs', r.jobId);
  if (projectId) await fileIn('brand_studio_jobs', r.jobId, projectId);
  return r;
}
async function soundRun(projectId: string | null = null): Promise<{ jobId: string; outputId: string }> {
  const job = await f.sql.query<{ id: string }>(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs, finished_at)
      values ($1, $2, $3, 'music', 'succeeded', 'sunra_api', 'suno-v6', 'calm piano', false, $4::jsonb, '[]'::jsonb, now()) returning id`,
    [f.orgId, f.ids.owner, requestId(), JSON.stringify({ locale: 'ko', music: { title: 'Jingle', vocal: false, mode: 'describe', careful: false, lyrics: null } })],
  );
  const { key } = await deps.media.put(new Uint8Array([73, 68, 51, clock % 250]), 'audio/mpeg');
  const output = await f.sql.query<{ id: string }>(
    `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, duration_ms) values ($1, $2, 0, 'audio', 'ready', $3, 'audio/mpeg', 30000) returning id`,
    [job.rows[0]!.id, f.orgId, key],
  );
  await stamp('brand_studio_jobs', job.rows[0]!.id);
  if (projectId) await fileIn('brand_studio_jobs', job.rows[0]!.id, projectId);
  return { jobId: job.rows[0]!.id, outputId: output.rows[0]!.id };
}
async function upload(role: string | null = null, projectId: string | null = null): Promise<string> {
  const id = await seedImageAsset(deps, f.orgId, f.ids.owner, role ? { role } : {});
  await stamp('brand_studio_assets', id);
  if (projectId) await fileIn('brand_studio_assets', id, projectId);
  return id;
}
async function film(title: string, projectId: string | null = null): Promise<string> {
  const made = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', { organizationId: f.orgId, requestId: `vp_${randomUUID()}`, title });
  if (!made.ok || !made.project) throw new Error(JSON.stringify(made));
  await stamp('brand_studio_video_projects', made.project.id);
  if (projectId) await fileIn('brand_studio_video_projects', made.project.id, projectId);
  return made.project.id;
}
/** `asset.from_output`, the studio's own save (the copy takes its run's project). */
async function save(outputId: string, extra: { role?: string } = {}): Promise<string> {
  const saved = await ok<{ asset: StudioAssetView }>(op(owner(), 'asset.from_output', { outputId, ...extra }));
  await stamp('brand_studio_assets', saved.asset.id);
  return saved.asset.id;
}
async function state(viewer = owner()): Promise<StudioState> {
  return ok<StudioState>(loadStudioState(deps, viewer, f.orgId));
}
const filedNow = async (table: 'brand_studio_jobs' | 'brand_studio_assets', id: string) =>
  (await f.sql.query<{ brand_project_id: string | null }>(`select brand_project_id::text as brand_project_id from ${table} where id = $1`, [id])).rows[0]!.brand_project_id;
const sendFile = (file: { kind: 'output'; outputId: string } | { kind: 'asset'; assetId: string }, viewer = owner()) => room(viewer, 'send.file', { file });

/* ======================================================================== A */

describe('A. a saved result shows once, as its result', () => {
  it('every assets read and count shows the pair once; counts equal lists; the reference rail keeps the copy', async () => {
    const P = await selfProject('Spring');
    const r1 = await run('image', P);
    const s1 = await soundRun(P);
    const u1 = await upload(null, P);
    const c1 = await save(r1.outputId); // the newest file filed in P
    const c3 = await save(s1.outputId);
    const r2 = await run('image');
    const c2 = await save(r2.outputId);
    const r4 = await run('image');
    const c4 = await save(r4.outputId, { role: 'logo' }); // would be 브랜드 자료 on its own
    for (const [copy, projectId] of [[c1, P], [c3, P], [c2, null], [c4, null]] as const) expect(await filedNow('brand_studio_assets', copy)).toBe(projectId);

    const groups = await overview();
    const group = groups.projects.find((g) => g.project.id === P)!;
    expect(group.counts).toEqual({ image: 1, video: 0, sound: 1, upload: 1, film: 0 });
    expect(groups.unfiled.counts).toEqual({ image: 2, video: 0, sound: 0, upload: 0, film: 0 });
    expect(groups.brandMaterials.count).toBe(0);
    const card = (await cards()).projects.find((c) => c.project.id === P)!;
    expect(card.counts).toEqual(group.counts);
    // The newest file is the newest LISTED one: the upload, not the copy saved after it.
    expect(card.lastActivity?.item).toEqual({ type: 'asset', id: u1 });
    for (const [scope, counts] of [
      [{ kind: 'project', brandProjectId: P }, group.counts],
      [{ kind: 'unfiled' }, groups.unfiled.counts],
      [{ kind: 'brand_materials' }, { image: 0, video: 0, sound: 0, upload: groups.brandMaterials.count, film: 0 }],
    ] as Array<[BrandProjectFilesScope, StudioBrandProjectCounts]>) {
      await countsEqualLists(scope, counts, JSON.stringify(scope));
      const listed = idsOf(await allPages(scope));
      for (const copy of [c1, c2, c3, c4]) expect(listed).not.toContain(`asset:${copy}`);
    }
    expect(idsOf(await allPages({ kind: 'project', brandProjectId: P })).sort()).toEqual([`job:${r1.jobId}`, `job:${s1.jobId}`, `asset:${u1}`].sort());

    // The studio's reference rail (the state's library) keeps every copy, each saying which result it was saved from.
    const st = await state();
    const rail = new Map(st.assets.map((a) => [a.id, a]));
    for (const [copy, output] of [[c1, r1.outputId], [c2, r2.outputId], [c3, s1.outputId], [c4, r4.outputId]] as const) expect(rail.get(copy)?.sourceOutputId).toBe(output);
    expect(rail.get(u1)!.sourceOutputId).toBeUndefined();
    // 모든 파일 (the state merged): the results are the tiles; the sound copy stays (the state never lists sound runs).
    const keys = buildHubEntries(st.assets, st.jobs, 'Made').map((e) => e.key);
    for (const copy of [c1, c2, c4]) expect(keys).not.toContain(`a:${copy}`);
    for (const output of [r1.outputId, r2.outputId, r4.outputId]) expect(keys).toContain(`o:${output}`);
    expect(keys).toContain(`a:${c3}`);
    expect(keys).toContain(`a:${u1}`);
  });

  it('deleting the result, or removing its run, shows the copy on its own again', async () => {
    const P = await selfProject('Spring');
    const r1 = await run('image', P);
    const c1 = await save(r1.outputId);
    const r2 = await run('image');
    const c2 = await save(r2.outputId);
    expect((await overview()).projects.find((g) => g.project.id === P)!.counts.upload).toBe(0);

    expect(await op(owner(), 'output.delete', { outputId: r1.outputId })).toEqual({ ok: true });
    const after = await overview();
    expect(after.projects.find((g) => g.project.id === P)!.counts).toEqual({ image: 0, video: 0, sound: 0, upload: 1, film: 0 });
    expect(idsOf(await allPages({ kind: 'project', brandProjectId: P }))).toEqual([`asset:${c1}`]);
    // A run a member removed (`deleted_at`; job.delete removes only failed or cancelled runs, so it is written here).
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [r2.jobId]);
    const unfiled = await overview();
    expect(unfiled.unfiled.counts).toEqual({ image: 0, video: 0, sound: 0, upload: 1, film: 0 });
    expect(idsOf(await allPages({ kind: 'unfiled' }))).toEqual([`asset:${c2}`]);
    const st = await state();
    const keys = buildHubEntries(st.assets, st.jobs, 'Made').map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining([`a:${c1}`, `a:${c2}`]));
  });

  it('a genuine upload with a result’s very bytes, and post-production files with no result behind them, still show', async () => {
    const P = await selfProject('Spring');
    const u = await upload(null, P);
    const r = await run('image', P);
    const sha = (await f.sql.query<{ sha256: string }>('select sha256 from brand_studio_assets where id = $1', [u])).rows[0]!.sha256;
    await f.sql.query('update brand_studio_outputs set sha256 = $2 where id = $1', [r.outputId, sha]);
    // Saving the result finds the upload by its bytes and links to it: it stays an upload, never shadowed.
    expect(await save(r.outputId)).toBe(u);
    const post = await upload(null, P);
    await f.sql.query("update brand_studio_assets set source = 'generation' where id = $1", [post]);
    const group = (await overview()).projects.find((g) => g.project.id === P)!;
    expect(group.counts).toEqual({ image: 1, video: 0, sound: 0, upload: 2, film: 0 });
    await countsEqualLists({ kind: 'project', brandProjectId: P }, group.counts, 'P');
    const st = await state();
    const keys = buildHubEntries(st.assets, st.jobs, 'Made').map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining([`a:${u}`, `a:${post}`, `o:${r.outputId}`]));
    // Neither carries `sourceOutputId`.
    for (const id of [u, post]) expect(st.assets.find((a) => a.id === id)!.sourceOutputId).toBeUndefined();
  });

  it('a copy filed apart from its run (drift) shows once, in the run’s project; nothing is rewritten', async () => {
    const P = await selfProject('Run here');
    const Q = await selfProject('Copy there');
    const r = await run('image', P);
    const c = await save(r.outputId);
    // Moving the copy alone is allowed, as before: the copy drifts to Q.
    expect(await op(owner(), 'project.move', { projectId: Q, assetIds: [c] })).toEqual({ ok: true, projectId: Q, jobIds: [], assetIds: [c], filmIds: [] });
    const groups = await overview();
    expect(groups.projects.find((g) => g.project.id === P)!.counts.image).toBe(1);
    expect(groups.projects.find((g) => g.project.id === Q)!.counts.upload).toBe(0);
    expect(idsOf(await allPages({ kind: 'project', brandProjectId: Q }))).toEqual([]);
    expect(await filedNow('brand_studio_assets', c)).toBe(Q);
    expect((await state()).assets.find((a) => a.id === c)!.brandProjectId).toBe(Q);
  });

  it('project.move moves the pair and the threads of both references, in one transaction', async () => {
    const P = await selfProject('From');
    const Q = await selfProject('To');
    const r = await run('image', P);
    const c = await save(r.outputId);
    const onResult = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.editor, body: 'On the result', file: { kind: 'output', id: r.outputId } });
    const onCopy = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.editor, body: 'On the copy', file: { kind: 'asset', id: c } });
    const preview = await ok<StudioBrandProjectMoved>(op(owner(), 'project.move', { projectId: Q, jobIds: [r.jobId], preview: true }));
    expect(preview).toEqual({ ok: true, projectId: Q, jobIds: [r.jobId], assetIds: [], filmIds: [], savedCopyIds: [c] });
    expect(await filedNow('brand_studio_assets', c)).toBe(P);
    expect(await ok(op(owner(), 'project.move', { projectId: Q, jobIds: [r.jobId] }))).toEqual(preview);
    expect(await filedNow('brand_studio_assets', c)).toBe(Q);
    const channels = (await f.sql.query<{ id: string; channel: string }>('select id::text as id, channel from brand_room_messages where id = any($1::uuid[])', [[onResult, onCopy]])).rows;
    for (const row of channels) expect(row.channel).toBe(`members:${Q}`);
    // Named in the request too: it is one of `assetIds`, not of `savedCopyIds`.
    expect(await ok(op(owner(), 'project.move', { projectId: P, jobIds: [r.jobId], assetIds: [c] }))).toEqual({ ok: true, projectId: P, jobIds: [r.jobId], assetIds: [c], filmIds: [] });
    // A copy whose result is gone is not shadowed: it does not follow the run.
    await op(owner(), 'output.delete', { outputId: r.outputId });
    expect(await ok(op(owner(), 'project.move', { projectId: Q, jobIds: [r.jobId] }))).toEqual({ ok: true, projectId: Q, jobIds: [r.jobId], assetIds: [], filmIds: [] });
    expect(await filedNow('brand_studio_assets', c)).toBe(P);
  });

  it('output.delete withSavedCopy deletes the pair; without it only the result; refusals as asset.delete’s', async () => {
    const P = await selfProject('Spring');
    const gone = async (table: 'brand_studio_assets' | 'brand_studio_outputs', id: string) =>
      (await f.sql.query<{ gone: boolean }>(`select deleted_at is not null as gone from ${table} where id = $1`, [id])).rows[0]!.gone;
    const r1 = await run('image', P);
    const c1 = await save(r1.outputId);
    const key = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_outputs where id = $1', [r1.outputId])).rows[0]!.storage_key;
    // Refusals first: malformed (a member), a viewer, people who are not members; nothing deleted.
    expect(await op(owner(), 'output.delete', { outputId: r1.outputId, withSavedCopy: 'yes' })).toEqual({ ok: false, code: 'invalid' });
    expect(await op(viewerOf(f.ids.viewer), 'output.delete', { outputId: r1.outputId, withSavedCopy: true })).toEqual({ ok: false, code: 'forbidden' });
    for (const who of [viewerOf(f.ids.outsider), staff()]) expect(await op(who, 'output.delete', { outputId: r1.outputId, withSavedCopy: 'yes' })).toEqual({ ok: false, code: 'not_found' });
    // An open run that uses the copy: the whole call is refused, as asset.delete refuses the copy.
    const user = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', status: 'queued', refs: [{ assetId: c1 }] as never });
    expect(await op(owner(), 'output.delete', { outputId: r1.outputId, withSavedCopy: true })).toEqual({ ok: false, code: 'conflict' });
    expect(await op(owner(), 'asset.delete', { assetId: c1 })).toEqual({ ok: false, code: 'conflict' });
    expect([await gone('brand_studio_outputs', r1.outputId), await gone('brand_studio_assets', c1)]).toEqual([false, false]);
    await f.sql.query("update brand_studio_jobs set status = 'succeeded', finished_at = now() where id = $1", [user.jobId]);
    // Now both go, in one call, and the file is no longer stored.
    expect(await op(owner(), 'output.delete', { outputId: r1.outputId, withSavedCopy: true })).toEqual({ ok: true, savedCopyId: c1 });
    expect([await gone('brand_studio_outputs', r1.outputId), await gone('brand_studio_assets', c1)]).toEqual([true, true]);
    expect((await f.sql.query('select 1 from brand_studio_outputs where saved_asset_id = $1', [c1])).rows).toEqual([]);
    expect(deps.media.objects.has(key)).toBe(false);
    expect((await overview()).projects.find((g) => g.project.id === P)!.counts.upload).toBe(0);

    // Without the flag: the result alone, and the copy shows on its own.
    const r2 = await run('image', P);
    const c2 = await save(r2.outputId);
    expect(await op(owner(), 'output.delete', { outputId: r2.outputId, withSavedCopy: false })).toEqual({ ok: true });
    expect(await gone('brand_studio_assets', c2)).toBe(false);
    expect(idsOf(await allPages({ kind: 'project', brandProjectId: P }))).toContain(`asset:${c2}`);

    // A result saved onto an upload (same bytes): the flag never touches the upload.
    const u = await upload(null, P);
    const r3 = await run('image', P);
    const sha = (await f.sql.query<{ sha256: string }>('select sha256 from brand_studio_assets where id = $1', [u])).rows[0]!.sha256;
    await f.sql.query('update brand_studio_outputs set sha256 = $2 where id = $1', [r3.outputId, sha]);
    expect(await save(r3.outputId)).toBe(u);
    expect(await op(owner(), 'output.delete', { outputId: r3.outputId, withSavedCopy: true })).toEqual({ ok: true });
    expect(await gone('brand_studio_assets', u)).toBe(false);
  });

  it('a result linked by equal bytes to ANOTHER result’s saved copy neither deletes nor carries that copy', async () => {
    const P = await selfProject('From');
    const Q = await selfProject('To');
    const a = await run('image', P);
    const b = await run('image', P);
    const sha = 'ab'.repeat(32);
    await f.sql.query('update brand_studio_outputs set sha256 = $2 where id = any($1::uuid[])', [[a.outputId, b.outputId], sha]);
    const copy = await save(a.outputId);
    // Saving B finds A's copy by its bytes and links to it (B never got a copy of its own).
    expect(await save(b.outputId)).toBe(copy);
    const linked = (await f.sql.query<{ id: string; saved: string | null }>('select id::text as id, saved_asset_id::text as saved from brand_studio_outputs where id = any($1::uuid[]) order by id', [[a.outputId, b.outputId]])).rows;
    expect(linked.every((row) => row.saved === copy)).toBe(true);
    // Moving B's run does not carry A's copy; deleting B with the flag does not delete it.
    expect(await ok(op(owner(), 'project.move', { projectId: Q, jobIds: [b.jobId] }))).toEqual({ ok: true, projectId: Q, jobIds: [b.jobId], assetIds: [], filmIds: [] });
    expect(await filedNow('brand_studio_assets', copy)).toBe(P);
    expect(await op(owner(), 'output.delete', { outputId: b.outputId, withSavedCopy: true })).toEqual({ ok: true });
    expect((await f.sql.query<{ gone: boolean }>('select deleted_at is not null as gone from brand_studio_assets where id = $1', [copy])).rows[0]!.gone).toBe(false);
    expect((await f.sql.query<{ saved: string | null }>('select saved_asset_id::text as saved from brand_studio_outputs where id = $1', [a.outputId])).rows[0]!.saved).toBe(copy);
    // A's own: carried and deleted as the pair.
    expect((await ok<StudioBrandProjectMoved>(op(owner(), 'project.move', { projectId: Q, jobIds: [a.jobId], preview: true }))).savedCopyIds).toEqual([copy]);
    expect(await op(owner(), 'output.delete', { outputId: a.outputId, withSavedCopy: true })).toEqual({ ok: true, savedCopyId: copy });
  });

  it('send.file by either reference answers both references’ threads, each once, newest first, with the result’s card', async () => {
    const P = await selfProject('Spring');
    const r = await run('image', P);
    const c = await save(r.outputId);
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute)).toISOString();
    const t1 = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.editor, body: 'First, on the result', file: { kind: 'output', id: r.outputId }, at: at(1) });
    const t2 = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.viewer, body: 'Then on the copy', file: { kind: 'asset', id: c }, at: at(2) });
    const t3 = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.owner, body: 'Last, on the result', file: { kind: 'output', id: r.outputId }, at: at(3) });
    await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.editor, body: 'A reply', file: { kind: 'output', id: r.outputId }, parentId: t1, at: at(4) });
    for (const viewer of [owner(), viewerOf(f.ids.editor), viewerOf(f.ids.viewer)]) {
      for (const ref of [{ kind: 'output', outputId: r.outputId }, { kind: 'asset', assetId: c }] as const) {
        const answer = (await sendFile(ref, viewer)) as SendFileThreads;
        expect(answer.ok).toBe(true);
        // t1's reply is the newest line, but roots are listed newest root first (as before).
        expect(answer.threads.map((t) => t.rootId)).toEqual([t3, t2, t1]);
        expect(answer.file).toMatchObject({ ref: { kind: 'output', outputId: r.outputId }, available: true, kind: 'image', name: null, project: { id: P, title: 'Spring' } });
      }
    }
    // The result deleted: the copy's card, still both lists.
    await op(owner(), 'output.delete', { outputId: r.outputId });
    for (const ref of [{ kind: 'output', outputId: r.outputId }, { kind: 'asset', assetId: c }] as const) {
      const answer = (await sendFile(ref)) as SendFileThreads;
      expect(answer.threads.map((t) => t.rootId)).toEqual([t3, t2, t1]);
      expect(answer.file).toMatchObject({ ref: { kind: 'asset', assetId: c }, available: true, name: expect.any(String), project: { id: P, title: 'Spring' } });
    }
    // The usual refusals: people who are not members, made-up and other organizations' files.
    for (const who of [viewerOf(f.ids.guest), viewerOf(f.ids.outsider), staff()]) {
      expect(await sendFile({ kind: 'asset', assetId: c }, who)).toEqual({ ok: false, code: 'not_found' });
    }
    expect(await sendFile({ kind: 'output', outputId: randomUUID() })).toEqual({ ok: false, code: 'not_found' });
    const other = randomUUID();
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [other, 'Other brand', f.ids.owner, randomUUID()]);
    const theirs = await run('image', null, other);
    expect(await sendFile({ kind: 'output', outputId: theirs.outputId })).toEqual({ ok: false, code: 'not_found' });
    // An unsaved result and a plain upload: exactly one list, as before.
    const lone = await run('image', P);
    const t4 = await membersLine(f.sql, { organizationId: f.orgId, projectId: P, authorId: f.ids.editor, body: 'Alone', file: { kind: 'output', id: lone.outputId } });
    expect(((await sendFile({ kind: 'output', outputId: lone.outputId })) as SendFileThreads).threads.map((t) => t.rootId)).toEqual([t4]);
  });

  it('buildHubEntries hides a copy only beside its own linked result, and only when the view carries sourceOutputId', () => {
    const output = (id: string, savedAssetId: string | null): StudioOutputView => ({ id, jobId: 'j1', kind: 'image', url: `/o/${id}`, thumbUrl: null, width: 1, height: 1, seconds: null, draft: false, savedAssetId, createdAt: '2026-11-20T09:00:00.000Z' });
    const job = (outputs: StudioOutputView[]): StudioJobView => ({ id: 'j1', kind: 'image', prompt: 'p', outputs, parentOutputId: null } as unknown as StudioJobView);
    const asset = (id: string, extra: Partial<StudioAssetView> = {}): StudioAssetView => ({ id, kind: 'image', role: null, name: 'n', tags: [], url: `/a/${id}`, thumbUrl: null, width: 1, height: 1, seconds: null, source: 'generation', createdAt: '2026-11-20T09:00:01.000Z', ...extra });
    const keys = (assets: StudioAssetView[], outputs: StudioOutputView[]) => buildHubEntries(assets, [job(outputs)], 'Made').map((e) => e.key).sort();
    // Linked both ways, the result merged here: one tile.
    expect(keys([asset('a1', { sourceOutputId: 'o1' })], [output('o1', 'a1')])).toEqual(['o:o1']);
    // No sourceOutputId (spine closed, a guest, MCP): exactly as before.
    expect(keys([asset('a1')], [output('o1', 'a1')])).toEqual(['a:a1', 'o:o1']);
    // An upload linked by its bytes, a result not merged here, a link one way only: never hidden.
    expect(keys([asset('a1', { source: 'upload', sourceOutputId: 'o1' })], [output('o1', 'a1')])).toEqual(['a:a1', 'o:o1']);
    expect(keys([asset('a1', { sourceOutputId: 'o9' })], [output('o1', 'a1')])).toEqual(['a:a1', 'o:o1']);
    expect(keys([asset('a1', { sourceOutputId: 'o1' })], [output('o1', 'a2')])).toEqual(['a:a1', 'o:o1']);
  });
});

/* ======================================================================== B */

const KINDS_OF_PROJECT = [
  ['self active', 'self', 'active', true],
  ['self archived', 'self', 'completed', true],
  ['team requested', 'team', 'requested', true],
  ['team active', 'team', 'active', true],
  ['team completed', 'team', 'completed', true],
  ['team cancelled', 'team', 'cancelled', true],
  ['hidden requested', 'team', 'requested', false],
  ['hidden active', 'team', 'active', false],
  ['hidden completed', 'team', 'completed', false],
  ['hidden cancelled', 'team', 'cancelled', false],
] as const;
type Place = 'project' | 'unfiled' | 'materials';
const FILE_KINDS = ['image', 'video', 'sound', 'upload', 'role upload', 'film'] as const;

interface MatrixProject {
  label: string;
  id: string;
  title: string;
  selectable: boolean;
  visible: boolean;
  status: 'open' | 'completed' | 'cancelled' | 'archived';
  files: Record<(typeof FILE_KINDS)[number], { ref: string; place: Place; job?: { jobId: string; outputId: string } }>;
}

/** One organization with every kind of project, each holding one file of every kind, and a thread on two of them. */
async function matrixWorld(): Promise<MatrixProject[]> {
  const projects: MatrixProject[] = [];
  for (const [label, origin, status, visible] of KINDS_OF_PROJECT) {
    const title = `Matrix ${label}`;
    let id: string;
    if (origin === 'self') {
      id = await selfProject(title);
      if (status !== 'active') await setStatus(id, status);
    } else id = await teamProject({ title, status, visible });
    const selectable = visible && (origin === 'self' ? status === 'active' : status === 'requested' || status === 'active');
    const finishedStatus = origin === 'self' ? 'archived' : status === 'cancelled' ? 'cancelled' : 'completed';
    const image = await run('image', id);
    const video = await run('video', id);
    const sound = await soundRun(id);
    const plain = await upload(null, id);
    const role = await upload('product', id);
    const cut = await film(`Cut ${label}`, id);
    const place = (kind: (typeof FILE_KINDS)[number]): Place => (kind === 'role upload' ? (selectable ? 'project' : 'materials') : visible ? 'project' : 'unfiled');
    projects.push({
      label,
      id,
      title,
      selectable,
      visible,
      status: selectable ? 'open' : finishedStatus,
      files: {
        image: { ref: `job:${image.jobId}`, place: place('image'), job: image },
        video: { ref: `job:${video.jobId}`, place: place('video'), job: video },
        sound: { ref: `job:${sound.jobId}`, place: place('sound'), job: sound },
        upload: { ref: `asset:${plain}`, place: place('upload') },
        'role upload': { ref: `asset:${role}`, place: place('role upload') },
        film: { ref: `film:${cut}`, place: place('film') },
      },
    });
    // Threads the owner is named in: on the image result and on the role-tagged upload.
    for (const file of [{ kind: 'output', id: image.outputId }, { kind: 'asset', id: role }] as const) {
      await membersLine(f.sql, { organizationId: f.orgId, projectId: id, authorId: f.ids.editor, body: `About ${label}`, file, mentions: [f.ids.owner], at: nextTime() });
    }
  }
  return projects;
}

describe('B. finished projects keep their files; a hidden team project leaks nowhere', () => {
  it('the matrix: project kind × status × file kind × read', async () => {
    const world = await matrixWorld();
    const fixture = f.projectId; // the fixture's team project: requested and shown, empty
    const open = world.filter((p) => p.selectable);
    const visible = world.filter((p) => p.visible);
    const hidden = world.filter((p) => !p.visible);
    const finished = world.filter((p) => p.visible && !p.selectable);
    const where = (place: Place) => world.flatMap((p) => Object.values(p.files).filter((file) => file.place === place).map((file) => file.ref)).sort();
    const inProject = (p: MatrixProject) => Object.values(p.files).filter((file) => file.place === 'project').map((file) => file.ref).sort();
    const countsOf = (p: MatrixProject): StudioBrandProjectCounts => ({
      image: p.files.image.place === 'project' ? 1 : 0,
      video: p.files.video.place === 'project' ? 1 : 0,
      sound: p.files.sound.place === 'project' ? 1 : 0,
      upload: (p.files.upload.place === 'project' ? 1 : 0) + (p.files['role upload'].place === 'project' ? 1 : 0),
      film: p.files.film.place === 'project' ? 1 : 0,
    });
    const sum = (list: MatrixProject[]): StudioBrandProjectCounts =>
      list.map(countsOf).reduce((a, b) => ({ image: a.image + b.image, video: a.video + b.video, sound: a.sound + b.sound, upload: a.upload + b.upload, film: a.film + b.film }), { image: 0, video: 0, sound: 0, upload: 0, film: 0 });

    // Cards and groups: which projects each view lists, with which marks and counts.
    const sets = {
      none: [...open.map((p) => p.id), fixture].sort(),
      active: [...open.map((p) => p.id), fixture].sort(),
      all: [...visible.map((p) => p.id), fixture].sort(),
    };
    for (const filter of [undefined, 'active', 'all'] as const) {
      const label = filter ?? 'none';
      const groups = await overview(filter);
      const homes = await cards(filter);
      expect(groups.projects.map((g) => g.project.id).sort(), `overview ${label}`).toEqual(sets[label]);
      expect(homes.projects.map((c) => c.project.id), `cards ${label}`).toEqual(groups.projects.map((g) => g.project.id));
      for (const p of world.filter((one) => sets[label].includes(one.id))) {
        const group = groups.projects.find((g) => g.project.id === p.id)!;
        const card = homes.projects.find((c) => c.project.id === p.id)!;
        expect(group.counts, `${label} ${p.label}`).toEqual(countsOf(p));
        expect(card.counts, `${label} ${p.label}`).toEqual(countsOf(p));
        if (filter) {
          expect({ status: group.status, selectable: group.selectable }, `${label} ${p.label}`).toEqual({ status: p.status, selectable: p.selectable });
          expect({ status: card.status, selectable: card.selectable }, `${label} ${p.label}`).toEqual({ status: p.status, selectable: p.selectable });
        } else {
          expect(Object.keys(group).sort()).toEqual(['counts', 'covers', 'project']);
          expect(Object.keys(card).sort()).toEqual(['counts', 'covers', 'lastActivity', 'project', 'stage', 'unread']);
        }
        // The newest file is the first item project.files lists for it.
        const first = (await page({ kind: 'project', brandProjectId: p.id })).items[0];
        expect(card.lastActivity?.item, `${label} ${p.label}`).toEqual(first);
      }
      // 미분류 and 브랜드 자료 are the same in every view.
      expect(groups.unfiled.counts, label).toEqual({ image: hidden.length, video: hidden.length, sound: hidden.length, upload: hidden.length, film: hidden.length });
      expect(groups.brandMaterials.count, label).toEqual(hidden.length + finished.length);
      expect(homes.unfiled).toEqual(groups.unfiled);
      // The overview always says how many files are in finished projects (they left 미분류).
      expect(groups.finished, label).toEqual({ counts: sum(finished) });
      if (filter) {
        expect(groups.totals, label).toEqual({ active: open.length + 1, all: visible.length + 1 });
        expect(homes.totals, label).toEqual(groups.totals);
      } else {
        expect(Object.keys(groups).sort()).toEqual(['brandMaterials', 'finished', 'ok', 'projects', 'unfiled']);
        expect(Object.keys(homes).sort()).toEqual(['ok', 'projects', 'unfiled']);
      }
    }

    // project.files: a visible project opens with exactly its files; a hidden one is not_found.
    for (const p of visible) expect(idsOf(await allPages({ kind: 'project', brandProjectId: p.id })).sort(), p.label).toEqual(inProject(p));
    for (const p of hidden) expect(await op(owner(), 'project.files', { scope: { kind: 'project', brandProjectId: p.id } }), p.label).toEqual({ ok: false, code: 'not_found' });
    expect(idsOf(await allPages({ kind: 'unfiled' })).sort()).toEqual(where('unfiled'));
    expect(idsOf(await allPages({ kind: 'brand_materials' })).sort()).toEqual(where('materials'));

    // Counts equal lists in every cell of the 'all' view.
    const all = await overview('all');
    for (const group of all.projects) await countsEqualLists({ kind: 'project', brandProjectId: group.project.id }, group.counts, group.project.title);
    await countsEqualLists({ kind: 'unfiled' }, all.unfiled.counts, 'unfiled');
    await countsEqualLists({ kind: 'brand_materials' }, { image: 0, video: 0, sound: 0, upload: all.brandMaterials.count, film: 0 }, 'materials');

    // The views' brandProjectId. The studio's answers (the state, the sound page, the films: what the studio walls, the
    // reference rail and 모든 파일 read) keep origin/main's rule (follow-up 1): the project while it can take work, else null,
    // so a finished project's files stay on the studio's 미분류 walls. The assets page's pages say where the file is shown.
    const st = await state();
    const sound = await loadSoundStudio(f.sql, deps.media, deps.env, f.orgId, f.ids.owner, { member: true });
    const listedFilms = await loadVideoProjects({ sql: f.sql, media: deps.media }, owner(), f.orgId);
    if (!listedFilms.ok) throw new Error(listedFilms.code);
    const pages = [
      ...(await Promise.all(visible.map((p) => allPages({ kind: 'project', brandProjectId: p.id })))).flat(),
      ...(await allPages({ kind: 'unfiled' })),
      ...(await allPages({ kind: 'brand_materials' })),
    ];
    for (const p of world) {
      for (const kind of FILE_KINDS) {
        const file = p.files[kind];
        const [type, id] = file.ref.split(':') as [string, string];
        const studioView =
          type === 'job'
            ? (kind === 'sound' ? sound.jobs : st.jobs).find((j) => j.id === id)
            : type === 'asset'
              ? st.assets.find((a) => a.id === id)
              : listedFilms.projects.find((x) => x.id === id);
        expect(studioView?.brandProjectId, `${p.label} ${kind} (studio)`).toBe(p.selectable ? p.id : null);
        const pageView = type === 'job' ? pages.flatMap((x) => x.jobs).find((j) => j.id === id) : type === 'asset' ? pages.flatMap((x) => x.assets).find((a) => a.id === id) : pages.flatMap((x) => x.films).find((x) => x.id === id);
        expect(pageView?.brandProjectId, `${p.label} ${kind} (assets page)`).toBe(file.place === 'project' ? p.id : null);
      }
    }

    // 보내기: the file card's project and the bell row's label say the same (the role-tagged upload of a finished project: none).
    const bell = await loadRoomSummary({ sql: f.sql }, owner(), f.orgId, { bell: { media: deps.media } });
    if (!bell.ok || !bell.bell) throw new Error(JSON.stringify(bell));
    for (const p of world) {
      for (const [kind, ref] of [['image', { kind: 'output', outputId: p.files.image.job!.outputId }], ['role upload', { kind: 'asset', assetId: p.files['role upload'].ref.split(':')[1]! }]] as const) {
        const expected = p.files[kind].place === 'project' ? { id: p.id, title: p.title } : null;
        const answer = (await sendFile(ref)) as SendFileThreads;
        expect(answer.file.project, `${p.label} ${kind}`).toEqual(expected);
        const rootId = answer.threads[0]!.rootId;
        const line = bell.bell.items.find((item) => item.id === `thread:${rootId}`)!;
        expect({ projectId: line.projectId, projectTitle: line.projectTitle }, `${p.label} ${kind} bell`).toEqual({ projectId: expected?.id ?? null, projectTitle: expected?.title ?? null });
      }
    }

    // Nothing of a hidden project, by id or title, in any member read.
    const everything = JSON.stringify([
      await overview(),
      await overview('active'),
      await overview('all'),
      await cards(),
      await cards('all'),
      st,
      sound.jobs,
      listedFilms,
      bell,
      ...(await Promise.all(visible.map((p) => allPages({ kind: 'project', brandProjectId: p.id })))),
      await allPages({ kind: 'unfiled' }),
      await allPages({ kind: 'brand_materials' }),
      await room(owner(), 'send.inbox', {}),
    ]);
    for (const p of hidden) {
      expect(everything, p.label).not.toContain(p.id);
      expect(everything, p.label).not.toContain(p.title);
    }
  });

  it('writes keep SELECTABLE_PROJECTS: a finished project takes no new work and is no move target; moving out is allowed', async () => {
    const done = await teamProject({ status: 'completed', title: 'Done' });
    const archived = await selfProject('Archived');
    await setStatus(archived, 'completed');
    const loose = await run('image');
    const up = await upload();
    for (const P of [done, archived]) {
      expect(await op(owner(), 'project.move', { projectId: P, jobIds: [loose.jobId] })).toEqual({ ok: false, code: 'not_found' });
      expect(await op(owner(), 'asset.reserve', { requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 10, brandProjectId: P })).toEqual({ ok: false, code: 'not_found' });
      expect((await ok<{ projects: StudioBrandProject[] }>(op(owner(), 'project.list', {}))).projects.some((p) => p.id === P)).toBe(false);
      const inside = await run('image', P);
      expect(await op(owner(), 'project.move', { projectId: null, jobIds: [inside.jobId], assetIds: [up] })).toMatchObject({ ok: true, projectId: null });
    }
  });

  it('the studio does not open a finished project: by address or remembered, it resolves to 미분류 with the gone notice', async () => {
    const archived = await selfProject('Archived');
    await setStatus(archived, 'completed');
    const done = await teamProject({ status: 'completed', title: 'Done' });
    for (const P of [archived, done]) {
      const byAddress = await loadStudioSpine({ sql: f.sql, viewer: owner(), organizationId: f.orgId, seat: { staff: false, role: 'owner' }, queryProject: P, cookieRaw: null, deps });
      expect(byAddress).toMatchObject({ open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'address' });
      const cookie = rememberOpenProject({}, f.orgId, { kind: 'project', id: P });
      const remembered = await loadStudioSpine({ sql: f.sql, viewer: owner(), organizationId: f.orgId, seat: { staff: false, role: 'owner' }, cookieRaw: cookie, deps });
      expect(remembered).toMatchObject({ open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'cookie' });
    }
  });
});

/* ===================================================================== cost */

describe('cost', () => {
  const recorded = async (operation: string, input: Record<string, unknown>): Promise<string[]> => {
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(text.replace(/\s+/g, ' ').trim());
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    const answer = await runStudioOperation({ ...deps, sql: wrap(f.sql) }, owner(), operation, { organizationId: f.orgId, ...input });
    expect(answer.ok).toBe(true);
    return texts;
  };

  it('the filtered views ask a fixed number of statements whatever the number of projects, finished ones included', async () => {
    const add = async (i: number) => {
      const P = i % 3 === 0 ? await teamProject({ title: `Team ${i}`, status: i % 2 ? 'completed' : 'active' }) : await selfProject(`Own ${i}`);
      if (i % 3 === 1) await setStatus(P, 'completed');
      const r = await run('image', P);
      await save(r.outputId);
      await upload(i % 2 ? 'logo' : null, P);
    };
    await add(0);
    await upload('logo'); // 브랜드 자료 is not empty from the start (its entries' shown project is one statement)
    await overview('all');
    await cards('all');
    const few = { overview: (await recorded('project.overview', { filter: 'all' })).length, cards: (await recorded('project.cards', { filter: 'all' })).length };
    for (let i = 1; i < 10; i += 1) await add(i);
    expect((await recorded('project.overview', { filter: 'all' })).length).toBe(few.overview);
    expect((await recorded('project.cards', { filter: 'all' })).length).toBe(few.cards);
    // A named filter costs exactly one statement more than none (the two views' sizes).
    expect((await recorded('project.overview', { filter: 'active' })).length).toBe((await recorded('project.overview', {})).length + 1);
  });

  it('the saved-result rule adds no scan: each entry is checked through two primary keys', async () => {
    const P = await selfProject('Plan');
    const r = await run('image', P);
    await save(r.outputId);
    // A few hundred results in the organization, so the planner chooses by real numbers (the tables are tiny otherwise).
    await f.sql.query(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs, finished_at)
        select $1, $2, 'bulk_' || lpad(g::text, 8, '0'), 'image', 'succeeded', 'sunra_api', 'seedream-5.5', '', true, '{}'::jsonb, '[]'::jsonb, now() from generate_series(1, 400) g`,
      [f.orgId, f.ids.owner],
    );
    await f.sql.query(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, width, height)
        select j.id, j.organization_id, 0, 'image', 'ready', 'st/' || md5(j.id::text) || md5(j.request_id) || '.png', 'image/png', 1, 1
          from brand_studio_jobs j where j.organization_id = $1 and j.request_id like 'bulk\_%'`,
      [f.orgId],
    );
    for (const table of ['brand_studio_jobs', 'brand_studio_outputs', 'brand_studio_assets']) await f.sql.query(`analyze ${table}`);
    // With the planner's own settings: an `exists` here was turned into a hashed subplan over the whole results and runs
    // tables; the scalar form is probed by key, whatever the planner prefers.
    const explain = (await f.sql.query(
      `explain select count(*) from brand_studio_assets a where a.organization_id = $1 and a.status = 'ready' and a.deleted_at is null and not ${SHADOWED_SAVED_COPY('a')}`,
      [f.orgId],
    )).rows.map((row) => Object.values(row as Record<string, unknown>)[0] as string);
    const text = explain.join(String.fromCharCode(10));
    expect(text).toContain('Index Scan using brand_studio_outputs_pkey on brand_studio_outputs so');
    expect(text).toContain('Index Scan using brand_studio_jobs_pkey on brand_studio_jobs sr');
    expect(text).not.toMatch(/Seq Scan on brand_studio_(outputs|jobs)|hashed SubPlan/);
    expect(BRAND_PROJECT_LIMITS.listMax).toBe(100);
  });
});

/* =========================================================== client methods */

describe('C. the studio wall keeps origin/main’s rule (follow-up 1)', () => {
  it('runs of a finished project, and every run made from one of its results, stay on the studio’s 미분류 wall; the assets page keeps them in the project', async () => {
    const F = await selfProject('Finishing');
    // Made while it is open: a picture run, a 720p clip and a draft clip.
    const picture = await ok<{ job: StudioJobView }>(op(owner(), 'job.create', { requestId: requestId(), kind: 'image', model: 'seedream-5.5', prompt: 'a glass bottle', aspect: '1:1', resolution: '2K', count: 1, brandProjectId: F }));
    await advanceStudioJobsWith(deps, { jobIds: [picture.job.id] });
    const pictureOutput = (await state()).jobs.find((j) => j.id === picture.job.id)!.outputs[0]!.id;
    const clip = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video', prompt: 'a bottle turns', params: { audio: 'ambient', resolution: '720p' } as never, seconds: 6 });
    const draft = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video', prompt: 'slow push in', params: { resolution: 'draft', seconds: 5 } as never, seconds: 5, isDraft: true });
    for (const id of [clip.jobId, draft.jobId]) await fileIn('brand_studio_jobs', id, F);
    await setStatus(F, 'completed'); // archived: it takes no new work now
    const loose = await run('image');

    // Made from its results afterwards: each keeps the family's project (B.4, kept as today).
    const edit = await ok<{ job: StudioJobView }>(op(owner(), 'job.create', { requestId: requestId(), kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { outputId: pictureOutput }, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }));
    const version = await ok<{ job: StudioJobView }>(op(owner(), 'job.create', { requestId: requestId(), kind: 'video_revise', outputId: clip.outputId, mode: 'edit', prompt: '병을 파란색으로', references: [] }));
    const final = await ok<{ job: StudioJobView }>(op(owner(), 'job.create', { requestId: requestId(), kind: 'video_final', draftOutputId: draft.outputId }));
    const upscale = await submitUpscaleJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), outputId: pictureOutput, kind: 'image', resolution: 1440 }, { env: { BRAND_STUDIO_UPSCALE_PROVIDER: 'fake' } });
    if (!upscale.ok) throw new Error(JSON.stringify(upscale));
    const upscaleJob = (upscale as unknown as { jobId: string }).jobId;
    // A result used as a reference is not a parent: that run is filed where the request says (here nowhere).
    const referenced = await ok<{ job: StudioJobView }>(op(owner(), 'job.create', { requestId: requestId(), kind: 'image', model: 'seedream-5.5', prompt: 'like this', aspect: '1:1', resolution: '2K', count: 1, references: [{ outputId: pictureOutput }] }));
    const derived = [edit.job.id, version.job.id, final.job.id];
    for (const id of [...derived, upscaleJob]) expect(await filedNow('brand_studio_jobs', id), id).toBe(F);
    expect(await filedNow('brand_studio_jobs', referenced.job.id)).toBeNull();

    // The studio: the answers that make the wall say 미분류 for all of them, and the 미분류 wall lists them.
    for (const made of [edit, version, final]) expect(made.job.brandProjectId).toBeNull();
    const ownRuns = [picture.job.id, clip.jobId, draft.jobId];
    const wall = (await ok<StudioState>(loadStudioState(deps, owner(), f.orgId, { scope: { kind: 'unfiled' } }))).jobs.map((j) => j.id);
    for (const id of [...ownRuns, ...derived, loose.jobId, referenced.job.id]) expect(wall, id).toContain(id);
    const everything = await state();
    for (const id of [...ownRuns, ...derived]) expect(everything.jobs.find((j) => j.id === id)!.brandProjectId, id).toBeNull();
    const polled = await ok<{ jobs: StudioJobView[] }>(pollStudioJobs(deps, owner(), f.orgId, [...ownRuns, ...derived]));
    for (const job of polled.jobs) expect(job.brandProjectId, job.id).toBeNull();
    // The upscale's run is the editor's export model: on no wall, on origin/main either.
    expect(wall).not.toContain(upscaleJob);
    expect(await loadStudioState(deps, owner(), f.orgId, { scope: { kind: 'project', brandProjectId: F } })).toEqual({ ok: false, code: 'not_found' });

    // The assets page: all of them in the finished project (once they have a result), none in 미분류.
    await advanceStudioJobsWith(deps, { jobIds: derived });
    const done = (await state()).jobs.filter((j) => derived.includes(j.id) && j.outputs.length > 0).map((j) => j.id);
    expect(done.length, 'derived runs with a result').toBe(derived.length);
    const listed = idsOf(await allPages({ kind: 'project', brandProjectId: F }));
    for (const id of [...ownRuns, ...derived]) expect(listed, id).toContain(`job:${id}`);
    const unfiled = idsOf(await allPages({ kind: 'unfiled' }));
    for (const id of [...ownRuns, ...derived]) expect(unfiled, id).not.toContain(`job:${id}`);
    for (const job of (await allPages({ kind: 'project', brandProjectId: F })).flatMap((p) => p.jobs)) expect(job.brandProjectId).toBe(F);
  });
});

describe('D. a notice and the file card name the same project (follow-up 2)', () => {
  it('a mention about a role-tagged upload of a finished project is in-app only, as its card names no project; a role-less one mails its project', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://twings.app');
    vi.stubEnv('NOTIFY_TOKEN_SECRET', 'test-only-room-notice-secret-0000000000');
    const mailer = createFakeMailer();
    const F = await selfProject('Winter teaser');
    const role = await upload('logo', F);
    const plain = await upload(null, F);
    await setStatus(F, 'completed');
    const post = async (assetId: string) =>
      ok<{ thread: { rootId: string; file: { project: unknown } }; message: { id: string } }>(room(owner(), 'send.post', { requestId: randomUUID(), file: { kind: 'asset', assetId }, body: '@editor 확인해 주세요', mentions: [f.ids.editor] }));
    const onRole = await post(role);
    const onPlain = await post(plain);
    expect(onRole.thread.file.project).toBeNull();
    expect(onPlain.thread.file.project).toEqual({ id: F, title: 'Winter teaser' });
    const report = await runRoomNoticePass({ sql: f.sql, mailer, push: null, now: minutesFromNow(0) });
    expect(report).toMatchObject({ mails: 1, sent: 1 });
    expect(mailer.sent.map((m) => m.subject)).toEqual([expect.stringContaining('Winter teaser')]);
    const rows = (await f.sql.query<{ message_id: string; state: string; skip_reason: string | null }>('select message_id::text as message_id, state, skip_reason from brand_room_notices where message_id = any($1::uuid[])', [[onRole.message.id, onPlain.message.id]])).rows;
    expect(rows.find((r) => r.message_id === onRole.message.id)).toMatchObject({ state: 'skipped', skip_reason: 'rule' });
    expect(rows.find((r) => r.message_id === onPlain.message.id)).toMatchObject({ state: 'sent' });
    // The bell row names what the card names.
    const bell = await loadRoomSummary({ sql: f.sql }, viewerOf(f.ids.editor), f.orgId, { bell: { media: deps.media } });
    if (!bell.ok || !bell.bell) throw new Error(JSON.stringify(bell));
    const line = (rootId: string) => bell.bell!.items.find((item) => item.id === `thread:${rootId}`)!;
    expect([line(onRole.thread.rootId).projectTitle, line(onPlain.thread.rootId).projectTitle]).toEqual([null, 'Winter teaser']);
  });
});

describe('typed client methods', () => {
  it('post the filter only when given, and the delete flag; hand back the answer or a failure code', async () => {
    const { createStudioApi } = await import('@/components/brand-studio/api');
    const calls: Array<{ url: string; body: unknown }> = [];
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, projects: [], unfiled: {} } };
    const api = createStudioApi({
      organizationId: 'org-1',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as never,
    });
    await api.loadBrandProjectCards();
    await api.loadBrandProjectCards({ filter: 'all' });
    await api.loadBrandProjectOverview();
    await api.loadBrandProjectOverview({ filter: 'active' });
    reply = { status: 200, body: { ok: true, savedCopyId: 'a-1' } };
    expect(await api.deleteResultWithSavedCopy('o-1')).toEqual({ ok: true, savedCopyId: 'a-1' });
    expect(calls.map((c) => c.body)).toEqual([
      { operation: 'project.cards', input: { organizationId: 'org-1' } },
      { operation: 'project.cards', input: { organizationId: 'org-1', filter: 'all' } },
      { operation: 'project.overview', input: { organizationId: 'org-1' } },
      { operation: 'project.overview', input: { organizationId: 'org-1', filter: 'active' } },
      { operation: 'output.delete', input: { organizationId: 'org-1', outputId: 'o-1', withSavedCopy: true } },
    ]);
    reply = { status: 409, body: { ok: false, code: 'conflict' } };
    expect(await api.deleteResultWithSavedCopy('o-1')).toEqual({ ok: false, code: 'conflict' });
  });
});
