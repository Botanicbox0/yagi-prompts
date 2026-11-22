import { describe, expect, it } from 'vitest';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import { FakeDecoder, makeIndex, pictureOf, session, useFakeDecoder } from './fake-decoder';
import { abortListeners } from './abort-listeners';

/**
 * Spec H, F6: the session reads the next run of bytes ahead. When it lets go (suspend, close, another group, a
 * reclaim) that read is aborted: no bytes read and thrown away after the session let go.
 */
useFakeDecoder();

/** Every sample 2 MB apart, so each is its own run and each feed reads the next run ahead. */
function spread() {
  const index = makeIndex(24, 12);
  return { ...index, offsets: index.offsets.map((_, i) => i * 2_000_000) };
}

function recording() {
  const reads: Array<{ start: number; signal: AbortSignal | undefined }> = [];
  const bytes: SampleBytes = {
    read: (run, signal) => {
      reads.push({ start: run.start, signal });
      // The run after picture 5's is still coming when the session lets go.
      if (run.start >= 6 * 2_000_000) return new Promise(() => undefined);
      return Promise.resolve(new Uint8Array(run.end - run.start));
    },
    stats: () => ({ requests: 0, received: 0, mode: 'range', fileSize: null }),
  };
  return { reads, bytes };
}

const pending = (reads: Array<{ start: number; signal: AbortSignal | undefined }>) => reads.filter((read) => read.start >= 6 * 2_000_000);

describe('the read ahead ends when the session lets go', () => {
  for (const [name, letGo] of [
    ['suspend', (s: Awaited<ReturnType<typeof session>>) => s.suspend()],
    ['close', (s: Awaited<ReturnType<typeof session>>) => s.close()],
    ['a reclaim', () => FakeDecoder.made[0]!.reclaim()],
  ] as const) {
    it(`${name}: the read already started for the next run is aborted`, async () => {
      const { reads, bytes } = recording();
      const s = await session(spread(), bytes);
      expect(pictureOf(await s.picture(0, [5, 6, 7], 5, new AbortController().signal))).toBe(5);
      expect(pending(reads).length).toBe(1);
      expect(pending(reads)[0]!.signal?.aborted).toBe(false);
      letGo(s);
      expect(pending(reads)[0]!.signal?.aborted).toBe(true);
      s.close();
    });
  }

  it('another group: the read ahead of the old one is aborted', async () => {
    const { reads, bytes } = recording();
    const s = await session(spread(), bytes);
    expect(pictureOf(await s.picture(0, [5, 6, 7], 5))).toBe(5);
    const ahead = pending(reads)[0]!;
    await s.picture(1, [1], 1);
    expect(ahead.signal?.aborted).toBe(true);
    s.close();
  });
});

describe('spec I, G4: the export’s cancel signal is not left holding a listener per read', () => {
  it('24 runs read, each its own request: no listener left on the export’s signal', async () => {
    const reads: number[] = [];
    const bytes: SampleBytes = {
      read: async (run) => (reads.push(run.start), new Uint8Array(run.end - run.start)),
      stats: () => ({ requests: 0, received: 0, mode: 'range', fileSize: null }),
    };
    const exportCancel = new AbortController();
    const count = abortListeners(exportCancel.signal);
    const s = await session(spread(), bytes);
    const wanted = Array.from({ length: 24 }, (_, i) => i);
    for (const picture of wanted) expect(pictureOf(await s.picture(0, wanted, picture, exportCancel.signal))).toBe(picture);
    s.close();
    expect(reads.length).toBeGreaterThanOrEqual(24);
    expect(count()).toBe(0);
  });
});
