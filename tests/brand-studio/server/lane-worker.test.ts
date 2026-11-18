import { describe, expect, it } from 'vitest';
import {
  CliRefusal,
  REFERENCE_VIDEO_MAX_BYTES,
  ReferenceUploadError,
  draftTaskIdOf,
  failureCodeOf,
  redactUrls,
  toolCall,
  withUploadedVideos,
  // @ts-expect-error -- plain Node module of the lane worker, without type declarations
} from '@/scripts/brand-studio-lane-mapping.mjs';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';

/**
 * The account-lane worker (scripts/brand-studio-lane-worker.mjs) maps a claimed job onto one `sunra` CLI
 * call through scripts/brand-studio-lane-mapping.mjs, tested here without the CLI:
 *
 * - The account lane takes a reference video only as one of its own uploads ("Reference video must be an
 *   uploaded asset", 2026-11-18, nothing charged). Each distinct video is fetched, PUT on a fresh upload
 *   slot with every header the slot names, and replaced by the slot's asset URL. Pictures and sounds from
 *   other hosts are taken as they are, so they stay untouched.
 * - A run that follows its reference's length (`duration: -1`) is never a preview, and a draft id is
 *   reported only for a run sent as one.
 */
type Job = {
  jobId: string;
  kind: string;
  model: string;
  prompt: string;
  params: Record<string, unknown>;
  inputs: Array<{ kind: string; url: string; frame?: string; mime?: string }>;
  draftTaskId: string | null;
  outputs: Array<{ outputId: string; idx: number }>;
};
const FILM = 'https://media.twings.app/0a96afc8c11b78e38ab86551ad217ac80a5f3cf1b6e51bcf8b57c35912bbd751.mp4';
const PICTURE = 'https://media.twings.app/aa.png';
const job = (over: Partial<Job> & { params?: Record<string, unknown> } = {}): Job => ({
  jobId: '00000000-0000-4000-8000-000000000001',
  kind: 'video_remix',
  model: 'seedance-2.5',
  prompt: 'turn the bottle blue',
  draftTaskId: null,
  outputs: [{ outputId: 'o1', idx: 0 }],
  inputs: [{ kind: 'video', url: FILM, mime: 'video/mp4' }, { kind: 'image', url: PICTURE }],
  ...over,
  params: { aspect: null, resolution: '480p', quality: null, seconds: null, audio: 'native', count: 1, draft: false, method: 'edit', keep: [], ...over.params },
});

describe('the CLI call for a video', () => {
  it('an edit follows its source: duration -1, no ratio, and at 480p a standard video, never a preview', () => {
    const { tool, input } = toolCall(job(), 'project-1');
    expect(tool).toBe('create_video');
    expect(input).toMatchObject({ project_id: 'project-1', model: 'seedance-2.5', duration: -1, draft: false, resolution: '480p', reference_videos: [FILM], reference_images: [PICTURE] });
    expect(input).not.toHaveProperty('aspect_ratio');
    // Even a job still marked as a draft (planned before the rule) is not sent as one.
    expect(toolCall(job({ params: { draft: true } }), 'p').input.draft).toBe(false);
  });

  it('a new take without a length of its own follows the reference too, keeping its ratio', () => {
    const { input } = toolCall(job({ params: { method: 'reference', aspect: '9:16', draft: true } }), 'p');
    expect(input).toMatchObject({ duration: -1, aspect_ratio: '9:16', draft: false });
  });

  it('a draft with a length of its own is a preview, and its task id is reported as the draft id', () => {
    const remix = toolCall(job({ params: { method: 'reference', aspect: '9:16', seconds: 8, draft: true } }), 'p');
    expect(remix.input).toMatchObject({ duration: 8, aspect_ratio: '9:16', draft: true, resolution: '480p' });
    expect(draftTaskIdOf(remix, { task_id: 't-1' })).toBe('t-1');

    const plain = toolCall(job({ kind: 'video', inputs: [], params: { method: null, aspect: '16:9', seconds: 5, draft: true } }), 'p');
    expect(plain.input).toMatchObject({ duration: 5, aspect_ratio: '16:9', draft: true });
    expect(draftTaskIdOf(plain, { task_id: 't-2' })).toBe('t-2');
  });

  it('reports no draft id for anything not sent as a preview', () => {
    expect(draftTaskIdOf(toolCall(job(), 'p'), { task_id: 't-3' })).toBeUndefined();
    const hd = toolCall(job({ kind: 'video', inputs: [], params: { method: null, resolution: '720p', aspect: '16:9', seconds: 5 } }), 'p');
    expect(hd.input).not.toHaveProperty('draft');
    expect(draftTaskIdOf(hd, { task_id: 't-4' })).toBeUndefined();
  });

  it('a final names the draft task and nothing else', () => {
    expect(toolCall(job({ kind: 'video_final', inputs: [], draftTaskId: 'preview-9', params: { resolution: '1080p' } }), 'p')).toEqual({
      tool: 'create_video',
      input: { project_id: 'p', model: 'seedance-2.5', draft_source_task_id: 'preview-9', auto_confirm: true },
    });
    expect(() => toolCall(job({ kind: 'video_final', inputs: [], params: { resolution: '1080p' } }), 'p')).toThrow(CliRefusal);
  });
});

