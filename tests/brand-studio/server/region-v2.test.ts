import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { studioEnv } from '@/lib/brand-studio/env';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { REGION_V2_MODEL, studioModel, type StudioImageModel } from '@/lib/brand-studio/models';
import { planJob } from '@/lib/brand-studio/plan';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import type { StudioProviderRequest } from '@/lib/brand-studio/provider/types';
import { compositeRegion, cropForEdit, describeSelection, planRegion, planRegionWindow, selectionLine } from '@/lib/brand-studio/region-edit';
import { loadStudioState } from '@/lib/brand-studio/service';
import type { JobRow, OutputRow } from '@/lib/brand-studio/types';
import { regionEditRun, usageKrw } from '@/lib/brand-studio/usage-rate';
import { brandStudioRegionV2Open } from '@/lib/flags';
import { fakeIntel, requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * Region edit v2 (`BRAND_STUDIO_REGION_V2`, docs/BRAND-STUDIO-V6-PLAN.md): one engine for every partial
 * edit, whatever the client sends; a window plan and a change-only paste. Off: exactly as before.
 */
describe('BRAND_STUDIO_REGION_V2', () => {
  it('is off unless the environment says exactly "on"', () => {
    expect(brandStudioRegionV2Open({})).toBe(false);
    expect(brandStudioRegionV2Open({ BRAND_STUDIO_REGION_V2: 'ON' })).toBe(false);
    expect(brandStudioRegionV2Open({ BRAND_STUDIO_REGION_V2: 'true' })).toBe(false);
    expect(brandStudioRegionV2Open({ BRAND_STUDIO_REGION_V2: 'on' })).toBe(true);
    expect(studioEnv({}).regionV2).toBe(false);
    expect(studioEnv({ BRAND_STUDIO_REGION_V2: 'on' }).regionV2).toBe(true);
  });

  it('prices a v2 edit on the one engine, whatever was asked', () => {
    const v2 = regionEditRun('nano-banana-pro', 0, null, true);
    expect(v2.model.id).toBe('seedream-5.5');
    expect(v2.resolution).toBe('2K');
    // $0.035 at 2K + $0.008 for the picture itself.
    expect(v2.usd).toBeCloseTo(0.043, 10);
    expect(regionEditRun('gpt-image-2.6-sunburst', 2, 'high', true).usd).toBeCloseTo(0.059, 10);
    // Off: unchanged.
    expect(regionEditRun('nano-banana-pro', 0).model.id).toBe('nano-banana-pro');
    expect(regionEditRun('seedream-5.5', 0).model.id).toBe('nano-banana-pro');
  });
});

describe('region edit v2 on the server', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  const realIntel = () => ({ ...fakeIntel(), planRegion, planRegionWindow: (image: { width: number; height: number }, box: { x: number; y: number; w: number; h: number }) => planRegionWindow(image, box), cropForEdit, compositeRegion });
  const depsWith = (env: Record<string, string>) => {
    const base = studioDeps(f.sql, { intel: realIntel() as never });
    const submitted: StudioProviderRequest[] = [];
    const submit = base.provider.submit.bind(base.provider);
    base.provider.submit = async (request: StudioProviderRequest) => {
      submitted.push(request);
      return submit(request);
    };
    const puts: string[] = [];
    const put = base.media.put.bind(base.media);
    base.media.put = async (bytes: Uint8Array, mime: string) => {
      puts.push(createHash('sha256').update(bytes).digest('hex'));
      return put(bytes, mime);
    };
    return { ...base, env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api', ...env }), submitted, puts };
  };
  const edit = (source: string, over: Record<string, unknown> = {}) => ({
    kind: 'region_edit',
    organizationId: f.orgId,
    requestId: requestId(),
    model: 'nano-banana-pro',
    prompt: 'make it a gold star',
    enhance: false,
    source: { assetId: source },
    box: { x: 0.25, y: 0.25, w: 0.25, h: 0.25 },
    ...over,
  });
  const jobRow = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;
  const settle = async (deps: ReturnType<typeof depsWith>, id: string) => {
    for (let i = 0; i < 6; i += 1) {
      const row = await jobRow(id);
      if (row.status === 'succeeded' || row.status === 'failed') return row;
      await advanceStudioJobsWith(deps, { jobIds: [id] });
    }
    return jobRow(id);
  };
  const outputBytes = async (deps: ReturnType<typeof depsWith>, jobId: string) => {
    const out = (await f.sql.query<OutputRow>('select * from brand_studio_outputs where job_id = $1', [jobId])).rows[0]!;
    return deps.media.read(out.storage_key!);
  };
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

  it('carries regionV2 in the studio state only when the flag is on, for members who can create', async () => {
    const load = async (env: Record<string, string>, who = f.ids.owner) => {
      const state = await loadStudioState(depsWith(env), viewerOf(who), f.orgId);
      if (!state.ok) throw new Error(state.code);
      return state;
    };
    expect(await load({})).not.toHaveProperty('regionV2');
    expect((await load({ BRAND_STUDIO_REGION_V2: 'on' })).regionV2).toBe(true);
    expect(await load({ BRAND_STUDIO_REGION_V2: 'on' }, f.ids.viewer)).not.toHaveProperty('regionV2');
  });

  it('runs every partial edit on the one engine and never trusts the model or quality sent', async () => {
    const deps = depsWith({ BRAND_STUDIO_REGION_V2: 'on' });
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 640, height: 480 });
    for (const asked of [{ model: 'nano-banana-pro' }, { model: 'gpt-image-2.6-sunburst', quality: 'high' }, { model: 'seedream-5.5' }]) {
      const created = await createStudioJob(deps, viewerOf(f.ids.owner), edit(source, asked));
      if (!created.ok) throw new Error(created.code);
      expect(created.job.model).toBe(REGION_V2_MODEL);
      const row = await jobRow(created.job.id);
      expect(row.model).toBe('seedream-5.5');
      expect(row.params.regionWindow).toBe(true);
      expect(row.params).not.toHaveProperty('quality');
      expect(Number(row.estimate_krw)).toBe(usageKrw(0.043, 'image'));
    }
  });

  it('runs a rerun of an older Nano Banana Pro edit on the one engine and keeps the old run as it was', async () => {
    const off = depsWith({});
    const source = await seedImageAsset(off, f.orgId, f.ids.owner, { width: 640, height: 480 });
    const old = await createStudioJob(off, viewerOf(f.ids.owner), edit(source));
    if (!old.ok) throw new Error(old.code);
    expect(old.job.model).toBe('nano-banana-pro');

    const on = { ...depsWith({ BRAND_STUDIO_REGION_V2: 'on' }), media: off.media };
    // "다시 만들기" sends what the old run was made with.
    const again = await createStudioJob(on, viewerOf(f.ids.owner), edit(source, { model: old.job.model, prompt: old.job.prompt, box: old.job.box }));
    if (!again.ok) throw new Error(again.code);
    expect(again.job.model).toBe('seedream-5.5');
    expect((await jobRow(old.job.id)).model).toBe('nano-banana-pro');
  });

  it('plans a wide window, says where the part is, and pastes back inside the zone only', async () => {
    const deps = depsWith({ BRAND_STUDIO_REGION_V2: 'on' });
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 640, height: 480 });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), edit(source));
    if (!created.ok) throw new Error(created.code);
    const row = await settle(deps, created.job.id);
    expect(row.status).toBe('succeeded');
    const plan = row.work.region!.plan;
    expect(plan.roi).toEqual({ left: 0, top: 0, width: 640, height: 480 });
    expect(plan.aspect).toBe('4:3');
    expect(plan.select).toEqual({ left: 160, top: 120, width: 160, height: 120 });
    expect(row.final_prompt).toBe(`make it a gold star\n${selectionLine(describeSelection(plan))}`);
    const sent = deps.submitted.at(-1)!;
    expect(sent.endpoint).toBe('bytedance/seedream-5.5/image-editing');
    expect(sent.body).toMatchObject({ aspect_ratio: '4:3', resolution: '2K', output_format: 'png' });
    expect(sent.body.prompt).toBe(row.final_prompt);
  });

  it('is exactly today’s partial edit when the flag is off', async () => {
    const deps = depsWith({});
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 640, height: 480 });
    const created = await createStudioJob(deps, viewerOf(f.ids.owner), edit(source));
    if (!created.ok) throw new Error(created.code);
    const row = await settle(deps, created.job.id);
    expect(row.status).toBe('succeeded');
    expect(row.model).toBe('nano-banana-pro');
    expect(row.params).not.toHaveProperty('regionWindow');
    expect(row.final_prompt).toBeNull();

    // The plan, the crop and the request are what the crop method has always made.
    const nano = studioModel('nano-banana-pro') as StudioImageModel;
    const expectedPlan = planRegion({ width: 640, height: 480 }, edit(source).box, nano.aspects);
    expect(row.work.region!.plan).toEqual(expectedPlan);
    const original = await deps.media.read(row.work.region!.sourceKey);
    // The crop is a working file, dropped once the run settles: it was stored as the crop method makes it.
    expect(deps.puts).toContain(sha((await cropForEdit(original, expectedPlan)).bytes));
    const sent = deps.submitted.at(-1)!;
    const expected = buildStudioRequest({
      kind: 'region_edit',
      model: 'nano-banana-pro',
      prompt: 'make it a gold star',
      params: row.params,
      images: [],
      videos: [],
      regionCrop: { url: String((sent.body.images as string[])[0]), aspect: expectedPlan.aspect },
    });
    expect(sent).toEqual(expected);

    // The stored result is today's composite of the same edit.
    const task = [...deps.provider.tasks.keys()].at(-1)!;
    const edited = (await deps.provider.download(`fake://image/${deps.provider.tasks.get(task)!.width}x${deps.provider.tasks.get(task)!.height}/${task}`)).bytes;
    const today = await compositeRegion({ original, edited, plan: expectedPlan });
    expect(sha(await outputBytes(deps, created.job.id))).toBe(sha(today.bytes));

    // And the plan the server makes with the switch off equals the plan without it.
    const input = { ...edit(source), references: [], requestId: 'x' } as never;
    const withOff = await planJob(f.sql, f.orgId, input, deps.media, 'ko', { regionV2: false });
    const without = await planJob(f.sql, f.orgId, input, deps.media, 'ko');
    expect(withOff).toEqual(without);
  });
});
