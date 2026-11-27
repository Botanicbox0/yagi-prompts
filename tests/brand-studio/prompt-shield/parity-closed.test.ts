import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { jobView } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { runWorkflowOperation } from '@/lib/brand-studio/workflows/service';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { WORLD, seedWorld, stable, worldRows } from './world';

/**
 * Step 0 of the video prompt shield (BRAND_STUDIO_VIDEO_PROMPT_SHIELD): with the switch absent, every answer that
 * carries a run is pinned here as it is on origin/main. The snapshots were written once, on the untouched branch,
 * and are never regenerated: a difference here means the closed switch changed an answer.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
const NOW = new Date('2026-11-21T09:00:00.000Z');
const ORG = '00000000-0000-4000-8000-00000000a001';
const snap = (name: string) => `./__snapshots__/closed/${name}.json`;

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', undefined as unknown as string);
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', undefined as unknown as string);
  resetSpineProbe();
  resetFreeIntelRateLimits();
  f = await studioFixture({ orgId: ORG });
  deps = studioDeps(f.sql, { env: studioEnv(ENV), now: () => NOW });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  resetSpineProbe();
  await f.db.close();
});

describe('video prompt shield closed: answers are origin/main byte for byte', () => {
  it('jobView, one run of every kind', async () => {
    const { jobs, outputs } = worldRows(ORG, '00000000-0000-4000-8000-00000000b001');
    const media = createMemoryMediaStore();
    for (const row of jobs) {
      await expect(stable(jobView(row, outputs, media))).toMatchFileSnapshot(snap(`job-view-${row.id.slice(-3)}-${row.kind}`));
    }
  });

  it('loadStudioState and pollStudioJobs', async () => {
    await seedWorld(f.sql, ORG, f.ids.owner);
    for (const role of ['owner', 'viewer', 'guest'] as const) {
      await expect(stable(await loadStudioState(deps, viewerOf(f.ids[role]), ORG))).toMatchFileSnapshot(snap(`state-${role}`));
    }
    const ids = Object.values(WORLD.job);
    await expect(stable(await pollStudioJobs(deps, viewerOf(f.ids.owner), ORG, ids))).toMatchFileSnapshot(snap('poll-owner'));
  });

  it('job.create replay of a designed video run', async () => {
    const { jobs } = await seedWorld(f.sql, ORG, f.ids.owner);
    const designed = jobs.find((j) => j.id === WORLD.job.videoDesigned)!;
    const again = await runStudioOperation(deps, viewerOf(f.ids.owner), 'job.create', {
      kind: 'video', organizationId: ORG, requestId: designed.request_id, model: 'seedance-2.5', prompt: designed.prompt,
      aspect: '9:16', resolution: '480p', seconds: 5,
    });
    await expect(stable(again)).toMatchFileSnapshot(snap('job-create-replay'));
  });

  it('prompt.enhance for an image model and a video model', async () => {
    const owner = viewerOf(f.ids.owner);
    const image = await runStudioOperation(deps, owner, 'prompt.enhance', {
      kind: 'image', organizationId: ORG, model: 'seedream-5.5', prompt: '흰 배경의 코발트 병', aspect: '1:1', resolution: '2K',
    });
    await expect(stable(image)).toMatchFileSnapshot(snap('enhance-image'));
    const video = await runStudioOperation(deps, owner, 'prompt.enhance', {
      kind: 'video', organizationId: ORG, model: 'seedance-2.5', prompt: '병이 천천히 돈다', aspect: '9:16', resolution: '720p', seconds: 5,
    });
    await expect(stable(video)).toMatchFileSnapshot(snap('enhance-video'));
  });

  it('project.files (spine open for the organization)', async () => {
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', ORG);
    await seedWorld(f.sql, ORG, f.ids.owner);
    const files = await runStudioOperation(deps, viewerOf(f.ids.owner), 'project.files', { organizationId: ORG, scope: { kind: 'unfiled' } });
    await expect(stable(files)).toMatchFileSnapshot(snap('project-files-unfiled'));
  });

  it('workflows run', async () => {
    await seedWorld(f.sql, ORG, f.ids.owner);
    // The reference video's file is in storage, so its blueprint step can be read (a blueprint that cannot be read is not made).
    const film = (await f.sql.query<{ storage_key: string }>('select storage_key from brand_studio_assets where id = $1', [WORLD.videoAsset])).rows[0]!;
    deps.media.objects.set(film.storage_key, { bytes: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), mime: 'video/mp4' });
    const run = await runWorkflowOperation(deps, viewerOf(f.ids.owner, 'ko'), 'run', {
      organizationId: ORG,
      requestId: 'req_world_workflow_run',
      workflowId: 'reference-video-ad-pack',
      inputs: { video1Ref: { assetId: WORLD.videoAsset }, image1Ref: { assetId: WORLD.imageAsset }, subject: '글로우 세럼', prompt: '유리 보틀 반사광', packs: ['cut_hook'] },
    });
    await expect(stable(run)).toMatchFileSnapshot(snap('workflows-run'));
  });
});
