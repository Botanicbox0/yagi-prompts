/**
 * `BRAND_STUDIO_PROVIDER=fake`: no network, no money (docs/BRAND-STUDIO-V2.md §7).
 *
 * A submitted task reports `pending` for its first poll and succeeds on the second. Images are soft
 * gradient PNGs in the requested aspect (long side 512 px, made with sharp). Videos are always the
 * bundled 5-second 854x480 clip (./fake-clip.ts); a draft also gets a fake draft id so the
 * draft -> final path runs end to end.
 *
 * Music (an endpoint under `suno/`) answers with two versions, real MP3 files of 12 s and 8 s (./fake-music.ts),
 * so a local screen plays, draws and measures them (docs/BRAND-SOUND-STUDIO.md §7.4).
 *
 * A prompt (or a music style or lyrics) containing `[[fake:reject]]` or `[[fake:fail]]` fails the task with
 * `provider_rejected` / `failed`, and `[[fake:none]]` makes a music request finish with no version, so tests
 * can exercise the failure paths without a real provider.
 */
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { FAKE_CLIP_MP4_BASE64, FAKE_CLIP_SECONDS } from './fake-clip';
import { FAKE_MUSIC_CLIPS } from './fake-music';
import type { StudioProvider, StudioProviderRequest } from './types';

const LONG_SIDE = 512;

function ratioOf(value: unknown): [number, number] {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value) : null;
  if (!match) return [1, 1];
  const w = Number(match[1]), h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : [1, 1];
}

export function fakeImageSize(aspect: unknown): { width: number; height: number } {
  const [w, h] = ratioOf(aspect);
  return w >= h
    ? { width: LONG_SIDE, height: Math.max(8, Math.round((LONG_SIDE * h) / w)) }
    : { width: Math.max(8, Math.round((LONG_SIDE * w) / h)), height: LONG_SIDE };
}

/** A vertical gradient from near-white to TWINGS blue, as PNG. */
export async function fakeImagePng(width: number, height: number): Promise<Uint8Array> {
  const top = [0xf4, 0xf7, 0xfb], bottom = [0x38, 0x75, 0xc5];
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const t = height > 1 ? y / (height - 1) : 0;
    const px = top.map((c, i) => Math.round(c + (bottom[i]! - c) * t));
    for (let x = 0; x < width; x++) raw.set(px, (y * width + x) * 3);
  }
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer());
}

export function fakeClipBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(FAKE_CLIP_MP4_BASE64, 'base64'));
}

interface FakeTask {
  medium: 'image' | 'video' | 'audio';
  width: number;
  height: number;
  draft: boolean;
  outcome: 'ok' | 'reject' | 'fail' | 'none';
  polls: number;
}

export function createFakeStudioProvider(options: { pollsBeforeDone?: number } = {}): StudioProvider & { tasks: Map<string, FakeTask> } {
  const tasks = new Map<string, FakeTask>();
  const doneAfter = Math.max(1, options.pollsBeforeDone ?? 2);
  return {
    name: 'fake',
    tasks,
    async submit(request: StudioProviderRequest) {
      const video = /-to-video$/.test(request.endpoint);
      const music = request.endpoint.startsWith('suno/');
      const prompt = ['prompt', 'style', 'lyrics', 'title'].map((k) => (typeof request.body[k] === 'string' ? request.body[k] : '')).join(' ');
      const size = fakeImageSize(request.body.aspect_ratio);
      const id = `fake_${randomBytes(9).toString('hex')}`;
      tasks.set(id, {
        medium: music ? 'audio' : video ? 'video' : 'image',
        ...size,
        draft: request.body.draft === true,
        outcome: prompt.includes('[[fake:reject]]') ? 'reject' : prompt.includes('[[fake:fail]]') ? 'fail' : music && prompt.includes('[[fake:none]]') ? 'none' : 'ok',
        polls: 0,
      });
      return { taskId: id };
    },
    async status(taskId) {
      const task = tasks.get(taskId);
      if (!task) return { state: 'failed', code: 'failed', detail: 'unknown fake task' };
      task.polls += 1;
      if (task.polls < doneAfter) return { state: 'pending' };
      if (task.outcome === 'reject') return { state: 'failed', code: 'provider_rejected', detail: 'fake rejection' };
      if (task.outcome === 'fail') return { state: 'failed', code: 'failed', detail: 'fake failure' };
      if (task.outcome === 'none') return { state: 'failed', code: 'failed', detail: 'fake: completed without a version' };
      if (task.medium === 'audio') {
        return {
          state: 'succeeded',
          outputs: FAKE_MUSIC_CLIPS.map((clip, i) => ({
            url: `fake://audio/${i}/${taskId}`,
            mime: 'audio/mpeg',
            seconds: clip.seconds,
            meta: { taskId, clipId: `${taskId}-${i}` },
          })),
        };
      }
      if (task.medium === 'video') {
        return {
          state: 'succeeded',
          outputs: [{ url: `fake://video/${taskId}`, mime: 'video/mp4', seconds: FAKE_CLIP_SECONDS }],
          ...(task.draft ? { draftTaskId: `fake-draft-${taskId}` } : {}),
        };
      }
      return { state: 'succeeded', outputs: [{ url: `fake://image/${task.width}x${task.height}/${taskId}`, mime: 'image/png' }] };
    },
    async cancel(taskId) {
      tasks.delete(taskId);
    },
    async download(url) {
      const image = /^fake:\/\/image\/(\d{1,4})x(\d{1,4})\//.exec(url);
      if (image) return { bytes: await fakeImagePng(Number(image[1]), Number(image[2])), mime: 'image/png' };
      if (url.startsWith('fake://video/')) return { bytes: fakeClipBytes(), mime: 'video/mp4' };
      const audio = /^fake:\/\/audio\/(\d)\//.exec(url);
      const clip = audio ? FAKE_MUSIC_CLIPS[Number(audio[1])] : undefined;
      if (clip) return { bytes: new Uint8Array(Buffer.from(clip.mp3Base64, 'base64')), mime: 'audio/mpeg' };
      throw new Error('fake download: unknown address');
    },
  };
}

/** One process-wide fake, so a local dev server keeps its task table across requests. */
let shared: ReturnType<typeof createFakeStudioProvider> | null = null;
export function sharedFakeStudioProvider(): StudioProvider {
  shared ??= createFakeStudioProvider();
  return shared;
}
