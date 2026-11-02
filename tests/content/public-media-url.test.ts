import { describe, expect, it } from 'vitest';
import { copiedPublicMediaUrl, publicContentUrl, publicMediaCacheKey } from '@/lib/content/asset-url';
import { publicMediaBaseUrl, publicMediaR2Config } from '@/lib/runtime-mode';

const SUPABASE = 'https://proj.supabase.co';
const MEDIA = 'https://media.twings.app';
const COPIED = `${'a'.repeat(64)}.mp4`;
const NEW_UPLOAD = `${'b'.repeat(64)}.mp4`;
const COPIED_KEYS = new Set([COPIED]);
const LIST_ONLY = false;
const DIRECT = true;

describe('publicContentUrl with the R2 media host', () => {
  it('serves a listed key from the media host', () => {
    expect(publicContentUrl(COPIED, SUPABASE, MEDIA, COPIED_KEYS, LIST_ONLY)).toBe(`${MEDIA}/${COPIED}`);
  });

  it('keeps an unlisted key on Supabase until the R2 keys exist', () => {
    expect(publicContentUrl(NEW_UPLOAD, SUPABASE, MEDIA, COPIED_KEYS, LIST_ONLY)).toBe(`${SUPABASE}/storage/v1/object/public/public-content/${NEW_UPLOAD}`);
  });

  it('serves every key from the media host once new files are written straight to R2', () => {
    expect(publicContentUrl(NEW_UPLOAD, SUPABASE, MEDIA, COPIED_KEYS, DIRECT)).toBe(`${MEDIA}/${NEW_UPLOAD}`);
    expect(publicContentUrl(COPIED, SUPABASE, MEDIA, new Set(), DIRECT)).toBe(`${MEDIA}/${COPIED}`);
  });

  it('stays on Supabase while the media host is unset', () => {
    expect(publicContentUrl(COPIED, SUPABASE, undefined, COPIED_KEYS, LIST_ONLY)).toBe(`${SUPABASE}/storage/v1/object/public/public-content/${COPIED}`);
  });

  it('answers null when nothing serves the public bucket, even with a media host', () => {
    expect(publicContentUrl(COPIED, undefined, MEDIA, COPIED_KEYS, DIRECT)).toBeNull();
  });

  it('tolerates a trailing slash on the media host', () => {
    expect(publicContentUrl(COPIED, SUPABASE, `${MEDIA}/`, COPIED_KEYS, LIST_ONLY)).toBe(`${MEDIA}/${COPIED}`);
  });
});

describe('copiedPublicMediaUrl', () => {
  it('answers with the media address only for a listed key until the R2 keys exist', () => {
    expect(copiedPublicMediaUrl(COPIED, MEDIA, COPIED_KEYS, LIST_ONLY)).toBe(`${MEDIA}/${COPIED}`);
    expect(copiedPublicMediaUrl(COPIED, `${MEDIA}/`, COPIED_KEYS, LIST_ONLY)).toBe(`${MEDIA}/${COPIED}`);
    expect(copiedPublicMediaUrl(NEW_UPLOAD, MEDIA, COPIED_KEYS, LIST_ONLY)).toBeNull();
  });

  it('answers with the media address for any key once files are written straight to R2', () => {
    expect(copiedPublicMediaUrl(NEW_UPLOAD, MEDIA, COPIED_KEYS, DIRECT)).toBe(`${MEDIA}/${NEW_UPLOAD}`);
  });

  it('answers null with no media host', () => {
    expect(copiedPublicMediaUrl(COPIED, undefined, COPIED_KEYS, DIRECT)).toBeNull();
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

describe('publicMediaR2Config', () => {
  const keys = { R2_ACCOUNT_ID: 'account', R2_ACCESS_KEY_ID: 'access', R2_SECRET_ACCESS_KEY: 'secret', R2_PUBLIC_BUCKET: 'twings-media-apac' };

  it('needs every key and the media host', () => {
    expect(publicMediaR2Config({ PLAYBOOK_MODE: 'cloud', PUBLIC_MEDIA_BASE_URL: MEDIA, ...keys })).toMatchObject({ bucket: 'twings-media-apac', mediaBaseUrl: MEDIA });
    expect(publicMediaR2Config({ PLAYBOOK_MODE: 'cloud', ...keys })).toBeNull();
    expect(publicMediaR2Config({ PLAYBOOK_MODE: 'cloud', PUBLIC_MEDIA_BASE_URL: MEDIA, ...keys, R2_SECRET_ACCESS_KEY: '' })).toBeNull();
  });

  it('stays off in local mode, whatever the env file holds', () => {
    expect(publicMediaR2Config({ PLAYBOOK_MODE: 'local', PUBLIC_MEDIA_BASE_URL: MEDIA, ...keys })).toBeNull();
  });
});

describe('publicMediaCacheKey', () => {
  it('changes with the host, the listed keys and the switch to direct writes, so cached catalogs cannot keep old addresses', () => {
    const off = publicMediaCacheKey(undefined, COPIED_KEYS, LIST_ONLY);
    const on = publicMediaCacheKey(MEDIA, COPIED_KEYS, LIST_ONLY);
    const more = publicMediaCacheKey(MEDIA, new Set([COPIED, NEW_UPLOAD]), LIST_ONLY);
    const direct = publicMediaCacheKey(MEDIA, COPIED_KEYS, DIRECT);
    expect(new Set([off, on, more, direct]).size).toBe(4);
  });
});
