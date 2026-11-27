import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { studioEnv } from '@/lib/brand-studio/env';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import { jobView } from '@/lib/brand-studio/repo';
import { loadStudioState, pollStudioJobs, runStudioOperation } from '@/lib/brand-studio/service';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { Wall } from '@/components/brand-studio/gallery/wall';
import { Viewer, type ViewerActions } from '@/components/brand-studio/viewer';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { copyFor, asset, job, output } from './ui/fixtures';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { WORLD, seedWorld, stable, worldRows } from './prompt-shield/world';

/**
 * Step 0 of Batch 2 (`BRAND_STUDIO_EDIT_TO_WALL`): with the switch closed, server answers and UI
 * renders are byte-for-byte identical to the baseline snapshot taken on the untouched branch.
 * NEVER regenerate these snapshots after Batch 2 edits begin.
 */
const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
const NOW = new Date('2026-11-27T09:00:00.000Z');
const ORG = '00000000-0000-4000-8000-00000000a001';
const snap = (name: string) => `./__snapshots__/edit-to-wall-closed/${name}.json`;
const htmlSnap = (name: string) => `./__snapshots__/edit-to-wall-closed/${name}.html`;

const noop = () => {};
const library: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set(),
  likedItems: [],
  folderItems: () => null,
  openFolder: noop,
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};
const viewerActions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
};

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', undefined as unknown as string);
  vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL_ORGS', undefined as unknown as string);
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

describe('BRAND_STUDIO_EDIT_TO_WALL closed: parity with untouched baseline', () => {
  it('jobView rows (image, region_edit, video)', async () => {
    const { jobs, outputs } = worldRows(ORG, '00000000-0000-4000-8000-00000000b001');
    const media = createMemoryMediaStore();
    for (const row of jobs.filter((r) => r.id === WORLD.job.image || r.id === WORLD.job.region || r.id === WORLD.job.videoTyped)) {
      await expect(stable(jobView(row, outputs, media))).toMatchFileSnapshot(snap(`job-view-${row.kind}`));
    }
  });

  it('loadStudioState (owner, editor, viewer, guest) and pollStudioJobs', async () => {
    await seedWorld(f.sql, ORG, f.ids.owner);
    for (const role of ['owner', 'editor', 'viewer', 'guest'] as const) {
      await expect(stable(await loadStudioState(deps, viewerOf(f.ids[role]), ORG))).toMatchFileSnapshot(snap(`state-${role}`));
    }
    const ids = Object.values(WORLD.job);
    await expect(stable(await pollStudioJobs(deps, viewerOf(f.ids.owner), ORG, ids))).toMatchFileSnapshot(snap('poll-owner'));
  });

  it('job.create ordinary image run', async () => {
    await seedWorld(f.sql, ORG, f.ids.owner);
    const created = await runStudioOperation(deps, viewerOf(f.ids.owner), 'job.create', {
      kind: 'image',
      organizationId: ORG,
      requestId: 'req_parity_img_01',
      model: 'seedream-5.5',
      prompt: 'White glass bottle',
      aspect: '1:1',
      resolution: '2K',
    });
    await expect(stable(created)).toMatchFileSnapshot(snap('job-create-image'));
  });

  it('Wall and Viewer markup for image and region_edit results', async () => {
    const copy = copyFor('ko');
    const baseOut = output(1);
    const baseJob = job(1, { model: 'seedream-5.5', estimateKrw: 150, outputs: [baseOut] });
    const regOut = output(2);
    const regJob = job(2, { kind: 'region_edit', model: 'nano-banana-pro', parentOutputId: baseOut.id, outputs: [regOut] });
    const wallHtml = renderToStaticMarkup(
      <Wall
        mode="image"
        jobs={[regJob, baseJob]}
        copy={copy}
        locale="ko"
        canGenerate
        canEdit
        library={library}
        parentOf={(oid) => (oid === baseOut.id ? baseOut : null)}
        onAction={noop}
        onRetry={noop}
        onNotice={noop}
        now={NOW}
      />,
    );
    await expect(wallHtml).toMatchFileSnapshot(htmlSnap('wall-image-closed'));

    const viewerHtml = renderToStaticMarkup(
      <Viewer
        items={[
          { type: 'output', output: regOut, job: regJob },
          { type: 'output', output: baseOut, job: baseJob },
        ]}
        index={0}
        copy={copy}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={(oid) => (oid === baseOut.id ? baseOut : null)}
        parentAssetOf={(aid) => (aid === asset(1).id ? asset(1) : null)}
        onIndex={noop}
        onClose={noop}
        actions={viewerActions}
      />,
    );
    await expect(viewerHtml).toMatchFileSnapshot(htmlSnap('viewer-region-closed'));
  });
});
