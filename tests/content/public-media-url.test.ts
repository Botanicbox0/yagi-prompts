import { describe, expect, it } from 'vitest';
import { publicContentUrl, publicMediaCacheKey } from '@/lib/content/asset-url';
import { publicMediaBaseUrl } from '@/lib/runtime-mode';

const SUPABASE = 'https://proj.supabase.co';
const MEDIA = 'https://media.twings.app';
const COPIED = `${'a'.repeat(64)}.mp4`;
const NEW_UPLOAD = `${'b'.repeat(64)}.mp4`;
const COPIED_KEYS = new Set([COPIED]);

describe('publicContentUrl with the R2 media host', () => {
  it('serves a copied key from the media host', () => {
    expect(publicContentUrl(COPIED, SUPABASE, MEDIA, COPIED_KEYS)).toBe(`${MEDIA}/${COPIED}`);
  });

  it('keeps a key that was not copied on Supabase', () => {
    expect(publicContentUrl(NEW_UPLOAD, SUPABASE, MEDIA, COPIED_KEYS)).toBe(`${SUPABASE}/storage/v1/object/public/public-content/${NEW_UPLOAD}`);
  });

  it('stays on Supabase while the media host is unset, which is also the rollback', () => {
    expect(publicContentUrl(COPIED, SUPABASE, undefined, COPIED_KEYS)).toBe(`${SUPABASE}/storage/v1/object/public/public-content/${COPIED}`);
  });

  it('answers null when nothing serves the public bucket, even with a media host', () => {
    expect(publicContentUrl(COPIED, undefined, MEDIA, COPIED_KEYS)).toBeNull();
  });

  it('tolerates a trailing slash on the media host', () => {
    expect(publicContentUrl(COPIED, SUPABASE, `${MEDIA}/`, COPIED_KEYS)).toBe(`${MEDIA}/${COPIED}`);
  });
});

describe('publicMediaBaseUrl', () => {
  it('reads the host in cloud mode', () => {
    expect(publicMediaBaseUrl({ PLAYBOOK_MODE: 'cloud', PUBLIC_MEDIA_BASE_URL: MEDIA })).toBe(MEDIA);
  });

  it('ignores the host in local mode, where objects live under .storage', () => {
    expect(publicMediaBaseUrl({ PLAYBOOK_MODE: 'local', PUBLIC_MEDIA_BASE_URL: MEDIA })).toBeUndefined();
  });

  it('refuses anything that is not https', () => {
    expect(publicMediaBaseUrl({ PLAYBOOK_MODE: 'cloud', PUBLIC_MEDIA_BASE_URL: 'http://media.twings.app' })).toBeUndefined();
    expect(publicMediaBaseUrl({ PLAYBOOK_MODE: 'cloud', PUBLIC_MEDIA_BASE_URL: 'media.twings.app' })).toBeUndefined();
  });
});

describe('publicMediaCacheKey', () => {
  it('changes with the host and the copied keys, so cached catalogs cannot keep old addresses', () => {
    const off = publicMediaCacheKey(undefined, COPIED_KEYS);
    const on = publicMediaCacheKey(MEDIA, COPIED_KEYS);
    const more = publicMediaCacheKey(MEDIA, new Set([COPIED, NEW_UPLOAD]));
    expect(new Set([off, on, more]).size).toBe(3);
  });
});
