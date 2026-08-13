import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalStorageDriver } from '@/lib/storage/local-driver';
import {
  ALLOWED_AUDIO_MIMES,
  ALLOWED_VIDEO_MIMES,
  checkUpload,
  probeMp4DurationSeconds,
  probeVideoDurationSeconds,
  promptStagingKey,
  publishPromptMedia,
  publishedKeyFor,
  sha256Hex,
  stagePromptUpload,
} from '@/lib/prompts/media';
import { AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS } from '@/lib/prompts/schemas';

/**
 * PLAN §13.1 — the caps and the publish copy, over real bytes.
 *
 * Everything abuse-facing is measured, never declared: the size comes from the buffer, the duration
 * comes out of the container, and the published key comes out of the hash.
 */

// --- a minimal ISO-BMFF file, built the same way `scripts/seed.ts` builds fixture video ---------
function isoBox(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, payload]);
}

function mp4(durationSeconds: number, timescale = 1000): Buffer {
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(0, 0);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(durationSeconds * timescale), 16);
  const ftyp = Buffer.concat([
    Buffer.from('isom', 'latin1'),
    Buffer.alloc(4), // minor version
    Buffer.from('isomiso2mp41', 'latin1'),
  ]);
  return Buffer.concat([
    isoBox('ftyp', ftyp),
    isoBox('moov', isoBox('mvhd', mvhd)),
    isoBox('mdat', Buffer.from('placeholder', 'latin1')),
  ]);
}

/** Copy into a plain `Uint8Array` so the bytes are a valid `File` part under `lib.dom`'s types. */
function filePart(buffer: Buffer) {
  const out = new Uint8Array(buffer.length);
  out.set(buffer);
  return out;
}

describe('mp4 duration probe (§13.1 — 60s cap)', () => {
  it('reads a v0 mvhd duration', () => {
    expect(probeMp4DurationSeconds(mp4(6))).toBeCloseTo(6, 5);
    expect(probeMp4DurationSeconds(mp4(59.5))).toBeCloseTo(59.5, 5);
  });

  it('respects the container timescale rather than assuming one', () => {
    expect(probeMp4DurationSeconds(mp4(6, 600))).toBeCloseTo(6, 5);
  });

  it('answers null — never throws — on anything that is not ISO-BMFF', () => {
    expect(probeMp4DurationSeconds(new Uint8Array(0))).toBeNull();
    expect(probeMp4DurationSeconds(new TextEncoder().encode('not a video at all'))).toBeNull();
    // A truncated moov: the box walk must terminate, not loop.
    expect(probeMp4DurationSeconds(mp4(6).slice(0, 24))).toBeNull();
  });

  it('does not pretend to read WebM', () => {
    expect(probeVideoDurationSeconds(mp4(6), 'video/webm')).toBeNull();
    expect(probeVideoDurationSeconds(mp4(6), 'video/mp4')).toBeCloseTo(6, 5);
    expect(probeVideoDurationSeconds(mp4(6), 'video/mp4; codecs="avc1"')).toBeCloseTo(6, 5);
  });
});

describe('upload caps (§13.1)', () => {
  const base = { kind: 'video' as const, mime: 'video/mp4', sizeBytes: 1024, durationSeconds: 10 };

  it('accepts a normal clip', () => {
    expect(checkUpload(base)).toBeNull();
  });

  it('refuses anything over 32MB, measured over the bytes', () => {
    expect(VIDEO_MAX_BYTES).toBe(32 * 1024 * 1024);
    expect(checkUpload({ ...base, sizeBytes: VIDEO_MAX_BYTES + 1 })).toBe('too_large');
    expect(checkUpload({ ...base, sizeBytes: VIDEO_MAX_BYTES })).toBeNull();
  });

  it('refuses a clip longer than 60s when the duration is knowable', () => {
    expect(VIDEO_MAX_SECONDS).toBe(60);
    expect(checkUpload({ ...base, durationSeconds: 61 })).toBe('too_long');
    expect(checkUpload({ ...base, durationSeconds: 60 })).toBeNull();
  });

  /**
   * The documented interpretation: an unreadable duration is ACCEPTED and left to the human who
   * reviews every submission anyway. Refusing every WebM would be a stricter rule than §13.1's,
   * dressed up as the same one.
   */
  it('accepts a clip whose duration cannot be read', () => {
    expect(checkUpload({ ...base, mime: 'video/webm', durationSeconds: null })).toBeNull();
  });

  /**
   * Founder direction (2026-08-13) — audio results. Its own byte cap (20MB), the formats
   * music/TTS models actually emit, no duration rule (human moderation, exactly as WebM), and
   * m4a's ISO-BMFF duration read for free where present.
   */
  it('accepts audio in the emitted formats, capped at 20MB', () => {
    const audio = { kind: 'audio' as const, mime: 'audio/mpeg', sizeBytes: 1024, durationSeconds: null };
    expect(AUDIO_MAX_BYTES).toBe(20 * 1024 * 1024);
    for (const mime of ALLOWED_AUDIO_MIMES) {
      expect(checkUpload({ ...audio, mime }), mime).toBeNull();
    }
    expect(checkUpload({ ...audio, sizeBytes: AUDIO_MAX_BYTES })).toBeNull();
    expect(checkUpload({ ...audio, sizeBytes: AUDIO_MAX_BYTES + 1 })).toBe('too_large');
    expect(checkUpload({ ...audio, mime: 'video/mp4' })).toBe('bad_type');
    expect(checkUpload({ ...audio, mime: 'application/zip' })).toBe('bad_type');
    // No duration cap for audio — a long track passes and a human hears it before it ships.
    expect(checkUpload({ ...audio, durationSeconds: 600 })).toBeNull();
  });

  it('refuses a file type outside the whitelist, per kind', () => {
    expect(checkUpload({ ...base, mime: 'application/zip' })).toBe('bad_type');
    expect(checkUpload({ ...base, kind: 'poster', mime: 'video/mp4' })).toBe('bad_type');
    expect(checkUpload({ ...base, kind: 'poster', mime: 'image/png' })).toBeNull();
    expect([...ALLOWED_VIDEO_MIMES]).toContain('video/mp4');
  });
});

