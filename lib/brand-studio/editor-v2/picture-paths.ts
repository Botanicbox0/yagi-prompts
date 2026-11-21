/**
 * Editing studio v2 — which path makes each film frame's picture, and how long a source's decoder session
 * lives (spec F; spec G B2, B10).
 *
 * Every source is on the decoder path when it can be, by seeking when not (decided before the first frame,
 * `decoder(srcUrl)`). A decoder failure in the middle of a source hands the rest of THAT source to seeking:
 * every frame already in the file was verified, nothing is drawn twice or skipped. A session is closed after
 * its source's last film frame (its decoder, the frame it holds and its byte cache go then, not at the end of
 * the export), and at most `MAX_LIVE_SESSIONS` decoders are open at once: when another is needed, the one used
 * longest ago is let go and made again on its next use (frame-decoder.ts `suspend`, the same way a decoder
 * the browser took back is made again).
 *
 * Pure: the picture getters are given (export-film.ts gives the real ones), so it is tested without a browser.
 */
import type { ExportPath } from './decode-plan';

/** Which path made a source's pictures, for the proof (the sheet shows it as data, never as words). */
export interface SourcePath {
  clip: string;
  srcUrl: string;
  /** The path its last picture came from. */
  path: ExportPath;
  /** Why it was seeked (`forced`, `container:…`, `colour`, `codec-unmeasured`, `error: …`), or `null`. */
  reason: string | null;
  /** Film frames drawn from each path. */
  decoded: number;
  seeked: number;
  /** Bytes read for its pictures by range, the file's size, and requests made (decoder path). */
  bytesRead: number;
  fileBytes: number | null;
  requests: number;
  /** Times its decoder was made again: let go to stay under the cap, or taken back by the browser. */
  reopened: number;
  /** Of those, taken back by the browser (spec G, A3). */
  reclaimed: number;
}

export interface SessionStats {
  bytesRead: number;
  fileBytes: number | null;
  requests: number;
  reopened: number;
  reclaimed: number;
}

/** A source's decoder session as the paths use it (export-film.ts wraps frame-decoder.ts `PictureDecoder`). */
export interface DecoderSession<P> {
  /** The picture of film frame `frame`, and whether it is past the footage's last one. */
  picture(frame: number, signal?: AbortSignal): Promise<{ picture: P; past: boolean }>;
  /** Lets go of the decoder and the frames it holds; the next `picture` makes them again. */
  suspend(): void;
  /** A decoder is open now. */
  readonly live: boolean;
  close(): void;
  stats(): SessionStats;
}

export interface FrameAsk {
  frame: number;
  srcUrl: string;
  sourceFrame: number;
}

export interface PathDeps<P, E extends FrameAsk = FrameAsk> {
  /** The source's decoder session, or why it is taken by seeking. Asked once per source, on its first frame. */
  decoder(srcUrl: string, label: string): DecoderSession<P> | { reason: string };
  /** The picture by seeking. */
  seek(entry: E, label: string, signal?: AbortSignal): Promise<{ picture: P; past: boolean }>;
  /** The seek path's resources for a source are no longer needed. */
  releaseSeek(srcUrl: string): void;
  /** `?exportPath=decoder`: a decoder failure stops the export (this error) instead of seeking. */
  required?: (entry: E, label: string, message: string) => Error;
  /** The export was cancelled: a failure then is the cancel, not a reason to seek. */
  cancelled(): boolean;
  /** A source leaves the decoder path (for the console). */
  left?(label: string, message: string): void;
}

/** Decoder sessions open at once (spec G, B2). */
export const MAX_LIVE_SESSIONS = 4;

type Slot<P> = { kind: 'decoder'; session: DecoderSession<P> } | { kind: 'seek' } | { kind: 'done' };

export class PicturePaths<P, E extends FrameAsk = FrameAsk> {
  private readonly slots = new Map<string, Slot<P>>();
  private readonly records = new Map<string, SourcePath>();
  private readonly lastFrame = new Map<string, number>();
  private readonly lastUse = new Map<string, number>();

  constructor(
    plan: readonly FrameAsk[],
    private readonly deps: PathDeps<P, E>,
    private readonly maxLive = MAX_LIVE_SESSIONS,
  ) {
    for (const entry of plan) this.lastFrame.set(entry.srcUrl, entry.frame);
  }