/** A fake network: the media host, the upload slot and the PUT. */
function network(options: { film?: Uint8Array<ArrayBuffer>; declare?: boolean; filmStatus?: number; putStatus?: number; slot?: Record<string, unknown> } = {}) {
  const film: Uint8Array<ArrayBuffer> = options.film ?? new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const calls = { downloads: [] as string[], slots: [] as unknown[], puts: [] as Array<{ url: string; method: string; headers: Record<string, string>; bytes: number }> };
  const slot = options.slot ?? {
    upload_url: 'https://uploads.sunra.test/put/ref.mp4?X-Amz-Signature=secret-signature&X-Amz-Credential=abc',
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'x-amz-meta-origin': 'cli' },
    asset_url: 'https://cdn.sunra.ai/assets/ref-1.mp4',
    expires_in: 900,
  };
  const deps = {
    uploadSlot: async (input: unknown) => {
      calls.slots.push(input);
      return slot;
    },
    fetch: async (url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) => {
      if ((init.method ?? 'GET') === 'GET') {
        calls.downloads.push(url);
        const status = options.filmStatus ?? 200;
        if (status !== 200) return new Response('missing', { status });
        if (options.declare === false) {
          return new Response(new ReadableStream({ start(c) { c.enqueue(film); c.close(); } }), { status: 200 });
        }
        return new Response(film, { status: 200, headers: { 'content-length': String(film.byteLength) } });
      }
      calls.puts.push({ url, method: init.method!, headers: { ...init.headers }, bytes: init.body?.byteLength ?? 0 });
      return new Response(null, { status: options.putStatus ?? 200 });
    },
  };
  return { deps, calls, film };
}

