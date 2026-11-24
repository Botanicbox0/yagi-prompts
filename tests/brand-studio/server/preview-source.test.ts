import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { previewStudioPrompt, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { fakeIntel, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** I-D1: "지금 설계하기" tells the bar whether the sentence was designed or is the server's fallback. */
let f: StudioFixture;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture();
});
afterEach(async () => {
  await f.db.close();
});

const image = () => ({
  kind: 'image' as const,
  organizationId: f.orgId,
  model: 'seedream-5.5',
  prompt: '하얀 대리석 위 향수병',
  enhance: true,
  aspect: '3:4',
  resolution: '2K',
});

describe('prompt.enhance answers with where the sentence came from', () => {
  it('says model for a real design', async () => {
    const answer = await previewStudioPrompt(studioDeps(f.sql), viewerOf(f.ids.owner), image());
    expect(answer).toMatchObject({ ok: true, source: 'model' });
  });

  it('says fallback when the writer failed and the deterministic sentence was used', async () => {
    const intel = fakeIntel();
    intel.enhancePrompt = async () => {
      throw new Error('gemini_timeout');
    };
    const answer = await previewStudioPrompt(studioDeps(f.sql, { intel }), viewerOf(f.ids.owner), image());
    expect(answer).toMatchObject({ ok: true, prompt: 'FALLBACK: 하얀 대리석 위 향수병', source: 'fallback' });

    const quiet = fakeIntel();
    quiet.enhancePrompt = async (input) => ({ prompt: `${input.prompt}.`, notes: '', source: 'fallback' });
    expect(await previewStudioPrompt(studioDeps(f.sql, { intel: quiet }), viewerOf(f.ids.owner), image())).toMatchObject({ source: 'fallback' });
  });

  it('says passthrough when the director keeps a structured prompt on purpose', async () => {
    const intel = fakeIntel();
    intel.enhancePrompt = async (input) => ({ prompt: input.prompt, notes: '', source: 'fallback', intent: 'passthrough' }) as never;
    const answer = await previewStudioPrompt(studioDeps(f.sql, { intel }), viewerOf(f.ids.owner), image());
    expect(answer).toMatchObject({ ok: true, source: 'passthrough' });
  });
});
