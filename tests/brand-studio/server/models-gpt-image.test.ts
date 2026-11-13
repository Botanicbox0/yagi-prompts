import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStudioRequest, hasSafetyChecker, type StudioRequestInput } from '@/lib/brand-studio/provider/requests';
import {
  STUDIO_IMAGE_QUALITIES,
  estimateImageUsd,
  pixelSize,
  regionEditModels,
  selectableModels,
  studioModel,
  type StudioImageModel,
} from '@/lib/brand-studio/models';
import { ImageJobSchema, RegionEditJobSchema } from '@/lib/brand-studio/contracts';
import { regionEditModel, regionEditRun, usageKrw } from '@/lib/brand-studio/usage-rate';
import { PROFILE_BLOCKS } from '@/lib/brand-studio/enhancer/profiles';
import { bindReferences, tokensIn } from '@/lib/brand-studio/enhancer/references';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import { laneClaim } from '@/lib/brand-studio/lane-api';
import { recordLaneHeartbeat } from '@/lib/brand-studio/lanes';
import type { StudioJobParams } from '@/lib/brand-studio/types';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/**
 * GPT Image 2.6 Flare / Sunburst (docs/BRAND-STUDIO-V3.md §4 "새 모델"). API lane facts from the Sunra
 * catalogue (OpenAPI documents, 2026-11-11); account lane facts and prices from its `list_models` and
 * `estimate_cost` (2026-11-11). The API parameter lists below are copied from those documents; the
 * request builder may send nothing else.
 */
const CATALOGUE = {
  'text-to-image': { required: ['prompt'], keys: ['prompt', 'n', 'width', 'height', 'quality', 'reasoning_effort', 'background', 'output_format', 'output_compression'] },
  'image-editing': { required: ['prompt', 'images'], keys: ['prompt', 'n', 'width', 'height', 'quality', 'reasoning_effort', 'background', 'output_format', 'output_compression', 'images', 'mask', 'markup'] },
} as const;
const API_QUALITY = ['auto', 'low', 'medium', 'high'];
const IDS = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'] as const;
/** Account-lane credits per image (1 credit = US$0.01), the same for both models. */
const CENTS = { low: { '1K': 3, '2K': 6, '4K': 9 }, medium: { '1K': 5, '2K': 9, '4K': 15 }, high: { '1K': 6, '2K': 11, '4K': 18 } } as const;

const params = (patch: Partial<StudioJobParams> = {}): StudioJobParams => ({ aspect: '4:3', resolution: '2K', seconds: null, audio: null, count: 1, locale: 'ko', ...patch });
const gpt = (id: string) => studioModel(id) as StudioImageModel;

function expectCatalogueShape(request: { endpoint: string; body: Record<string, unknown> }, alias: string) {
  const name = request.endpoint.slice(alias.length + 1) as keyof typeof CATALOGUE;
  expect(request.endpoint.startsWith(`${alias}/`)).toBe(true);
  const schema = CATALOGUE[name];
  expect(schema, request.endpoint).toBeDefined();
  for (const key of Object.keys(request.body)) expect(schema.keys as readonly string[], `${request.endpoint} has no "${key}"`).toContain(key);
  for (const key of schema.required) expect(request.body).toHaveProperty(key);
  expect(API_QUALITY).toContain(request.body.quality);
  const { width, height } = request.body as { width: number; height: number };
  for (const side of [width, height]) expect(side >= 16 && side <= 3840, `${side}`).toBe(true);
}

