import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import {
  BRAND_PROJECT_LIMITS,
  type BrandProjectFileKind,
  type BrandProjectFilesScope,
  type StudioBrandProjectArchive,
  type StudioBrandProjectCards,
  type StudioBrandProjectCounts,
  type StudioBrandProjectFiles,
  type StudioBrandProjectList,
  type StudioBrandProjectOverview,
  type StudioState,
} from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import {
  openProjectCandidateId,
  rememberOpenProject,
  resolveVideoPageSpine,
  resolveVideoStudioAddress,
  scopeOfOpenProject,
} from '@/lib/brand-studio/open-project';
import { loadStudioSpine, includeSelectableProjectForFilm } from '@/lib/brand-studio/open-project-server';
import { loadStudioState, runStudioOperation } from '@/lib/brand-studio/service';
import { runVideoProjectOperation } from '@/lib/brand-studio/video-projects/service';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { seedRun } from '../server/revision-helpers';

/**
 * Spine rules R-B (Batch A server):
 *  - `project.archive` (every visible project, keyset-paged past 100, search, fixed statement count)
 *  - `project.files` page-1 `project` summary (active, finished, beyond 100)
 *  - `project.cards` / `project.overview` `listed` totals sibling (only when `filter` is named)
 *  - `loadStudioSpine` opening selectable projects beyond 100 (and keeping non-selectable ones unchanged)
 *  - `project.list` optional `query` search past 100
 *  - leak matrix, counts-equal-lists, client methods & boundary guards
 */
const ENV = {
  BRAND_STUDIO_PROVIDER: 'fake',
  BRAND_STUDIO_DEFAULT_LANE: 'sunra_api',
  BRAND_SOUND_STUDIO: 'on',
  BRAND_STUDIO_MUSIC_GENERATION: 'on',
};
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
const open = () => {
  openFor(f.orgId);
  vi.stubEnv('BRAND_ROOMS', 'on');
};
const owner = () => viewerOf(f.ids.owner);
const staff = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const op = (viewer: Viewer, operation: string, input: Record<string, unknown>) =>
  runStudioOperation(deps, viewer, operation, { organizationId: f.orgId, ...input });

type Outcome = 'ok' | string;
const outcome = (r: { ok: boolean; code?: string }): Outcome => (r.ok ? 'ok' : (r.code as string));

async function insertProject(opts: {
  id?: string;
  organizationId?: string;
  title: string;
  origin: 'self' | 'team';
  status?: 'requested' | 'active' | 'completed' | 'cancelled';
  visible?: boolean;
  updatedAt?: string;
  createdAt?: string;
}): Promise<string> {
  const id = opts.id ?? randomUUID();
  const visible = opts.origin === 'self' ? false : (opts.visible ?? true);
  const status = opts.status ?? 'active';
  const createdAt = opts.createdAt ?? opts.updatedAt ?? '2026-11-20T00:00:00.000000Z';
  const updatedAt = opts.updatedAt ?? createdAt;
  await f.sql.query(
    `insert into brand_projects (id, organization_id, title, objective, production_mode, status, client_visible, origin, created_by, request_id, created_at, updated_at)
      values ($1, $2, $3, $4, 'studio', $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      opts.organizationId ?? f.orgId,
      opts.title,
      opts.origin === 'self' ? '' : 'A goal for the team',
      status,
      visible,
      opts.origin,
      f.ids.owner,
      randomUUID(),
      createdAt,
      updatedAt,
    ],
  );
  return id;
}

async function secondOrg(name = 'Other Brand'): Promise<string> {
  const id = randomUUID();
  await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
    id,
    name,
    f.ids.owner,
    randomUUID(),
  ]);
  await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
    id,
    f.ids.owner,
  ]);
  return id;
}

async function saveOutput(outputId: string): Promise<string> {
  const o = (
    await f.sql.query<{
      kind: string;
      mime: string;
      width: number | null;
      height: number | null;
      storage_key: string;
      thumb_key: string | null;
      job_id: string;
      organization_id: string;
    }>('select * from brand_studio_outputs where id = $1', [outputId])
  ).rows[0]!;
  const id = (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, storage_key, thumb_key, sha256, source, source_output_id, status, created_by, brand_project_id)
        values ($1, $2, 'Saved copy', $3, 1, $4, $5, $6, $7, $8, 'generation', $9, 'ready', $10, (select brand_project_id from brand_studio_jobs where id = $11))
        returning id`,
      [
        o.organization_id,
        o.kind,
        o.mime,
        o.width,
        o.height,
        o.storage_key,
        o.thumb_key,
        randomUUID().replace(/-/g, '').padEnd(64, '0'),
        outputId,
        f.ids.owner,
        o.job_id,
      ],
    )
  ).rows[0]!.id;
  await f.sql.query('update brand_studio_outputs set saved_asset_id = $2 where id = $1', [outputId, id]);
  return id;
}

async function allFilePages(scope: BrandProjectFilesScope, kind?: BrandProjectFileKind): Promise<StudioBrandProjectFiles[]> {
  const pages: StudioBrandProjectFiles[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const res = await op(owner(), 'project.files', { scope, ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) });
    if (!res.ok) throw new Error(`project.files failed: ${JSON.stringify(res)}`);
    const page = res as StudioBrandProjectFiles;
    pages.push(page);
    if (!page.next) return pages;
    cursor = page.next;
  }
  throw new Error('too many pages');
}

const MEDIUM: Record<string, 'image' | 'video' | 'sound'> = {
  image: 'image',
  region_edit: 'image',
  video: 'video',
  video_remix: 'video',
  video_final: 'video',
  music: 'sound',
  sound_effect: 'sound',
};

function countsFromPages(pages: StudioBrandProjectFiles[]): StudioBrandProjectCounts {
  const counts: StudioBrandProjectCounts = { image: 0, video: 0, sound: 0, upload: 0, film: 0 };
  for (const p of pages) {
    counts.upload += p.assets.length;
    counts.film += p.films.length;
    for (const job of p.jobs) {
      const m = MEDIUM[job.kind];
      if (m) counts[m] += job.outputs.length;
    }
  }
  return counts;
}

/* ================================================================= leak matrix */

