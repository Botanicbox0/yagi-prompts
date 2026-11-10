import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { analyzeStudioFilm, cancelStudioJob, createStudioJob } from '@/lib/brand-studio/jobs';
import { createFakeStudioProvider } from '@/lib/brand-studio/provider/fake';
import { pollStudioJobs } from '@/lib/brand-studio/service';
import { loadAllowance } from '@/lib/brand-studio/usage';
import type { StudioJobView } from '@/lib/brand-studio/contracts';
import { requestId, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** Cancel, the fields "같은 설정으로 다시 만들기" needs, and a reference video read once. */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const image = { kind: 'image', model: 'seedream-5-pro', prompt: 'a glass bottle on wet stone', aspect: '16:9', resolution: '2K', count: 1 };
async function create(input: Record<string, unknown>): Promise<StudioJobView> {
  const result = await createStudioJob(deps, owner(), { organizationId: f.orgId, requestId: requestId(), ...input });
  if (!result.ok) throw new Error(`create failed: ${result.code}`);
  return result.job;
}
async function view(id: string): Promise<StudioJobView> {
  const poll = await pollStudioJobs(deps, owner(), f.orgId, [id]);
  if (!poll.ok) throw new Error(poll.code);
  return poll.jobs[0]!;
}
const cancel = (jobId: string) => cancelStudioJob(deps, owner(), { organizationId: f.orgId, jobId });
const used = async () => (await loadAllowance(f.sql, f.orgId, deps.env)).usedKrw;

describe('job.cancel', () => {
  it('stops a waiting run and gives its usage back', async () => {
    const job = await create(image);
    expect(await used()).toBe(job.estimateKrw);
    expect(await cancel(job.id)).toEqual({ ok: true });
    expect(await view(job.id)).toMatchObject({ status: 'canceled', estimateKrw: 0 });
    expect(await used()).toBe(0);
  });

  it('refuses once the provider has the run, and the run keeps its reservation', async () => {
    deps = studioDeps(f.sql, { provider: createFakeStudioProvider({ pollsBeforeDone: 3 }) as never });
    const job = await create(image);
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('running');
    expect(await cancel(job.id)).toEqual({ ok: false, code: 'conflict' });
    expect(await used()).toBe(job.estimateKrw);
  });

  it('refuses while a prepared run may be on its way to the provider, or once a slot was sent', async () => {
    const leased = await create(image);
    await f.sql.query(`update brand_studio_jobs set work = '{"prepared": true}'::jsonb, claimed_at = now() where id = $1`, [leased.id]);
    expect(await cancel(leased.id)).toEqual({ ok: false, code: 'conflict' });
    // A lease left by a crashed invocation does not hold it.
    await f.sql.query("update brand_studio_jobs set claimed_at = now() - interval '10 minutes' where id = $1", [leased.id]);
    expect(await cancel(leased.id)).toEqual({ ok: true });

    const sent = await create(image);
    await f.sql.query("update brand_studio_outputs set provider_task_id = 'task-1' where job_id = $1", [sent.id]);
    expect(await cancel(sent.id)).toEqual({ ok: false, code: 'conflict' });
  });
});

describe('what a run carries for "같은 설정으로 다시 만들기"', () => {
  it('gives a partial edit its box and its picture, a reference-video run its method, keep and change', async () => {
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 64, height: 48 });
    const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const edit = await create({ kind: 'region_edit', model: 'nano-banana-pro', prompt: '라벨만', source: { assetId: source }, box });
    expect(edit).toMatchObject({ parentAssetId: source, parentOutputId: null, box, method: null, keep: [], change: null });

    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const remix = await create({ kind: 'video_remix', model: 'seedance-2.5', prompt: '', change: '병을 파란 병으로', method: 'edit', keep: ['timing', 'camera'], aspect: '9:16', resolution: 'draft', audio: 'ambient', references: [{ assetId: film }] });
    expect(remix).toMatchObject({ method: 'edit', keep: ['timing', 'camera'], change: '병을 파란 병으로', audio: 'ambient', box: null, parentAssetId: null });

    const plain = await create(image);
    expect(plain).toMatchObject({ box: null, method: null, keep: [], change: null, parentAssetId: null });
  });
});

describe('reference-video limits (models.ts referenceVideoSeconds / referenceVideoPixels)', () => {
  async function film(ms: number | null, width: number | null, height: number | null): Promise<string> {
    const { key } = await deps.media.put(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), 'video/mp4');
    return (
      await f.sql.query<{ id: string }>(
        `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by)
          values ($1, 'video', 'ref film', 'video/mp4', 12, $2, $3, $4, $5, 'upload', 'ready', $6) returning id`,
        [f.orgId, width, height, ms, key, f.ids.owner],
      )
    ).rows[0]!.id;
  }
  const remix = async (assetId: string, method: 'edit' | 'reference') =>
    createStudioJob(deps, owner(), {
      kind: 'video_remix', organizationId: f.orgId, requestId: requestId(), model: 'seedance-2.5', prompt: '', change: '병을 파란 병으로',
      method, keep: [], aspect: '9:16', seconds: 5, resolution: 'draft', audio: 'native', references: [{ assetId }],
    });

  it('refuses, before reserving anything, a film the provider would refuse', async () => {
    for (const [ms, w, h] of [[1_500, 720, 1280], [31_000, 720, 1280], [6_000, 200, 2400], [6_000, 400, 600], [6_000, 4096, 2160]] as const) {
      expect(await remix(await film(ms, w, h), 'reference'), `${ms} ${w}x${h}`).toEqual({ ok: false, code: 'invalid' });
    }
    expect(await used()).toBe(0);
  });

  it('lets a short clip be followed but not edited, and never blocks on a missing measurement', async () => {
    const short = await film(3_000, 720, 1280);
    expect(await remix(short, 'edit')).toEqual({ ok: false, code: 'invalid' });
    expect((await remix(short, 'reference')).ok).toBe(true);
    expect((await remix(await film(null, null, null), 'edit')).ok).toBe(true);
    expect((await remix(await film(30_000, 3840, 2160), 'edit')).ok).toBe(true);
  });
});

describe('a reference video is read once', () => {
  it('keeps the reading on the asset per language and reuses it for the panel and the run', async () => {
    const film = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);
    const first = await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film });
    const again = await analyzeStudioFilm(deps, owner(), { organizationId: f.orgId, assetId: film });
    expect(first).toMatchObject({ ok: true, sheet: { summary: '6초, 컷 하나.' } });
    expect(again).toEqual(first);
    expect(deps.intel.calls.film).toBe(1);

    const job = await create({ kind: 'video_remix', model: 'seedance-2.5', prompt: '', change: '병을 파란 병으로', method: 'reference', keep: [], aspect: '9:16', seconds: 5, resolution: 'draft', audio: 'native', references: [{ assetId: film }] });
    await advanceStudioJobsWith(deps, { jobIds: [job.id] });
    expect((await view(job.id)).status).toBe('succeeded');
    expect(deps.intel.calls.film).toBe(1);

    // Another language is another reading.
    await analyzeStudioFilm(deps, viewerOf(f.ids.owner, 'en'), { organizationId: f.orgId, assetId: film });
    expect(deps.intel.calls.film).toBe(2);
  });
});
