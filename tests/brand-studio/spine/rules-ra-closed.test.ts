import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadRoomSummary, runRoomOperation } from '@/lib/brand-rooms/messages';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { loadSoundStudio } from '@/lib/brand-studio/sound/load';
import { loadVideoProjects, runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { membersLine } from '../../brand-rooms/send/helpers';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * Spine rules, slice R-A (a saved result shows once; finished projects keep their files): while the spine is closed for an
 * organization, for a sandboxed or generation-closed organization, for a project guest and for staff who are not members,
 * every read and operation this slice changed answers byte for byte what origin/main answers, the new optional inputs
 * (`filter`, `withSavedCopy`) included.
 *
 * The snapshot in __snapshots__/rules-ra-closed.test.ts.snap was RECORDED BY RUNNING THIS FILE ON origin/main's CODE
 * (commit 351685c8, before the slice's first change); the slice must leave it untouched. The world holds what the slice
 * reads differently: files in a finished own project, in completed and cancelled team projects and in a hidden team
 * project, saved results (a run's result with its library copy), a post-production file, members threads on both
 * references of a pair. Ids and media keys are replaced by their order of appearance; times are fixed.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', BRAND_SOUND_STUDIO: 'on', BRAND_STUDIO_MUSIC_GENERATION: 'on' };
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const T = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute, 0)).toISOString();

async function fixture(orgId?: string): Promise<void> {
  resetSpineProbe();
  resetBrandSendProbe();
  f = await studioFixture(orgId ? { orgId } : {});
  deps = studioDeps(f.sql, { env: studioEnv(ENV) });
}
beforeEach(() => {
  vi.stubEnv('BRAND_SEND', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  resetBrandSendProbe();
  await f?.db.close();
});

const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });

interface World {
  P: string;
  D: string;
  TC: string;
  TX: string;
  TH: string;
  jobs: string[];
  r1: { jobId: string; outputId: string };
  r2: { jobId: string; outputId: string };
  c1: string;
  c2: string;
  u1: string;
}