describe('R-B leak matrix: project.archive & project.list(query)', () => {
  const ROLES = ['owner', 'editor', 'viewer', 'guest', 'outsider', 'admin'] as const;
  const viewerFor = (role: (typeof ROLES)[number]): Viewer => (role === 'admin' ? staff() : viewerOf(f.ids[role]));

  for (const spine of ['open', 'switched off', 'organization not listed', 'column missing'] as const) {
    it(`project.archive × role × organization (${spine})`, async () => {
      openFor('*');
      await insertProject({ title: 'Visible Own', origin: 'self', status: 'active' });
      const hiddenActive = await insertProject({ title: 'Secret Active', origin: 'team', status: 'active', visible: false });
      const hiddenDone = await insertProject({ title: 'Secret Done', origin: 'team', status: 'completed', visible: false });
      const other = await secondOrg('Org B');
      const otherProject = await insertProject({ organizationId: other, title: 'Org B Secret', origin: 'self', status: 'active' });
      const otherTeam = await insertProject({ organizationId: other, title: 'Org B Team', origin: 'team', status: 'active', visible: true });

      if (spine === 'switched off') vi.unstubAllEnvs();
      if (spine === 'organization not listed') openFor(randomUUID());
      if (spine === 'column missing') {
        await f.sql.query('alter table brand_studio_video_projects drop column brand_project_id cascade');
        resetSpineProbe();
      }

      for (const role of ROLES) {
        const viewer = viewerFor(role);
        for (const org of [f.orgId, other]) {
          const list = await runStudioOperation(deps, viewer, 'project.list', { organizationId: org });
          const archive = await runStudioOperation(deps, viewer, 'project.archive', { organizationId: org });
          const searched = await runStudioOperation(deps, viewer, 'project.archive', { organizationId: org, query: 'Secret' });
          const listSearched = await runStudioOperation(deps, viewer, 'project.list', { organizationId: org, query: 'Secret' });
          const label = `${spine} ${role} ${org === other ? 'B' : 'A'}`;
          expect(outcome(archive), label).toBe(outcome(list));
          expect(outcome(searched), label).toBe(outcome(list));
          expect(outcome(listSearched), label).toBe(outcome(list));
          if (!list.ok) {
            expect(archive, label).toEqual(list);
            expect(searched, label).toEqual(list);
            expect(listSearched, label).toEqual(list);
          } else if (org === f.orgId) {
            const dump = JSON.stringify([archive, searched, listSearched]);
            for (const secret of [hiddenActive, hiddenDone, otherProject, otherTeam, 'Secret Active', 'Secret Done', 'Org B Secret', 'Org B Team']) {
              expect(dump, label).not.toContain(secret);
            }
            expect((searched as StudioBrandProjectArchive).total).toBe(0);
            expect((searched as StudioBrandProjectArchive).projects).toEqual([]);
          }
        }
      }

      const madeUp = randomUUID();
      for (const role of ROLES) {
        const list = await runStudioOperation(deps, viewerFor(role), 'project.list', { organizationId: madeUp });
        expect(await runStudioOperation(deps, viewerFor(role), 'project.archive', { organizationId: madeUp })).toEqual(list);
      }

      if (spine !== 'open') {
        expect(await op(owner(), 'project.archive', {})).toEqual(await op(owner(), 'no.such.operation', {}));
      }
    });
  }

  it('malformed inputs are judged after the seat; sandboxed and feature-closed orgs get feature_unavailable', async () => {
    openFor('*');
    const badInputs: Array<Record<string, unknown>> = [
      { cursor: '' },
      { cursor: 'garbage' },
      { cursor: 'x'.repeat(BRAND_PROJECT_LIMITS.cursorMax + 1) },
      { cursor: Buffer.from(JSON.stringify(['2026-02-30T00:00:00.000000', randomUUID()])).toString('base64url') },
      { cursor: Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000000', 'not-a-uuid'])).toString('base64url') },
      { query: 'a'.repeat(BRAND_PROJECT_LIMITS.queryMax + 1) },
      { query: 123 },
      { limit: 0 },
      { limit: -1 },
      { limit: BRAND_PROJECT_LIMITS.archivePageMax + 1 },
      { limit: 1.5 },
      { limit: '24' },
    ];
    for (const bad of badInputs) {
      const label = JSON.stringify(bad).slice(0, 80);
      for (const role of ['owner', 'editor', 'viewer'] as const) {
        expect(await op(viewerOf(f.ids[role]), 'project.archive', bad), `${role} ${label}`).toEqual({ ok: false, code: 'invalid' });
      }
      for (const viewer of [viewerOf(f.ids.guest), viewerOf(f.ids.outsider), staff()]) {
        expect(await op(viewer, 'project.archive', bad), label).toEqual({ ok: false, code: 'not_found' });
      }
    }

    // `project.list` rejects invalid query after the seat only.
    for (const badQuery of [{ query: 'a'.repeat(81) }, { query: 42 }, { query: null }]) {
      expect(await op(owner(), 'project.list', badQuery)).toEqual({ ok: false, code: 'invalid' });
      expect(await op(viewerOf(f.ids.guest), 'project.list', badQuery)).toEqual({ ok: false, code: 'not_found' });
    }

    const closedOrgs: string[] = [];
    const sandboxedId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      sandboxedId,
      'Sandboxed',
      f.ids.owner,
      randomUUID(),
    ]);
    await f.sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [
      sandboxedId,
      f.ids.owner,
    ]);
    closedOrgs.push(sandboxedId);
    for (const denied of ['generative_media', 'self_studio']) {
      const id = await secondOrg(`Closed ${denied}`);
      await f.sql.query('insert into brand_feature_policies (organization_id, denied_features) values ($1, array[$2]::text[])', [id, denied]);
      closedOrgs.push(id);
    }
    for (const org of closedOrgs) {
      expect(await runStudioOperation(deps, owner(), 'project.archive', { organizationId: org })).toEqual({ ok: false, code: 'feature_unavailable' });
      expect(await runStudioOperation(deps, owner(), 'project.archive', { organizationId: org, limit: 999 })).toEqual({
        ok: false,
        code: 'feature_unavailable',
      });
      expect(await runStudioOperation(deps, owner(), 'project.list', { organizationId: org, query: 'x'.repeat(100) })).toEqual({
        ok: false,
        code: 'feature_unavailable',
      });
    }
  });
});

/* ========================================= 130-project paging, search, counts */

