/**
 * Editing studio v2 — every network wait of the export has an end (spec G, B1).
 *
 * A request for a run of samples gives up when no bytes have come for `stallMs` or the whole answer has not
 * come in `totalMs`; cancelling the export ends it at once. In each case the request itself is aborted and
 * the caller is answered without waiting for the network to agree (a fetch that ignores its signal still
 * lets go of the export).
 *
 * The numbers stay well under the time the browser takes an idle encoder back in a hidden page (about 90 s,
 * measured, spec G A1; export-run.ts): a picture that cannot come in time is taken by seeking instead.
 *
 * Pure apart from the timers it is given (the global ones by default; tests use fake timers).
 */

export interface ReadLimits {
  /** No bytes for this long: the read stalled. `0`: no limit. */
  stallMs: number;
  /** The whole answer not in after this long. `0`: no limit. */
  totalMs: number;
}

/** A run of samples (sample-bytes.ts): 15 s without bytes, 45 s in all. */
export const RUN_LIMITS: ReadLimits = { stallMs: 15_000, totalMs: 45_000 };

/** No byte for this long ends a read (spec G B1; spec H F2 keeps it). */
export const STALL_MS = 15_000;
/** The slowest connection a read is given time for: 32 KiB/s, about 256 kbit/s (spec H, F2). */
export const SLOWEST_BYTES_PER_SECOND = 32 * 1024;

/**
 * How long a read of `bytes` may take in all (spec H, F2): 45 s, plus the time those bytes take at the slowest
 * connection given time for. A run of 8 MiB gets about 5 min, a whole file its length by the same rule; a slow
 * but live connection is not cut, a stalled one ends after `STALL_MS` whatever the total.
 */
export function totalLimitMs(bytes: number): number {
  return 45_000 + Math.ceil((Math.max(0, bytes) * 1000) / SLOWEST_BYTES_PER_SECOND);
}

/**
 * How long the export waits for a shared read (a clip's frame facts, its picture index) before going on
 * without it (that source is then seeked). These reads are made before the encoder exists.
 */
export const SHARED_WAIT_MS = 45_000;

/** The read stalled or took too long. */
export class ReadTimedOut extends Error {
  readonly kind: 'stall' | 'total';
  constructor(kind: 'stall' | 'total', ms: number) {
    super(kind === 'stall' ? `no bytes for ${ms / 1000} s` : `not done in ${ms / 1000} s`);
    this.name = 'ReadTimedOut';
    this.kind = kind;
  }
}

/** The export was cancelled while it waited. */
export class ReadCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'ReadCancelled';
  }
}

export interface Watch {
  /** For the request: aborted when the watch ends it. */
  readonly signal: AbortSignal;
  /** `work`, or the watch's failure if that comes first. */
  guard<T>(work: Promise<T>): Promise<T>;
  /** Bytes came: the stall clock starts again. */
  alive(): void;
  /** The total limit, counted from when the watch began, once the answer says how much is coming. */
  limitTotal(totalMs: number): void;
  /** The read is over: timers and listeners go. */
  done(): void;
}

/** A watch over one read: `limits`, and the export's own `signal` (cancel). */
export function watchRead(limits: ReadLimits, signal?: AbortSignal): Watch {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  const failed = new Promise<never>((_, no) => {
    reject = no;
  });
  failed.catch(() => undefined);
  let over = false;
  let stall: ReturnType<typeof setTimeout> | null = null;
  let total: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (stall !== null) clearTimeout(stall);
    if (total !== null) clearTimeout(total);
    stall = total = null;
    signal?.removeEventListener('abort', cancelled);
  };
  const end = (error: Error) => {
    if (over) return;
    over = true;
    clear();
    controller.abort(error);
    reject(error);
  };
  const cancelled = () => end(new ReadCancelled());
  const started = Date.now();
  const limitTotal = (totalMs: number) => {
    if (over || totalMs <= 0) return;
    if (total !== null) clearTimeout(total);
    total = setTimeout(() => end(new ReadTimedOut('total', totalMs)), Math.max(0, totalMs - (Date.now() - started)));
  };
  const restartStall = () => {
    if (over || limits.stallMs <= 0) return;
    if (stall !== null) clearTimeout(stall);
    stall = setTimeout(() => end(new ReadTimedOut('stall', limits.stallMs)), limits.stallMs);
  };
  if (signal?.aborted) end(new ReadCancelled());
  else {
    signal?.addEventListener('abort', cancelled, { once: true });
    limitTotal(limits.totalMs);
    restartStall();
  }
  return {
    signal: controller.signal,
    guard: <T>(work: Promise<T>) => Promise.race([work, failed]),
    alive: restartStall,
    limitTotal,
    done() {
      over = true;
      clear();
    },
  };
}

/** A body read as a stream, the watch told of every piece; past `limit` bytes `tooLarge` is thrown and the body cancelled. */
export async function readStream(body: ReadableStream<Uint8Array>, watch: Pick<Watch, 'alive' | 'guard'>, limit = Infinity, tooLarge: () => Error = () => new Error('too large')): Promise<Uint8Array> {
  const reader = body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await watch.guard(reader.read());
      if (done) break;
      if (!value) continue;
      watch.alive();
      total += value.length;
      if (total > limit) throw tooLarge();
      pieces.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  return bytes;
}

/**
 * A shared read (frame facts, picture index: cached for the visit and used by the editor too) waited for by
 * the export: never aborted (others may want it), but the export stops waiting when it is cancelled
 * (`cancelled()` is thrown) or after `limitMs` (`timedOut` is returned, and the export goes on without it).
 */
export function waitShared<T, U>(work: Promise<T>, signal: AbortSignal | undefined, limitMs: number, timedOut: U, cancelled: () => Error): Promise<T | U> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise<T | U>((resolve, reject) => {
    const timer = setTimeout(() => finish(() => resolve(timedOut)), limitMs);
    const aborted = () => finish(() => reject(cancelled()));
    function finish(then: () => void) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      then();
    }
    signal?.addEventListener('abort', aborted, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
