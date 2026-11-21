import { describe, expect, it } from 'vitest';
import { CodecReclaimed, runWithRestarts } from '@/lib/brand-studio/editor-v2/export-run';
import { encodeFrames, encodeFromPaths, handOver, type FrameStep } from '@/lib/brand-studio/editor-v2/frame-loop';

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

/**
 * Spec H, F8 (was a source-text test): every picture comes from the picture paths, a frame is marked done only
 * after its picture went to the encoder (its source may let go of the decoder and its frame then), and
 * everything is let go when the loop ends, however it ends.
 */
describe('the video pass over the picture paths', () => {
  function run(options: { failPicture?: number; failEncode?: number; cancelAt?: number } = {}) {
    const log: string[] = [];
    const controller = new AbortController();
    const paths = {
      picture: async (entry: { frame: number }) => {
        log.push(`picture ${entry.frame}`);
        if (entry.frame === options.failPicture) throw new FrameError(`no picture ${entry.frame}`);
        return `p${entry.frame}`;
      },
      done: (frame: number) => log.push(`done ${frame}`),
      closeAll: () => log.push('closeAll'),
    };
    const running = encodeFromPaths(plan.slice(0, 3), paths, {
      checkCancel: () => {
        if (controller.signal.aborted) throw new Cancelled();
      },
      stopped: () => null,
      encode: (entry, picture) => {
        if (entry.frame === options.failEncode) throw new Error('encoder refused');
        log.push(`encode ${entry.frame} ${picture}`);
      },
      after: async (entry) => {
        log.push(`after ${entry.frame}`);
        if (entry.frame === options.cancelAt) controller.abort();
      },
    });
    return { running, log };
  }

  it('each picture from the paths, done after its encode and before the rest of the frame, everything let go at the end', async () => {
    const { running, log } = run();
    await running;
    expect(log).toEqual([
      'picture 0', 'encode 0 p0', 'done 0', 'after 0',
      'picture 1', 'encode 1 p1', 'done 1', 'after 1',
      'picture 2', 'encode 2 p2', 'done 2', 'after 2',
      'closeAll',
    ]);
  });

  it('a picture that fails, an encoder that refuses, a cancel: everything is let go once, and the frame is not marked done', async () => {
    for (const [options, kind, frame] of [[{ failPicture: 1 }, FrameError, 1], [{ failEncode: 1 }, Error, 1], [{ cancelAt: 0 }, Cancelled, 1]] as const) {
      const { running, log } = run(options);
      await expect(running).rejects.toBeInstanceOf(kind);
      expect(log.filter((entry) => entry === 'closeAll')).toHaveLength(1);
      expect(log[log.length - 1]).toBe('closeAll');
      expect(log).not.toContain(`done ${frame}`);
    }
  });
});

/** Spec H, F8 (was a source-text test): a picture frame or a block of sound is closed whatever the encoder does. */
describe('handing a frame to the encoder', () => {
  const item = () => {
    const made = { closed: 0, close: () => (made.closed += 1) };
    return made;
  };

  it('closed after the encoder took it', () => {
    const frame = item();
    const taken: unknown[] = [];
    handOver(frame, (given) => taken.push(given));
    expect(taken).toEqual([frame]);
    expect(frame.closed).toBe(1);
  });

  it('closed when the encoder refuses it, and the refusal goes on as it was', () => {
    const frame = item();
    const refusal = new DOMException("Cannot call 'encode' on a closed codec.", 'InvalidStateError');
    expect(() =>
      handOver(frame, () => {
        throw refusal;
      }),
    ).toThrow(refusal);
    expect(frame.closed).toBe(1);
  });
});