describe('R-B 130-project paging, search, listed totals, and counts-equal-lists', () => {
  it('pages all 130 visible projects in exact order with ties/microseconds, matches project.cards all, reports totals/listed, and preserves cursor under concurrent updates', async () => {
    open();
    // Move fixture's requested team project into the deterministic timeline.
    await f.sql.query("update brand_projects set created_at = '2026-11-01T00:00:00.000000Z', updated_at = '2026-11-01T00:00:00.000000Z' where id = $1", [
      f.projectId,
    ]);

    const visible: Array<{ id: string; key: number }> = [{ id: f.projectId, key: Date.parse('2026-11-01T00:00:00.000Z') }];
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);

    // 125 projects spaced 1 minute apart; 2 exact timestamp ties; 2 spaced by 1 microsecond.
    for (let i = 0; i < 125; i += 1) {
      const origin = i % 3 === 0 ? 'team' : 'self';
      const status =
        origin === 'self'
          ? i % 2 === 0
            ? 'active'
            : 'completed'
          : i % 5 === 0
            ? 'completed'
            : i % 7 === 0
              ? 'cancelled'
              : 'active';
      const at = new Date(baseMs - i * 60_000).toISOString();
      const id = await insertProject({
        title: `Project ${String(i + 1).padStart(3, '0')}`,
        origin,
        status,
        visible: true,
        updatedAt: at,
      });
      visible.push({ id, key: Date.parse(at) });
    }
    const tieAt = '2026-11-19T12:00:00.000000Z';
    const tieA = await insertProject({ title: 'Tie A', origin: 'self', status: 'active', updatedAt: tieAt });
    const tieB = await insertProject({ title: 'Tie B', origin: 'team', status: 'completed', visible: true, updatedAt: tieAt });
    const usNewer = await insertProject({
      title: 'Micro Newer',
      origin: 'self',
      status: 'active',
      updatedAt: '2026-11-18T12:00:00.000002Z',
    });
    const usOlder = await insertProject({
      title: 'Micro Older',
      origin: 'self',
      status: 'active',
      updatedAt: '2026-11-18T12:00:00.000001Z',
    });
    visible.push(
      { id: tieA, key: Date.parse(tieAt) },
      { id: tieB, key: Date.parse(tieAt) },
      { id: usNewer, key: Date.parse('2026-11-18T12:00:00.000Z') + 0.002 },
      { id: usOlder, key: Date.parse('2026-11-18T12:00:00.000Z') + 0.001 },
    );

    // Hidden and other-org projects must never enter any list or count.
    const hidden = await insertProject({ title: 'Hidden Team', origin: 'team', status: 'active', visible: false, updatedAt: '2026-11-26T00:00:00Z' });
    const other = await secondOrg('Other');
    const theirs = await insertProject({ organizationId: other, title: 'Other Project', origin: 'self', status: 'active', updatedAt: '2026-11-26T00:00:00Z' });

    expect(visible).toHaveLength(130);

    // Give the fixture project (originally oldest!) a newer run so `last_activity_at` moves it to the very top.
    const newestRun = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'boost' });
    const boostAt = '2026-11-25T10:00:00.000000Z';
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2, created_at = $3, finished_at = $3 where id = $1', [
      newestRun.jobId,
      f.projectId,
      boostAt,
    ]);
    visible[0]!.key = Date.parse(boostAt);

    // Rich file mixtures on one open project near the end (index ~118) and one archived self project near the end (index ~121).
    const deepOpen = visible.find((_, idx) => idx === 118)!; // i=117 -> 117%3=0 (team), active
    const deepArchived = visible.find((_, idx) => idx === 120)!; // i=119 -> self, completed -> archived
    const deepActiveSelfId = visible[123]!.id; // i=122 -> self, active

    // File items into deepOpen (team active), deepArchived (self archived), and deepActiveSelf (idx 123).
    // Keep job created_at <= each project's own updated_at so its position past 100 is preserved.
    const deepOpenAt = new Date(deepOpen.key).toISOString();
    const deepArchAt = new Date(deepArchived.key).toISOString();
    const rPair = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'pair' });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2, created_at = $3, finished_at = $3 where id = $1', [
      rPair.jobId,
      deepOpen.id,
      deepOpenAt,
    ]);
    await f.sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [rPair.jobId, deepOpenAt]);
    await saveOutput(rPair.outputId); // shadowed saved copy: counts once as image, 0 upload
    await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [
      await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' }),
      deepOpen.id,
    ]);
    const deepUpload = await seedImageAsset(deps, f.orgId, f.ids.owner);
    await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [deepUpload, deepOpen.id]);

    const rArch = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video', prompt: 'arch' });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2, created_at = $3, finished_at = $3 where id = $1', [
      rArch.jobId,
      deepArchived.id,
      deepArchAt,
    ]);
    await f.sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [rArch.jobId, deepArchAt]);
    await saveOutput(rArch.outputId); // shadowed
    const archLogo = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'logo' });
    await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [archLogo, deepArchived.id]); // stays 브랜드 자료!
    const archLoose = await seedImageAsset(deps, f.orgId, f.ids.owner);
    await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [archLoose, deepArchived.id]);
    const archFilm = await runVideoProjectOperation({ sql: f.sql, media: deps.media }, owner(), 'create', {
      organizationId: f.orgId,
      requestId: `vp_${randomUUID()}`,
      title: 'Deep Film',
    });
    if (!archFilm.ok || !archFilm.project) throw new Error(JSON.stringify(archFilm));
    await f.sql.query('update brand_studio_video_projects set brand_project_id = $2 where id = $1', [
      archFilm.project.id,
      deepArchived.id,
    ]);

    const expectedOrder = [...visible]
      .sort((a, b) => (b.key !== a.key ? b.key - a.key : a.id < b.id ? 1 : -1))
      .map((p) => p.id);

    // 1. Page through all 130 with default limit (24 -> 24, 24, 24, 24, 24, 10)
    const collected: StudioBrandProjectArchive['projects'] = [];
    let cursor: string | undefined;
    const pageSizes: number[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const res = (await op(owner(), 'project.archive', cursor ? { cursor } : {})) as StudioBrandProjectArchive;
      expect(res.ok).toBe(true);
      expect(res.total).toBe(130);
      pageSizes.push(res.projects.length);
      collected.push(...res.projects);
      if (!res.next) break;
      cursor = res.next;
    }
    expect(pageSizes).toEqual([24, 24, 24, 24, 24, 10]);
    expect(collected.map((p) => p.project.id)).toEqual(expectedOrder);
    expect(new Set(collected.map((p) => p.project.id)).size).toBe(130);
    expect(JSON.stringify(collected)).not.toContain(hidden);
    expect(JSON.stringify(collected)).not.toContain(theirs);

    // 2. First 100 archive rows match project.cards filter:'all' identically
    const cardsAll = (await op(owner(), 'project.cards', { filter: 'all' })) as StudioBrandProjectCards;
    expect(cardsAll.ok).toBe(true);
    expect(cardsAll.projects).toHaveLength(100);
    expect(collected.slice(0, 100)).toEqual(cardsAll.projects);

    // 3. totals and listed on cards and overview (only when filter is named)
    const overviewAll = (await op(owner(), 'project.overview', { filter: 'all' })) as StudioBrandProjectOverview;
    const overviewActive = (await op(owner(), 'project.overview', { filter: 'active' })) as StudioBrandProjectOverview;
    const cardsActive = (await op(owner(), 'project.cards', { filter: 'active' })) as StudioBrandProjectCards;
    const cardsNone = (await op(owner(), 'project.cards', {})) as StudioBrandProjectCards;
    const overviewNone = (await op(owner(), 'project.overview', {})) as StudioBrandProjectOverview;

    const activeTotal = cardsAll.totals!.active;
    expect(cardsAll.totals).toEqual({ active: activeTotal, all: 130 });
    expect(cardsAll.listed).toEqual({ active: Math.min(activeTotal, 100), all: 100 });
    expect(overviewAll.totals).toEqual(cardsAll.totals);
    expect(overviewAll.listed).toEqual(cardsAll.listed);
    expect(overviewActive.totals).toEqual(cardsAll.totals);
    expect(overviewActive.listed).toEqual(cardsAll.listed);
    expect(cardsActive.totals).toEqual(cardsAll.totals);
    expect(cardsActive.listed).toEqual(cardsAll.listed);
    expect('totals' in cardsNone).toBe(false);
    expect('listed' in cardsNone).toBe(false);
    expect('totals' in overviewNone).toBe(false);
    expect('listed' in overviewNone).toBe(false);

    // 4. limit: 1 and limit: 48
    const pOne = (await op(owner(), 'project.archive', { limit: 1 })) as StudioBrandProjectArchive;
    expect(pOne.projects.map((p) => p.project.id)).toEqual(expectedOrder.slice(0, 1));
    expect(pOne.next).toEqual(expect.any(String));
    const p48 = (await op(owner(), 'project.archive', { limit: 48 })) as StudioBrandProjectArchive;
    expect(p48.projects.map((p) => p.project.id)).toEqual(expectedOrder.slice(0, 48));
    expect(p48.next).toEqual(expect.any(String));

    // 5. Counts equal project.files for rows on page 1 AND page > 100 (including saved copy pair & finished logo)
    const inspectIds = [expectedOrder[0]!, deepOpen.id, deepArchived.id, deepActiveSelfId];
    for (const id of inspectIds) {
      const archiveRow = collected.find((r) => r.project.id === id)!;
      const pages = await allFilePages({ kind: 'project', brandProjectId: id });
      expect(archiveRow.counts, id).toEqual(countsFromPages(pages));
      expect(pages[0]!.project, id).toEqual({
        id: archiveRow.project.id,
        title: archiveRow.project.title,
        origin: archiveRow.project.origin,
        status: archiveRow.status,
        selectable: archiveRow.selectable,
        counts: archiveRow.counts,
      });
    }
    expect(collected.find((r) => r.project.id === deepOpen.id)!.counts).toEqual({
      image: 1,
      video: 0,
      sound: 0,
      upload: 2,
      film: 0,
    });
    expect(collected.find((r) => r.project.id === deepArchived.id)!.counts).toEqual({
      image: 0,
      video: 1,
      sound: 0,
      upload: 1,
      film: 1,
    });

    // 6. Cursor stability when a page-2 project is updated and a new project is inserted between page 1 and page 2
    const page1 = (await op(owner(), 'project.archive', { limit: 24 })) as StudioBrandProjectArchive;
    const page1Ids = new Set(page1.projects.map((p) => p.project.id));
    const promotedFromPage2 = expectedOrder[30]!;
    await f.sql.query("update brand_projects set updated_at = '2026-11-27T01:00:00.000000Z' where id = $1", [promotedFromPage2]);
    await f.sql.query("update brand_projects set updated_at = '2026-11-27T02:00:00.000000Z' where id = $1", [expectedOrder[5]!]);
    const brandNew = await insertProject({
      title: 'Inserted Mid-Paging',
      origin: 'self',
      status: 'active',
      updatedAt: '2026-11-27T03:00:00.000000Z',
    });

    const tailIds: string[] = [];
    let c: string | null = page1.next;
    while (c) {
      const nextPage = (await op(owner(), 'project.archive', { limit: 24, cursor: c })) as StudioBrandProjectArchive;
      expect(nextPage.total).toBe(131);
      tailIds.push(...nextPage.projects.map((p) => p.project.id));
      c = nextPage.next;
    }
    // Zero duplicates from page 1, zero skips of remaining older projects (all 105 untouched page-2+ items).
    for (const id of tailIds) expect(page1Ids.has(id)).toBe(false);
    expect(tailIds).not.toContain(brandNew);
    expect(tailIds).not.toContain(promotedFromPage2);
    expect(tailIds).toEqual(expectedOrder.slice(24).filter((id) => id !== promotedFromPage2));
  });

  it('query search on project.archive and project.list: case, Hangul, literal %/_/\\, trim/whitespace, beyond 100', async () => {
    open();
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    await f.sql.query("update brand_projects set title = 'Filler Base', updated_at = $2 where id = $1", [
      f.projectId,
      new Date(baseMs + 1000).toISOString(),
    ]);
    // 105 recent filler projects so matching targets sit PAST the 100 cut
    for (let i = 0; i < 105; i += 1) {
      await insertProject({
        title: `Filler ${i}`,
        origin: 'self',
        status: 'active',
        updatedAt: new Date(baseMs - i * 1000).toISOString(),
      });
    }
    const oldMs = baseMs - 200 * 1000;
    const springOpen = await insertProject({ title: 'Spring Lookbook', origin: 'self', status: 'active', updatedAt: new Date(oldMs).toISOString() });
    const springDone = await insertProject({ title: 'SPRING Archive', origin: 'self', status: 'completed', updatedAt: new Date(oldMs - 1000).toISOString() });
    const hangul = await insertProject({ title: '가을 신제품 캠페인', origin: 'team', status: 'active', visible: true, updatedAt: new Date(oldMs - 2000).toISOString() });
    const pctMatch = await insertProject({ title: '100% Cotton', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 3000).toISOString() });
    const pctDecoy = await insertProject({ title: '100X Cotton', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 4000).toISOString() });
    const underMatch = await insertProject({ title: 'Look_01', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 5000).toISOString() });
    const underDecoy = await insertProject({ title: 'LookX01', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 6000).toISOString() });
    const slashMatch = await insertProject({ title: 'Path\\A', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 7000).toISOString() });
    const slashDecoy = await insertProject({ title: 'PathXA', origin: 'self', status: 'active', updatedAt: new Date(oldMs - 8000).toISOString() });
    const hiddenMatch = await insertProject({ title: 'Spring Hidden', origin: 'team', status: 'active', visible: false, updatedAt: new Date(baseMs + 5000).toISOString() });

    // Archive search: case-insensitive, both active & finished, trimmed, never hidden
    const qSpring = (await op(owner(), 'project.archive', { query: '  spring  ' })) as StudioBrandProjectArchive;
    expect(qSpring.total).toBe(2);
    expect(qSpring.projects.map((p) => p.project.id)).toEqual([springOpen, springDone]);
    expect(JSON.stringify(qSpring)).not.toContain(hiddenMatch);

    // Hangul search
    const qHangul = (await op(owner(), 'project.archive', { query: '신제품' })) as StudioBrandProjectArchive;
    expect(qHangul.total).toBe(1);
    expect(qHangul.projects[0]!.project.id).toBe(hangul);

    // Literal %, _, \
    const qPct = (await op(owner(), 'project.archive', { query: '100%' })) as StudioBrandProjectArchive;
    expect(qPct.projects.map((p) => p.project.id)).toEqual([pctMatch]);
    expect(qPct.projects.map((p) => p.project.id)).not.toContain(pctDecoy);

    const qUnder = (await op(owner(), 'project.archive', { query: 'Look_01' })) as StudioBrandProjectArchive;
    expect(qUnder.projects.map((p) => p.project.id)).toEqual([underMatch]);
    expect(qUnder.projects.map((p) => p.project.id)).not.toContain(underDecoy);

    const qSlash = (await op(owner(), 'project.archive', { query: 'Path\\A' })) as StudioBrandProjectArchive;
    expect(qSlash.projects.map((p) => p.project.id)).toEqual([slashMatch]);
    expect(qSlash.projects.map((p) => p.project.id)).not.toContain(slashDecoy);

    // Empty/whitespace query identical to omitted query
    const blank = (await op(owner(), 'project.archive', { query: '   ' })) as StudioBrandProjectArchive;
    const omitted = (await op(owner(), 'project.archive', {})) as StudioBrandProjectArchive;
    expect(blank).toEqual(omitted);

    // Exactly 80 chars accepted; 81 chars refused
    expect((await op(owner(), 'project.archive', { query: `  ${'z'.repeat(80)}  ` })).ok).toBe(true);
    expect(await op(owner(), 'project.archive', { query: 'z'.repeat(81) })).toEqual({ ok: false, code: 'invalid' });

    // project.archive search paging across >24 matches
    for (let i = 0; i < 30; i += 1) {
      await insertProject({
        title: `BatchMatch ${i}`,
        origin: 'self',
        status: i % 2 === 0 ? 'active' : 'completed',
        updatedAt: new Date(oldMs - (20 + i) * 1000).toISOString(),
      });
    }
    const p1 = (await op(owner(), 'project.archive', { query: 'BatchMatch' })) as StudioBrandProjectArchive;
    expect(p1.total).toBe(30);
    expect(p1.projects).toHaveLength(24);
    expect(p1.next).toEqual(expect.any(String));
    const p2 = (await op(owner(), 'project.archive', { query: 'BatchMatch', cursor: p1.next! })) as StudioBrandProjectArchive;
    expect(p2.total).toBe(30);
    expect(p2.projects).toHaveLength(6);
    expect(p2.next).toBeNull();

    // project.list with query finds selectable projects past 100 and excludes finished/hidden
    const defaultList = (await op(owner(), 'project.list', {})) as StudioBrandProjectList;
    expect(defaultList.projects).toHaveLength(100);
    expect(defaultList.projects.some((p) => p.id === springOpen)).toBe(false);

    const searchList = (await op(owner(), 'project.list', { query: 'spring' })) as StudioBrandProjectList;
    expect(searchList.ok).toBe(true);
    expect(searchList.projects.map((p) => p.id)).toEqual([springOpen]);
    expect(searchList.projects.map((p) => p.id)).not.toContain(springDone);
    expect(searchList.projects.map((p) => p.id)).not.toContain(hiddenMatch);

    expect(await op(owner(), 'project.list', { query: '   ' })).toEqual(defaultList);
    expect((await op(owner(), 'project.list', { query: '100%' })) as StudioBrandProjectList).toMatchObject({
      ok: true,
      projects: [expect.objectContaining({ id: pctMatch })],
    });
  });

  it('concurrent project.move out decreases activity (duplicate across pages) and move in boosts (skip in tail)', async () => {
    open();
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    await f.sql.query('update brand_projects set updated_at = $2 where id = $1', [f.projectId, new Date(baseMs).toISOString()]);

    // Create 30 projects with decreasing updated_at. Project A has oldest updated_at, boosted to top #1 via a run.
    const projA = await insertProject({ title: 'Boosted By Run', origin: 'self', status: 'active', updatedAt: new Date(baseMs - 50 * 1000).toISOString() });
    const runA = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2, created_at = $3 where id = $1', [
      runA.jobId,
      projA,
      new Date(baseMs + 10_000).toISOString(),
    ]);

    const mids: string[] = [];
    for (let i = 0; i < 29; i += 1) {
      mids.push(
        await insertProject({
          title: `Mid ${i}`,
          origin: 'self',
          status: 'active',
          updatedAt: new Date(baseMs - (i + 1) * 1000).toISOString(),
        }),
      );
    }
    const projB = mids[26]!; // on page 2 when limit=24

    const p1 = (await op(owner(), 'project.archive', { limit: 24 })) as StudioBrandProjectArchive;
    expect(p1.projects[0]!.project.id).toBe(projA);

    // 1. Move the newest run OUT of projA -> projA's activity drops back to updated_at (below page-1 cursor),
    // so page 2 returns projA again (server-side keyset duplicate that Batch B UI must deduplicate by project.id).
    // 2. Also move that run INTO projB (from page 2) -> projB rises above page-1 cursor (skipped in tail).
    const moveRes = await runStudioOperation(deps, owner(), 'project.move', {
      organizationId: f.orgId,
      projectId: projB,
      jobIds: [runA.jobId],
    });
    expect(moveRes.ok).toBe(true);

    const p2 = (await op(owner(), 'project.archive', { limit: 24, cursor: p1.next! })) as StudioBrandProjectArchive;
    const p2Ids = p2.projects.map((p) => p.project.id);
    expect(p2Ids).toContain(projA); // decreased activity fell behind page-1 cursor
    expect(p2Ids).not.toContain(projB); // increased activity rose above page-1 cursor

    // Deduplicating across pages keeps first seen occurrence, and reload puts projB at top.
    const reload = (await op(owner(), 'project.archive', { limit: 24 })) as StudioBrandProjectArchive;
    expect(reload.projects[0]!.project.id).toBe(projB);
    expect(reload.projects.some((p) => p.project.id === projA)).toBe(false);
  });

  it('normalizes NFD Hangul and Latin queries to NFC before 80-char limit and matching in archive and list', async () => {
    open();
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    const hangul = await insertProject({ title: '가을 신제품 캠페인', origin: 'self', status: 'active', updatedAt: new Date(baseMs + 2000).toISOString() });
    const cafe = await insertProject({ title: 'Café Lookbook', origin: 'self', status: 'active', updatedAt: new Date(baseMs + 1000).toISOString() });

    const nfdHangul = `  ${'신제품'.normalize('NFD')}  `;
    const nfdCafe = `Cafe\u0301`;
    expect(nfdHangul).not.toBe('  신제품  ');

    const archHangul = (await op(owner(), 'project.archive', { query: nfdHangul })) as StudioBrandProjectArchive;
    expect(archHangul.projects.map((p) => p.project.id)).toEqual([hangul]);
    const listHangul = (await op(owner(), 'project.list', { query: nfdHangul })) as StudioBrandProjectList;
    expect(listHangul.projects.map((p) => p.id)).toEqual([hangul]);

    const archCafe = (await op(owner(), 'project.archive', { query: nfdCafe })) as StudioBrandProjectArchive;
    expect(archCafe.projects.map((p) => p.project.id)).toEqual([cafe]);

    // 80 Hangul NFC syllables sent in NFD (= 240 UTF-16 code units!) pass because length is checked AFTER NFC.
    const nfd80 = '각'.repeat(80).normalize('NFD');
    expect(nfd80.length).toBeGreaterThan(BRAND_PROJECT_LIMITS.queryMax);
    expect((await op(owner(), 'project.archive', { query: nfd80 })).ok).toBe(true);
    expect((await op(owner(), 'project.list', { query: nfd80 })).ok).toBe(true);

    // 81 NFC syllables sent in NFD are still rejected as `invalid`.
    const nfd81 = '각'.repeat(81).normalize('NFD');
    expect(await op(owner(), 'project.archive', { query: nfd81 })).toEqual({ ok: false, code: 'invalid' });
    expect(await op(owner(), 'project.list', { query: nfd81 })).toEqual({ ok: false, code: 'invalid' });
  });

  it('project.files summary: page 1 carries project for active/finished/empty/kind-filtered; page 2 and non-project scopes omit it', async () => {
    open();
    const empty = await insertProject({ title: 'Empty Active', origin: 'self', status: 'active' });
    const doneTeam = await insertProject({ title: 'Done Team', origin: 'team', status: 'cancelled', visible: true });
    const big = await insertProject({ title: 'Big Project', origin: 'self', status: 'active' });

    const r = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [r.jobId, big]);
    for (let i = 0; i < BRAND_PROJECT_LIMITS.filesPage + 3; i += 1) {
      const a = await seedImageAsset(deps, f.orgId, f.ids.owner);
      await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [a, big]);
    }

    const emptyRes = (await op(owner(), 'project.files', { scope: { kind: 'project', brandProjectId: empty } })) as StudioBrandProjectFiles;
    expect(emptyRes.project).toEqual({
      id: empty,
      title: 'Empty Active',
      origin: 'self',
      status: 'open',
      selectable: true,
      counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 },
    });

    const teamRes = (await op(owner(), 'project.files', { scope: { kind: 'project', brandProjectId: doneTeam } })) as StudioBrandProjectFiles;
    expect(teamRes.project).toEqual({
      id: doneTeam,
      title: 'Done Team',
      origin: 'team',
      status: 'cancelled',
      selectable: false,
      counts: { image: 0, video: 0, sound: 0, upload: 0, film: 0 },
    });

    // Narrowed by kind: 'image' still gives full project counts on page 1
    const bigImagePage1 = (await op(owner(), 'project.files', {
      scope: { kind: 'project', brandProjectId: big },
      kind: 'image',
    })) as StudioBrandProjectFiles;
    expect(bigImagePage1.project).toEqual({
      id: big,
      title: 'Big Project',
      origin: 'self',
      status: 'open',
      selectable: true,
      counts: { image: 1, video: 0, sound: 0, upload: BRAND_PROJECT_LIMITS.filesPage + 3, film: 0 },
    });

    // Page 2 (cursor present) omits `project`
    const bigPage1 = (await op(owner(), 'project.files', { scope: { kind: 'project', brandProjectId: big } })) as StudioBrandProjectFiles;
    expect(bigPage1.next).toEqual(expect.any(String));
    const bigPage2 = (await op(owner(), 'project.files', {
      scope: { kind: 'project', brandProjectId: big },
      cursor: bigPage1.next!,
    })) as StudioBrandProjectFiles;
    expect('project' in bigPage2).toBe(false);

    // unfiled & brand_materials omit `project`
    const unfiled = (await op(owner(), 'project.files', { scope: { kind: 'unfiled' } })) as StudioBrandProjectFiles;
    const materials = (await op(owner(), 'project.files', { scope: { kind: 'brand_materials' } })) as StudioBrandProjectFiles;
    expect('project' in unfiled).toBe(false);
    expect('project' in materials).toBe(false);
  });
});

