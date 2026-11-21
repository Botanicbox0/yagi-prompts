import { describe, expect, it } from 'vitest';
import { CodecReclaimed, runWithRestarts } from '@/lib/brand-studio/editor-v2/export-run';
import { encodeFrames, type FrameStep } from '@/lib/brand-studio/editor-v2/frame-loop';

/**
 * Spec H, F1: the export's frame loop (lib/brand-studio/editor-v2/frame-loop.ts, used by export-film.ts
 * `videoPass`) with the picture getter and the encoder given. A picture that fails after the encoder was taken
 * back (it waited in a hidden page, then the seek path gave up on it) must restart the export, not end it.
 */
class FrameError extends Error {}
class Cancelled extends Error {}

/** One attempt: a fake encoder (`reclaimed` is what its error callback got) and a picture getter. */
function attempt(plan: Array<{ frame: number }>, picture: (frame: number, encoder: { reclaimed: boolean }) => Promise<string>, signal?: AbortSignal) {
  const encoder = { reclaimed: false, written: [] as number[] };
  const step: FrameStep<{ frame: number }, string> = {
    checkCancel: () => {
      if (signal?.aborted) throw new Cancelled();
    },
    stopped: () => (encoder.reclaimed ? new CodecReclaimed('video') : null),
    picture: (entry) => picture(entry.frame, encoder),
    encode: (entry) => {
      if (encoder.reclaimed) throw new DOMException("Cannot call 'encode' on a closed codec.", 'InvalidStateError');
      encoder.written.push(entry.frame);
    },
    after: async () => undefined,
  };
  return encodeFrames(plan, step).then(() => encoder.written);
}

const plan = Array.from({ length: 5 }, (_, frame) => ({ frame }));

describe('a picture that fails after the encoder was taken back restarts the export', () => {
  it('reclaimed while the seek picture waits, then the picture fails with a frame error: the attempt ends CodecReclaimed and runs again', async () => {
    let attempts = 0;
    const outcome = await runWithRestarts(
      () => {
        attempts += 1;
        const first = attempts === 1;
        return attempt(plan, async (frame, encoder) => {
          if (first && frame === 2) {
            // The browser takes the encoder back while this picture waits; then the picture gives up.
            encoder.reclaimed = true;
            throw new FrameError('film frame 2 could not be confirmed');
          }
          return `picture ${frame}`;
        });
      },
      async () => undefined,
    );
    expect(outcome).toEqual({ result: [0, 1, 2, 3, 4], restarts: 1 });
    expect(attempts).toBe(2);
  });

  it('a picture that fails with the encoder still alive ends the export with that failure', async () => {
    const failure = new FrameError('film frame 2 could not be confirmed');
    await expect(attempt(plan, async (frame) => (frame === 2 ? Promise.reject(failure) : `picture ${frame}`))).rejects.toBe(failure);
  });

  it('a cancel during the picture is a cancel, even when the encoder was taken back too', async () => {
    const controller = new AbortController();
    const outcome = attempt(plan, async (frame, encoder) => {
      if (frame === 1) {
        encoder.reclaimed = true;
        controller.abort();
        throw new FrameError('aborted');
      }
      return `picture ${frame}`;
    }, controller.signal);
    await expect(outcome).rejects.toBeInstanceOf(Cancelled);
  });

  it('the encoder is asked after the picture arrives and before encode(): no raw closed-codec error', async () => {
    const outcome = attempt(plan, async (frame, encoder) => {
      if (frame === 3) encoder.reclaimed = true;
      return `picture ${frame}`;
    });
    await expect(outcome).rejects.toBeInstanceOf(CodecReclaimed);
  });
});
