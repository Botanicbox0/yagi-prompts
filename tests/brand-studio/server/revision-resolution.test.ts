import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudioRevisePlan } from '@/lib/brand-studio/contracts';
import { createStudioJob, resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { studioModel, type StudioVideoModel } from '@/lib/brand-studio/models';
import { buildStudioRequest } from '@/lib/brand-studio/provider/requests';
import { isDraftRun } from '@/lib/brand-studio/reference-video';
import { runStudioOperation } from '@/lib/brand-studio/service';
import type { JobRow } from '@/lib/brand-studio/types';
import { remixRunUsd, usageKrw, videoRunUsd } from '@/lib/brand-studio/usage-rate';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';
import { seedFinal, seedRevision, seedRun, type SeededRun } from './revision-helpers';

/**
 * Owner's rule, 2026-11-18: "a 720p video is edited at 720p and a 1080p video at 1080p". A revision is
 * made at the resolution of the version it is made from. A draft stays a draft where the run can be one
 * (a new take with a length of its own, so a final can still follow); an edit follows its source and is
 * the standard 480p run instead (the provider makes no preview that follows its source). A revision never
 * drops back to a draft and never raises the resolution; "draft to final" is its own step. The figure the
 * revise form shows for a way (`revise.plan`) is the figure the run reserves.
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
const SECONDS = 6;
const owner = () => viewerOf(f.ids.owner);
const row = async (id: string) => (await f.sql.query<JobRow>('select * from brand_studio_jobs where id = $1', [id])).rows[0]!;
const isDraftColumn = async (jobId: string) =>
  (await f.sql.query<{ is_draft: boolean }>('select is_draft from brand_studio_outputs where job_id = $1', [jobId])).rows[0]!.is_draft;

type Base = 'draft' | '480p' | '720p' | '1080p' | 'final of a draft' | 'edit of a final' | 'edit of a draft';
async function seedBase(base: Base): Promise<SeededRun> {
  const run = (resolution: string, isDraft = false) => seedRun(deps, f.orgId, f.ids.owner, { prompt: 'a bottle turns', params: { resolution }, isDraft, seconds: SECONDS });
  switch (base) {
    case 'draft':
      return run('draft', true);
    case '480p':
    case '720p':
    case '1080p':
      return run(base);
    case 'final of a draft':
      return seedFinal(deps, f.orgId, f.ids.owner, await run('draft', true));
    case 'edit of a final': {
      // v2 made by editing a final: its own job is at 1080p, while its recipe run is still the draft's.
      const draft = await run('draft', true);
      const final = await seedFinal(deps, f.orgId, f.ids.owner, draft);
      return seedRevision(deps, f.orgId, f.ids.owner, { base: final, rootJobId: draft.jobId, version: 2, mode: 'edit', request: 'blue', params: { resolution: '1080p' }, seconds: SECONDS });
    }
    case 'edit of a draft': {
      // v2 made by editing a draft: the standard 480p run, no draft, while its recipe run is the draft.
      const draft = await run('draft', true);
      return seedRevision(deps, f.orgId, f.ids.owner, { base: draft, rootJobId: draft.jobId, version: 2, mode: 'edit', request: 'blue', params: { resolution: '480p' }, seconds: SECONDS });
    }
  }
}

/** The quote of one way, as the revise form shows it. */
async function quoted(outputId: string, mode: 'edit' | 'reshoot'): Promise<number> {
  const plan = await runStudioOperation(deps, owner(), 'revise.plan', { organizationId: f.orgId, outputId, prompt: '병을 파란색으로', references: [] });
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const way = (plan as StudioRevisePlan).methods[mode];
  if (!way.available) throw new Error(`${mode} closed: ${way.problem}`);
  return way.estimateKrw;
}

// base x mode -> the resolution asked for, and whether the result is a draft a 1080p final can come from.
const TABLE: Array<[Base, 'edit' | 'reshoot', string, boolean]> = [
  ['draft', 'edit', '480p', false],
  ['draft', 'reshoot', 'draft', true],
  ['480p', 'edit', '480p', false],
  ['480p', 'reshoot', '480p', false],
  ['720p', 'edit', '720p', false],
  ['720p', 'reshoot', '720p', false],
  ['1080p', 'edit', '1080p', false],
  ['1080p', 'reshoot', '1080p', false],
  ['final of a draft', 'edit', '1080p', false],
  ['final of a draft', 'reshoot', '1080p', false],
  ['edit of a final', 'edit', '1080p', false],
  ['edit of a final', 'reshoot', '1080p', false],
  // Never back to a draft: a 480p version that is no draft is made again as 480p, not as a draft.
  ['edit of a draft', 'edit', '480p', false],
  ['edit of a draft', 'reshoot', '480p', false],
];

describe('a revision keeps the resolution of the version it is made from', () => {
  it.each(TABLE)('%s, %s -> %s (draft: %s)', async (base, mode, resolution, draft) => {
    const seeded = await seedBase(base);
    const quote = await quoted(seeded.outputId, mode);
    const created = await createStudioJob(deps, owner(), { kind: 'video_revise', organizationId: f.orgId, requestId: requestId(), outputId: seeded.outputId, mode, prompt: '병을 파란색으로', references: [] });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const stored = await row(created.job.id);
    expect(stored.params.resolution).toBe(resolution);
    expect(await isDraftColumn(created.job.id)).toBe(draft);
    // Both lanes are told the same: the account lane gets `isDraftRun` as `params.draft`, the API lane this body.
    expect(isDraftRun(stored.kind, stored.params)).toBe(draft);
    const body = buildStudioRequest({
      kind: stored.kind, model: stored.model, prompt: 'x', params: stored.params, images: [],
      videos: stored.kind === 'video_remix' && stored.params.method !== 'blueprint' ? [{ url: 'https://media.example.test/clip.mp4' }] : [],
    }).body;
    expect(body.draft).toBe(draft);
    expect(body.resolution).toBe(resolution === 'draft' ? '480p' : resolution);
    // The quote on the button is the reserve, and it is the arithmetic of that resolution.
    expect(created.job.estimateKrw).toBe(quote);
    const expected =
      mode === 'edit'
        ? remixRunUsd({ model: seedance, resolution, method: 'edit', seconds: null, referenceSeconds: SECONDS, referenceMs: SECONDS * 1000 }).usd
        : videoRunUsd({ resolution, seconds: SECONDS });
    expect(created.job.estimateKrw).toBe(usageKrw(expected, 'video'));
  });
});
