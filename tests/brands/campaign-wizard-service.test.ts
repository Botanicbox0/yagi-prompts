import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb, runner } from '@/tests/helpers/pglite';
import { seedProfile } from '@/tests/helpers/billing';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { createBrandOrganization, createBrandProject, loadBrandProject } from '@/lib/brands/workspace/service';

/** docs/PLATFORM-2.0.md §16.3 — the wizard's request goes through the existing brief path, as `requested`. */
const OWNER = 'f1000000-0000-4000-8000-000000000001';
const owner: Viewer = { userId: OWNER, isAdmin: false, tier: 'free', email: null, locale: 'ko' };
const now = new Date('2026-10-23T03:00:00Z');
const terms = {
  version: 1,
  format: { kind: 'template', slug: 'mirror-dance', source: 'yagi' },
  reward: { model: 'hybrid', rewardMinKrw: 100_000, rewardMaxKrw: 300_000, perThousandViewsKrw: 2_000, totalBudgetKrw: 3_000_000, taxBasis: 'excluded', slots: 10 },
  audience: { mode: 'criteria', platforms: ['tiktok'], minFollowers: 5000, gender: 'any', regions: [] },
  schedule: { applicationsCloseOn: '2026-11-10', postDeadlineOn: '2026-11-30', hashtags: ['신제품'], mentions: [], disclosure: true, prohibited: '' },
};

describe('wizard brief', () => {
  let db: PGlite, sql: SqlRunner, org: string;
  beforeEach(async () => {
    db = await freshDb(); sql = runner(db);
    await seedProfile(sql, { id: OWNER });
    const o = await createBrandOrganization({ sql }, owner, { name: 'Wizard Brand', requestId: randomUUID() });
    if (!o.ok) throw Error(o.code); org = o.id;
  });
  afterEach(async () => { await db?.close(); });
  // What the wizard posts: the brief's own fields plus terms. The budget and dates it also sends are ignored.
  const input = (over: Record<string, unknown> = {}) => ({
    organizationId: org, requestId: randomUUID(), title: '가을 신제품 캠페인', objective: '신제품을 알린다', audience: '',
    budgetKrw: 1, budgetTaxBasis: 'unspecified', startsOn: null, endsOn: null, productionMode: 'studio', campaignTerms: terms, ...over,
  });

  it('creates a requested brief whose columns follow the terms', async () => {
    const r = await createBrandProject({ sql }, owner, input(), now);
    if (!r.ok) throw Error(r.code);
    const row = (await sql.query<Record<string, unknown>>('select status,budget_krw,budget_tax_basis,ends_on,production_mode,criteria,campaign_terms from brand_projects where id=$1', [r.id])).rows[0]!;
    expect(row).toMatchObject({ status: 'requested', budget_tax_basis: 'excluded', production_mode: 'creator' });
    expect(Number(row.budget_krw)).toBe(3_000_000);
    expect(row.criteria).toMatchObject({ platforms: ['tiktok'], minFollowers: 5000 });
    expect(row.campaign_terms).toEqual(terms);
    const project = await loadBrandProject({ sql }, owner, r.id);
    expect(project?.campaignTerms).toEqual(terms);
    expect(project?.endsOn).toBe('2026-11-30');
  });

  it('refuses terms that turn off the ad label, or whose deadline has passed', async () => {
    expect(await createBrandProject({ sql }, owner, input({ campaignTerms: { ...terms, schedule: { ...terms.schedule, disclosure: false } } }), now))
      .toMatchObject({ ok: false, code: 'invalid', field: 'campaignTerms.schedule.disclosure' });
    expect(await createBrandProject({ sql }, owner, input({ campaignTerms: { ...terms, schedule: { ...terms.schedule, applicationsCloseOn: '2026-10-22' } } }), now))
      .toMatchObject({ ok: false, code: 'invalid', field: 'campaignTerms.schedule.applicationsCloseOn' });
    expect(await createBrandProject({ sql }, owner, input({ campaignTerms: { ...terms, reward: { ...terms.reward, slots: 31 } } }), now))
      .toMatchObject({ ok: false, code: 'invalid', field: 'campaignTerms.reward.totalBudgetKrw' });
    expect((await sql.query('select id from brand_projects')).rows).toEqual([]);
  });

  it('keeps an ordinary brief without terms exactly as before', async () => {
    const r = await createBrandProject({ sql }, owner, input({ campaignTerms: undefined, budgetKrw: 5_000_000, productionMode: 'studio' }), now);
    if (!r.ok) throw Error(r.code);
    const project = await loadBrandProject({ sql }, owner, r.id);
    expect(project).toMatchObject({ campaignTerms: null, budgetKrw: 5_000_000, productionMode: 'studio', status: 'requested' });
  });

  it('replays the same request id without a second brief', async () => {
    const same = input();
    const a = await createBrandProject({ sql }, owner, same, now), b = await createBrandProject({ sql }, owner, same, now);
    expect(a).toEqual(b);
    expect((await sql.query('select id from brand_projects')).rows).toHaveLength(1);
  });
});
