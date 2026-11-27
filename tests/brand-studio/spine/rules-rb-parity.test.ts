import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { rememberOpenProject } from '@/lib/brand-studio/open-project';
import { loadStudioSpine } from '@/lib/brand-studio/open-project-server';
import { loadStudioState, runStudioOperation } from '@/lib/brand-studio/service';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * Spine rules R-B §1 Step 0 parity snapshots — recorded on the untouched branch (`gemini/spine-rules-rb`,
 * cut from `main`) BEFORE any code edit.
 *
 * NEVER regenerate this snapshot file (`tests/brand-studio/spine/__snapshots__/rules-rb-parity.test.ts.snap`):
 *  - While the spine is closed, for non-members (guest/staff/outsider), and for sandboxed/denied organizations:
 *    every read and operation (including `project.archive` and `project.list` with `query` when closed) matches
 *    the untouched branch byte for byte.
 *  - With the spine open for members of an organization with <= 100 projects (here 3 visible + 1 hidden):
 *    `project.list`, `project.cards` (no filter), `project.overview` (no filter), `project.files` (unfiled and
 *    brand_materials), `loadStudioState`, and `loadStudioSpine` match byte for byte; `project.cards` / `project.overview`
 *    with a filter and `project.files` on a project keep every existing key, order, and count unchanged (only the new
 *    documented R-B top-level optional fields `listed` and `project` are stripped when comparing against the Step 0
 *    baseline).
 */
const ENV = {
  BRAND_STUDIO_PROVIDER: 'fake',
  BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
  BRAND_SOUND_STUDIO: 'on',
  BRAND_STUDIO_MUSIC_GENERATION: 'on',
};
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

const T = (minute: number) => new Date(Date.UTC(2026, 10, 20, 9, minute, 0)).toISOString();

async function fixture(orgId?: string): Promise<void> {
  resetSpineProbe();
  f = await studioFixture(orgId ? { orgId } : {});
  deps = studioDeps(f.sql, { env: studioEnv(ENV) });
}

beforeEach(() => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f?.db.close();
});

const openFor = (orgs: string) => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgs);
};

const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });

interface World {
  P_OPEN_SELF: string;
  P_DONE_SELF: string;
  P_OPEN_TEAM: string;
  P_HIDDEN_TEAM: string;
}

