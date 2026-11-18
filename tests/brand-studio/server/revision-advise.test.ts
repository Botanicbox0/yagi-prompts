import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { mockGemini, sentBody } from '../intel/helpers';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRevision, seedRun } from './revision-helpers';

let f: StudioFixture;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const seedance = studioModel('seedance-2.5') as StudioVideoModel;
const editKrw = (seconds: number) => usageKrw(remixRunUsd({ model: seedance, resolution: '720p', method: 'edit', seconds: null, referenceSeconds: seconds }).usd, 'video');

function withGemini(answer: unknown | (() => Response)) {
  const fetchMock = mockGemini(answer);
  return { fetchMock, deps: studioDeps(f.sql, { intelDeps: { fetch: fetchMock as unknown as typeof fetch, env: { GEMINI_API_KEY: 'test-key' } } }) };
}

const ask = (deps: ReturnType<typeof studioDeps>, input: Record<string, unknown>, who = f.ids.owner) =>
  runStudioOperation(deps, viewerOf(who), 'revise.plan', { organizationId: f.orgId, ...input });

describe('revise.plan', () => {
  it('says which ways are open and what each uses, without asking the model when there is no request', async () => {
    const { deps, fetchMock } = withGemini({ reason: 'motion' });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', params: { seconds: 6 }, seconds: 6 });
    const v2 = await seedRevision(deps, f.orgId, f.ids.owner, { base: root, rootJobId: root.jobId, version: 2, mode: 'edit', request: 'blue' });
    expect(await ask(deps, { outputId: v2.outputId })).toEqual({
      ok: true,
      version: 3,
      methods: {
        edit: { available: true, estimateKrw: editKrw(6) },
        reshoot: { available: true, estimateKrw: usageKrw(videoRunUsd({ resolution: '720p', seconds: 6 }), 'video') },
      },
      recommended: 'edit',
      reason: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['surface', 'edit'],
    ['motion', 'reshoot'],
    ['structure', 'reshoot'],
    ['length', 'reshoot'],
  ] as const)('recommends by the model\'s reading: %s -> %s', async (reason, recommended) => {
    const { deps, fetchMock } = withGemini({ reason });
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', finalPrompt: 'A perfume bottle on stone.' });
    expect(await ask(deps, { outputId: root.outputId, prompt: '카메라를 왼쪽으로' })).toMatchObject({ ok: true, recommended, reason });
    const body = sentBody(fetchMock);
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'LOW' } });
    expect(JSON.parse((body.contents[0]!.parts[0] as { text: string }).text)).toEqual({ request: '카메라를 왼쪽으로', madeWith: 'A perfume bottle on stone.', history: [], references: 0, materials: 0 });
  });

  it('falls back to edit when the reading fails or is unexpected, and never passes model text on', async () => {
    const root = await seedRun(studioDeps(f.sql), f.orgId, f.ids.owner, { prompt: 'a bottle' });
    for (const answer of [{ reason: 'vibes' }, { reason: 'surface', note: 'free text' }, () => new Response('nope', { status: 500 })]) {
      const { deps } = withGemini(answer);
      const result = await ask(deps, { outputId: root.outputId, prompt: 'something' });
      expect(result).toMatchObject({ ok: true, recommended: 'edit' });
      expect(Object.keys(result).sort()).toEqual(['methods', 'ok', 'reason', 'recommended', 'version']);
    }
    // No key at all.
    const noKey = studioDeps(f.sql);
    expect(await ask(noKey, { outputId: root.outputId, prompt: 'something' })).toMatchObject({ ok: true, recommended: 'edit', reason: null });
  });

  it('closes edit for a short clip and recommends reshoot even for a surface change', async () => {
    const { deps } = withGemini({ reason: 'surface' });
    const short = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'short', seconds: 3, params: { seconds: 4 } });
    expect(await ask(deps, { outputId: short.outputId, prompt: 'blue bottle' })).toMatchObject({
      ok: true,
      methods: { edit: { available: false, estimateKrw: 0, problem: 'too_short' }, reshoot: { available: true } },
      recommended: 'reshoot',
      reason: 'surface',
    });
  });

  it('marks a gone recipe reference and too many pictures; neither way open is invalid', async () => {
    const deps = studioDeps(f.sql);
    const product = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle', refs: [{ assetId: product }] });
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [product]);
    expect(await ask(deps, { outputId: root.outputId })).toMatchObject({ ok: true, methods: { edit: { available: true }, reshoot: { available: false, problem: 'references_gone' } }, recommended: 'edit' });

    const many = await Promise.all(Array.from({ length: 10 }, () => seedImageAsset(deps, f.orgId, f.ids.owner)));
    const busy = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'busy', refs: many.slice(0, 1).map((assetId) => ({ assetId })) });
    expect(await ask(deps, { outputId: busy.outputId, references: many.slice(1).map((assetId) => ({ assetId })) })).toMatchObject({
      ok: true,
      methods: { edit: { available: true }, reshoot: { available: false, estimateKrw: 0, problem: 'too_many_references' } },
    });

    const short = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'short', seconds: 3, refs: [{ assetId: product }] });
    expect(await ask(deps, { outputId: short.outputId })).toEqual({ ok: false, code: 'invalid' });
  });

  it('is guarded like prompt.enhance: role, allowance, rate limit', async () => {
    const deps = studioDeps(f.sql);
    const root = await seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle' });
    expect(await ask(deps, { outputId: root.outputId }, f.ids.viewer)).toEqual({ ok: false, code: 'forbidden' });
    expect(await ask(deps, { outputId: root.outputId }, f.ids.outsider)).toEqual({ ok: false, code: 'not_found' });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 0 where organization_id = $1', [f.orgId]);
    expect(await ask(deps, { outputId: root.outputId })).toEqual({ ok: false, code: 'allowance_closed' });
    await f.sql.query('update brand_studio_allowances set monthly_cap_krw = 500000 where organization_id = $1', [f.orgId]);
    for (let i = 0; i < 20; i++) expect((await ask(deps, { outputId: root.outputId })).ok).toBe(true);
    expect(await ask(deps, { outputId: root.outputId })).toEqual({ ok: false, code: 'too_many_running' });
    expect(await ask(deps, { outputId: 'nope' })).toEqual({ ok: false, code: 'invalid' });
  });
});