describe('reference videos on the account lane', () => {
  it('uploads each distinct video once, PUTs it with every header the slot names, and uses the asset URL', async () => {
    const { deps, calls, film } = network();
    const twice = job({ inputs: [{ kind: 'video', url: FILM, mime: 'video/mp4' }, { kind: 'image', url: PICTURE }, { kind: 'video', url: FILM, mime: 'video/mp4' }] });
    const { job: ready, uploads, bytes } = await withUploadedVideos(twice, deps);
    expect(calls.downloads).toEqual([FILM]);
    expect(calls.slots).toEqual([{ content_type: 'video/mp4', filename: 'reference.mp4' }]);
    expect(calls.puts).toEqual([
      { url: 'https://uploads.sunra.test/put/ref.mp4?X-Amz-Signature=secret-signature&X-Amz-Credential=abc', method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'x-amz-meta-origin': 'cli' }, bytes: film.byteLength },
    ]);
    expect(ready.inputs).toEqual([
      { kind: 'video', url: 'https://cdn.sunra.ai/assets/ref-1.mp4', mime: 'video/mp4' },
      { kind: 'image', url: PICTURE },
      { kind: 'video', url: 'https://cdn.sunra.ai/assets/ref-1.mp4', mime: 'video/mp4' },
    ]);
    expect({ uploads, bytes }).toEqual({ uploads: 1, bytes: film.byteLength });
    expect(toolCall(ready, 'p').input.reference_videos).toEqual(['https://cdn.sunra.ai/assets/ref-1.mp4']);
    // The job as claimed is left as it was.
    expect(twice.inputs[0]!.url).toBe(FILM);
  });

  it('leaves a job without a video alone and calls nothing', async () => {
    const { deps, calls } = network();
    const still = job({ kind: 'video', inputs: [{ kind: 'image', url: PICTURE }, { kind: 'audio', url: 'https://example.test/a.mp3' }] });
    const { job: ready, uploads } = await withUploadedVideos(still, deps);
    expect(ready).toBe(still);
    expect(uploads).toBe(0);
    expect(calls).toEqual({ downloads: [], slots: [], puts: [] });
  });

  it('asks for the slot with the video\'s stored type, and mp4 when it has none the slot takes', async () => {
    for (const [mime, expected] of [
      ['video/quicktime', { content_type: 'video/quicktime', filename: 'reference.mov' }],
      ['video/webm', { content_type: 'video/webm', filename: 'reference.webm' }],
      [undefined, { content_type: 'video/mp4', filename: 'reference.mp4' }],
      ['application/octet-stream', { content_type: 'video/mp4', filename: 'reference.mp4' }],
    ] as const) {
      const { deps, calls } = network();
      await withUploadedVideos(job({ inputs: [{ kind: 'video', url: FILM, ...(mime ? { mime } : {}) }] }), deps);
      expect(calls.slots, String(mime)).toEqual([expected]);
    }
  });

  it('caps a video at the studio upload limit, told or not by the host, before asking for a slot', async () => {
    expect(REFERENCE_VIDEO_MAX_BYTES).toBe(STUDIO_LIMITS.videoBytesMax);
    const big = new Uint8Array(32);
    for (const declare of [true, false]) {
      const { deps, calls } = network({ film: big, declare });
      await expect(withUploadedVideos(job(), { ...deps, maxBytes: 16 })).rejects.toBeInstanceOf(ReferenceUploadError);
      expect(calls.slots).toEqual([]);
      expect(calls.puts).toEqual([]);
    }
  });

  it('fails the run as a plain failure when the video cannot be fetched or the upload is refused, naming no secret', async () => {
    const missing = network({ filmStatus: 404 });
    const notFound = await withUploadedVideos(job(), missing.deps).catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(ReferenceUploadError);
    expect(failureCodeOf(notFound)).toBe('failed');

    const refused = network({ putStatus: 403 });
    const error = await withUploadedVideos(job(), refused.deps).catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(ReferenceUploadError);
    expect(failureCodeOf(error)).toBe('failed');
    expect(error.message).toMatch(/403/);
    expect(error.message).not.toMatch(/Signature|secret|uploads\.sunra\.test/);

    const noAsset = network({ slot: { upload_url: 'https://uploads.sunra.test/put', headers: {}, asset_url: 'http://insecure.test/a.mp4' } });
    await expect(withUploadedVideos(job(), noAsset.deps)).rejects.toBeInstanceOf(ReferenceUploadError);
  });

  it('a slot the CLI refuses is a plain failure too (it says nothing about the account\'s balance)', async () => {
    const { deps } = network();
    const refusing = { ...deps, uploadSlot: async () => { throw new CliRefusal('rate limit reached, unavailable'); } };
    const error = await withUploadedVideos(job(), refusing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReferenceUploadError);
    expect(failureCodeOf(error)).toBe('failed');
    // A refusal of the generation itself keeps its own reading.
    expect(failureCodeOf(new CliRefusal('insufficient credits'))).toBe('provider_unavailable');
    expect(failureCodeOf(new CliRefusal('content policy violation'))).toBe('provider_rejected');
    expect(failureCodeOf(new Error('socket hang up'))).toBe('failed');
  });
});

describe('what the worker logs and reports', () => {
  it('drops the query string of every URL in a message', () => {
    expect(redactUrls('PUT https://uploads.sunra.test/put/ref.mp4?X-Amz-Signature=abc&b=c failed; see https://cdn.sunra.ai/a.mp4#t=1 and http://x.test/y?z')).toBe(
      'PUT https://uploads.sunra.test/put/ref.mp4 failed; see https://cdn.sunra.ai/a.mp4 and http://x.test/y',
    );
    expect(redactUrls('no address here')).toBe('no address here');
  });
});