/* =================================================== fixed statement count */

describe('R-B fixed statement count (30 vs 130 projects)', () => {
  const recordArchive = async (input: Record<string, unknown> = {}): Promise<string[]> => {
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(text.replace(/\s+/g, ' ').trim());
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    const res = await runStudioOperation({ ...deps, sql: wrap(f.sql) }, owner(), 'project.archive', {
      organizationId: f.orgId,
      ...input,
    });
    expect(res.ok).toBe(true);
    return texts;
  };

  it('asks a fixed number of statements for a 24-project page regardless of whether the org has 30 or 130 projects', async () => {
    open();
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    const seedBatch = async (start: number, count: number) => {
      for (let i = start; i < start + count; i += 1) {
        const origin = i % 2 === 0 ? 'team' : 'self';
        const status = i % 5 === 0 ? 'completed' : 'active';
        const P = await insertProject({
          title: `Batch ${i}`,
          origin,
          status,
          visible: true,
          updatedAt: new Date(baseMs - i * 60_000).toISOString(),
        });
        if (i % 4 === 0) {
          const r = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
          await f.sql.query('update brand_studio_jobs set brand_project_id = $2 where id = $1', [r.jobId, P]);
        }
        if (i % 3 === 0) {
          const a = await seedImageAsset(deps, f.orgId, f.ids.owner);
          await f.sql.query('update brand_studio_assets set brand_project_id = $2 where id = $1', [a, P]);
        }
      }
    };

    await seedBatch(0, 30);
    // Warm column probes first.
    await op(owner(), 'project.archive', {});
    const statements30 = await recordArchive({});

    await seedBatch(30, 100);
    const statements130Page1 = await recordArchive({});
    const page1Res = (await op(owner(), 'project.archive', {})) as StudioBrandProjectArchive;
    const statements130Page2 = await recordArchive({ cursor: page1Res.next! });

    expect(statements130Page1.length).toBe(statements30.length);
    expect(statements130Page2.length).toBe(statements30.length);
    // Counts & covers only touch the page's project ids (never an org-wide group-by scan).
    const countQueries = statements130Page1.filter((s) => s.includes('group by 1'));
    expect(countQueries).toHaveLength(3);
    for (const q of countQueries) expect(q).toMatch(/any\(\$2::uuid\[\]\)|unnest\(\$2::uuid\[\]/);
  });
});

/* ================================================ opening beyond the 100 cut */

describe('R-B opening a selectable project beyond the 100 cut', () => {
  it('opens a selectable beyond-100 project by address or cookie with 1 extra lookup; non-selectable behaves as today', async () => {
    open();
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    for (let i = 0; i < 104; i += 1) {
      await insertProject({
        title: `Recent ${i}`,
        origin: 'self',
        status: 'active',
        updatedAt: new Date(baseMs - i * 1000).toISOString(),
      });
    }
    const oldMs = baseMs - 200 * 1000;
    const oldOpenSelf = await insertProject({ title: 'Old Open Self', origin: 'self', status: 'active', updatedAt: new Date(oldMs).toISOString() });
    const oldOpenTeam = await insertProject({
      title: 'Old Open Team',
      origin: 'team',
      status: 'active',
      visible: true,
      updatedAt: new Date(oldMs - 1000).toISOString(),
    });
    const oldArchived = await insertProject({ title: 'Old Archived', origin: 'self', status: 'completed', updatedAt: new Date(oldMs - 2000).toISOString() });
    const oldCompleted = await insertProject({
      title: 'Old Completed',
      origin: 'team',
      status: 'completed',
      visible: true,
      updatedAt: new Date(oldMs - 3000).toISOString(),
    });
    const oldHidden = await insertProject({
      title: 'Old Hidden',
      origin: 'team',
      status: 'active',
      visible: false,
      updatedAt: new Date(oldMs - 4000).toISOString(),
    });
    const other = await secondOrg('Other');
    const otherProject = await insertProject({
      organizationId: other,
      title: 'Other Org',
      origin: 'self',
      status: 'active',
      updatedAt: new Date(oldMs - 5000).toISOString(),
    });

    const runOld = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image', prompt: 'deep run' });
    const runOldAt = new Date(oldMs - 100).toISOString();
    await f.sql.query('update brand_studio_jobs set brand_project_id = $2, created_at = $3, finished_at = $3 where id = $1', [
      runOld.jobId,
      oldOpenSelf,
      runOldAt,
    ]);
    await f.sql.query('update brand_studio_outputs set created_at = $2 where job_id = $1', [runOld.jobId, runOldAt]);

    // Warm probes and measure statement count for top-100 vs beyond-100 lookup.
    const countQueries = async (queryProject?: string | null, cookieRaw: string | null = null) => {
      const texts: string[] = [];
      const wrap = (inner: SqlRunner): SqlRunner => ({
        query: (text, params) => {
          texts.push(text.replace(/\s+/g, ' ').trim());
          return inner.query(text, params);
        },
        transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
      });
      const res = await loadStudioSpine({
        sql: wrap(f.sql),
        viewer: owner(),
        organizationId: f.orgId,
        seat: { staff: false, role: 'owner' },
        queryProject,
        cookieRaw,
        deps: { ...deps, sql: wrap(f.sql) },
      });
      return { res, count: texts.length };
    };
    await countQueries(null, null); // warm probes

    const topOnly = await countQueries(null, null);
    expect(topOnly.res!.projects).toHaveLength(100);
    expect(topOnly.res!.projects.some((p) => p.id === oldOpenSelf)).toBe(false);

    // 1. Beyond-100 selectable self & team by address (including uppercase)
    for (const target of [oldOpenSelf, oldOpenTeam]) {
      const byAddr = await countQueries(target.toUpperCase(), null);
      expect(byAddr.count).toBe(topOnly.count + 1);
      expect(byAddr.res).toMatchObject({
        open: { kind: 'project', id: target },
        notice: null,
        noticeSource: null,
      });
      expect(byAddr.res!.projects).toHaveLength(101);
      expect(byAddr.res!.projects[0]!.id).toBe(target);

      // Remembered via cookie
      const byCookie = await countQueries(null, rememberOpenProject({}, f.orgId, { kind: 'project', id: target }));
      expect(byCookie.count).toBe(topOnly.count + 1);
      expect(byCookie.res).toMatchObject({
        open: { kind: 'project', id: target },
        notice: null,
        noticeSource: null,
      });
      expect(byCookie.res!.projects).toHaveLength(101);
      expect(byCookie.res!.projects[0]!.id).toBe(target);
    }

    // 2. Video studio address disambiguation & loadStudioState work seamlessly with the returned spine
    const openSpine = (await countQueries(oldOpenSelf, null)).res!;
    const decision = resolveVideoStudioAddress({
      pathname: '/brand/studio/video',
      searchParams: [
        ['organizationId', f.orgId],
        ['project', oldOpenSelf],
      ],
      projectIds: openSpine.projects.map((p) => p.id),
      filmIds: [],
    });
    expect(decision).toEqual({ kind: 'project', id: oldOpenSelf });
    const videoSpine = resolveVideoPageSpine({
      spine: openSpine,
      decision: decision as Exclude<typeof decision, { kind: 'redirect_film' }>,
      openedFilm: null,
      hadQueryProject: true,
    });
    expect(videoSpine.open).toEqual({ kind: 'project', id: oldOpenSelf });
    expect(videoSpine.notice).toBeNull();

    const state = (await loadStudioState(deps, owner(), f.orgId, { scope: scopeOfOpenProject(openSpine.open) })) as StudioState;
    expect(state.ok).toBe(true);
    expect(state.jobs.map((j) => j.id)).toEqual([runOld.jobId]);

    // 3. Non-selectable beyond-100 projects -> unfiled + gone, list stays 100
    for (const bad of [oldArchived, oldCompleted, oldHidden, otherProject, randomUUID(), 'not-a-uuid']) {
      const addrGone = await countQueries(bad, null);
      expect(addrGone.res).toMatchObject({ open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'address' });
      expect(addrGone.res!.projects).toHaveLength(100);
      if (bad !== 'not-a-uuid') {
        const cookieGone = await countQueries(null, rememberOpenProject({}, f.orgId, { kind: 'project', id: bad }));
        expect(cookieGone.res).toMatchObject({ open: { kind: 'unfiled' }, notice: 'gone', noticeSource: 'cookie' });
        expect(cookieGone.res!.projects).toHaveLength(100);
      }
    }

    // 4. ?project=unfiled never triggers lookup even when cookie holds a beyond-100 project
    const explicitUnfiled = await countQueries('unfiled', rememberOpenProject({}, f.orgId, { kind: 'project', id: oldOpenSelf }));
    expect(explicitUnfiled.count).toBe(topOnly.count);
    expect(explicitUnfiled.res).toMatchObject({ open: { kind: 'unfiled' }, notice: null, noticeSource: null });
    expect(explicitUnfiled.res!.projects).toHaveLength(100);
  });

  it('skips the extra lookup when an org has fewer than listMax (100) selectable projects', async () => {
    open();
    const texts: string[] = [];
    const wrap = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        texts.push(text.replace(/\s+/g, ' ').trim());
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
    });
    // Warm probe
    await loadStudioSpine({ sql: f.sql, viewer: owner(), organizationId: f.orgId, seat: { staff: false, role: 'owner' }, deps });
    await loadStudioSpine({
      sql: wrap(f.sql),
      viewer: owner(),
      organizationId: f.orgId,
      seat: { staff: false, role: 'owner' },
      queryProject: randomUUID(),
      deps: { ...deps, sql: wrap(f.sql) },
    });
    // Only the seat checks + the single list query ran (never a second `p.id = $1` project query).
    expect(texts.filter((s) => s.includes('from brand_projects p'))).toHaveLength(1);
  });

  it('openProjectCandidateId resolves address over cookie and ignores unfiled/malformed', () => {
    const P1 = '11111111-1111-4111-8111-111111111111';
    const P2 = '22222222-2222-4222-8222-222222222222';
    expect(openProjectCandidateId({ queryProject: ` ${P1.toUpperCase()} `, remembered: { kind: 'project', id: P2 } })).toBe(P1);
    expect(openProjectCandidateId({ queryProject: 'unfiled', remembered: { kind: 'project', id: P2 } })).toBeNull();
    expect(openProjectCandidateId({ queryProject: 'not-a-uuid', remembered: { kind: 'project', id: P2 } })).toBeNull();
    expect(openProjectCandidateId({ queryProject: null, remembered: { kind: 'project', id: P2.toUpperCase() } })).toBe(P2);
    expect(openProjectCandidateId({ queryProject: null, remembered: { kind: 'unfiled' } })).toBeNull();
    expect(openProjectCandidateId({})).toBeNull();
  });

  it('includeSelectableProjectForFilm opens beyond-100 selectable film project, keeps finished unfiled, and skips < 100', async () => {
    open();
    // 1. Org with < 100 selectable projects runs ZERO extra SQL queries.
    const smallSpine = await loadStudioSpine({ sql: f.sql, viewer: owner(), organizationId: f.orgId, seat: { staff: false, role: 'owner' }, deps });
    const smallSqlCalls: string[] = [];
    const wrapSmall = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        smallSqlCalls.push(text);
        return inner.query(text, params);
      },
      transaction: (fn) => inner.transaction((tx) => fn(wrapSmall(tx))),
    });
    const unchangedSmall = await includeSelectableProjectForFilm({
      sql: wrapSmall(f.sql),
      viewer: owner(),
      organizationId: f.orgId,
      seat: { staff: false, role: 'owner' },
      spine: smallSpine!,
      projectId: randomUUID(),
      deps: { ...deps, sql: wrapSmall(f.sql) },
    });
    expect(unchangedSmall).toBe(smallSpine);
    expect(smallSqlCalls).toHaveLength(0);

    // 2. Seed >= 100 selectable projects so two targets fall beyond 100: one selectable team, one archived self.
    const oldMs = Date.UTC(2026, 9, 1, 0, 0, 0);
    const oldOpenTeam = await insertProject({
      title: 'Film Project #104',
      origin: 'team',
      status: 'active',
      visible: true,
      updatedAt: new Date(oldMs).toISOString(),
    });
    const oldArchivedSelf = await insertProject({
      title: 'Film Project Archived #105',
      origin: 'self',
      status: 'completed',
      updatedAt: new Date(oldMs - 1000).toISOString(),
    });
    const baseMs = Date.UTC(2026, 10, 20, 0, 0, 0);
    for (let i = 0; i < 102; i += 1) {
      await insertProject({ title: `Top ${i}`, origin: 'self', status: 'active', updatedAt: new Date(baseMs - i * 1000).toISOString() });
    }

    const baseSpine = await loadStudioSpine({ sql: f.sql, viewer: owner(), organizationId: f.orgId, seat: { staff: false, role: 'owner' }, deps });
    expect(baseSpine!.projects).toHaveLength(100);
    expect(baseSpine!.projects.some((p) => p.id === oldOpenTeam)).toBe(false);

    const expanded = await includeSelectableProjectForFilm({
      sql: f.sql,
      viewer: owner(),
      organizationId: f.orgId,
      seat: { staff: false, role: 'owner' },
      spine: baseSpine!,
      projectId: oldOpenTeam,
      deps,
    });
    expect(expanded.projects).toHaveLength(101);
    expect(expanded.projects[0]!.id).toBe(oldOpenTeam);
    const opened = resolveVideoPageSpine({
      spine: expanded,
      decision: { kind: 'none' },
      openedFilm: { brandProjectId: oldOpenTeam },
      hadQueryProject: false,
    });
    expect(opened.open).toEqual({ kind: 'project', id: oldOpenTeam });
    expect(opened.notice).toBeNull();

    // Finished beyond-100 project is NOT added and resolves to unfiled.
    const notExpanded = await includeSelectableProjectForFilm({
      sql: f.sql,
      viewer: owner(),
      organizationId: f.orgId,
      seat: { staff: false, role: 'owner' },
      spine: baseSpine!,
      projectId: oldArchivedSelf,
      deps,
    });
    expect(notExpanded.projects).toHaveLength(100);
    const archivedOpened = resolveVideoPageSpine({
      spine: notExpanded,
      decision: { kind: 'none' },
      openedFilm: { brandProjectId: oldArchivedSelf },
      hadQueryProject: false,
    });
    expect(archivedOpened.open).toEqual({ kind: 'unfiled' });
  });
});

