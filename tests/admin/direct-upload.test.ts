import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { directUploadFailure, uploadFailureText, uploadMime } from '@/lib/admin/direct-upload';
import { ALLOWED_AUDIO_MIMES, ALLOWED_POSTER_MIMES, ALLOWED_VIDEO_MIMES } from '@/lib/prompts/media';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mediaDropLabels } from '@/components/admin/prompt-fields';

/**
 * Admin template upload audit (2026-09-25): a company-domain admin reported that a template upload
 * "does not work". Every gate on the path reads only `profiles.is_admin`, so an admin who can see the
 * form passes them all. What the form could NOT do was say why a file was refused: the signing route
 * answers `400 {error:'too_large'|'bad_type'}`, the client threw `sign_failed_400`, dropped the body
 * and showed "retry in a moment" — for a refusal that no retry can ever fix.
 */

const mocks = vi.hoisted(() => ({ viewer: vi.fn(), signed: vi.fn() }));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => {
    const v = await mocks.viewer();
    if (!v.isAdmin) throw Error('forbidden');
    return v;
  },
}));
vi.mock('@/lib/storage', () => ({
  getStorage: async () => ({ signedUploadUrl: mocks.signed }),
  STAGING_BUCKET: 'content',
}));

import { POST } from '@/app/api/admin/staging-url/route';

const MiB = 1024 * 1024;

function sign(body: unknown) {
  return POST(
    new NextRequest('https://admin.twings.app/api/admin/staging-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', host: 'admin.twings.app' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/admin/staging-url — refusals are specific', () => {
  beforeEach(() => {
    mocks.viewer.mockResolvedValue({ isAdmin: true, userId: 'u' });
    mocks.signed.mockResolvedValue('https://storage.example/upload?token=t');
  });

  it('signs an ordinary clip for any admin', async () => {
    const res = await sign({ kind: 'video', filename: 'clip.mp4', mime: 'video/mp4', size: 20 * MiB });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ direct: true });
  });

  it('refuses a clip over the video cap with too_large', async () => {
    const res = await sign({ kind: 'video', filename: 'clip.mp4', mime: 'video/mp4', size: 57.7 * 1e6 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'too_large' });
  });

  it('refuses a HEIC poster and a typeless file with bad_type', async () => {
    for (const mime of ['image/heic', 'application/octet-stream']) {
      const res = await sign({ kind: 'poster', filename: 'p.heic', mime, size: MiB });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'bad_type' });
    }
  });

  it('answers a non-admin with a bare 404', async () => {
    mocks.viewer.mockResolvedValue({ isAdmin: false, userId: 'u' });
    const res = await sign({ kind: 'video', filename: 'clip.mp4', mime: 'video/mp4', size: MiB });
    expect(res.status).toBe(404);
  });
});

describe('direct upload client helpers', () => {
  it('reads the refusal code from the signing response', () => {
    expect(directUploadFailure(400, { error: 'too_large' })).toBe('too_large');
    expect(directUploadFailure(400, { error: 'bad_type' })).toBe('bad_type');
    expect(directUploadFailure(400, { error: 'bad_request' })).toBe('failed');
    expect(directUploadFailure(400, null)).toBe('failed');
    // 401/403/404: the session is gone or no longer an admin — a reload/sign-in, not a retry.
    for (const status of [401, 403, 404]) expect(directUploadFailure(status, null)).toBe('session');
    expect(directUploadFailure(500, null)).toBe('failed');
  });

  it('gives each reason its own text, with the real caps in it', () => {
    const labels = mediaDropLabels(getDictionary('ko').admin);
    const texts = (['too_large', 'bad_type', 'session', 'failed'] as const).map((r) => uploadFailureText(r, labels));
    expect(new Set(texts).size).toBe(4);
    expect(uploadFailureText('failed', labels)).toBe(labels.uploadFailed);
    expect(uploadFailureText('too_large', labels)).toContain('48MB');
    expect(uploadFailureText('too_large', labels)).toContain('20MB');
    expect(uploadFailureText('too_large', labels)).not.toMatch(/\{\w+\}/);
    const en = mediaDropLabels(getDictionary('en').admin);
    expect(uploadFailureText('bad_type', en)).toContain('MP4');
  });

  it('fills an empty browser type from the extension, only with types the server accepts', () => {
    expect(uploadMime('clip.MOV', '')).toBe('video/quicktime');
    expect(uploadMime('clip.mp4', '')).toBe('video/mp4');
    expect(uploadMime('poster.jpg', '')).toBe('image/jpeg');
    expect(uploadMime('clip.mp4', 'video/mp4')).toBe('video/mp4');
    // A browser-reported type always wins; an unknown extension stays unknown.
    expect(uploadMime('clip.mkv', '')).toBe('application/octet-stream');
    expect(uploadMime('clip.mp4', 'video/x-matroska')).toBe('video/x-matroska');
    const allowed = new Set<string>([...ALLOWED_VIDEO_MIMES, ...ALLOWED_POSTER_MIMES, ...ALLOWED_AUDIO_MIMES]);
    for (const name of ['a.mp4', 'a.webm', 'a.mov', 'a.png', 'a.jpeg', 'a.webp', 'a.avif', 'a.mp3', 'a.wav', 'a.m4a', 'a.ogg', 'a.flac', 'a.aac']) {
      expect(allowed.has(uploadMime(name, '')), name).toBe(true);
    }
  });
});
