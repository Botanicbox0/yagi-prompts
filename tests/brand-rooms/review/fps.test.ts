import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverFile, newDeliveryKey } from '@/lib/brand-rooms/deliveries';
import { assetFpsReady, storableFps } from '@/lib/brand-studio/asset-fps';
import { loadRoomReviewDetail, staffReviewDetail } from '@/lib/brand-studio/review';
import type { ReviewCreated, RoomReviewDetail } from '@/lib/brand-studio/review-contracts';
import { pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { mp4, track } from '@/tests/helpers/mp4-boxes';
import { reviewDeps, roomDraft } from './fixtures';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — a delivered film's frame rate (0096): read from the file when the team
 * delivers it, kept on the studio asset, and handed to the stage with the review. The same bytes delivered
 * again keep the first measurement; a picture and a studio result have none (the player measures those).
 */
vi.mock('@/lib/brand-rooms/events', async (original) => ({ ...(await original<typeof import('@/lib/brand-rooms/events')>()), postRoomEvent: async () => undefined }));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let root: string;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  root = mkdtempSync(join(tmpdir(), 'twings-fps-'));
  vi.stubEnv('STORAGE_LOCAL_ROOT', root);
  f = await studioFixture();
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  rmSync(root, { recursive: true, force: true });
});

const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const ddeps = () => ({ sql: f.sql, media: deps.media, staging: deps.staging });
async function deliver(bytes: Uint8Array, mime: string, title = 'Main film', stackReviewId: string | null = null) {
  const key = newDeliveryKey(mime);
  await deps.staging.putStaging(key, bytes, mime);
  const result = await deliverFile(ddeps(), { viewer: admin() }, { organizationId: f.orgId, projectId: f.projectId, title, stagingKey: key, stackReviewId });
  expect(result).toMatchObject({ ok: true });
  return (result as { created: ReviewCreated }).created.review.id;
}

describe("a delivered film's frame rate", () => {
  it('is read from the file, stored on the asset and handed to the stage', async () => {
    expect(await assetFpsReady(f.sql)).toBe(true);
    const reviewId = await deliver(mp4({ tracks: [track('vide', 24_000, [[240, 1001]])], moovAtEnd: true }), 'video/mp4');
    expect((await f.sql.query<{ fps: string }>('select fps from brand_studio_assets')).rows.map((r) => Number(r.fps))).toEqual([23.976]);
    const detail = (await loadRoomReviewDetail(reviewDeps(deps), viewerOf(f.ids.owner), f.orgId, f.projectId, reviewId)) as RoomReviewDetail;
    expect(detail.review.fps).toBe(23.976);
    expect(await staffReviewDetail(reviewDeps(deps), admin(), reviewId)).toMatchObject({ ok: true, review: { fps: 23.976 } });
  });

  it('keeps the first measurement when the same bytes come again, and fills one that was missing', async () => {
    const bytes = mp4({ tracks: [track('vide', 15_360, [[90, 512]])] });
    const first = await deliver(bytes, 'video/mp4');
    await f.sql.query('update brand_studio_assets set fps = null');
    await deliver(bytes, 'video/mp4', 'Main film', first);
    expect((await f.sql.query<{ fps: string }>('select fps from brand_studio_assets')).rows.map((r) => Number(r.fps))).toEqual([30]);
    await f.sql.query('update brand_studio_assets set fps = 25');
    await deliver(bytes, 'video/mp4', 'Main film', first);
    expect((await f.sql.query<{ fps: string }>('select fps from brand_studio_assets')).rows.map((r) => Number(r.fps))).toEqual([25]);
  });

  it('is null for a film the probe cannot read, a picture and a studio result', async () => {
    const fragmented = await deliver(mp4({ tracks: [track('vide', 24_000, [[0, 1001]])], fragmented: true }), 'video/mp4', 'Fragmented');
    const picture = await deliver(await pngBytes(40, 30), 'image/png', 'Key visual');
    const result = await roomDraft(f, deps, 'video');
    for (const id of [fragmented, picture, result]) {
      const detail = (await loadRoomReviewDetail(reviewDeps(deps), viewerOf(f.ids.owner), f.orgId, f.projectId, id)) as RoomReviewDetail;
      expect(detail.review.fps ?? null).toBeNull();
    }
  });

  it('refuses a rate outside the column', async () => {
    expect(storableFps(23.976)).toBe(23.976);
    expect(storableFps(0.5)).toBeNull();
    expect(storableFps(300)).toBeNull();
    expect(storableFps(null)).toBeNull();
    await expect(f.sql.query("update brand_studio_assets set fps = 0 where false")).resolves.toBeTruthy();
    await f.sql.query(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, storage_key, sha256, source, status, created_by)
       values ($1, 'video', 'x', 'video/mp4', 10, 'st/x.mp4', $2, 'upload', 'ready', $3)`,
      [f.orgId, 'b'.repeat(64), f.ids.owner],
    );
    await expect(f.sql.query('update brand_studio_assets set fps = 241')).rejects.toThrow();
  });
});