  /** Film frame `entry`'s picture, verified on its source's path. */
  async picture(entry: E, label: string, signal?: AbortSignal): Promise<{ picture: P; path: ExportPath; past: boolean }> {
    let slot = this.slots.get(entry.srcUrl);
    if (!slot) slot = this.open(entry, label);
    const record = this.records.get(entry.srcUrl)!;
    if (slot.kind === 'decoder') {
      this.lastUse.set(entry.srcUrl, entry.frame);
      if (!slot.session.live) this.makeRoom(entry.srcUrl);
      try {
        const shown = await slot.session.picture(entry.frame, signal);
        record.decoded += 1;
        record.path = 'decoder';
        return { ...shown, path: 'decoder' };
      } catch (error) {
        if (this.deps.cancelled()) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (this.deps.required) throw this.deps.required(entry, label, message);
        // Every frame already in the file was verified; the rest of this source is taken by seeking.
        this.deps.left?.(label, message);
        this.finish(entry.srcUrl, slot.session);
        record.reason = `error: ${message}`;
        slot = { kind: 'seek' };
        this.slots.set(entry.srcUrl, slot);
      }
    }
    if (slot.kind === 'done') throw new Error(`"${label}" was asked for after its last frame`);
    const shown = await this.deps.seek(entry, label, signal);
    record.seeked += 1;
    record.path = 'seek';
    return { ...shown, path: 'seek' };
  }

  /** Film frame `frame` is in the file: a source whose last frame it was lets go of everything it holds. */
  done(frame: number): void {
    for (const [srcUrl, last] of this.lastFrame) {
      if (last !== frame) continue;
      const slot = this.slots.get(srcUrl);
      if (!slot || slot.kind === 'done') continue;
      if (slot.kind === 'decoder') this.finish(srcUrl, slot.session);
      else this.deps.releaseSeek(srcUrl);
      this.slots.set(srcUrl, { kind: 'done' });
    }
  }

  /** Which path made each source's pictures, in the order the film first uses them. */
  paths(): SourcePath[] {
    for (const [srcUrl, slot] of this.slots) if (slot.kind === 'decoder') this.note(srcUrl, slot.session);
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  /** Decoder sessions with a decoder open now (for the cap and its test). */
  liveSessions(): number {
    let live = 0;
    for (const slot of this.slots.values()) if (slot.kind === 'decoder' && slot.session.live) live += 1;
    return live;
  }

  /** Everything let go (the export ended, was cancelled or starts again). */
  closeAll(): void {
    for (const [srcUrl, slot] of this.slots) {
      if (slot.kind === 'decoder') this.finish(srcUrl, slot.session);
      else if (slot.kind === 'seek') this.deps.releaseSeek(srcUrl);
      this.slots.set(srcUrl, { kind: 'done' });
    }
  }

  private open(entry: FrameAsk, label: string): Slot<P> {
    const record: SourcePath = { clip: label, srcUrl: entry.srcUrl, path: 'decoder', reason: null, decoded: 0, seeked: 0, bytesRead: 0, fileBytes: null, requests: 0, reopened: 0, reclaimed: 0 };
    this.records.set(entry.srcUrl, record);
    const opened = this.deps.decoder(entry.srcUrl, label);
    const slot: Slot<P> = 'reason' in opened ? { kind: 'seek' } : { kind: 'decoder', session: opened };
    if ('reason' in opened) {
      record.path = 'seek';
      record.reason = opened.reason;
    }
    this.slots.set(entry.srcUrl, slot);
    return slot;
  }

  /** Before a decoder is made again: under the cap, letting go of the one used longest ago. */
  private makeRoom(srcUrl: string) {
    for (;;) {
      if (this.liveSessions() < this.maxLive) return;
      let oldest: string | null = null;
      for (const [other, slot] of this.slots) {
        if (other === srcUrl || slot.kind !== 'decoder' || !slot.session.live) continue;
        if (oldest === null || (this.lastUse.get(other) ?? -1) < (this.lastUse.get(oldest) ?? -1)) oldest = other;
      }
      if (oldest === null) return;
      const slot = this.slots.get(oldest);
      if (slot?.kind === 'decoder') slot.session.suspend();
    }
  }

  private note(srcUrl: string, session: DecoderSession<P>) {
    const stats = session.stats();
    Object.assign(this.records.get(srcUrl)!, { bytesRead: stats.bytesRead, fileBytes: stats.fileBytes, requests: stats.requests, reopened: stats.reopened, reclaimed: stats.reclaimed });
  }

  private finish(srcUrl: string, session: DecoderSession<P>) {
    this.note(srcUrl, session);
    session.close();
  }
}
