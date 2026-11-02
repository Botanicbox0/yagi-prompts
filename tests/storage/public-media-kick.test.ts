import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CopyRequest, StorageDriver } from '@/lib/storage';

const mocks = vi.hoisted(() => ({
  after: [] as Array<() => unknown>,
  afterThrows: false,
  run: vi.fn(),
  keys: new Set<string>(),
}));
vi.mock('next/server', () => ({
  after: (task: () => unknown) => {
    if (mocks.afterThrows) throw new Error('`after` was called outside a request scope');
    mocks.after.push(task);
  },
}));
vi.mock('@/lib/storage/public-media-runtime', () => ({ runPublicMediaSync: mocks.run }));
vi.mock('@/lib/content/public-media-registry', () => ({ copiedPublicMediaKeys: () => mocks.keys }));

import { withPublicMediaSync } from '@/lib/storage/public-media-kick';

const NEW_KEY = `${'b'.repeat(64)}.mp4`;
const COPY: CopyRequest = { fromKey: 'rev/a.mp4', toBucket: 'public-content', toKey: NEW_KEY };

function driverDouble(copy: StorageDriver['copy'] = async () => 'copied'): StorageDriver {
  return { name: 'supabase', servesSignedUrls: true, copy } as unknown as StorageDriver;
}

function configure(): void {
  vi.stubEnv('PLAYBOOK_MODE', 'cloud');
  vi.stubEnv('PUBLIC_MEDIA_BASE_URL', 'https://media.twings.app');
  vi.stubEnv('R2_ACCOUNT_ID', 'account');
  vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('R2_PUBLIC_BUCKET', 'twings-media-apac');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('withPublicMediaSync', () => {
  beforeEach(() => {
    mocks.after.length = 0;
    mocks.afterThrows = false;
    mocks.keys = new Set();
    mocks.run.mockReset().mockResolvedValue(null);
    configure();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the same driver when R2 is not configured, so nothing changes until the keys exist', () => {
    vi.stubEnv('R2_SECRET_ACCESS_KEY', '');
    const driver = driverDouble();
    expect(withPublicMediaSync(driver)).toBe(driver);
  });

  it('keeps the rest of the driver as it was', () => {
    const wrapped = withPublicMediaSync(driverDouble());
    expect(wrapped.name).toBe('supabase');
    expect(wrapped.servesSignedUrls).toBe(true);
  });

  it('copies after the response, not while the publish is waiting', async () => {
    const wrapped = withPublicMediaSync(driverDouble());
    await expect(wrapped.copy(COPY)).resolves.toBe('copied');
    await settle();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.after).toHaveLength(1);
    await mocks.after[0]!();
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });

  it('asks again when the Supabase copy already existed, because R2 may still lack it', async () => {
    const wrapped = withPublicMediaSync(driverDouble(async () => 'exists'));
    await wrapped.copy(COPY);
    await settle();
    expect(mocks.after).toHaveLength(1);
  });

  it('does nothing for a key that is already on R2, the common case of re-saving a template', async () => {
    mocks.keys = new Set([NEW_KEY]);
    await withPublicMediaSync(driverDouble()).copy(COPY);
    await settle();
    expect(mocks.after).toHaveLength(0);
  });

  it('never reacts to a private bucket', async () => {
    await withPublicMediaSync(driverDouble()).copy({ ...COPY, toBucket: 'content-published' });
    await settle();
    expect(mocks.after).toHaveLength(0);
  });

  it('never reacts to a key that is not content-addressed', async () => {
    await withPublicMediaSync(driverDouble()).copy({ ...COPY, toKey: 'temp-dm/clip.mp4' });
    await settle();
    expect(mocks.after).toHaveLength(0);
  });

  it('asks for nothing when the Supabase copy failed, and passes the failure on', async () => {
    const wrapped = withPublicMediaSync(driverDouble(async () => { throw new Error('copy failed'); }));
    await expect(wrapped.copy(COPY)).rejects.toThrow('copy failed');
    await settle();
    expect(mocks.after).toHaveLength(0);
  });

  it('does not fail a publish made outside a request, such as a seed script', async () => {
    mocks.afterThrows = true;
    await expect(withPublicMediaSync(driverDouble()).copy(COPY)).resolves.toBe('copied');
    await settle();
  });

  it('never fails the publish when the copy fails later', async () => {
    mocks.run.mockRejectedValue(new Error('R2 down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await withPublicMediaSync(driverDouble()).copy(COPY);
    await settle();
    await expect(Promise.resolve(mocks.after[0]!())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('runs once more when another publish arrives during a run, so its file is not left for the daily tick', async () => {
    let finish: () => void = () => undefined;
    mocks.run.mockImplementationOnce(() => new Promise<null>((resolve) => { finish = () => resolve(null); }));
    const wrapped = withPublicMediaSync(driverDouble());
    await wrapped.copy(COPY);
    await settle();
    const first = mocks.after[0]!();
    await settle();
    expect(mocks.run).toHaveBeenCalledTimes(1);

    await wrapped.copy(COPY);
    await settle();
    const second = mocks.after[1]!();
    finish();
    await Promise.all([first, second]);
    expect(mocks.run).toHaveBeenCalledTimes(2);
  });
});
