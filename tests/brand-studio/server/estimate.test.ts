import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAND_IMAGE_MARKUP, BRAND_VIDEO_MARGIN } from '@/lib/brands/production/pricing';
import { COST_ASSUMPTIONS } from '@/lib/twings/cost-model';
import { createStudioJob, cancelStudioJob } from '@/lib/brand-studio/jobs';
import { loadStudioState } from '@/lib/brand-studio/service';
import { usageKrw } from '@/lib/brand-studio/usage';
import { STUDIO_USAGE_FACTORS, usageKrw as sharedUsageKrw } from '@/lib/brand-studio/usage-rate';
import {
  DRAFT_RESOLUTION,
  buildJob,
  dockEstimateKrw,
  initialDraft,
  regionEditInput,
  regionEstimateKrw,
  withMedium,
  withModel,
  type DockDraft,
} from '@/components/brand-studio/dock-model';
import { trayItemFromAsset, type TrayItem } from '@/components/brand-studio/refs';
import { requestId, seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './helpers';

/** docs/BRAND-STUDIO-V2.md §9: the figure the dock shows before a press is the one the server reserves. */
let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
beforeEach(async () => {
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  await f.db.close();
});

describe('one usage arithmetic for the dock and the server', () => {
  it('restates exactly the existing exchange rate and brand margins', () => {
    expect(STUDIO_USAGE_FACTORS).toEqual({
      krwPerUsd: COST_ASSUMPTIONS.krwPerUsd,
      imageMarkup: BRAND_IMAGE_MARKUP.target,
      videoMargin: BRAND_VIDEO_MARGIN.target,
    });
    expect(usageKrw).toBe(sharedUsageKrw);
  });
});

async function libraryTray(ids: string[]): Promise<TrayItem[]> {
  const state = await loadStudioState(deps, viewerOf(f.ids.owner), f.orgId);
  if (!state.ok) throw new Error(state.code);
  return ids.map((id) => trayItemFromAsset(state.assets.find((a) => a.id === id)!));
}

/** A video asset whose length is not a whole number of tenths, the case where rounding could drift. */
async function seedFilm(ms: number): Promise<string> {
  const { key } = await deps.media.put(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]), 'video/mp4');
  return (
    await f.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, source, status, created_by)
        values ($1, 'video', 'ref film', 'video/mp4', 12, 720, 1280, $2, $3, 'upload', 'ready', $4) returning id`,
      [f.orgId, ms, key, f.ids.owner],
    )
  ).rows[0]!.id;
}

async function reserved(draft: DockDraft, tray: TrayItem[]): Promise<number> {
  const built = buildJob(draft, tray, { organizationId: f.orgId, requestId: requestId() });
  if (!built.ok) throw new Error(built.problem.kind);
  const created = await createStudioJob(deps, viewerOf(f.ids.owner), built.input);
  if (!created.ok) throw new Error(created.code);
  // Keep the organization under its open-job cap for the next case.
  await cancelStudioJob(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, jobId: created.job.id });
  return created.job.estimateKrw;
}

describe('the dock quotes what the server reserves', () => {
  it('for picture runs: model, quality, count and references', async () => {
    const pics = await libraryTray([await seedImageAsset(deps, f.orgId, f.ids.owner), await seedImageAsset(deps, f.orgId, f.ids.owner)]);
    const base = { ...initialDraft('image'), prompt: 'a glass bottle on wet stone' };
    const cases: Array<[DockDraft, TrayItem[]]> = [
      [base, []],
      [{ ...base, resolution: '1K', count: 3 }, pics],
      [{ ...withModel(base, 'nano-banana-pro'), resolution: '4K', count: 2 }, pics.slice(0, 1)],
      [{ ...withModel(base, 'seedream-5-flash'), count: 4 }, pics],
    ];
    for (const [draft, tray] of cases) {
      const quote = dockEstimateKrw(draft, tray);
      expect(quote).toBeGreaterThan(0);
      expect(await reserved(draft, tray)).toBe(quote);
    }
  });

  it('for video runs: quality, the 480p draft and length', async () => {
    const base = { ...withMedium(initialDraft('image'), 'video'), prompt: 'slow push in on the bottle' };
    for (const draft of [{ ...base, resolution: '720p', seconds: 5 }, { ...base, resolution: '1080p', seconds: 10 }, { ...base, resolution: DRAFT_RESOLUTION, seconds: 8 }]) {
      expect(await reserved(draft, [])).toBe(dockEstimateKrw(draft, []));
    }
  });

  it('for reference-video runs: the method, the length asked for and the film length, rounded alike', async () => {
    const film = await libraryTray([await seedFilm(7250)]);
    const pic = await libraryTray([await seedImageAsset(deps, f.orgId, f.ids.owner)]);
    const base = { ...withMedium(initialDraft('image'), 'video'), prompt: '', change: '병을 파란 병으로' };
    const cases: Array<[DockDraft, TrayItem[]]> = [
      [{ ...base, method: 'reference', resolution: DRAFT_RESOLUTION, seconds: 6 }, film],
      [{ ...base, method: 'edit', resolution: '720p' }, [...film, ...pic]],
      [{ ...base, method: 'edit', resolution: DRAFT_RESOLUTION }, film],
    ];
    for (const [draft, tray] of cases) expect(await reserved(draft, tray)).toBe(dockEstimateKrw(draft, tray));
  });

  it('for a partial edit: one edit call on the edit model', async () => {
    const source = await seedImageAsset(deps, f.orgId, f.ids.owner, { width: 64, height: 48 });
    for (const draft of [initialDraft('image'), withModel(initialDraft('image'), 'nano-banana-pro')]) {
      const input = regionEditInput({ ids: { organizationId: f.orgId, requestId: requestId() }, source: { assetId: source }, box: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }, instruction: '라벨만', draft });
      const created = await createStudioJob(deps, viewerOf(f.ids.owner), input);
      if (!created.ok) throw new Error(created.code);
      expect(created.job.estimateKrw).toBe(regionEstimateKrw(draft));
      await cancelStudioJob(deps, viewerOf(f.ids.owner), { organizationId: f.orgId, jobId: created.job.id });
    }
  });
});