describe('GPT Image 2.6 in the registry', () => {
  it('is selectable on both lanes with the catalogue facts', () => {
    for (const id of IDS) {
      const model = gpt(id);
      expect(model).toMatchObject({
        availability: 'live',
        medium: 'image',
        promptProfile: 'gpt-image',
        mcp: { model: id },
        regionEdit: true,
        maxReferences: 16,
        resolutions: ['1K', '2K', '4K'],
        defaultResolution: '1K',
        qualities: ['low', 'medium', 'high'],
        defaultQuality: 'medium',
      });
      expect([...model.aspects].sort()).toEqual(['1:1', '16:9', '2:3', '3:2', '3:4', '4:3', '9:16'].sort());
      expect(model.api.alias).toBe(`openai/${id}`);
      expect(model.endpoints).toEqual({ textToImage: 'text-to-image', edit: 'image-editing' });
      expect(selectableModels('image').map((m) => m.id)).toContain(id);
      expect(regionEditModels().map((m) => m.id)).toContain(id);
      expect(regionEditModel(id).id).toBe(id);
      expect(hasSafetyChecker(model)).toBe(false);
    }
    // No other model offers a quality choice.
    for (const model of selectableModels('image')) if (!(IDS as readonly string[]).includes(model.id)) expect((model as StudioImageModel).qualities).toBeUndefined();
  });

  it('prices one image from the account lane table, the same for both, with no reference surcharge', () => {
    for (const id of IDS)
      for (const quality of STUDIO_IMAGE_QUALITIES)
        for (const resolution of ['1K', '2K', '4K'] as const) {
          expect(estimateImageUsd({ model: id, resolution, references: 0, quality })).toBeCloseTo(CENTS[quality][resolution] / 100, 10);
          expect(estimateImageUsd({ model: id, resolution, references: 9, quality })).toBe(estimateImageUsd({ model: id, resolution, references: 0, quality }));
        }
    // No quality: the default (medium).
    expect(estimateImageUsd({ model: IDS[0], resolution: '2K', references: 0 })).toBeCloseTo(0.09, 10);
    expect(regionEditRun(IDS[1], 2, 'high').usd).toBeCloseTo(0.11, 10);
  });

  it('has a size for every ratio and tier it offers, matching the ratio', () => {
    for (const id of IDS) {
      const model = gpt(id);
      for (const resolution of model.resolutions)
        for (const aspect of model.aspects) {
          const size = pixelSize(model, resolution, aspect);
          expect(size, `${resolution} ${aspect}`).not.toBeNull();
          const [w, h] = size!;
          const [a, b] = aspect.split(':').map(Number);
          expect(Math.abs(w / h / (a! / b!) - 1), `${resolution} ${aspect}`).toBeLessThan(0.01);
          expect(Math.max(w, h)).toBeLessThanOrEqual(3840);
        }
      // A region crop's own shape takes the closest listed size.
      expect(pixelSize(model, '2K', '5:4')).toEqual([2048, 1536]);
    }
    expect(pixelSize(studioModel('seedream-5.5') as StudioImageModel, '2K', '1:1')).toBeNull();
  });
});

describe('GPT Image 2.6 on the API lane', () => {
  const base = (patch: Partial<StudioRequestInput>): StudioRequestInput => ({ kind: 'image', model: IDS[0], prompt: 'a bottle', params: params(), images: [], videos: [], ...patch });

  it('turns ratio and tier into width and height and passes the planned quality', () => {
    for (const id of IDS) {
      const request = buildStudioRequest(base({ model: id, params: params({ aspect: '9:16', resolution: '4K', quality: 'low' }) }));
      expect(request.endpoint).toBe(`openai/${id}/text-to-image`);
      expect(request.body).toEqual({ prompt: 'a bottle', width: 2160, height: 3840, quality: 'low' });
      expectCatalogueShape(request, `openai/${id}`);
    }
    expect(buildStudioRequest(base({ params: params({ aspect: '3:2', resolution: '1K' }) })).body).toMatchObject({ width: 1536, height: 1024, quality: 'medium' });
  });

  it('sends references to the edit endpoint as `images`', () => {
    const request = buildStudioRequest(base({ params: params({ quality: 'high' }), images: [{ url: 'https://m/1.png' }, { url: 'https://m/2.png' }] }));
    expect(request.endpoint).toBe('openai/gpt-image-2.6-flare/image-editing');
    expect(request.body).toMatchObject({ images: ['https://m/1.png', 'https://m/2.png'], width: 2048, height: 1536, quality: 'high' });
    expectCatalogueShape(request, 'openai/gpt-image-2.6-flare');
  });

  it('edits a region with the crop first and the references after', () => {
    const request = buildStudioRequest(
      base({ kind: 'region_edit', model: IDS[1], params: params({ resolution: '2K', quality: 'high' }), images: [{ url: 'https://m/logo.png' }], regionCrop: { url: 'https://m/crop.png', aspect: '3:4' } }),
    );
    expect(request.endpoint).toBe('openai/gpt-image-2.6-sunburst/image-editing');
    expect(request.body).toMatchObject({ images: ['https://m/crop.png', 'https://m/logo.png'], width: 1536, height: 2048, quality: 'high', output_format: 'png' });
    expectCatalogueShape(request, 'openai/gpt-image-2.6-sunburst');
  });
});

