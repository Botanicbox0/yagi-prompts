import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { createBrandProject } from '@/lib/brands/workspace/service';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-PROJECT-SPINE.md §4.5, the daily project limits. Each side has its own count of 20 per organization
 * per rolling day: `project.create` counts only the organization's own projects (`origin = 'self'`), the team
 * request (`createBrandProject` → `createProject`) only team projects (`TEAM_PROJECTS`, so it also runs on a
 * database without the `origin` column, where every row is a team row). Neither side can use up the other's.
 * The team request's own answer is today's: the 20th of the day is made, the 21st is `rate_limited`.
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  resetSpineProbe();
  f = await studioFixture();
  deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' }) });
  // The fixture's team project was made today: move it out of the window so every count below starts at zero.
  await f.sql.query("update brand_projects set created_at = now() - interval '2 days'");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
});

const open = () => {
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', f.orgId);
};
const owner = () => viewerOf(f.ids.owner);

/** A project of the brand's own, as the studio makes it. */
const own = (n: number) => runStudioOperation(deps, owner(), 'project.create', { organizationId: f.orgId, requestId: requestId(), title: `Own ${n}` });
/** A commission to the YAGI team, as the workspace form (and `handoff.campaign`) sends it. */
const team = (n: number) =>
  createBrandProject({ sql: f.sql }, owner(), {
    organizationId: f.orgId,
    requestId: randomUUID(),
    title: `Request ${n}`,
    objective: 'A goal for the team',
    budgetKrw: null,
    productionMode: 'creator',
  });
/** A team row made another way (a share-bridge review room, a staff-made project): it counts as a team row. */
const teamRow = () =>
  f.sql.query(
    `insert into brand_projects (organization_id, title, objective, production_mode, status, client_visible, created_by, request_id)
      values ($1, 'Review room', 'Reviews from the studio', 'studio', 'active', true, $2, $3)`,
    [f.orgId, f.ids.owner, randomUUID()],
  );
const projectRows = async () => Number((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_projects')).rows[0]!.n);
const today = async () =>
  (
    await f.sql.query<{ self: number; team: number }>(
      `select count(*) filter (where origin = 'self')::int as self, count(*) filter (where origin = 'team')::int as team
         from brand_projects where organization_id = $1 and created_at > now() - interval '1 day'`,
      [f.orgId],
    )
  ).rows[0];

describe('own projects and team requests are counted apart', () => {
  beforeEach(open);

  it('20 own projects made today do not block a team request; the 21st own project is refused', async () => {
    for (let i = 1; i <= 20; i += 1) expect((await own(i)).ok, `own ${i}`).toBe(true);
    expect((await team(1)).ok).toBe(true);
    const before = await projectRows();
    expect(await own(21)).toEqual({ ok: false, code: 'too_many_running' });
    expect(await projectRows()).toBe(before);
    expect(await today()).toEqual({ self: 20, team: 1 });
  });

  it('20 team projects made today do not block project.create; the 21st team request is refused as today', async () => {
    await teamRow();
    for (let i = 2; i <= 20; i += 1) expect((await team(i)).ok, `request ${i}`).toBe(true);
    expect((await own(1)).ok).toBe(true);
    const before = await projectRows();
    expect(await team(21)).toEqual({ ok: false, code: 'rate_limited' });
    expect(await projectRows()).toBe(before);
    expect(await today()).toEqual({ self: 1, team: 20 });
  });
});

describe('the team request keeps today’s answer while no own project exists', () => {
  const schemas: Array<[string, () => Promise<void>]> = [
    ['with the origin column', async () => {}],
    [
      'without it (a database before 0194)',
      async () => {
        await f.sql.query('alter table brand_projects drop column origin cascade');
        resetSpineProbe();
      },
    ],
  ];

  for (const [label, prepare] of schemas) {
    it(`${label}: every team row of the day counts, the 20th is made, the 21st is refused, a day later it starts again`, async () => {
      await prepare();
      // Rows made another way count too, as on origin/main.
      for (let i = 1; i <= 3; i += 1) await teamRow();
      for (let i = 4; i <= 20; i += 1) expect((await team(i)).ok, `request ${i}`).toBe(true);
      const before = await projectRows();
      expect(await team(21)).toEqual({ ok: false, code: 'rate_limited' });
      expect(await projectRows()).toBe(before);
      // Rows older than a day do not count.
      await f.sql.query("update brand_projects set created_at = now() - interval '25 hours'");
      expect((await team(22)).ok).toBe(true);
    });
  }
});
