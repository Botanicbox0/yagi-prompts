import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandProjectSpineFor, brandProjectSpineOn, brandProjectSpineOrgs } from '@/lib/flags';
import { brandProjectSpineOpen, resetSpineProbe, spineColumnsReady } from '@/lib/brand-studio/brand-projects';
import { studioFixture, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §3.6 — `BRAND_PROJECT_SPINE` (master switch, default off) and
 * `BRAND_PROJECT_SPINE_ORGS` (comma-separated organization ids; `all` / `*` = everyone; unset or empty =
 * nobody), the same shape as `BRAND_STUDIO_EDITOR_V2` + `_ORGS`. The server also needs migration 0194's
 * columns, so the code can deploy before the migration: one helper answers "is the spine open for this
 * organization" and every new read and write goes through it.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

describe('brandProjectSpineFor', () => {
  it('needs exactly `on` and the organization listed', () => {
    expect(brandProjectSpineFor(ORG, {})).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE_ORGS: ORG })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'off', BRAND_PROJECT_SPINE_ORGS: ORG })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'ON', BRAND_PROJECT_SPINE_ORGS: ORG })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on' })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: '' })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: OTHER })).toBe(false);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: ORG })).toBe(true);
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: ` ${OTHER} , ,${ORG} ` })).toBe(true);
    expect(brandProjectSpineFor(null, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: '*' })).toBe(false);
    expect(brandProjectSpineFor('', { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: 'all' })).toBe(false);
  });

  it('`all` (any case) or `*` anywhere in the list counts every organization; ids compare without regard to case', () => {
    for (const all of ['all', 'ALL', 'All', '*', `${OTHER},all`, `*,${OTHER}`]) {
      expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: all }), all).toBe(true);
      expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'off', BRAND_PROJECT_SPINE_ORGS: all }), all).toBe(false);
    }
    const UPPER = '00000000-0000-4000-8000-0000000000AA';
    expect(brandProjectSpineFor(ORG, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: UPPER })).toBe(true);
    expect(brandProjectSpineFor(UPPER, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: ORG })).toBe(true);
    expect(brandProjectSpineFor(UPPER, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: OTHER.toUpperCase() })).toBe(false);
    expect(brandProjectSpineOrgs({ BRAND_PROJECT_SPINE_ORGS: ` ${ORG}, ,${OTHER},` })).toEqual([ORG, OTHER]);
    expect(brandProjectSpineOn({ BRAND_PROJECT_SPINE: 'on' })).toBe(true);
    expect(brandProjectSpineOn({})).toBe(false);
  });
});

describe('server readiness: the flag AND migration 0194', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    resetSpineProbe();
    f = await studioFixture();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    resetSpineProbe();
    await f.db.close();
  });

  it('opens only for a listed organization, and only once every column exists', async () => {
    const env = { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: f.orgId };
    expect(await spineColumnsReady(f.sql)).toBe(true);
    expect(await brandProjectSpineOpen(f.sql, f.orgId, env)).toBe(true);
    expect(await brandProjectSpineOpen(f.sql, OTHER, env)).toBe(false);
    expect(await brandProjectSpineOpen(f.sql, f.orgId, {})).toBe(false);

    // Any one of the four columns missing keeps it closed.
    for (const [table, column] of [
      ['brand_studio_video_projects', 'brand_project_id'],
      ['brand_studio_assets', 'brand_project_id'],
      ['brand_studio_jobs', 'brand_project_id'],
      ['brand_projects', 'origin'],
    ] as const) {
      await f.sql.query(`alter table ${table} drop column ${column} cascade`);
      resetSpineProbe();
      expect(await spineColumnsReady(f.sql), `${table}.${column}`).toBe(false);
      expect(await brandProjectSpineOpen(f.sql, f.orgId, env)).toBe(false);
    }
  });

  it('reads the server environment by default', async () => {
    expect(await brandProjectSpineOpen(f.sql, f.orgId)).toBe(false);
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', f.orgId);
    expect(await brandProjectSpineOpen(f.sql, f.orgId)).toBe(true);
  });

  it('never asks the database while the switch is off for the organization', async () => {
    const queries: string[] = [];
    const spy = { ...f.sql, query: (text: string, params?: unknown[]) => (queries.push(text), f.sql.query(text, params as never)) } as typeof f.sql;
    expect(await brandProjectSpineOpen(spy, f.orgId, {})).toBe(false);
    expect(await brandProjectSpineOpen(spy, f.orgId, { BRAND_PROJECT_SPINE: 'on', BRAND_PROJECT_SPINE_ORGS: OTHER })).toBe(false);
    expect(queries).toEqual([]);
  });

  it('a miss is looked up again after a minute; a hit is kept', async () => {
    await f.sql.query('alter table brand_studio_jobs drop column brand_project_id cascade');
    resetSpineProbe();
    const t0 = 1_000_000;
    expect(await spineColumnsReady(f.sql, t0)).toBe(false);
    await f.sql.query('alter table brand_studio_jobs add column brand_project_id uuid');
    expect(await spineColumnsReady(f.sql, t0 + 30_000)).toBe(false);
    expect(await spineColumnsReady(f.sql, t0 + 61_000)).toBe(true);
    await f.sql.query('alter table brand_studio_jobs drop column brand_project_id cascade');
    expect(await spineColumnsReady(f.sql, t0 + 999_000)).toBe(true);
  });
});