/* =================================================== client & boundary guards */

describe('R-B typed client & boundary guards', () => {
  it('api.loadBrandProjectArchive and api.listBrandProjects post expected bodies and handle failures', async () => {
    const { createStudioApi } = await import('@/components/brand-studio/api');
    const calls: Array<{ url: string; body: unknown }> = [];
    let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, projects: [], next: null, total: 0 } };
    const api = createStudioApi({
      organizationId: 'org-1',
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
      }) as never,
    });

    await api.loadBrandProjectArchive();
    await api.loadBrandProjectArchive({ cursor: 'cur-1', query: 'Spring', limit: 12 });
    reply = { status: 200, body: { ok: true, projects: [] } };
    await api.listBrandProjects();
    await api.listBrandProjects({ query: 'Summer' });

    expect(calls.map((c) => c.body)).toEqual([
      { operation: 'project.archive', input: { organizationId: 'org-1' } },
      { operation: 'project.archive', input: { organizationId: 'org-1', cursor: 'cur-1', query: 'Spring', limit: 12 } },
      { operation: 'project.list', input: { organizationId: 'org-1' } },
      { operation: 'project.list', input: { organizationId: 'org-1', query: 'Summer' } },
    ]);

    reply = { status: 400, body: { ok: false, code: 'invalid' } };
    expect(await api.loadBrandProjectArchive()).toEqual({ ok: false, code: 'invalid' });
    reply = { status: 404, body: { ok: false, code: 'feature_unavailable' } };
    expect(await api.loadBrandProjectArchive()).toEqual({ ok: false, code: 'feature_unavailable' });
  });

  it('new spine helpers stay inside the spine files and admin/team code cannot import project.archive', () => {
    const ROOT = process.cwd();
    const under = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir)).flatMap((name) => {
        const rel = `${dir}/${name}`;
        return statSync(path.join(ROOT, rel)).isDirectory() ? under(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
      });
    const sources = [...under('lib'), ...under('app'), ...under('components')];
    const matching = (pattern: RegExp) => sources.filter((file) => pattern.test(readFileSync(path.join(ROOT, file), 'utf8'))).sort();

    expect(matching(/\barchiveBrandProjectsPage\b/)).toEqual(['lib/brand-studio/brand-project-files.ts', 'lib/brand-studio/brand-projects.ts']);
    expect(matching(/\bcountVisibleBrandProjects\b/)).toEqual(['lib/brand-studio/brand-project-files.ts', 'lib/brand-studio/brand-projects.ts']);
    expect(matching(/\bloadBrandProjectArchive\b/)).toEqual([
      'components/brand-studio/api.ts',
      'components/brand-studio/asset-hub-spine/archive-view.tsx',
      'lib/brand-studio/brand-project-files.ts',
    ]);
    expect(matching(/\blistSelectableProjectsForStudio\b/)).toEqual(['lib/brand-studio/brand-projects.ts', 'lib/brand-studio/open-project-server.ts']);
    expect(matching(/\bselectableProjectById\b/)).toEqual(['lib/brand-studio/brand-projects.ts', 'lib/brand-studio/open-project-server.ts']);

    const admin = sources.filter((file) => /^(app\/\(admin\)|lib\/admin|app\/api\/admin)/.test(file));
    for (const file of admin) {
      expect(readFileSync(path.join(ROOT, file), 'utf8'), file).not.toMatch(/project\.archive|loadBrandProjectArchive/);
    }
  });
});
