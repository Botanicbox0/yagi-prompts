import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createStudioJob, cancelStudioJob, previewStudioPrompt, analyzeStudioFilm, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { loadStudioState, runStudioOperation } from '@/lib/brand-studio/service';
import { loadAllowance, studioMonthWindow, usageKrw } from '@/lib/brand-studio/usage';
import { studioEnv } from '@/lib/brand-studio/env';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const image = (over: Record<string, unknown> = {}) => ({
  kind: 'image', organizationId: f.orgId, requestId: requestId(), model: 'seedream-5.5', prompt: 'a glass bottle on wet stone',
  aspect: '3:4', resolution: '2K', count: 2, ...over,
});

describe('usage arithmetic (existing FX and margins only)', () => {
  it('converts provider USD with 1,400 KRW/USD and the brand image markup / video margin', () => {
    expect(usageKrw(0.09, 'image')).toBe(150); // 0.09 x 1,400 x 1.12 = 141.12, counted as 15 whole credits
    expect(usageKrw(1, 'video')).toBe(1560); // 1 x 1,400 x 1.11 = 1,554, counted as 156 whole credits
    expect(usageKrw(0.5, 'image')).toBe(790); // 784 exactly is 79 credits, not 78 (no float creep either way)
    expect(usageKrw(1, 'image')).toBe(1570);
    expect(usageKrw(0, 'image')).toBe(0);
    expect(usageKrw(-1, 'video')).toBe(0);
  });

  it('uses the Asia/Seoul calendar month', () => {
    const w = studioMonthWindow(new Date('2026-11-30T16:00:00Z')); // 2026-12-01 01:00 in Seoul
    expect(w.start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    const n = studioMonthWindow(new Date('2026-11-10T03:00:00Z'));
    expect([n.start.toISOString(), n.end.toISOString()]).toEqual(['2026-10-31T15:00:00.000Z', '2026-11-30T15:00:00.000Z']);
  });
});

describe('job.create', () => {
  it('creates a job with its slots and an estimate, without touching a provider', async () => {
    const created = await createStudioJob(deps, viewerOf(f.ids.editor), image());
    // A lane is free, so it starts `queued` on it rather than flashing "waiting for a slot".
    expect(created).toMatchObject({ ok: true, job: { kind: 'image', status: 'queued', expected: 2, aspect: '3:4', resolution: '2K', outputs: [], errorCode: null } });
    if (!created.ok) throw new Error();
    // Two pictures at $0.035 list: each is billed 4 cents and counted on its own.
    expect(created.job.estimateKrw).toBe(2 * usageKrw(0.04, 'image'));
    expect(deps.provider.tasks.size).toBe(0);
    expect((await f.sql.query('select count(*)::int as n from brand_studio_outputs where job_id = $1', [created.job.id])).rows[0]).toEqual({ n: 2 });
    expect((await f.sql.query('select lane from brand_studio_jobs where id = $1', [created.job.id])).rows[0]).toEqual({ lane: 'sunra_api' });
  });

  it('starts held only while every lane is full, and then waits behind older held jobs', async () => {
    const full = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_API_CONCURRENCY: '1', BRAND_STUDIO_MCP_CONCURRENCY: '1' }) });
    const first = await createStudioJob(full, viewerOf(f.ids.owner), image({ count: 1 }));
    const second = await createStudioJob(full, viewerOf(f.ids.owner), image({ count: 1 }));
    expect(first).toMatchObject({ ok: true, job: { status: 'queued' } });
    // The account lane has no worker heartbeat, so the API lane's one slot is all there is.
    expect(second).toMatchObject({ ok: true, job: { status: 'held' } });
    if (!second.ok) throw new Error();
    expect((await f.sql.query('select lane from brand_studio_jobs where id = $1', [second.job.id])).rows[0]).toEqual({ lane: null });
  });

  it('is idempotent per member and request id; a different kind under the same key is a conflict', async () => {
    const input = image();
    const first = await createStudioJob(deps, viewerOf(f.ids.owner), input);
    const again = await createStudioJob(deps, viewerOf(f.ids.owner), input);
    expect(first.ok && again.ok && again.job.id === first.job.id).toBe(true);
    expect((await f.sql.query('select count(*)::int as n from brand_studio_jobs')).rows[0]).toEqual({ n: 1 });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), { ...input, kind: 'video', aspect: '9:16', resolution: '720p', seconds: 5 })).toEqual({ ok: false, code: 'conflict' });
    // Another member may use the same key: it is theirs.
    expect((await createStudioJob(deps, viewerOf(f.ids.editor), input)).ok).toBe(true);
  });

  it('lets owners and editors create; viewers and campaign guests read only; outsiders see nothing', async () => {
    expect((await createStudioJob(deps, viewerOf(f.ids.owner), image())).ok).toBe(true);
    expect((await createStudioJob(deps, viewerOf(f.ids.editor), image())).ok).toBe(true);
    expect(await createStudioJob(deps, viewerOf(f.ids.viewer), image())).toEqual({ ok: false, code: 'forbidden' });
    expect(await createStudioJob(deps, viewerOf(f.ids.guest), image())).toEqual({ ok: false, code: 'forbidden' });
    expect(await createStudioJob(deps, viewerOf(f.ids.outsider), image())).toEqual({ ok: false, code: 'not_found' });
    expect(await createStudioJob(deps, { ...viewerOf(f.ids.owner), userId: null }, image())).toEqual({ ok: false, code: 'sign_in_required' });
    const asViewer = await loadStudioState(deps, viewerOf(f.ids.viewer), f.orgId);
    expect(asViewer).toMatchObject({ ok: true, canCreate: false });
    if (asViewer.ok) expect(asViewer.jobs).toHaveLength(2);
    expect(await loadStudioState(deps, viewerOf(f.ids.guest), f.orgId)).toMatchObject({ ok: true, canCreate: false, campaigns: [{ id: f.projectId }] });
    expect(await loadStudioState(deps, viewerOf(f.ids.outsider), f.orgId)).toEqual({ ok: false, code: 'not_found' });
    expect(await runStudioOperation(deps, viewerOf(f.ids.viewer), 'asset.reserve', { organizationId: f.orgId, requestId: requestId(), name: 'a.png', mime: 'image/png', sizeBytes: 10 })).toEqual({ ok: false, code: 'forbidden' });
  });

  it('refuses what the model does not offer, models not yet live, and unknown operations', async () => {
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ aspect: '5:4' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ resolution: '4K' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ model: 'seedream-5-pro' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ model: 'seedance-2.5' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 5 }))).toEqual({ ok: false, code: 'invalid' });
    expect(await runStudioOperation(deps, viewerOf(f.ids.owner), 'job.explode', { organizationId: f.orgId })).toEqual({ ok: false, code: 'invalid' });
  });

  it('refuses a reference that is missing, deleted, from another organization, or named in the prompt but not in the tray', async () => {
    const asset = await seedImageAsset(deps, f.orgId, f.ids.owner);
    expect((await createStudioJob(deps, viewerOf(f.ids.owner), image({ references: [{ assetId: asset, role: 'product' }] }))).ok).toBe(true);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ references: [{ assetId: randomUUID() }] }))).toEqual({ ok: false, code: 'reference_missing' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ prompt: '이미지 2의 병을 이미지 1 위에', references: [{ assetId: asset }] }))).toEqual({ ok: false, code: 'reference_missing' });
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ prompt: 'put image 1 on stone', references: [{ assetId: asset }] }))).toMatchObject({ ok: true });
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [asset]);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ references: [{ assetId: asset }] }))).toEqual({ ok: false, code: 'reference_missing' });
  });

  it('caps open jobs per organization at six', async () => {
    for (let i = 0; i < 6; i++) expect((await createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 1 }))).ok).toBe(true);
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 1 }))).toEqual({ ok: false, code: 'too_many_running' });
  });
});