/** Deterministic 3-visible + 1-hidden project world with deterministic timestamps. */
async function seed(withFilms = true): Promise<World> {
  const sql = f.sql;
  const org = f.orgId;
  const owner = f.ids.owner;
  let minute = 1;

  await sql.query('update brand_projects set created_at = $2, updated_at = $2 where id = $1', [f.projectId, T(minute++)]);
  const project = async (title: string, origin: 'self' | 'team', status: string, visible: boolean): Promise<string> => {
    const id = randomUUID();
    const at = T(minute++);
    await sql.query(
      `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id, created_at, updated_at)
        values ($1, $2, $3, $4, 'studio', $5, $6, $7, $8, $9, $10, $10)`,
      [id, org, title, origin === 'self' ? '' : 'A goal for the team', status, visible, origin, owner, randomUUID(), at],
    );
    return id;
  };

  const P_OPEN_SELF = await project('Open own', 'self', 'active', false);
  const P_DONE_SELF = await project('Done own', 'self', 'completed', false);
  const P_HIDDEN_TEAM = await project('Hidden team', 'team', 'active', false);
  const P_OPEN_TEAM = f.projectId;

  const fileIn = (table: string, id: string, projectId: string | null) =>
    sql.query(`update ${table} set brand_project_id = $2 where id = $1`, [id, projectId]);

  const run = async (kind: 'image' | 'video', projectId: string | null) => {
    const r = await seedRun(deps, org, owner, { kind, prompt: `${kind} ${minute}` });
    const at = T(minute++);
    await sql.query('update brand_studio_jobs set created_at = $2, finished_at = $2 where id = $1', [r.jobId, at]);
    await sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [r.jobId, at]);
    if (projectId) await fileIn('brand_studio_jobs', r.jobId, projectId);
    return r;
  };

  const save = async (outputId: string): Promise<string> => {
    const o = (
      await sql.query<{
        kind: string;
        mime: string;
        width: number | null;
        height: number | null;
        storage_key: string;
        thumb_key: string | null;
        job_id: string;
      }>('select * from brand_studio_outputs where id = $1', [outputId])
    ).rows[0]!;
    const id = (
      await sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, thumb_key, sha256, source, source_output_id, status, created_by, created_at, brand_project_id)
          values ($1, $2, 'Saved result', $3, 1, $4, $5, $6, $7, $8, 'generation', $9, 'ready', $10, $11, (select brand_project_id from brand_studio_jobs where id = $12)) returning id`,
        [
          org,
          o.kind,
          o.mime,
          o.width,
          o.height,
          o.storage_key,
          o.thumb_key,
          randomUUID().replace(/-/g, '').padEnd(64, '0'),
          outputId,
          owner,
          T(minute++),
          o.job_id,
        ],
      )
    ).rows[0]!.id;
    await sql.query('update brand_studio_outputs set saved_asset_id = $2 where id = $1', [outputId, id]);
    return id;
  };

  const upload = async (role: string | null, projectId: string | null) => {
    const id = await seedImageAsset(deps, org, owner, role ? { role } : {});
    await sql.query('update brand_studio_assets set created_at = $2 where id = $1', [id, T(minute++)]);
    if (projectId) await fileIn('brand_studio_assets', id, projectId);
    return id;
  };

  // Open self: 1 image run + saved copy, 1 upload, 1 film
  const rOpen = await run('image', P_OPEN_SELF);
  await save(rOpen.outputId);
  await upload(null, P_OPEN_SELF);

  // Finished self: 1 image run, 1 role-less upload, 1 logo upload (stays 브랜드 자료)
  await run('image', P_DONE_SELF);
  await upload(null, P_DONE_SELF);
  await upload('logo', P_DONE_SELF);

  // Open team: 1 image run
  await run('image', P_OPEN_TEAM);

  // Hidden team: 1 image run (must never leak)
  await run('image', P_HIDDEN_TEAM);

  // Unfiled + brand materials
  await upload(null, null);
  await upload('style', null);

  if (withFilms) {
    for (const [title, projectId] of [
      ['Open cut', P_OPEN_SELF],
      ['Done cut', P_DONE_SELF],
      ['Hidden cut', P_HIDDEN_TEAM],
      ['Loose cut', null],
    ] as const) {
      const made = await runVideoProjectOperation({ sql, media: deps.media }, viewerOf(owner), 'create', {
        organizationId: org,
        requestId: `vp_${randomUUID()}`,
        title,
      });
      if (!made.ok || !made.project) throw new Error(JSON.stringify(made));
      await sql.query('update brand_studio_video_projects set created_at = $2, updated_at = $2, brand_project_id = $3 where id = $1', [
        made.project.id,
        T(minute++),
        projectId,
      ]);
    }
  }

  return { P_OPEN_SELF, P_DONE_SELF, P_OPEN_TEAM, P_HIDDEN_TEAM };
}

/** Ids and media keys replaced by their order of appearance so the snapshot is stable across runs. */
function normal(value: unknown): unknown {
  const seen = new Map<string, string>();
  const text = JSON.stringify(value).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|st\/[0-9a-f]{64}\.[a-z0-9]+/gi,
    (hit) => {
      const key = hit.toLowerCase();
      if (!seen.has(key)) seen.set(key, `<${hit.startsWith('st/') ? 'key' : 'id'}${seen.size + 1}>`);
      return seen.get(key)!;
    },
  );
  return JSON.parse(text);
}

/** Strip allowance and storage (calendar-moving) from studio state answers. */
function stateOf(answer: unknown): unknown {
  if (!answer || typeof answer !== 'object' || !(answer as { ok?: boolean }).ok) return answer;
  const { allowance: _a, storage: _s, ...rest } = answer as Record<string, unknown>;
  return rest;
}

/**
 * For the open-spine member reads where R-B adds optional top-level keys (`listed` on filtered
 * `project.cards`/`project.overview`, `project` on `project.files` with `scope.kind === 'project'`), remove ONLY
 * those new keys before comparing against the Step 0 untouched-branch snapshot. Also strips Fix Round 3 Item 8's
 * always-present `cover.model` field on `project.overview` covers and `project.cards.unfiled.covers` without
 * regenerating the Step 0 snapshot.
 */
function stripCoverModel(body: Record<string, unknown>, includeProjectCovers: boolean): Record<string, unknown> {
  const stripCovers = (list: unknown) =>
    Array.isArray(list)
      ? list.map((c) => {
          if (!c || typeof c !== 'object') return c;
          const { model: _m, ...rest } = c as Record<string, unknown>;
          return rest;
        })
      : list;
  const projects =
    includeProjectCovers && Array.isArray(body.projects)
      ? body.projects.map((g) => {
          if (!g || typeof g !== 'object') return g;
          const rec = g as Record<string, unknown>;
          return { ...rec, covers: stripCovers(rec.covers) };
        })
      : body.projects;
  const unfiled =
    body.unfiled && typeof body.unfiled === 'object'
      ? { ...(body.unfiled as Record<string, unknown>), covers: stripCovers((body.unfiled as Record<string, unknown>).covers) }
      : body.unfiled;
  return { ...body, projects, unfiled };
}

function stripRbOptional(
  kind: 'cards_none' | 'cards_filtered' | 'overview_none' | 'overview_filtered' | 'files_project',
  answer: unknown,
): unknown {
  if (!answer || typeof answer !== 'object' || !(answer as { ok?: boolean }).ok) return answer;
  if (kind === 'cards_none') return stripCoverModel(answer as Record<string, unknown>, false);
  if (kind === 'overview_none') return stripCoverModel(answer as Record<string, unknown>, true);
  if (kind === 'cards_filtered') {
    const { listed: _l, ...rest } = answer as Record<string, unknown>;
    return stripCoverModel(rest, false);
  }
  if (kind === 'overview_filtered') {
    const { listed: _l, ...rest } = answer as Record<string, unknown>;
    return stripCoverModel(rest, true);
  }
  const { project: _p, ...rest } = answer as Record<string, unknown>;
  return rest;
}

const ALL_VIEWERS: Array<[string, () => Viewer]> = [
  ['owner', () => viewerOf(f.ids.owner)],
  ['viewer', () => viewerOf(f.ids.viewer)],
  ['guest', () => viewerOf(f.ids.guest)],
  ['staff', staff],
  ['outsider', () => viewerOf(f.ids.outsider)],
];

const NON_MEMBERS: Array<[string, () => Viewer]> = [
  ['guest', () => viewerOf(f.ids.guest)],
  ['staff', staff],
  ['outsider', () => viewerOf(f.ids.outsider)],
];

const MEMBERS: Array<[string, () => Viewer, 'owner' | 'viewer']> = [
  ['owner', () => viewerOf(f.ids.owner), 'owner'],
  ['viewer', () => viewerOf(f.ids.viewer), 'viewer'],
];

async function collectBaseline(
  w: World,
  callers: Array<[string, () => Viewer]>,
  options: { includeRbClosedOps: boolean; stripOpenOptionalKeys: boolean },
): Promise<unknown> {
  const out: Record<string, unknown> = {};
  const org = f.orgId;
  const studio = (v: Viewer, operation: string, input: Record<string, unknown>) =>
    runStudioOperation(deps, v, operation, { organizationId: org, ...input });

  for (const [name, make] of callers) {
    const v = make();
    const cardsActive = await studio(v, 'project.cards', { filter: 'active' });
    const cardsAll = await studio(v, 'project.cards', { filter: 'all' });
    const overviewActive = await studio(v, 'project.overview', { filter: 'active' });
    const overviewAll = await studio(v, 'project.overview', { filter: 'all' });
    const filesOpen = await studio(v, 'project.files', { scope: { kind: 'project', brandProjectId: w.P_OPEN_SELF } });
    const filesDone = await studio(v, 'project.files', { scope: { kind: 'project', brandProjectId: w.P_DONE_SELF } });

    const cardsNone = await studio(v, 'project.cards', {});
    out[`${name} project.list`] = await studio(v, 'project.list', {});
    out[`${name} project.cards none`] = options.stripOpenOptionalKeys ? stripRbOptional('cards_none', cardsNone) : cardsNone;
    out[`${name} project.cards active`] = options.stripOpenOptionalKeys ? stripRbOptional('cards_filtered', cardsActive) : cardsActive;
    out[`${name} project.cards all`] = options.stripOpenOptionalKeys ? stripRbOptional('cards_filtered', cardsAll) : cardsAll;
    const overviewNone = await studio(v, 'project.overview', {});
    out[`${name} project.overview none`] = options.stripOpenOptionalKeys ? stripRbOptional('overview_none', overviewNone) : overviewNone;
    out[`${name} project.overview active`] = options.stripOpenOptionalKeys ? stripRbOptional('overview_filtered', overviewActive) : overviewActive;
    out[`${name} project.overview all`] = options.stripOpenOptionalKeys ? stripRbOptional('overview_filtered', overviewAll) : overviewAll;
    out[`${name} project.files open`] = options.stripOpenOptionalKeys ? stripRbOptional('files_project', filesOpen) : filesOpen;
    out[`${name} project.files done`] = options.stripOpenOptionalKeys ? stripRbOptional('files_project', filesDone) : filesDone;
    out[`${name} project.files unfiled`] = await studio(v, 'project.files', { scope: { kind: 'unfiled' } });
    out[`${name} project.files materials`] = await studio(v, 'project.files', { scope: { kind: 'brand_materials' } });

    out[`${name} state none`] = stateOf(await loadStudioState(deps, v, org));
    out[`${name} state unfiled`] = stateOf(await loadStudioState(deps, v, org, { scope: { kind: 'unfiled' } }));
    out[`${name} state open`] = stateOf(await loadStudioState(deps, v, org, { scope: { kind: 'project', brandProjectId: w.P_OPEN_SELF } }));
    out[`${name} state done`] = stateOf(await loadStudioState(deps, v, org, { scope: { kind: 'project', brandProjectId: w.P_DONE_SELF } }));

    if (options.includeRbClosedOps) {
      out[`${name} project.list query`] = await studio(v, 'project.list', { query: 'Open' });
      out[`${name} project.archive`] = await studio(v, 'project.archive', {});
    }
  }
  return normal(out);
}

async function collectSpineStates(w: World): Promise<unknown> {
  const out: Record<string, unknown> = {};
  const org = f.orgId;
  for (const [name, make, role] of MEMBERS) {
    const v = make();
    const seat = { staff: false, role };
    out[`${name} spine default`] = await loadStudioSpine({ sql: f.sql, viewer: v, organizationId: org, seat, cookieRaw: null, deps });
    out[`${name} spine query open`] = await loadStudioSpine({ sql: f.sql, viewer: v, organizationId: org, seat, queryProject: w.P_OPEN_SELF, cookieRaw: null, deps });
    out[`${name} spine query done`] = await loadStudioSpine({ sql: f.sql, viewer: v, organizationId: org, seat, queryProject: w.P_DONE_SELF, cookieRaw: null, deps });
    out[`${name} spine cookie open`] = await loadStudioSpine({
      sql: f.sql,
      viewer: v,
      organizationId: org,
      seat,
      cookieRaw: rememberOpenProject({}, org, { kind: 'project', id: w.P_OPEN_SELF }),
      deps,
    });
    out[`${name} spine cookie done`] = await loadStudioSpine({
      sql: f.sql,
      viewer: v,
      organizationId: org,
      seat,
      cookieRaw: rememberOpenProject({}, org, { kind: 'project', id: w.P_DONE_SELF }),
      deps,
    });
  }
  for (const [name, seat] of [
    ['guest', { staff: false, role: 'guest' }],
    ['staff', { staff: true, role: 'studio' }],
  ] as const) {
    out[`${name} spine`] = await loadStudioSpine({ sql: f.sql, viewer: viewerOf(f.ids.guest), organizationId: org, seat, queryProject: w.P_OPEN_SELF, cookieRaw: null, deps });
  }
  return normal(out);
}

describe('R-B Step 0 parity: untouched-branch baseline (3-project org, spine closed & open)', () => {
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
    it(`closed (${name}): all reads and loadStudioSpine match untouched branch byte for byte`, async () => {
      await fixture();
      openFor(f.orgId);
      const w = await seed();
      await close();
      expect({
        reads: await collectBaseline(w, ALL_VIEWERS, { includeRbClosedOps: true, stripOpenOptionalKeys: false }),
        spine: await collectSpineStates(w),
      }).toMatchSnapshot();
    });
  }

  it('open spine, non-members (guest, staff, outsider): every existing read and loadStudioSpine unchanged', async () => {
    await fixture();
    openFor(f.orgId);
    const w = await seed();
    expect({
      reads: await collectBaseline(w, NON_MEMBERS, { includeRbClosedOps: false, stripOpenOptionalKeys: false }),
      spine: {
        guest: await loadStudioSpine({ sql: f.sql, viewer: viewerOf(f.ids.guest), organizationId: f.orgId, seat: { staff: false, role: 'guest' }, queryProject: w.P_OPEN_SELF, cookieRaw: null, deps }),
        staff: await loadStudioSpine({ sql: f.sql, viewer: staff(), organizationId: f.orgId, seat: { staff: true, role: 'studio' }, queryProject: w.P_OPEN_SELF, cookieRaw: null, deps }),
      },
    }).toMatchSnapshot();
  });

  for (const denied of ['sandboxed', 'generative_media', 'self_studio'] as const) {
    it(`open spine, closed organization (${denied}): every existing read unchanged`, async () => {
      await fixture(denied === 'sandboxed' ? [...SANDBOXED_CLIENT_ORG_IDS][0]! : undefined);
      if (denied !== 'sandboxed') {
        await f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, array[$2]::text[])', [f.orgId, denied]);
      }
      openFor(f.orgId);
      const w = await seed(false);
      expect(await collectBaseline(w, ALL_VIEWERS, { includeRbClosedOps: false, stripOpenOptionalKeys: false })).toMatchSnapshot();
    });
  }

  it('open spine, members (owner, viewer), 3-project org (<= 100): existing answers & loadStudioSpine unchanged', async () => {
    await fixture();
    openFor(f.orgId);
    const w = await seed();
    expect({
      reads: await collectBaseline(
        w,
        MEMBERS.map(([n, m]) => [n, m]),
        { includeRbClosedOps: false, stripOpenOptionalKeys: true },
      ),
      spine: await collectSpineStates(w),
    }).toMatchSnapshot();
  });
});
