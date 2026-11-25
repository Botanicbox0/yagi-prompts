import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => ({
  fetchPublicMedia: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn }));
vi.mock('@/lib/makers/fetch-media', async (original) => {
  const actual = await original<typeof import('@/lib/makers/fetch-media')>();
  return {
    ...actual,
    fetchPublicMedia: fetchMock.fetchPublicMedia,
  };
});

import { activateOpenMaker } from '@/lib/makers/self-activate';
import { MAKER_AV_FILE_MAX_BYTES, MAKER_FILE_MAX_BYTES } from '@/lib/recipes/assets';
import { handleMcp } from '@/lib/mcp/server';
import { createLocalRenderStore, type RenderStore } from '@/lib/renders/store';
import { viewerOf } from '@/tests/helpers/admin';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';

const CREATIVE = viewerOf('free');

describe('MCP upload_file & add_work size limits', () => {
  let h: PromptHarness;
  let root: string;
  let store: RenderStore;
  let templateId: string;

  const call = (name: string, args: Record<string, unknown> = {}) =>
    handleMcp({ sql: h.sql, store, userId: CREATIVE.userId!, origin: 'https://twings.app' }, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
  const payload = (response: unknown) => JSON.parse((response as { result: { content: Array<{ text: string }> } }).result.content[0]!.text);

  beforeEach(async () => {
    vi.clearAllMocks();
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-mcp-upload-'));
    store = createLocalRenderStore(root);
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
    await activateOpenMaker(h.sql, CREATIVE, { rightsAgreed: true });

    const saved = payload(await call('save_template', {
      id: randomUUID(),
      title: 'Upload limit test',
      recipe: {
        version: 2,
        slots: { selfie: { kind: 'image', source: 'user', required: true } },
        steps: [{ id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'Portrait of {{selfie}}.', params: { aspect: '4:5' } }],
        output: { from: 'still' },
      },
    }));
    templateId = saved.id;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('fetches up to MAKER_AV_FILE_MAX_BYTES on upload_file url, stores >4MB video, and rejects >4MB image', async () => {
    const mp4 = new Uint8Array(5 * 1024 * 1024);
    mp4.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // ....ftypisom
    fetchMock.fetchPublicMedia.mockResolvedValueOnce(mp4);

    const videoRes = payload(await call('upload_file', {
      template_id: templateId,
      role: 'reference',
      url: 'https://cdn.example.com/clip.mp4',
    }));
    expect(fetchMock.fetchPublicMedia).toHaveBeenCalledWith('https://cdn.example.com/clip.mp4', MAKER_AV_FILE_MAX_BYTES);
    expect(videoRes).toMatchObject({ kind: 'video', role: 'reference', bytes: 5 * 1024 * 1024 });

    const bigJpeg = new Uint8Array(MAKER_FILE_MAX_BYTES + 256);
    bigJpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    fetchMock.fetchPublicMedia.mockResolvedValueOnce(bigJpeg);

    const imgRes = payload(await call('upload_file', {
      template_id: templateId,
      role: 'reference',
      url: 'https://cdn.example.com/huge.jpg',
    }));
    expect(imgRes).toEqual({ code: 'too_large' });
  });

  it('keeps base64 upload_file and add_work URL fetches capped at MAKER_FILE_MAX_BYTES', async () => {
    const bigBytes = new Uint8Array(MAKER_FILE_MAX_BYTES + 64);
    bigBytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const bigB64 = Buffer.from(bigBytes).toString('base64');

    expect(payload(await call('upload_file', {
      template_id: templateId,
      role: 'reference',
      data_base64: bigB64,
    }))).toEqual({ code: 'too_large' });

    const smallMp4 = new Uint8Array(64);
    smallMp4.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    fetchMock.fetchPublicMedia.mockResolvedValueOnce(smallMp4);

    const workRes = payload(await call('add_work', {
      url: 'https://cdn.example.com/work.mp4',
      title: 'Short clip',
    }));
    expect(fetchMock.fetchPublicMedia).toHaveBeenCalledWith('https://cdn.example.com/work.mp4', MAKER_FILE_MAX_BYTES);
    expect(workRes).toMatchObject({ kind: 'video', title: 'Short clip' });
  });
});
