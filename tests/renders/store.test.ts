import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenderObjectNotFound, assertRenderKey, createLocalRenderStore, extensionFor } from '@/lib/renders/store';

describe('the local render store', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'playbook-render-store-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes, overwrites in place, reads back, and mints no url (the gateway streams)', async () => {
    const store = createLocalRenderStore(root);
    const key = '11111111-1111-4111-8111-111111111111/result.jpg';
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(await store.read(key)).toEqual(new Uint8Array([1, 2, 3]));
    await store.put(key, new Uint8Array([4]), 'image/jpeg');
    expect(await store.read(key)).toEqual(new Uint8Array([4]));
    expect(await store.url(key, 600)).toBeNull();
    await expect(store.read('22222222-2222-4222-8222-222222222222/result.jpg')).rejects.toBeInstanceOf(RenderObjectNotFound);
  });

  it('refuses any key that is not {uuid}/{name}.{ext}', () => {
    expect(() => assertRenderKey('../etc/passwd')).toThrow(/illegal render key/);
    expect(() => assertRenderKey('11111111-1111-4111-8111-111111111111/../x.jpg')).toThrow(/illegal render key/);
    expect(() => assertRenderKey('11111111-1111-4111-8111-111111111111/result.jpg')).not.toThrow();
  });

  it('names files by their type', () => {
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('application/x-unknown')).toBe('bin');
  });
});
