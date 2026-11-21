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
