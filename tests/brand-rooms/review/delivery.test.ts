import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminContext } from '@/lib/admin/context';
import { dispatchAdmin } from '@/lib/admin/dispatch';
import { ADMIN_OPERATION_NAMES } from '@/lib/admin/operations';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { DELIVERY_LIMITS, deliverFile, deliveryRefusal, deliveryUploadAddress, isDeliveryKey, newDeliveryKey } from '@/lib/brand-rooms/deliveries';
import { runIngest } from '@/lib/brand-rooms/ingest';
import { createShare } from '@/lib/brand-rooms/shares';
import type { ShareCreated } from '@/lib/brand-rooms/share-contracts';
import { STAGING_BUCKET } from '@/lib/storage';
import { memoryStaging, pngBytes, studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { roomDraft } from './fixtures';

/**
 * docs/BRAND-ROOMS.md §6 — the team delivers a draft: the upload address is minted on the server inside the
 * delivery prefix; the bytes are re-checked (magic bytes, size) before anything is stored; a sandboxed brand
 * and a non-admin get nothing; the admin operation and the command line (`review.push` / `review.finish`)
 * both end in a `source = 'delivery'` draft; a share link can be turned off from /admin.
 */
vi.mock('@/lib/brand-rooms/events', async (original) => ({ ...(await original<typeof import('@/lib/brand-rooms/events')>()), postRoomEvent: async () => undefined }));

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;
let root: string;
beforeEach(async () => {
  vi.stubEnv('BRAND_ROOMS', 'on');
  root = mkdtempSync(join(tmpdir(), 'twings-delivery-'));
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

async function staged(bytes?: Uint8Array, mime = 'image/png'): Promise<string> {
  const key = newDeliveryKey(mime);
  await deps.staging.putStaging(key, bytes ?? (await pngBytes(40, 30)), mime);
  return key;
}

describe('the upload address', () => {
  it('takes films up to 200 MB and images up to 50 MB of the studio types only', () => {
    expect(deliveryRefusal('video/mp4', DELIVERY_LIMITS.videoBytesMax)).toBeNull();
    expect(deliveryRefusal('video/mp4', DELIVERY_LIMITS.videoBytesMax + 1)).toBe('too_large');
    expect(deliveryRefusal('image/png', 50_000_000)).toBeNull();
    expect(deliveryRefusal('image/png', 50_000_001)).toBe('too_large');
    expect(deliveryRefusal('image/gif', 10)).toBe('bad_type');
    expect(deliveryRefusal('video/webm', 10)).toBe('bad_type');
    expect(deliveryRefusal('image/png', 0)).toBe('bad_type');
  });

  it('is minted on the server inside the delivery prefix', async () => {
    const address = await deliveryUploadAddress(memoryStaging(), 'video/quicktime');
    expect(address.direct).toBe(false);
    expect(isDeliveryKey(address.key)).toBe(true);
    expect(address.key).toMatch(/^brand-rooms\/deliveries\/[0-9a-f]{64}\.mov$/);
    expect(address.url).toBe(`/api/brand-rooms/reviews/upload?key=${encodeURIComponent(address.key)}`);
    expect(isDeliveryKey('brand-rooms/deliveries/../x.png')).toBe(false);
    expect(isDeliveryKey('st/' + 'a'.repeat(64) + '.png')).toBe(false);
  });
});

describe('delivering a file', () => {
  it('re-checks the bytes, stores the file and makes the draft', async () => {
    const result = await deliverFile(ddeps(), { viewer: admin() }, { organizationId: f.orgId, projectId: f.projectId, title: 'Key visual', stagingKey: await staged(), name: 'kv-final.png' });
    expect(result).toMatchObject({ ok: true, created: { existing: false, review: { source: 'delivery', kind: 'image', version: 1, available: true } } });
    const asset = (await f.sql.query('select name, source, width, height, thumb_key is not null as thumb from brand_studio_assets')).rows;
    expect(asset).toEqual([{ name: 'kv-final', source: 'delivery', width: 40, height: 30, thumb: true }]);
  });

  it('refuses what is not a picture or a film, and leaves nothing behind', async () => {
    const before = deps.media.objects.size;
    const text = new TextEncoder().encode('not a picture at all');
    expect(await deliverFile(ddeps(), { viewer: admin() }, { organizationId: f.orgId, projectId: f.projectId, title: 'x', stagingKey: await staged(text) })).toEqual({ ok: false, code: 'unsupported_file' });
    expect(await deliverFile(ddeps(), { viewer: admin() }, { organizationId: f.orgId, projectId: f.projectId, title: 'x', stagingKey: 'brand-studio/whatever' })).toEqual({ ok: false, code: 'invalid' });
    expect(await deliverFile(ddeps(), { viewer: admin() }, { organizationId: f.orgId, projectId: f.projectId, title: 'x', stagingKey: newDeliveryKey('image/png') })).toEqual({ ok: false, code: 'not_found' });
    expect(deps.media.objects.size).toBe(before);
    expect((await f.sql.query('select count(*)::int as n from brand_studio_reviews')).rows[0]).toEqual({ n: 0 });
  });

  it('reads no bytes for a brand member or a closed brand', async () => {
    const key = await staged();
    const read = vi.spyOn(deps.staging, 'read');
    expect(await deliverFile(ddeps(), { viewer: viewerOf(f.ids.owner) }, { organizationId: f.orgId, projectId: f.projectId, title: 'x', stagingKey: key })).toEqual({ ok: false, code: 'forbidden' });
    const sandboxed = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][1]! });
    try {
      const sdeps = { sql: sandboxed.sql, media: deps.media, staging: deps.staging };
      expect(await deliverFile(sdeps, { viewer: { ...viewerOf(sandboxed.ids.admin), isAdmin: true } }, { organizationId: sandboxed.orgId, projectId: sandboxed.projectId, title: 'x', stagingKey: key })).toEqual({
        ok: false,
        code: 'feature_unavailable',
      });
    } finally {
      await sandboxed.db.close();
    }
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the command line', () => {
  it('pushes and finishes a draft, then a version of it', async () => {
    const ctx = { sql: f.sql, media: deps.media, staging: deps.staging };
    const pushed = (await runIngest(ctx, 'review.push', { projectId: f.projectId, mime: 'image/png', sizeBytes: 1000 })) as { ok: true; key: string; url: string; direct: boolean };
    expect(pushed).toMatchObject({ ok: true, direct: false });
    await deps.staging.putStaging(pushed.key, await pngBytes(20, 20), 'image/png');
    const done = (await runIngest(ctx, 'review.finish', { projectId: f.projectId, title: 'From the CLI', stagingKey: pushed.key })) as { ok: true; reviewId: string; version: number; brandPath: string };
    expect(done).toMatchObject({ ok: true, version: 1, brandPath: expect.stringContaining(`/brand/rooms/${f.projectId}?`) });
    const second = await runIngest(ctx, 'review.push', { projectId: f.projectId, mime: 'image/png', sizeBytes: 1000 });
    const key2 = (second as unknown as { key: string }).key;
    await deps.staging.putStaging(key2, await pngBytes(21, 20), 'image/png');
    expect(await runIngest(ctx, 'review.finish', { projectId: f.projectId, title: 'v2', stagingKey: key2, versionOf: done.reviewId })).toMatchObject({ ok: true, version: 2 });
    expect((await f.sql.query("select created_by, created_role from brand_studio_reviews where version = 2")).rows).toEqual([{ created_by: null, created_role: 'studio' }]);
    expect(await runIngest(ctx, 'review.push', { projectId: f.projectId, mime: 'image/gif', sizeBytes: 10 })).toEqual({ ok: false, code: 'unsupported_file' });
  });

  it('answers a closed brand as if the project did not exist', async () => {
    const sandboxed = await studioFixture({ orgName: 'Morphic Korea' });
    try {
      const ctx = { sql: sandboxed.sql, media: deps.media, staging: deps.staging };
      expect(await runIngest(ctx, 'review.push', { projectId: sandboxed.projectId, mime: 'image/png', sizeBytes: 10 })).toEqual({ ok: false, code: 'not_found' });
    } finally {
      await sandboxed.db.close();
    }
  });
});

describe('the admin operations', () => {
  const ctx = (isAdmin = true): AdminContext => ({ sql: f.sql, storage: deps.staging as never, viewer: { ...viewerOf(isAdmin ? f.ids.admin : f.ids.owner), isAdmin } });
  const form = (op: string, fields: Record<string, string>) => {
    const data = new FormData();
    data.set('_op', op);
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };

  it('are registered', () => {
    expect(ADMIN_OPERATION_NAMES).toContain('brand_rooms.delivery.add');
    expect(ADMIN_OPERATION_NAMES).toContain('brand_rooms.share.revoke');
  });

  it('deliver through /admin/do and land on the draft', async () => {
    const stagingKey = await staged();
    const outcome = await dispatchAdmin('brand_rooms.delivery.add', form('brand_rooms.delivery.add', { organizationId: f.orgId, projectId: f.projectId, title: 'Hero', stagingKey }), ctx());
    expect(outcome).toMatchObject({ ok: true, code: 'created', to: expect.stringMatching(/^\/admin\/brand-studio\/reviews\/[0-9a-f-]{36}$/) });
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(await dispatchAdmin('brand_rooms.delivery.add', form('brand_rooms.delivery.add', { organizationId: f.orgId, projectId: f.projectId, title: 'Hero', stagingKey }), ctx())).toMatchObject({ ok: false, code: 'notFound' });
  });

  it('turn a share link off', async () => {
    const reviewId = await roomDraft(f, deps);
    const created = (await createShare({ sql: f.sql, media: deps.media }, viewerOf(f.ids.owner), { organizationId: f.orgId, kind: 'review', targetId: reviewId })) as ShareCreated;
    const outcome = await dispatchAdmin('brand_rooms.share.revoke', form('brand_rooms.share.revoke', { shareId: created.share.id }), ctx());
    expect(outcome).toMatchObject({ ok: true, to: `/admin/brand-studio/reviews/${reviewId}` });
    expect((await f.sql.query('select revoked_by from brand_room_shares')).rows[0]).toEqual({ revoked_by: f.ids.admin });
    expect((await deps.staging.read(STAGING_BUCKET, await staged())).byteLength).toBeGreaterThan(0);
  });
});
