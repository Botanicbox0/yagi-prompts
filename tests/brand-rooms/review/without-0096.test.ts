import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverFile, newDeliveryKey } from '@/lib/brand-rooms/deliveries';
import { assetFpsReady } from '@/lib/brand-studio/asset-fps';
import { loadRoomReviewDetail, loadRoomReviews, staffReviewDetail } from '@/lib/brand-studio/review';
import type { ReviewCreated, RoomReviewDetail } from '@/lib/brand-studio/review-contracts';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { mp4, track } from '@/tests/helpers/mp4-boxes';
import { reviewDeps } from './fixtures';

/**
 * The code reaches production before 0096 (`brand_studio_assets.fps`) is applied. On a database without the
 * column a film is delivered, listed and opened exactly as before, with no rate (the player measures it).
 * Its own file: the probe remembers a positive answer for the life of the module.
 */
vi.mock('@/lib/brand-rooms/events', async (original) => ({ ...(await original<typeof import('@/lib/brand-rooms/events')>()), postRoomEvent: async () => undefined }));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let root: string;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  root = mkdtempSync(join(tmpdir(), 'twings-no-fps-'));
  vi.stubEnv('STORAGE_LOCAL_ROOT', root);
  f = await studioFixture();
  await f.db.exec('alter table brand_studio_assets drop column fps');
  deps = studioDeps(f.sql);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('a database without 0096', () => {
  it('delivers, lists and opens a film as before, with no rate', async () => {
    expect(await assetFpsReady(f.sql)).toBe(false);
    const key = newDeliveryKey('video/mp4');
    await deps.staging.putStaging(key, mp4({ tracks: [track('vide', 24_000, [[240, 1001]])] }), 'video/mp4');
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const result = await deliverFile({ sql: f.sql, media: deps.media, staging: deps.staging }, { viewer: admin }, { organizationId: f.orgId, projectId: f.projectId, title: 'Main film', stagingKey: key });
    expect(result).toMatchObject({ ok: true });
    const reviewId = (result as { created: ReviewCreated }).created.review.id;
    expect(await loadRoomReviews(reviewDeps(deps), viewerOf(f.ids.owner), f.orgId, f.projectId)).toMatchObject({ ok: true });
    const detail = (await loadRoomReviewDetail(reviewDeps(deps), viewerOf(f.ids.owner), f.orgId, f.projectId, reviewId)) as RoomReviewDetail;
    expect(detail.ok).toBe(true);
    expect(detail.review).not.toHaveProperty('fps');
    expect(await staffReviewDetail(reviewDeps(deps), admin, reviewId)).toMatchObject({ ok: true });
  });
});
