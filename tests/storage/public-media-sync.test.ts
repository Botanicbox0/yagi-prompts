import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PUBLIC_MEDIA_CACHE_CONTROL, renderPublicMediaKeys, syncPublicMedia, type PublicMediaSyncDeps } from '@/lib/storage/public-media-sync';

const bytesOf = (text: string) => new TextEncoder().encode(text);
const keyFor = (bytes: Uint8Array, ext = 'mp4') => `${createHash('sha256').update(bytes).digest('hex')}.${ext}`;

const BODY = bytesOf('x'.repeat(4096));
const KEY = keyFor(BODY);

function harness(overrides: Partial<PublicMediaSyncDeps> = {}) {
  const stored = new Map<string, { bytes: Uint8Array; mime: string; cacheControl: string }>();
  const deps: PublicMediaSyncDeps = {
    list: async () => [{ key: KEY, size: BODY.length, mime: 'video/mp4' }],
    read: async () => BODY,
    put: async (key, bytes, meta) => { stored.set(key, { bytes, ...meta }); },
    publicGet: async (key, range) => {
      const object = stored.get(key);
      if (!object) return { status: 404, contentType: null, contentRange: null, cacheControl: null, bytes: new Uint8Array() };
      if (range) {
        const part = object.bytes.slice(range.start, range.end + 1);
        return { status: 206, contentType: object.mime, contentRange: `bytes ${range.start}-${range.end}/${object.bytes.length}`, cacheControl: object.cacheControl, bytes: part };
      }
      return { status: 200, contentType: object.mime, contentRange: null, cacheControl: object.cacheControl, bytes: object.bytes };
    },
    ...overrides,
  };
  return { deps, stored };
}

describe('syncPublicMedia', () => {
  it('copies a content-addressed object and lists it only after the public read matches', async () => {
    const { deps, stored } = harness();
    const report = await syncPublicMedia(deps);
    expect(report.verified).toEqual([KEY]);
    expect(report.failed).toEqual([]);
    expect(stored.get(KEY)?.mime).toBe('video/mp4');
    expect(stored.get(KEY)?.cacheControl).toBe(PUBLIC_MEDIA_CACHE_CONTROL);
  });

  it('leaves out objects that are not content-addressed, such as temporary uploads', async () => {
    const { deps, stored } = harness({
      list: async () => [{ key: 'temp-dm/clip.mp4', size: 10, mime: 'video/mp4' }, { key: 'ig-masters-20261031/a.mp4', size: 10, mime: 'video/mp4' }],
    });
    const report = await syncPublicMedia(deps);
    expect(report.verified).toEqual([]);
    expect(report.skipped).toEqual(['temp-dm/clip.mp4', 'ig-masters-20261031/a.mp4']);
    expect(stored.size).toBe(0);
  });

  it('fails a key whose bytes do not match its name, without uploading it', async () => {
    const wrongKey = `${'0'.repeat(64)}.mp4`;
    const { deps, stored } = harness({ list: async () => [{ key: wrongKey, size: BODY.length, mime: 'video/mp4' }] });
    const report = await syncPublicMedia(deps);
    expect(report.failed).toEqual([{ key: wrongKey, reason: 'name_hash_mismatch' }]);
    expect(stored.size).toBe(0);
  });

  it('fails a key when the public host returns different bytes', async () => {
    const { deps } = harness();
    const { deps: broken } = harness({
      put: deps.put,
      publicGet: async () => ({ status: 200, contentType: 'video/mp4', contentRange: null, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL, bytes: bytesOf('other') }),
    });
    const report = await syncPublicMedia(broken);
    expect(report.verified).toEqual([]);
    expect(report.failed).toEqual([{ key: KEY, reason: 'public_bytes_mismatch' }]);
  });

  it('fails a video key that cannot seek', async () => {
    const { deps } = harness();
    const original = deps.publicGet;
    const report = await syncPublicMedia({
      ...deps,
      publicGet: async (key, range) => range
        ? { status: 200, contentType: 'video/mp4', contentRange: null, cacheControl: PUBLIC_MEDIA_CACHE_CONTROL, bytes: BODY }
        : original(key),
    });
    expect(report.failed).toEqual([{ key: KEY, reason: 'range_not_supported' }]);
  });

  it('fails a key served with the wrong type', async () => {
    const { deps } = harness();
    const original = deps.publicGet;
    const report = await syncPublicMedia({ ...deps, publicGet: async (key, range) => ({ ...(await original(key, range)), contentType: 'application/octet-stream' }) });
    expect(report.failed).toEqual([{ key: KEY, reason: 'public_type_mismatch' }]);
  });

  it('keeps going after one failed object', async () => {
    const other = bytesOf('y'.repeat(2048));
    const otherKey = keyFor(other, 'jpg');
    const { deps } = harness({
      list: async () => [{ key: KEY, size: BODY.length, mime: 'video/mp4' }, { key: otherKey, size: other.length, mime: 'image/jpeg' }],
      read: async (key) => {
        if (key === KEY) throw new Error('down');
        return other;
      },
    });
    const report = await syncPublicMedia(deps);
    expect(report.verified).toEqual([otherKey]);
    expect(report.failed).toEqual([{ key: KEY, reason: 'copy_error' }]);
  });
});

describe('renderPublicMediaKeys', () => {
  const GONE = `${'9'.repeat(64)}.mp4`;

  it('writes sorted keys, so reruns produce the same file', () => {
    const source = renderPublicMediaKeys([], ['b.mp4', 'a.jpg']);
    expect(source.indexOf("'a.jpg'")).toBeLessThan(source.indexOf("'b.mp4'"));
    expect(source).toContain('export const PUBLIC_MEDIA_KEYS');
  });

  it('writes a key once when it is both listed and verified again', () => {
    const source = renderPublicMediaKeys(['a.jpg'], ['a.jpg']);
    expect(source.match(/'a\.jpg'/g)).toHaveLength(1);
  });

  it('keeps a listed key whose Supabase original is gone, which would otherwise turn into a 404', async () => {
    const { deps } = harness();
    const report = await syncPublicMedia(deps);
    expect(report.verified).toEqual([KEY]);
    const source = renderPublicMediaKeys([GONE], report.verified);
    expect(source).toContain(`'${GONE}'`);
    expect(source).toContain(`'${KEY}'`);
  });

  it('keeps every listed key when the bucket lists nothing at all', async () => {
    const { deps } = harness({ list: async () => [] });
    const report = await syncPublicMedia(deps);
    expect(renderPublicMediaKeys([GONE, KEY], report.verified)).toContain(`'${GONE}'`);
  });

  it('keeps a listed key that fails the re-check, and never adds a new one that fails', async () => {
    const other = bytesOf('y'.repeat(2048));
    const otherKey = keyFor(other, 'jpg');
    const { deps } = harness({
      list: async () => [{ key: KEY, size: BODY.length, mime: 'video/mp4' }, { key: otherKey, size: other.length, mime: 'image/jpeg' }],
      read: async () => { throw new Error('object not found'); },
    });
    const report = await syncPublicMedia(deps);
    expect(report.failed).toHaveLength(2);
    const source = renderPublicMediaKeys([KEY], report.verified);
    expect(source).toContain(`'${KEY}'`);
    expect(source).not.toContain(`'${otherKey}'`);
  });
});
