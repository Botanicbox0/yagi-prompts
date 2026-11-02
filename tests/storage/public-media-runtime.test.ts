import { createHash } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { PublicMediaSyncDeps } from '@/lib/storage/public-media-sync';
import { freshDb, runner } from '@/tests/helpers/pglite';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  deps: null as PublicMediaSyncDeps | null,
  revalidate: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/cache', () => ({ revalidatePublicMedia: mocks.revalidate }));
vi.mock('@/lib/supabase/service-client', () => ({ createServiceClient: () => ({}) }));
vi.mock('@/lib/storage/r2-public', () => ({ createR2PublicMediaDeps: () => mocks.deps }));

import { publicContentUrl } from '@/lib/content/asset-url';
import { refreshPublicMediaKeys, resetPublicMediaKeys } from '@/lib/content/public-media-registry';
import { runPublicMediaSync } from '@/lib/storage/public-media-runtime';
import { PUBLIC_MEDIA_CACHE_CONTROL } from '@/lib/storage/public-media-sync';

const SUPABASE = 'https://project.supabase.co';
const MEDIA = 'https://media.twings.app';
const BODY = new TextEncoder().encode('z'.repeat(3000));
const KEY = `${createHash('sha256').update(BODY).digest('hex')}.mp4`;

function liveDeps(overrides: Partial<PublicMediaSyncDeps> = {}): PublicMediaSyncDeps {
  const stored = new Map<string, Uint8Array>();
  return {
    list: async () => [{ key: KEY, size: BODY.length, mime: 'video/mp4' }],
    read: async () => BODY,
    put: async (key, bytes) => { stored.set(key, bytes); },
    publicGet: async (key, range) => {
      const bytes = stored.get(key);
      if (!bytes) return { status: 404, contentType: null, contentRange: null, cacheControl: null, bytes: new Uint8Array() };
      if (range) return { status: 206, contentType: 'video/mp4', contentRange: `bytes ${range.start}-${range.end}/${bytes.length}`, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL, bytes: bytes.slice(range.start, range.end + 1) };
      return { status: 200, contentType: 'video/mp4', contentRange: null, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL, bytes };
    },
    ...overrides,
  };
}

describe('runPublicMediaSync', () => {
  let db: PGlite;

  beforeAll(async () => { db = await freshDb(); });
  afterAll(async () => db.close());
  beforeEach(async () => {
    await db.exec('delete from public_media_copies');
    resetPublicMediaKeys();
    mocks.sql = runner(db);
    mocks.deps = liveDeps();
    mocks.revalidate.mockReset();
    vi.stubEnv('PLAYBOOK_MODE', 'cloud');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
    vi.stubEnv('PUBLIC_MEDIA_BASE_URL', MEDIA);
    vi.stubEnv('R2_ACCOUNT_ID', 'account');
    vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
    vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('R2_PUBLIC_BUCKET', 'twings-media-apac');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('does nothing without the R2 keys', async () => {
    vi.stubEnv('R2_ACCESS_KEY_ID', '');
    expect(await runPublicMediaSync(1000)).toBeNull();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('takes a new file from Supabase to the media host with nobody involved', async () => {
    expect(publicContentUrl(KEY)).toContain('/storage/v1/object/public/public-content/');
    const report = await runPublicMediaSync(60_000);
    expect(report?.verified).toEqual([KEY]);
    expect(publicContentUrl(KEY)).toBe(`${MEDIA}/${KEY}`);
    expect(mocks.revalidate).toHaveBeenCalledOnce();
  });

  it('stays on Supabase and keeps cached pages when the public read does not match', async () => {
    mocks.deps = liveDeps({
      publicGet: async () => ({ status: 200, contentType: 'video/mp4', contentRange: null, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL, bytes: new Uint8Array([1]) }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const report = await runPublicMediaSync(60_000);
    expect(report?.failed).toEqual([{ key: KEY, reason: 'public_bytes_mismatch' }]);
    expect(publicContentUrl(KEY)).toContain('/storage/v1/object/public/public-content/');
    expect(mocks.revalidate).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not read the file twice on the next run', async () => {
    let reads = 0;
    mocks.deps = liveDeps({ read: async () => { reads += 1; return BODY; } });
    await runPublicMediaSync(60_000);
    await runPublicMediaSync(60_000);
    expect(reads).toBe(1);
    expect(mocks.revalidate).toHaveBeenCalledOnce();
  });

  it('keeps a verified key on the media host after its Supabase original is gone', async () => {
    await runPublicMediaSync(60_000);
    mocks.deps = liveDeps({
      list: async () => [],
      read: async () => { throw new Error('object not found'); },
    });
    const report = await runPublicMediaSync(60_000);
    expect(report).toEqual({ verified: [], failed: [], waiting: [], deferred: [] });

    // A fresh process has only the database to go on.
    resetPublicMediaKeys();
    await refreshPublicMediaKeys(mocks.sql, { force: true });
    expect(publicContentUrl(KEY)).toBe(`${MEDIA}/${KEY}`);
    const { rows } = await db.query<{ verified_at: Date | null; last_failure: string | null }>('select verified_at, last_failure from public_media_copies where key = $1', [KEY]);
    expect(rows[0]?.verified_at).not.toBeNull();
    expect(rows[0]?.last_failure).toBeNull();
  });

  it('survives a failed cache refresh, because the hourly TTL corrects the pages anyway', async () => {
    mocks.revalidate.mockImplementation(() => { throw new Error('no store'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(runPublicMediaSync(60_000)).resolves.toMatchObject({ verified: [KEY] });
    warn.mockRestore();
  });
});
