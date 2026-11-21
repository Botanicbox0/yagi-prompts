/**
 * Editing studio v2 — the export's frame loop (export-film.ts `videoPass`), with what it needs given, so it is
 * tested without a browser (spec H, F1).
 *
 * For each film frame: the cancel and the encoder are asked first; the picture is got (decoder or seek path);
 * the encoder is asked again before `encode()` (the picture may have waited long in a hidden page, and the
 * browser takes an idle encoder back after about 90 s, spec G A1). A picture that FAILED is answered the same
 * way: when the encoder was taken back meanwhile, the attempt ends with that (`CodecReclaimed`: the export
 * starts again once the page is visible, export-run.ts) instead of the picture's own failure, because the
 * picture usually failed only because the page was hidden. A cancel stays a cancel.
 */

export interface FrameStep<E extends { frame: number }, P> {
  /** Throws the export's cancel when it was cancelled. */
  checkCancel(): void;
  /** Why the encoder takes no more frames (taken back by the browser, or failed), or `null`. */
  stopped(frame: number): Error | null;
  /** The picture of this film frame. */
  picture(entry: E): Promise<P>;
  /** Draws it and hands it to the encoder; throws when the encoder refuses. */
  encode(entry: E, picture: P): void;
  /** After the frame is in the file: sources let go, the encoder's queue waited for, progress, a yield. */
  after(entry: E, picture: P): Promise<void>;
}

export async function encodeFrames<E extends { frame: number }, P>(plan: readonly E[], step: FrameStep<E, P>): Promise<void> {
  for (const entry of plan) {
    step.checkCancel();
    const before = step.stopped(entry.frame);
    if (before) throw before;
    let picture: P;
    try {
      picture = await step.picture(entry);
    } catch (error) {
      step.checkCancel();
      throw step.stopped(entry.frame) ?? error;
    }
    const after = step.stopped(entry.frame);
    if (after) throw after;
    try {
      step.encode(entry, picture);
    } catch (error) {
      throw step.stopped(entry.frame) ?? error;
    }
    await step.after(entry, picture);
  }
}

/** What the video pass needs of the picture paths (picture-paths.ts `PicturePaths`). */
export interface PictureSource<E extends { frame: number }, P> {
  /** The picture of this film frame, by the path its source takes. */
  picture(entry: E): Promise<P>;
  /** This film frame is in the file: a source whose last frame it was lets go of its decoder, frame and bytes. */
  done(frame: number): void;
  /** Lets go of every source. Safe to call more than once. */
  closeAll(): void;
}

/**
 * The video pass's loop over the picture paths (spec G B2; spec H F8): every picture comes from `paths`; a film
 * frame is marked done only after its picture went to the encoder, before the rest of the frame's work; every
 * source is let go when the loop ends, however it ends (done, a failed picture, a refusing encoder, a cancel).
 */
export async function encodeFromPaths<E extends { frame: number }, P>(
  plan: readonly E[],
  paths: PictureSource<E, P>,
  step: Omit<FrameStep<E, P>, 'picture'>,
): Promise<void> {
  try {
    await encodeFrames(plan, {
      ...step,
      picture: (entry) => paths.picture(entry),
      after: async (entry, picture) => {
        paths.done(entry.frame);
        await step.after(entry, picture);
      },
    });
  } finally {
    paths.closeAll();
  }
}

/**
 * Hands a picture frame or a block of sound to its encoder and closes it whatever the encoder does: one left to
 * the garbage collector is a browser warning and holds memory until then (spec G, A0).
 */
export function handOver<T extends { close(): void }>(item: T, hand: (item: T) => void): void {
  try {
    hand(item);
  } finally {
    item.close();
  }
}
