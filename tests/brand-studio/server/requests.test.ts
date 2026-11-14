import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildStudioRequest, hasSafetyChecker, StudioRequestError, type StudioRequestInput } from '@/lib/brand-studio/provider/requests';
import { STUDIO_MODELS, studioModel } from '@/lib/brand-studio/models';
import type { StudioJobParams } from '@/lib/brand-studio/types';

/**
 * The builders against the provider's own input schemas (docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt,
 * read from the live catalogue). Every key we send must exist on the endpoint, every enum value must be
 * one it lists, and every required key must be present.
 */
interface Param { required: boolean; enumValues: string[] | null }
type Schema = Map<string, Map<string, Param>>;

function parseSchemas(): Schema {
  const text = readFileSync(join(process.cwd(), 'docs/research/SUNRA-API-SCHEMAS-2026-11-10.txt'), 'utf8');
  const out: Schema = new Map();
  let current: Map<string, Param> | null = null;
  for (const line of text.split(/\r?\n/)) {
    const post = /^\s{2}POST \/(\S+)$/.exec(line);
    if (post) {
      current = post[1]!.includes('{request_id}') ? null : new Map();
      if (current) out.set(post[1]!, current);
      continue;
    }
    const param = /^\s{4}(\*?)\s?([a-z_]+):\s+(\S+)(?:\s+enum\[([^\]]*)\])?/.exec(line);
    if (param && current) current.set(param[2]!, { required: param[1] === '*', enumValues: param[4] ? param[4].split(',') : null });
  }
  return out;
}

const SCHEMAS = parseSchemas();

function expectValid(request: { endpoint: string; body: Record<string, unknown> }) {
  const schema = SCHEMAS.get(request.endpoint);
  expect(schema, `schema for ${request.endpoint}`).toBeDefined();
  for (const [key, value] of Object.entries(request.body)) {
    const param = schema!.get(key);
    expect(param, `${request.endpoint} has no "${key}"`).toBeDefined();
    if (param!.enumValues && typeof value === 'string') expect(param!.enumValues, `${request.endpoint}.${key}`).toContain(value);
  }
  for (const [key, param] of schema!) if (param.required) expect(request.body, `${request.endpoint} requires ${key}`).toHaveProperty(key);
}

/**
 * Live models whose schemas are in the 2026-11-10 snapshot. GPT Image 2.6 (pixel-sized, read 2026-11-11)
 * is checked against its own catalogue copy in ./models-gpt-image.test.ts.
 */
const SNAPSHOT_MODELS = STUDIO_MODELS.filter((m) => m.availability === 'live' && !('pixels' in m));
const params = (p: Partial<StudioJobParams> = {}): StudioJobParams => ({ aspect: null, resolution: null, seconds: null, audio: null, count: 1, locale: 'ko', ...p });
const input = (p: Partial<StudioRequestInput>): StudioRequestInput => ({ kind: 'image', model: 'seedream-5.5', prompt: 'a bottle on stone', params: params(), images: [], videos: [], ...p });
const img = (n: number) => `https://media.example.test/st/${String(n).repeat(64).slice(0, 64)}.png`;

describe('the schema file parses', () => {
  it('knows the endpoints the registry names', () => {
    for (const model of SNAPSHOT_MODELS) {
      for (const endpoint of Object.values(model.endpoints)) expect(SCHEMAS.has(`${model.api.alias}/${endpoint}`), `${model.api.alias}/${endpoint}`).toBe(true);
    }
  });
});

describe('image requests', () => {
  it('text-to-image without references, image-editing with them; URL strings in order', () => {
    const plain = buildStudioRequest(input({ params: params({ aspect: '4:3', resolution: '1K' }) }));
    expect(plain).toEqual({
      endpoint: 'bytedance/seedream-5.5/text-to-image',
      body: { prompt: 'a bottle on stone', aspect_ratio: '4:3', resolution: '1K' },
    });
    expectValid(plain);
    const mid = buildStudioRequest(input({ params: params({ aspect: '16:9', resolution: '1.5K' }) }));
    expect(mid.body.resolution).toBe('1.5K');
    expectValid(mid);
    const edit = buildStudioRequest(input({ params: params({ aspect: '9:16', resolution: '2K' }), images: [{ url: img(1) }, { url: img(2) }] }));
    expect(edit.endpoint).toBe('bytedance/seedream-5.5/image-editing');
    expect(edit.body.images).toEqual([img(1), img(2)]);
    expectValid(edit);
  });

  it('sends the safety checker as true on endpoints that have the field and omits it on models without one', () => {
    for (const model of SNAPSHOT_MODELS.filter((m) => m.medium === 'image')) {
      for (const images of [[], [{ url: img(3) }]]) {
        const request = buildStudioRequest(input({ model: model.id, images, params: params({ aspect: '1:1', resolution: '2K' }) }));
        expectValid(request);
        if (hasSafetyChecker(model)) expect(request.body.enable_safety_checker).toBe(true);
        else expect(request.body).not.toHaveProperty('enable_safety_checker');
      }
    }
  });

  it('has no input that turns the safety checker off', () => {
    const sneaky = { ...input({ model: 'seedream-5-flash' }), params: { ...params(), enable_safety_checker: false } as unknown as StudioJobParams, enable_safety_checker: false } as StudioRequestInput;
    expect(buildStudioRequest(sneaky).body.enable_safety_checker).toBe(true);
  });

  it('falls back to the model defaults for an aspect or resolution it does not list, and refuses too many references', () => {
    const request = buildStudioRequest(input({ model: 'nano-banana-pro', params: params({ aspect: '7:1', resolution: '8K' }) }));
    expect(request.body).toMatchObject({ aspect_ratio: '1:1', resolution: '2K' });
    expectValid(request);
    expect(() => buildStudioRequest(input({ images: Array.from({ length: 11 }, (_, i) => ({ url: img(i) })) }))).toThrow(StudioRequestError);
  });

  it('a region edit sends the crop first, then the brand references, as PNG at 2K', () => {
    const request = buildStudioRequest(input({ kind: 'region_edit', model: 'nano-banana-pro', regionCrop: { url: img(9), aspect: '4:3' }, images: [{ url: img(1) }] }));
    expect(request.endpoint).toBe('google/gemini-3-pro-image/image-editing');
    expect(request.body).toMatchObject({ images: [img(9), img(1)], aspect_ratio: '4:3', resolution: '2K', output_format: 'png' });
    expectValid(request);
    expect(() => buildStudioRequest(input({ kind: 'region_edit', model: 'nano-banana-pro' }))).toThrow(StudioRequestError);
  });
});

