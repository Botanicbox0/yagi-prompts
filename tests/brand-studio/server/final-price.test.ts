import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creditsOf } from '@/lib/brand-studio/credits';
import { finalPrice } from '@/lib/brand-studio/final-price';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { estimateVideoUsd, studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { loadStudioState } from '@/lib/brand-studio/service';
import { usageKrw } from '@/lib/brand-studio/usage-rate';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedRun } from './revision-helpers';

/**
 * Owner rule, 2026-11-18: the figure on a button that takes credits is the figure taken. "완성본 만들기"
 * on a draft's version card shows `finalEstimateKrw` from the draft's view; `job.create` with
 * `video_final` reserves `planFinal`'s estimate. Both come from one function (lib/brand-studio/final-price.ts).
 */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  resetFreeIntelRateLimits();
  f = await studioFixture({ capKrw: 5_000_000 });
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

const seedance = studioModel('seedance-2.5') as StudioVideoModel;
const owner = () => viewerOf(f.ids.owner);

async function shownAndReserved(outputId: string) {
  const state = await loadStudioState(deps, owner(), f.orgId);
  if (!state.ok) throw new Error(state.code);
  const output = state.jobs.flatMap((j) => j.outputs).find((o) => o.id === outputId)!;
  const created = await createStudioJob(deps, owner(), { kind: 'video_final', organizationId: f.orgId, requestId: requestId(), draftOutputId: outputId });
  if (!created.ok) throw new Error(created.code);
  const row = (await f.sql.query<{ estimate_krw: number }>('select estimate_krw from brand_studio_jobs where id = $1', [created.job.id])).rows[0]!;
  return { shown: output.finalEstimateKrw, reserved: Number(row.estimate_krw), view: created.job.estimateKrw };
}

describe('the final of a draft: the figure on the card is the figure reserved', () => {
  it('a plain draft', async () => {
    const draft = await seedRun(deps, f.orgId, f.ids.owner, { params: { resolution: 'draft', seconds: 5 }, isDraft: true, seconds: 5 });
    const { shown, reserved, view } = await shownAndReserved(draft.outputId);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBe(reserved);
    expect(view).toBe(reserved);
    expect(shown).toBe(usageKrw(estimateVideoUsd({ resolution: '1080p', seconds: 5, referenceVideoSeconds: 0 }), 'video'));
    expect(creditsOf(shown!)).toBe(creditsOf(reserved));
  });

  it('a draft made with a reference video of 15,042 ms counts that video again at its exact length', async () => {
    const draft = await seedRun(deps, f.orgId, f.ids.owner, {
      kind: 'video_remix',
      params: { resolution: 'draft', seconds: 8, method: 'reference', keep: [], change: '', referenceVideoSeconds: 15.042 },
      isDraft: true,
      seconds: 8,
    });
    const { shown, reserved } = await shownAndReserved(draft.outputId);
    expect(shown).toBe(reserved);
    expect(shown).toBe(usageKrw(estimateVideoUsd({ resolution: '1080p', seconds: 8, referenceVideoSeconds: 15.042 }), 'video'));
    // The reference video is part of the figure: without it the final would read cheaper.
    expect(shown!).toBeGreaterThan(finalPrice({ params: { seconds: 8 }, draftDurationMs: 8000, model: seedance }).krw);
    expect(creditsOf(shown!)).toBe(creditsOf(reserved));
  });

  it('is present only on a real draft', async () => {
    const plain = await seedRun(deps, f.orgId, f.ids.owner, { params: { resolution: '480p', seconds: 5 }, isDraft: false, seconds: 5 });
    const state = await loadStudioState(deps, owner(), f.orgId);
    if (!state.ok) throw new Error(state.code);
    const output = state.jobs.flatMap((j) => j.outputs).find((o) => o.id === plain.outputId)!;
    expect(output.draft).toBe(false);
    expect(output).not.toHaveProperty('finalEstimateKrw');
  });
});
