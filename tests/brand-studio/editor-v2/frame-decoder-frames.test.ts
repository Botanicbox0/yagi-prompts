import { describe, expect, it } from 'vitest';
import { FakeDecoder, counter, makeIndex, pictureOf, session, us, STEP, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, A0: production's console showed "A VideoFrame was garbage collected without being closed." right
 * after an export was cancelled. Every frame the decoder gives is held for a picture asked for or closed,
 * and nothing is left open after a cancel, after close(), or when a frame arrives after the decoder was let go.
 */
useFakeDecoder();

describe('no frame of the decoder is left open', () => {
  it('after a cancel and close(), every frame the decoder gave is closed', async () => {
    FakeDecoder.reorder = 3;
    const index = makeIndex(24);
    const s = await session(index);
    const controller = new AbortController();
    const pictures = [2, 3, 4, 5, 6, 7, 8];
    expect(pictureOf(await s.picture(0, pictures, 2, controller.signal))).toBe(2);
    controller.abort();
    await s.picture(0, pictures, 3, controller.signal).catch(() => undefined);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('a frame that arrives after close() is closed at once', async () => {
    const index = makeIndex(24, 12);
    const s = await session(index);
    expect(pictureOf(await s.picture(0, [2, 3], 2))).toBe(2);
    const decoder = FakeDecoder.made[0]!;
    s.close();
    expect(counter.open).toBe(0);
    decoder.late(us(3 * STEP));
    expect(counter.open).toBe(0);
  });

  it('a session that was closed answers no more requests', async () => {
    const index = makeIndex(12);
    const s = await session(index);
    s.close();
    await expect(s.picture(0, [1], 1)).rejects.toThrow(/closed/);
    expect(counter.open).toBe(0);
  });
});

describe('the export closes what it makes for the encoders, whatever encode() does', () => {
  it('the picture frame and the sound data are closed in a finally after encode()', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(process.cwd(), 'components/brand-studio/editor-v2/export-film.ts'), 'utf8');
    expect(source).toMatch(/new VideoFrame\(canvas[\s\S]{0,240}?try \{\s*encoder\.encode\(frame[\s\S]{0,120}?\} finally \{\s*frame\.close\(\);/);
    expect(source).toMatch(/try \{\s*encoder\.encode\(data\);\s*\} finally \{\s*data\.close\(\);/);
  });
});
