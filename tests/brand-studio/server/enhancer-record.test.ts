import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { prepareJob } from '@/lib/brand-studio/prepare';
import type { JobRow } from '@/lib/brand-studio/types';
import { fakeIntel, requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** Every prepared job says which rules wrote its prompt (`work.enhancer`, 2026-11-19); nothing customer-visible. */
describe('work.enhancer', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });

  async function prepared(input: Record<string, unknown>, intel = fakeIntel()) {
    const deps = studioDeps(f.sql, { intel });
    const made = await createStudioJob(deps, viewerOf(f.ids.owner), { kind: 'image', organizationId: f.orgId, requestId: requestId(), aspect: '1:1', resolution: '2K', count: 1, ...input });
    if (!made.ok) throw new Error(JSON.stringify(made));
    const job = (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [made.job.id])).rows[0]!;
    return prepareJob(deps, job);
  }

  it('records the profile version, the core version, the source and the skin plan', async () => {
    const out = await prepared({ model: 'seedream-5.5', prompt: '30대 남성이 셔츠를 입고 창가에 앉은 사진, 실사 느낌으로', enhance: true });
    expect(out.work.enhancer).toEqual({
      profile: 'seedream',
      profileVersion: 'seedream@2026-11-19.1',
      coreVersion: 'core@2026-11-19.2',
      llmModel: null,
      source: 'model',
      skinMode: 'realism',
      toneMatch: false,
    });
  });

  it('a model with its own block records both versions; a fallback records why when the enhancer says so', async () => {
    const intel = fakeIntel();
    intel.enhancePrompt = async (input) => ({
      prompt: `FALLBACK: ${input.prompt}`,
      notes: '',
      source: 'fallback',
      meta: { profile: input.profile, profileVersion: 'nano-banana@2026-11-19.1+nano-banana-2.1@2026-11-19.1', coreVersion: 'core@2026-11-19.2', llmModel: null, source: 'fallback', fallbackReason: 'timeout', skinMode: 'off', toneMatch: false },
    });
    const out = await prepared({ model: 'nano-banana-2.1', prompt: '대리석 위 향수병', enhance: true }, intel);
    expect(out.work.enhancer).toMatchObject({ profileVersion: 'nano-banana@2026-11-19.1+nano-banana-2.1@2026-11-19.1', source: 'fallback', fallbackReason: 'timeout' });
  });

  it('a run with the enhancer off records nothing', async () => {
    const out = await prepared({ model: 'seedream-5.5', prompt: '대리석 위 향수병', enhance: false });
    expect(out.work.enhancer).toBeUndefined();
  });
});