/** Everything written straight into the tables (no operation), so the same world can be laid out for any organization. */
async function seed(withFilms = true): Promise<World> {
  const sql = f.sql;
  const org = f.orgId;
  const owner = f.ids.owner;
  let minute = 1;
  await sql.query('update brand_projects set created_at = $2, updated_at = $2 where id = $1', [f.projectId, T(0)]);
  const project = async (title: string, origin: 'self' | 'team', status: string, visible: boolean): Promise<string> => {
    const id = randomUUID();
    await sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id, created_at, updated_at)
        values ($1, $2, $3, $4, 'studio', $5, $6, $7, $8, $9, $10, $10)`,
      [id, org, title, origin === 'self' ? '' : 'A goal for the team', status, visible, origin, owner, randomUUID(), T(0)],
    );
    return id;
  };
  const P = await project('Open own', 'self', 'active', false);
  const D = await project('Done own', 'self', 'completed', false);
  const TC = await project('Done team', 'team', 'completed', true);
  const TX = await project('Cancelled team', 'team', 'cancelled', true);
  const TH = await project('Hidden team', 'team', 'active', false);
  const fileIn = (table: string, id: string, projectId: string | null) => sql.query(`update ${table} set brand_project_id = $2 where id = $1`, [id, projectId]);
  const jobs: string[] = [];
  const run = async (kind: 'image' | 'video', projectId: string | null) => {
    const r = await seedRun(deps, org, owner, { kind, prompt: `${kind} ${minute}` });
    const at = T(minute++);
    await sql.query('update brand_studio_jobs set created_at = $2, finished_at = $2 where id = $1', [r.jobId, at]);
    await sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [r.jobId, at]);
    if (projectId) await fileIn('brand_studio_jobs', r.jobId, projectId);
    jobs.push(r.jobId);
    return r;
  };
  const sound = async (projectId: string | null) => {
    const at = T(minute++);
    const job = await sql.query<{ id: string }>(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, lane, model, prompt, enhance, params, refs, created_at, finished_at)
        values ($1, $2, $3, 'music', 'succeeded', 'sunra_api', 'suno-v6', 'calm piano', false, $4::jsonb, '[]'::jsonb, $5, $5) returning id`,
      [org, owner, requestId(), JSON.stringify({ locale: 'ko', music: { title: 'Jingle', vocal: false, mode: 'describe', careful: false, lyrics: null } }), at],
    );
    const { key } = await deps.media.put(new Uint8Array([73, 68, 51, minute]), 'audio/mpeg');
    const output = await sql.query<{ id: string }>(
      `insert into brand_studio_outputs (job_id, organization_id, idx, kind, status, storage_key, mime, duration_ms, created_at)
        values ($1, $2, 0, 'audio', 'ready', $3, 'audio/mpeg', 30000, $4) returning id`,
      [job.rows[0]!.id, org, key, at],
    );
    if (projectId) await fileIn('brand_studio_jobs', job.rows[0]!.id, projectId);
    jobs.push(job.rows[0]!.id);
    return { jobId: job.rows[0]!.id, outputId: output.rows[0]!.id };
  };
  /** What `asset.from_output` writes for a new library entry: a `generation` copy linked both ways, in the run's project. */
  const save = async (outputId: string): Promise<string> => {
    const o = (await sql.query<{ kind: string; mime: string; width: number | null; height: number | null; storage_key: string; thumb_key: string | null; job_id: string }>('select * from brand_studio_outputs where id = $1', [outputId])).rows[0]!;
    const id = (
      await sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, thumb_key, sha256, source, source_output_id, status, created_by, created_at, brand_project_id)
          values ($1, $2, 'Saved result', $3, 1, $4, $5, $6, $7, $8, 'generation', $9, 'ready', $10, $11, (select brand_project_id from brand_studio_jobs where id = $12)) returning id`,
        [org, o.kind, o.mime, o.width, o.height, o.storage_key, o.thumb_key, randomUUID().replace(/-/g, '').padEnd(64, '0'), outputId, owner, T(minute++), o.job_id],
      )
    ).rows[0]!.id;
    await sql.query('update brand_studio_outputs set saved_asset_id = $2 where id = $1', [outputId, id]);
    return id;
  };
  const upload = async (role: string | null, projectId: string | null, source: 'upload' | 'generation' = 'upload') => {
    const id = await seedImageAsset(deps, org, owner, role ? { role } : {});
    await sql.query('update brand_studio_assets set created_at = $2, source = $3 where id = $1', [id, T(minute++), source]);
    if (projectId) await fileIn('brand_studio_assets', id, projectId);
    return id;
  };

  const r1 = await run('image', D);
  const c1 = await save(r1.outputId);
  const r2 = await run('image', null);
  const c2 = await save(r2.outputId);
  const r3 = await run('video', TC);
  const r4 = await run('image', TX);
  const r5 = await run('image', TH);
  const r6 = await run('image', P);
  const s1 = await sound(D);
  await save(s1.outputId);
  const u1 = await upload(null, D);
  await upload('logo', D);
  await upload(null, TC);
  await upload('product', TC);
  await upload(null, TH);
  await upload('person', TH);
  await upload(null, P);
  await upload(null, null);
  await upload('style', null);
  // A post-production file: `generation` with no result behind it (an upscale, a track), never a saved result.
  await upload(null, D, 'generation');
  void r3;
  void r4;
  void r5;
  void r6;
  if (withFilms) {
    for (const [title, projectId] of [['Done cut', D], ['Team cut', TC], ['Hidden cut', TH], ['Loose cut', null]] as const) {
      const made = await runVideoProjectOperation({ sql, media: deps.media }, viewerOf(owner), 'create', { organizationId: org, requestId: `vp_${randomUUID()}`, title });
      if (!made.ok || !made.project) throw new Error(JSON.stringify(made));
      await sql.query('update brand_studio_video_projects set created_at = $2, updated_at = $2, brand_project_id = $3 where id = $1', [made.project.id, T(minute++), projectId]);
    }
  }
  // Members threads about both references of the pair in D, and about an upload.
  await membersLine(sql, { organizationId: org, projectId: D, authorId: f.ids.editor, body: 'On the result', file: { kind: 'output', id: r1.outputId }, mentions: [owner], at: T(minute++) });
  await membersLine(sql, { organizationId: org, projectId: D, authorId: f.ids.viewer, body: 'On the saved copy', file: { kind: 'asset', id: c1 }, at: T(minute++) });
  await membersLine(sql, { organizationId: org, projectId: D, authorId: f.ids.editor, body: 'On an upload', file: { kind: 'asset', id: u1 }, at: T(minute++) });
  return { P, D, TC, TX, TH, jobs, r1, r2, c1, c2, u1 };
}

/** Ids and media keys replaced by their order of appearance, so the snapshot holds across runs. */
function normal(value: unknown): unknown {
  const seen = new Map<string, string>();
  const text = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|st\/[0-9a-f]{64}\.[a-z0-9]+/gi, (hit) => {
    const key = hit.toLowerCase();
    if (!seen.has(key)) seen.set(key, `<${hit.startsWith('st/') ? 'key' : 'id'}${seen.size + 1}>`);
    return seen.get(key)!;
  });
  return JSON.parse(text);
}

function recording(sql: SqlRunner, texts: string[]): SqlRunner {
  const wrap = (inner: SqlRunner): SqlRunner => ({
    query: (text, params) => {
      texts.push(text.replace(/\s+/g, ' ').trim());
      return inner.query(text, params);
    },
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(sql);
}

/** The studio state without the two parts that move with the calendar (allowance, storage) and that this slice never touches. */
function stateOf(answer: unknown): unknown {
  if (!answer || typeof answer !== 'object' || !(answer as { ok?: boolean }).ok) return answer;
  const { allowance: _a, storage: _s, ...rest } = answer as Record<string, unknown>;
  return rest;
}

const VIEWERS: Array<[string, () => Viewer]> = [
  ['owner', () => viewerOf(f.ids.owner)],
  ['viewer', () => viewerOf(f.ids.viewer)],
  ['guest', () => viewerOf(f.ids.guest)],
  ['staff', staff],
  ['outsider', () => viewerOf(f.ids.outsider)],
];

/** Every read and operation the slice changes, for each caller, then the two writes (refused first, then the owner's). */
async function everything(w: World, callers = VIEWERS, options: { sound?: boolean } = { sound: true }): Promise<unknown> {
  const out: Record<string, unknown> = {};
  const org = f.orgId;
  const studio = (v: Viewer, operation: string, input: Record<string, unknown>) => runStudioOperation(deps, v, operation, { organizationId: org, ...input });
  const room = async (v: Viewer, operation: string, input: Record<string, unknown>) => (await runRoomOperation({ sql: f.sql, media: deps.media }, v, operation, { organizationId: org, ...input })).result;
  for (const [name, make] of callers) {
    const v = make();
    out[`${name} state`] = stateOf(await loadStudioState(deps, v, org));
    out[`${name} state unfiled`] = stateOf(await loadStudioState(deps, v, org, { scope: { kind: 'unfiled' } }));
    out[`${name} state done own`] = stateOf(await loadStudioState(deps, v, org, { scope: { kind: 'project', brandProjectId: w.D } }));
    out[`${name} poll`] = stateOf(await pollStudioJobs(deps, v, org, w.jobs));
    out[`${name} films`] = await loadVideoProjects({ sql: f.sql, media: deps.media }, v, org);
    out[`${name} project.list`] = await studio(v, 'project.list', {});
    out[`${name} project.overview`] = await studio(v, 'project.overview', {});
    out[`${name} project.overview all`] = await studio(v, 'project.overview', { filter: 'all' });
    out[`${name} project.cards`] = await studio(v, 'project.cards', {});
    out[`${name} project.cards all`] = await studio(v, 'project.cards', { filter: 'all' });
    out[`${name} project.files done own`] = await studio(v, 'project.files', { scope: { kind: 'project', brandProjectId: w.D } });
    out[`${name} project.files unfiled`] = await studio(v, 'project.files', { scope: { kind: 'unfiled' } });
    out[`${name} project.files materials`] = await studio(v, 'project.files', { scope: { kind: 'brand_materials' } });
    out[`${name} project.move preview`] = await studio(v, 'project.move', { projectId: w.P, jobIds: [w.r1.jobId], preview: true });
    out[`${name} send.file output`] = await room(v, 'send.file', { file: { kind: 'output', outputId: w.r1.outputId } });
    out[`${name} send.file asset`] = await room(v, 'send.file', { file: { kind: 'asset', assetId: w.c1 } });
    out[`${name} bell`] = await loadRoomSummary({ sql: f.sql }, v, org, { bell: { media: deps.media } });
  }
  // The sound page's loader (the page's own gate refuses a sandboxed or closed organization before it runs).
  if (options.sound) out['owner sound'] = (await loadSoundStudio(f.sql, deps.media, deps.env, org, f.ids.owner, { member: true })).jobs;
  // The statements of the owner's state read (the remembered probes warm from the reads above).
  if (callers.some(([name]) => name === 'owner')) {
    const texts: string[] = [];
    await loadStudioState({ ...deps, sql: recording(f.sql, texts) }, viewerOf(f.ids.owner), org);
    out['owner state statements'] = texts;
  }
  // The writes: refused for everyone but the owner, then the owner's (the flag on output.delete included).
  for (const [name, make] of [...callers.filter(([n]) => n !== 'owner'), ...callers.filter(([n]) => n === 'owner')]) {
    const v = make();
    out[`${name} asset.update`] = await studio(v, 'asset.update', { assetId: w.c1, name: 'Renamed' });
    out[`${name} output.delete with the flag`] = await studio(v, 'output.delete', { outputId: w.r2.outputId, withSavedCopy: true });
  }
  if (!callers.some(([name]) => name === 'owner')) return normal(out);
  out['owner state after delete'] = stateOf(await loadStudioState(deps, viewerOf(f.ids.owner), org));
  out['owner project.move'] = await studio(viewerOf(f.ids.owner), 'project.move', { projectId: w.P, jobIds: [w.r1.jobId] });
  out['filing after move'] = (
    await f.sql.query<{ id: string; brand_project_id: string | null }>(
      "select a.id::text as id, to_jsonb(a) ->> 'brand_project_id' as brand_project_id from brand_studio_assets a where a.id = any($1::uuid[]) order by a.created_at",
      [[w.c1, w.c2]],
    )
  ).rows;
  out['deleted after'] = (
    await f.sql.query<{ id: string; gone: boolean }>('select id::text as id, deleted_at is not null as gone from brand_studio_assets where id = any($1::uuid[]) order by created_at', [[w.c1, w.c2]])
  ).rows;
  return normal(out);
}

describe('R-A closed: the changed reads answer exactly what origin/main answers', () => {
  const CLOSED: Array<[string, () => Promise<void> | void]> = [
    ['the spine switched off', () => void vi.stubEnv('BRAND_PROJECT_SPINE', 'off')],
    ['the organization not on the spine list', () => void vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID())],
    [
      'the spine columns missing (0194 not applied)',
      async () => {
        await f.sql.query('alter table brand_studio_assets drop column brand_project_id cascade');
        resetSpineProbe();
      },
    ],
  ];
  for (const [name, close] of CLOSED) {
    it(name, async () => {
      await fixture();
      openFor(f.orgId);
      const w = await seed();
      await close();
      expect(await everything(w)).toMatchSnapshot();
    });
  }

  it('the spine open: a project guest, staff who are not members and an outsider', async () => {
    await fixture();
    openFor(f.orgId);
    const w = await seed();
    expect(await everything(w, VIEWERS.filter(([name]) => name !== 'owner' && name !== 'viewer'), { sound: false })).toMatchSnapshot();
  });

  for (const denied of ['sandboxed', 'generative_media'] as const) {
    it(`the spine open for a closed organization (${denied})`, async () => {
      await fixture(denied === 'sandboxed' ? [...SANDBOXED_CLIENT_ORG_IDS][0]! : undefined);
      if (denied === 'generative_media') await f.sql.query("insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])", [f.orgId]);
      openFor(f.orgId);
      const w = await seed(false);
      expect(await everything(w, VIEWERS, { sound: false })).toMatchSnapshot();
    });
  }
});