describe('the quality field', () => {
  const ORG = '00000000-0000-4000-8000-0000000000aa';
  const job = { organizationId: ORG, requestId: 'press-0001', model: IDS[0], prompt: 'x', aspect: '1:1', resolution: '1K' };
  const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };

  it('is optional on image and partial-edit jobs and takes only low, medium or high', () => {
    for (const quality of STUDIO_IMAGE_QUALITIES) expect(ImageJobSchema.safeParse({ kind: 'image', ...job, quality }).success).toBe(true);
    expect(ImageJobSchema.safeParse({ kind: 'image', ...job }).success).toBe(true);
    expect(ImageJobSchema.safeParse({ kind: 'image', ...job, quality: 'ultra' }).success).toBe(false);
    expect(RegionEditJobSchema.safeParse({ kind: 'region_edit', ...job, source: { outputId: ORG }, box, quality: 'high' }).success).toBe(true);
    expect(RegionEditJobSchema.safeParse({ kind: 'region_edit', ...job, source: { outputId: ORG }, box, quality: 'auto' }).success).toBe(false);
  });

  describe('through the planner and both lanes', () => {
    let f: StudioFixture;
    let deps: ReturnType<typeof studioDeps>;
    beforeEach(async () => {
      f = await studioFixture();
      deps = studioDeps(f.sql);
    });
    afterEach(async () => {
      await f.db.close();
    });
    const create = (input: Record<string, unknown>) =>
      createStudioJob(deps, viewerOf(f.ids.owner), { kind: 'image', organizationId: f.orgId, requestId: requestId(), prompt: 'a glass bottle', enhance: false, aspect: '1:1', resolution: '1K', count: 2, ...input });

    it('stores the quality, prices it, refuses it for a model without qualities and defaults it', async () => {
      const high = await create({ model: IDS[0], quality: 'high' });
      expect(high).toMatchObject({ ok: true, job: { quality: 'high', model: IDS[0] } });
      if (high.ok) expect(high.job.estimateKrw).toBe(usageKrw(0.06 * 2, 'image'));
      const plain = await create({ model: IDS[1] });
      expect(plain).toMatchObject({ ok: true, job: { quality: 'medium' } });
      expect(await create({ model: 'seedream-5.5', quality: 'high' })).toEqual({ ok: false, code: 'invalid' });
      const seedream = await create({ model: 'seedream-5.5' });
      expect(seedream.ok && seedream.job.quality).toBeFalsy();
    });

    it('hands the account lane its model id, ratio, tier and quality', async () => {
      await recordLaneHeartbeat(f.sql, 'sunra_mcp', { host: 'test' });
      await f.sql.query("update brand_studio_allowances set preferred_lane = 'sunra_mcp' where organization_id = $1", [f.orgId]);
      const created = await create({ model: IDS[1], quality: 'low', aspect: '16:9', resolution: '2K', count: 1 });
      if (!created.ok) throw new Error(created.code);
      await advanceStudioJobsWith(deps, { jobIds: [created.job.id] });
      const claimed = await laneClaim(deps, { limit: 1 });
      if (!claimed.ok) throw new Error(claimed.code);
      expect(claimed.jobs[0]).toMatchObject({ jobId: created.job.id, model: 'gpt-image-2.6-sunburst', params: { aspect: '16:9', resolution: '2K', quality: 'low' } });
    });
  });

  it('is passed to create_image by the lane worker', () => {
    const worker = readFileSync(join(process.cwd(), 'scripts/brand-studio-lane-worker.mjs'), 'utf8');
    const call = worker.slice(worker.indexOf("tool: 'create_image'"), worker.indexOf("tool: 'create_image'") + 600);
    expect(call).toMatch(/p\.quality \? \{ quality: p\.quality \} : \{\}/);
  });
});

describe('the gpt-image prompt profile', () => {
  it('is registered and asks for quoted on-image text and numbered images', () => {
    const block = PROFILE_BLOCKS['gpt-image'];
    expect(block).toMatch(/instruction/i);
    expect(block).toMatch(/double quotes/);
    expect(block).toMatch(/"image 1"/);
  });

  it('names references "image N" (after the cut-out in a region edit)', () => {
    const refs = [{ index: 1, kind: 'image' as const, label: '이미지 1', role: 'logo' as const }];
    expect(bindReferences({ kind: 'image', profile: 'gpt-image', references: refs }).bound[0]!.token).toBe('image 1');
    const edit = bindReferences({ kind: 'region_edit', profile: 'gpt-image', references: refs });
    expect(edit.bound[0]!.token).toBe('image 2');
    expect(edit.editTarget).toBe('image 1');
    expect(tokensIn('gpt-image', 'Use image 2 for the logo')).toEqual([{ kind: 'image', number: 2 }]);
  });
});