describe('the monthly allowance', () => {
  it('is closed with no row and a default of 0, and closed by a row of 0', async () => {
    await f.sql.query('delete from brand_studio_allowances');
    expect(await createStudioJob(deps, viewerOf(f.ids.owner), image())).toEqual({ ok: false, code: 'allowance_closed' });
    const opened = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_MONTHLY_KRW: '50000' }) });
    expect((await createStudioJob(opened, viewerOf(f.ids.owner), image())).ok).toBe(true);
    await f.sql.query('insert into brand_studio_allowances (organization_id, monthly_cap_krw) values ($1, 0)', [f.orgId]);
    expect(await createStudioJob(opened, viewerOf(f.ids.owner), image())).toEqual({ ok: false, code: 'allowance_closed' });
  });

  it('cannot be overspent by two concurrent requests, and failed or canceled jobs give their reservation back', async () => {
    const one = usageKrw(0.04, 'image');
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = $2 where organization_id = $1', [f.orgId, one + Math.floor(one / 2)]);
    const results = await Promise.all([
      createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 1 })),
      createStudioJob(deps, viewerOf(f.ids.editor), image({ count: 1 })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'allowance_exhausted' }]);
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(one);
    const winner = results.find((r) => r.ok)!;
    if (!winner.ok) throw new Error();
    expect(await cancelStudioJob(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, jobId: winner.job.id })).toEqual({ ok: true });
    expect((await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw).toBe(0);
    expect((await createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 1 }))).ok).toBe(true);
  });
});

