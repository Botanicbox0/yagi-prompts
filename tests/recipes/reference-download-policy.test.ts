import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const mock = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  makerFileObject: vi.fn(),
  store: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({ getViewer: mock.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mock.sql }));
vi.mock('@/lib/renders/store', async (original) => ({
  ...(await original<typeof import('@/lib/renders/store')>()),
  getRenderStore: mock.store,
}));
vi.mock('@/lib/recipes/media', async (original) => ({
  ...(await original<typeof import('@/lib/recipes/media')>()),
  makerFileObject: mock.makerFileObject,
}));

import { GET } from '@/app/api/makers/files/[file]/route';
import { administerPlatform } from '@/lib/creator-platform/admin';
import { makerAction, uploadMakerFile } from '@/lib/recipes/maker';
import { createLocalRenderStore } from '@/lib/renders/store';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import { promptHarness } from '@/tests/helpers/prompts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HANDLE = 'ast_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';

describe('GET /api/makers/files/[file] — portrait reference download guard & audio serving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.viewer.mockResolvedValue({ userId: 'viewer-1', isAdmin: false, tier: 'free', locale: 'ko' });
    mock.sql.mockResolvedValue({});
    mock.store.mockResolvedValue({
      url: vi.fn(async () => null),
      read: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    });
  });

  it('blocks ?download=1 with 403 when containsPerson is true, while allowing inline viewing', async () => {
    mock.makerFileObject.mockResolvedValue({
      key: 'makers/person.jpg',
      mime: 'image/jpeg',
      publicCache: false,
      containsPerson: true,
    });

    const downloadRes = await GET(new Request(`https://twings.app/api/makers/files/${HANDLE}?download=1`), {
      params: Promise.resolve({ file: HANDLE }),
    });
    expect(downloadRes.status).toBe(403);
    expect(downloadRes.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(downloadRes.json()).resolves.toEqual({
      ok: false,
      code: 'person_reference_download_forbidden',
    });

    const inlineRes = await GET(new Request(`https://twings.app/api/makers/files/${HANDLE}`), {
      params: Promise.resolve({ file: HANDLE }),
    });
    expect(inlineRes.status).toBe(200);
    expect(inlineRes.headers.get('Content-Disposition')).toBeNull();
    expect(inlineRes.headers.get('Content-Type')).toBe('image/jpeg');
  });

  it('allows ?download=1 for non-person image and audio assets with clean attachment filenames', async () => {
    mock.makerFileObject.mockResolvedValueOnce({
      key: 'makers/dress.jpg',
      mime: 'image/jpeg',
      publicCache: false,
      containsPerson: false,
    });
    const imgRes = await GET(new Request(`https://twings.app/api/makers/files/${HANDLE}?download=1`), {
      params: Promise.resolve({ file: HANDLE }),
    });
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('Content-Disposition')).toContain('attachment; filename="twings-');
    expect(imgRes.headers.get('Content-Disposition')).toContain('.jpg"');

    mock.makerFileObject.mockResolvedValueOnce({
      key: 'makers/beat.mp3',
      mime: 'audio/mpeg',
      publicCache: false,
      containsPerson: false,
    });
    const audioRes = await GET(new Request(`https://twings.app/api/makers/files/${HANDLE}?download=1`), {
      params: Promise.resolve({ file: HANDLE }),
    });
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(audioRes.headers.get('Content-Disposition')).toContain('.mp3"');
  });

  it('returns 404 when the file handle is hidden or absent', async () => {
    mock.makerFileObject.mockResolvedValueOnce(null);
    const missingRes = await GET(new Request(`https://twings.app/api/makers/files/${HANDLE}?download=1`), {
      params: Promise.resolve({ file: HANDLE }),
    });
    expect(missingRes.status).toBe(404);
  });

  it('surfaces containsPerson from platform_format_assets via SQL', async () => {
    const h = await promptHarness();
    const root = await mkdtemp(join(tmpdir(), 'twings-ref-policy-'));
    try {
      const store = createLocalRenderStore(root);
      const maker = viewerOf('free');
      const member = viewerOf('pro');
      await administerPlatform(h.sql, ADMIN_VIEWER, {
        action: 'creator',
        id: maker.userId!,
        active: true,
        contract: 'pilot-v1',
        reason: 'Policy test maker',
      });
      const formatId = randomUUID();
      const pngBytes = new Uint8Array(
        await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 120, g: 120, b: 120 } } })
          .png()
          .toBuffer(),
      );
      await makerAction(
        { sql: h.sql, store },
        maker,
        {
          action: 'save',
          id: formatId,
          title: 'Policy test',
          titleKo: '정책 테스트',
          recipe: {
            version: 2,
            slots: { selfie: { kind: 'image', source: 'user', required: true } },
            steps: [
              {
                id: 'step1',
                kind: 'image',
                engine: 'gpt-image-2',
                inputs: ['selfie'],
                prompt: 'Portrait of {{selfie}} in natural studio light.',
                params: { aspect: '4:5' },
              },
            ],
            output: { from: 'step1' },
          },
          example: '',
          disclosure: { prompts: true, assets: true },
          presentation: 'make-first',
          royalty: 1500,
        },
        { creators: true },
      );
      const uploaded = await uploadMakerFile(
        { sql: h.sql, store },
        maker,
        { formatId, role: 'reference', bytes: pngBytes },
        { creators: true },
      );
      await h.sql.query('update platform_format_assets set contains_person = true where id = $1', [uploaded.id]);
      const actualMedia = await vi.importActual<typeof import('@/lib/recipes/media')>('@/lib/recipes/media');
      const obj = await actualMedia.makerFileObject(h.sql, maker, uploaded.id);
      expect(obj).toMatchObject({ mime: 'image/jpeg', containsPerson: true });
      // Non-owner cannot see unpublished file yet.
      expect(await actualMedia.makerFileObject(h.sql, member, uploaded.id)).toBeNull();
    } finally {
      await h.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
