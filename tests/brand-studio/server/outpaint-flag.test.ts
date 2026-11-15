import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { jobsOf } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs } from '@/lib/brand-studio/service';
import { loadStudioSummary } from '@/lib/brand-studio/summary';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { brandStudioOutpaintOpen } from '@/lib/flags';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * "빈 곳 채우기" in the layer editor is built but not proven with a real model, so it ships switched
 * off: the server says it is on only when `BRAND_STUDIO_OUTPAINT=on`, and the editor renders nothing
 * unless the studio state carries `canFillEmpty`.
 */
describe('BRAND_STUDIO_OUTPAINT', () => {
  it('is off unless the environment says exactly "on"', () => {
    expect(brandStudioOutpaintOpen({})).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'ON' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: '1' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'true' })).toBe(false);
    expect(brandStudioOutpaintOpen({ BRAND_STUDIO_OUTPAINT: 'on' })).toBe(true);
    expect(studioEnv({}).outpaint).toBe(false);
    expect(studioEnv({ BRAND_STUDIO_OUTPAINT: 'on' }).outpaint).toBe(true);
  });
});

describe('studio state', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const load = async (env: Record<string, string>, who = f.ids.owner) => {
    const base = studioDeps(f.sql);
    const deps = { ...base, env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...env }) };
    const state = await loadStudioState(deps, viewerOf(who), f.orgId);
    if (!state.ok) throw new Error(state.code);
    return state;
  };

  it('carries no fill capability by default', async () => {
    const state = await load({});
    expect(state).not.toHaveProperty('canFillEmpty');
  });

  it('carries it when the flag is on, for members who can create', async () => {
    expect((await load({ BRAND_STUDIO_OUTPAINT: 'on' })).canFillEmpty).toBe(true);
    expect((await load({ BRAND_STUDIO_OUTPAINT: 'on' }, f.ids.editor)).canFillEmpty).toBe(true);
    expect(await load({ BRAND_STUDIO_OUTPAINT: 'on' }, f.ids.viewer)).not.toHaveProperty('canFillEmpty');
  });
});

describe('a fill strip is an internal run', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const depsWith = (env: Record<string, string>) => ({
    ...studioDeps(f.sql),
    env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...env }),
  });
  const strip = (source: string, purpose?: 'fill') => ({
    kind: 'region_edit',
    organizationId: f.orgId,
    requestId: requestId(),
    model: 'nano-banana-pro',
    prompt: 'The flat grey band along the RIGHT edge is empty canvas.',
    enhance: false,
    source: { assetId: source },
    box: { x: 0.7, y: 0, w: 0.3, h: 1 },
    ...(purpose ? { purpose } : {}),
  });

  it('is refused while the flag is off', async () => {
    const deps = depsWith({});
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), strip(source, 'fill'))).toMatchObject({ ok: false, code: 'feature_unavailable' });
    // An ordinary partial edit is not affected.
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), strip(source))).toMatchObject({ ok: true });
  });

  it('is never listed, is returned by id, and counts toward usage like any run', async () => {
    const deps = depsWith({ BRAND_STUDIO_OUTPAINT: 'on' });
    const owner = viewerOf(f.ids.owner);
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const usedBefore = (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;
    const fill = await createStudioJob(deps, owner, strip(source, 'fill'));
    const plain = await createStudioJob(deps, owner, strip(source));
    if (!fill.ok || !plain.ok) throw new Error('create failed');
    expect(fill.job.purpose).toBe('fill');
    expect(plain.job).not.toHaveProperty('purpose');
    const stored = (await f.sql.query<{ params: Record<string, unknown> }>('select params from brand_studio_jobs where id = $1', [fill.job.id])).rows[0]!;
    expect(stored.params.purpose).toBe('fill');
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBeGreaterThan(usedBefore);

    await advanceStudioJobsWith(deps, { jobIds: [fill.job.id, plain.job.id] });

    const state = await loadStudioState(deps, owner, f.orgId);
    if (!state.ok) throw new Error(state.code);
    expect(state.jobs.map((j) => j.id)).toEqual([plain.job.id]);
    expect((await jobsOf(f.sql, f.orgId)).map((j) => j.id)).toEqual([plain.job.id]);
    const summary = await loadStudioSummary({ sql: f.sql, env: deps.env }, owner, f.orgId);
    if (!summary.ok) throw new Error(summary.code);
    expect([...summary.open, ...summary.settled].map((j) => j.id)).not.toContain(fill.job.id);

    const poll = await pollStudioJobs(deps, owner, f.orgId, [fill.job.id]);
    if (!poll.ok) throw new Error(poll.code);
    expect(poll.jobs[0]).toMatchObject({ id: fill.job.id, purpose: 'fill', status: 'succeeded' });
    expect(poll.jobs[0]!.outputs).toHaveLength(1);
    // Usage: both runs, the fill as much as the plain one.
    const used = (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw - usedBefore;
    const rows = (await f.sql.query<{ id: string; u: number }>('select id, coalesce(usage_krw, estimate_krw)::int as u from brand_studio_jobs where id = any($1::uuid[])', [[fill.job.id, plain.job.id]])).rows;
    expect(rows).toHaveLength(2);
    expect(used).toBe(rows.reduce((s, r) => s + Number(r.u), 0));
  });
});