describe('scale hardening R-03 & R-08', () => {
  it('R-03: blocks prompt.enhance and film.analyze when allowance cap <= 0, rate-limits uncached bursts, and serves cached film sheets freely', async () => {
    const clip = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const previewInput = (prompt: string) => ({
      kind: 'video' as const,
      organizationId: f.orgId,
      model: 'seedance-2.5',
      prompt,
      aspect: '9:16',
      resolution: 'draft' as const,
      seconds: 5,
    });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 0 where organization_id = $1', [f.orgId]);
    expect(await previewStudioPrompt(deps, viewerOf(f.ids.owner), previewInput('rain on glass'))).toEqual({
      ok: false,
      code: 'allowance_closed',
    });
    expect(await analyzeStudioFilm(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, assetId: clip, depth: 'blueprint' })).toEqual({
      ok: false,
      code: 'allowance_closed',
    });

    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 500000 where organization_id = $1', [f.orgId]);
    for (let i = 0; i < 20; i++) {
      const ok = await previewStudioPrompt(deps, viewerOf(f.ids.owner), previewInput(`studio bottle take ${i}`));
      expect(ok.ok).toBe(true);
    }
    expect(await previewStudioPrompt(deps, viewerOf(f.ids.owner), previewInput('studio bottle overflow'))).toEqual({
      ok: false,
      code: 'too_many_running',
    });

    // First film.analyze populates storedSheet; subsequent cached reads bypass the uncached rate limit.
    const firstRead = await analyzeStudioFilm(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, assetId: clip, depth: 'blueprint' });
    expect(firstRead.ok).toBe(true);
    for (let i = 0; i < 10; i++) {
      const cached = await analyzeStudioFilm(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, assetId: clip, depth: 'blueprint' });
      expect(cached.ok).toBe(true);
    }
    expect(deps.intel.calls.film).toBe(1);
  });

  it('R-08: loadStudioState keeps video jobs visible even after more than 60 newer image jobs', async () => {
    const videoRes = await createStudioJob(deps, viewerOf(f.ids.owner), {
      kind: 'video',
      organizationId: f.orgId,
      requestId: requestId(),
      model: 'seedance-2.5',
      prompt: 'a perfume bottle in morning mist',
      aspect: '9:16',
      resolution: 'draft',
      seconds: 5,
    });
    expect(videoRes.ok).toBe(true);
    if (!videoRes.ok) throw new Error('expected video job');
    await f.sql.query("update brand_studio_jobs set status = 'canceled', finished_at = now() where id = $1", [videoRes.job.id]);

    for (let i = 0; i < 65; i++) {
      const img = await createStudioJob(deps, viewerOf(f.ids.owner), image({ count: 1, prompt: 'clean ceramic bottle on stone' }));
      if (!img.ok) throw new Error(`img ${i}: ${img.code}`);
      await f.sql.query("update brand_studio_jobs set status = 'canceled', finished_at = now() where id = $1", [img.job.id]);
    }

    const loaded = await loadStudioState(deps, viewerOf(f.ids.owner), f.orgId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('expected state');
    expect(loaded.jobs.some((j) => j.id === videoRes.job.id)).toBe(true);
  });
});