describe('video requests (Seedance 2.5)', () => {
  const video = (p: Partial<StudioRequestInput>) => input({ kind: 'video', model: 'seedance-2.5', params: params({ aspect: '9:16', resolution: '720p', seconds: 8, audio: 'native' }), ...p });

  it('text-to-video with ratio, duration and native audio', () => {
    const request = buildStudioRequest(video({}));
    expect(request).toEqual({
      endpoint: 'bytedance/seedance-2.5/text-to-video',
      body: { prompt: 'a bottle on stone', resolution: '720p', duration: 8, draft: false, output_format: 'mp4', generate_audio: true, ratio: '9:16' },
    });
    expectValid(request);
  });

  it('a draft is 480p with draft: true; silent turns audio off; ambient keeps it (the prompt says no music)', () => {
    const draft = buildStudioRequest(video({ params: params({ aspect: '16:9', resolution: 'draft', seconds: 5, audio: 'silent' }) }));
    expect(draft.body).toMatchObject({ resolution: '480p', draft: true, generate_audio: false });
    expectValid(draft);
    expect(buildStudioRequest(video({ params: params({ aspect: '16:9', resolution: '720p', seconds: 5, audio: 'ambient' }) })).body.generate_audio).toBe(true);
  });

  it('an opening still alone is image-to-video, which takes no ratio', () => {
    const request = buildStudioRequest(video({ images: [{ url: img(1), frame: 'start' }, { url: img(2), frame: 'end' }] }));
    expect(request.endpoint).toBe('bytedance/seedance-2.5/image-to-video');
    expect(request.body).toMatchObject({ start_image: img(1), end_image: img(2) });
    expect(request.body).not.toHaveProperty('ratio');
    expectValid(request);
  });

  it('reference images make a reference-to-video request', () => {
    const request = buildStudioRequest(video({ images: [{ url: img(1) }, { url: img(2), frame: 'start' }], audios: [{ url: 'https://media.example.test/st/a.mp3' }] }));
    expect(request.endpoint).toBe('bytedance/seedance-2.5/reference-to-video');
    expect(request.body).toMatchObject({ reference_images: [img(1), img(2)], reference_audios: ['https://media.example.test/st/a.mp3'], ratio: '9:16', duration: 8 });
    expectValid(request);
    expect(() => buildStudioRequest(video({ videos: [{ url: img(5) }] }))).toThrow(StudioRequestError);
  });

  it('a remix edit pins the edit task, follows the source (duration -1, adaptive) and can be a draft', () => {
    const request = buildStudioRequest(
      input({
        kind: 'video_remix', model: 'seedance-2.5', videos: [{ url: img(7) }], images: [{ url: img(1) }],
        params: params({ aspect: null, resolution: 'draft', seconds: null, audio: 'ambient', method: 'edit', keep: ['camera'] }),
      }),
    );
    expect(request.endpoint).toBe('bytedance/seedance-2.5/reference-to-video');
    expect(request.body).toMatchObject({ reference_videos: [img(7)], reference_images: [img(1)], duration: -1, ratio: 'adaptive', omni_reference_task_type: 'edit', draft: true, resolution: '480p' });
    expectValid(request);
  });

  it('a remix reference takes the asked shape and length', () => {
    const request = buildStudioRequest(
      input({ kind: 'video_remix', model: 'seedance-2.5', videos: [{ url: img(7) }], params: params({ aspect: '1:1', resolution: '1080p', seconds: 10, audio: 'native', method: 'reference' }) }),
    );
    expect(request.body).toMatchObject({ ratio: '1:1', duration: 10, omni_reference_task_type: 'reference', resolution: '1080p', draft: false });
    expectValid(request);
    expect(() => buildStudioRequest(input({ kind: 'video_remix', model: 'seedance-2.5', params: params({ method: 'edit' }) }))).toThrow(StudioRequestError);
  });

  it('a final is draft-to-video with the draft id only', () => {
    const request = buildStudioRequest(input({ kind: 'video_final', model: 'seedance-2.5', prompt: '', draftTaskId: 'draft_abc' }));
    expect(request).toEqual({ endpoint: 'bytedance/seedance-2.5/draft-to-video', body: { draft_task_id: 'draft_abc', output_format: 'mp4' } });
    expectValid(request);
    expect(() => buildStudioRequest(input({ kind: 'video_final', model: 'seedance-2.5' }))).toThrow(StudioRequestError);
  });

  it('refuses an image model for a video and the reverse', () => {
    expect(() => buildStudioRequest(video({ model: 'seedream-5.5' }))).toThrow(StudioRequestError);
    expect(() => buildStudioRequest(input({ model: 'seedance-2.5' }))).toThrow(StudioRequestError);
    expect(studioModel('seedance-2.5')?.medium).toBe('video');
  });
});