describe('staging + publication (§13.1 lifecycle)', () => {
  async function harness() {
    const root = await mkdtemp(join(tmpdir(), 'playbook-prompt-media-'));
    return { root, storage: createLocalStorageDriver(root), close: () => rm(root, { recursive: true, force: true }) };
  }

  it('stages under the prompt namespace and hashes the real bytes', async () => {
    const h = await harness();
    const bytes = mp4(6);
    const file = new File([filePart(bytes)], 'clip.mp4', { type: 'video/mp4' });

    const staged = await stagePromptUpload(h.storage, '9a000000-0000-4000-8000-000000000001', 'video', file);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    expect(staged.value.ref.staging_key).toMatch(/^content\/prompt\/9a000000-0000-4000-8000-000000000001\//);
    expect(staged.value.ref.sha256).toBe(sha256Hex(bytes));
    expect(staged.value.ref.duration_s).toBeCloseTo(6, 2);
    expect(await h.storage.exists('content', staged.value.ref.staging_key)).toBe(true);
    await h.close();
  });

  it('refuses an over-long clip BEFORE anything is written', async () => {
    const h = await harness();
    const file = new File([filePart(mp4(90))], 'long.mp4', { type: 'video/mp4' });
    const staged = await stagePromptUpload(h.storage, '9a000000-0000-4000-8000-000000000001', 'video', file);
    expect(staged).toEqual({ ok: false, reason: 'too_long' });
    await h.close();
  });

  it('copies to a content-addressed public key and stamps the ref', async () => {
    const h = await harness();
    const bytes = new TextEncoder().encode('poster bytes');
    const file = new File([bytes], 'poster.png', { type: 'image/png' });
    const staged = await stagePromptUpload(h.storage, '9a000000-0000-4000-8000-000000000002', 'poster', file);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const first = await publishPromptMedia(h.storage, { poster: staged.value.ref });
    expect(first.report).toEqual({ copied: 1, alreadyPresent: 0 });
    expect(first.media.poster?.bucket).toBe('public-content');
    expect(first.media.poster?.published_key).toBe(publishedKeyFor(staged.value.ref.sha256, 'x.png'));
    expect(await h.storage.exists('public-content', first.media.poster!.published_key!)).toBe(true);

    // Idempotent: approve pressed twice is the same object, not an overwrite (§6 write-once).
    const second = await publishPromptMedia(h.storage, first.media);
    expect(second.report).toEqual({ copied: 0, alreadyPresent: 1 });
    expect(second.media.poster?.published_key).toBe(first.media.poster?.published_key);
    await h.close();
  });

  it('derives the published key from the hash and the staging extension', () => {
    expect(publishedKeyFor('a'.repeat(64), 'content/prompt/x/y.PNG')).toBe(`${'a'.repeat(64)}.png`);
    expect(publishedKeyFor('a'.repeat(64), 'no-extension')).toBe('a'.repeat(64));
    expect(promptStagingKey('id', 'mp4')).toMatch(/^content\/prompt\/id\/[0-9a-f-]+\.mp4$/);
  });

  /** Audio rides the SAME staging→copy pipeline (founder 2026-08-13) — one asset kind, no fork. */
  it('stages and publishes an audio result exactly like the other kinds', async () => {
    const h = await harness();
    const file = new File([filePart(Buffer.from('ID3 not-really-mp3-but-mime-gated', 'latin1'))], 'result.mp3', {
      type: 'audio/mpeg',
    });
    const staged = await stagePromptUpload(h.storage, 'prompt-1', 'audio', file);
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    expect(staged.value.ref.staging_key).toMatch(/\.mp3$/);

    const published = await publishPromptMedia(h.storage, { audio: staged.value.ref });
    expect(published.report).toEqual({ copied: 1, alreadyPresent: 0 });
    expect(published.media.audio?.bucket).toBe('public-content');
    expect(published.media.audio?.published_key).toMatch(/\.mp3$/);
    expect(await h.storage.exists('public-content', published.media.audio!.published_key!)).toBe(true);
    await h.close();
  });
});
