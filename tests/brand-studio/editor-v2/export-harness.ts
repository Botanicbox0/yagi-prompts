import { vi } from 'vitest';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';
import { FakeDecoder } from './fake-decoder';

/**
 * Spec I (G1, G5): the real `exportFilm` (components/brand-studio/editor-v2/export-film.ts) run in node with the
 * browser it needs faked here, nothing changed in production: a document, a hidden `<video>` that seeks and
 * shows the asked picture (the seek path), a canvas, `VideoEncoder` / `VideoFrame`, `AudioEncoder` /
 * `AudioData`, an `OfflineAudioContext`, `fetch` for the sound reads, and the clip's frame facts and picture
 * index (the facts module is replaced). Each encoder can be taken back by the browser after a number of items
 * (`QuotaExceededError`, as measured in spec G A1). `events` records the order of what happened.
 */

export const events: string[] = [];

export type FactsSetup = 'never' | 'unreadable' | { fps: number; frames: number };

export interface ClipSetup {
  facts: FactsSetup;
  /** The picture index: refused (the source is seeked) or this index (the decoder path). */
  index: 'refused' | VideoIndex;
  /** Answer the facts this much later (real or fake ms). */
  factsDelayMs?: number;
}

export interface HarnessOptions {
  clips: Record<string, ClipSetup>;
  /** The size a `HEAD` answers per address; `'never'`: it never answers. Default 1,000 bytes. */
  headLength?: (url: string) => number | null | 'never';
  /** The k-th video encoder made (0-based) is taken back after this many frames; missing: never. */
  reclaimVideoAfter?: number[];
  /** The k-th sound encoder made is taken back after this many blocks; missing: never. */
  reclaimAudioAfter?: number[];
  /** The bytes a `GET` answers per address (the sound read). Default 100 zero bytes. */
  getBody?: (url: string) => Uint8Array;
  /** The status a `GET` answers per address; anything but 200 comes with no body. Default 200. */
  getStatus?: (url: string) => number;
}

export const made = { videoEncoders: 0, audioEncoders: 0, videoFrames: 0, audioData: 0, factsReads: new Map<string, number>(), heads: [] as string[] };

/** An `avcC` record (High, one SPS and one PPS) for the muxer. */
const AVCC = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xce);
const FPS = 24;

class Listeners {
  private map = new Map<string, Set<(event?: unknown) => void>>();
  addEventListener(type: string, listener: (event?: unknown) => void) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event?: unknown) => void) {
    this.map.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of [...(this.map.get(type) ?? [])]) listener();
  }
}

/** The seek path's hidden `<video>`: loads, seeks, and presents the picture at the asked time. */
class FakeVideo extends Listeners {
  crossOrigin = '';
  muted = false;
  playsInline = false;
  preload = '';
  tabIndex = 0;
  style = { cssText: '' };
  videoWidth = 640;
  videoHeight = 360;
  ended = false;
  duration = Number.NaN;
  src = '';
  private time = 0;
  private callbacks = new Map<number, (now: number, metadata: { mediaTime: number }) => void>();
  private nextHandle = 1;
  setAttribute() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  pause() {}
  load() {
    if (this.src) setTimeout(() => this.emit('loadeddata'), 0);
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(seconds: number) {
    this.time = seconds;
    setTimeout(() => {
      const shown = Math.floor(seconds * FPS + 1e-6) / FPS;
      const waiting = [...this.callbacks.values()];
      this.callbacks.clear();
      for (const callback of waiting) callback(performance.now(), { mediaTime: shown });
      this.emit('seeked');
    }, 0);
  }
  requestVideoFrameCallback(callback: (now: number, metadata: { mediaTime: number }) => void) {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }
  cancelVideoFrameCallback(handle: number) {
    this.callbacks.delete(handle);
  }
}

function element() {
  return { style: { cssText: '' }, setAttribute() {}, remove() {}, appendChild: <T,>(child: T) => child };
}

function canvas() {
  const store: Record<string | symbol, unknown> = {};
  const context = new Proxy(store, {
    get: (target, key) => (key in target ? target[key] : () => undefined),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { width: 0, height: 0, getContext: () => context };
}

class FakeVideoFrame {
  readonly timestamp: number;
  closed = false;
  constructor(_source: unknown, init: { timestamp: number }) {
    this.timestamp = init.timestamp;
    made.videoFrames += 1;
  }
  close() {
    this.closed = true;
  }
}

class FakeAudioData {
  closed = false;
  constructor() {
    made.audioData += 1;
  }
  close() {
    this.closed = true;
  }
}

type EncoderInit = { output: (chunk: unknown, meta?: unknown) => void; error: (error: unknown) => void };

/** A video or sound encoder: one chunk out per item, in a microtask; taken back after `reclaimAfter` items. */
function encoderClass(kind: 'video' | 'audio', reclaimAfter: () => number[]) {
  return class FakeEncoder extends Listeners {
    static async isConfigSupported(config: unknown) {
      return { supported: true, config };
    }
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
    encodeQueueSize = 0;
    private items = 0;
    private readonly limit: number | undefined;
    constructor(private readonly init: EncoderInit) {
      super();
      const k = kind === 'video' ? made.videoEncoders++ : made.audioEncoders++;
      this.limit = reclaimAfter()[k];
      events.push(`${kind === 'video' ? 'VideoEncoder' : 'AudioEncoder'} ${k}`);
    }
    configure() {
      this.state = 'configured';
    }
    encode(item: { timestamp?: number }, options?: { keyFrame?: boolean }) {
      if (this.state === 'closed') throw new DOMException("Cannot call 'encode' on a closed codec.", 'InvalidStateError');
      this.items += 1;
      const first = this.items === 1;
      const chunk = { byteLength: 4, type: options?.keyFrame || kind === 'audio' ? 'key' : 'delta', timestamp: item.timestamp ?? 0, copyTo: (to: Uint8Array) => to.set([0, 0, 0, 1]) };
      const meta = first ? { decoderConfig: { description: kind === 'video' ? AVCC : Uint8Array.of(0x12, 0x10) } } : undefined;
      queueMicrotask(() => {
        if (this.state !== 'closed') this.init.output(chunk, meta);
      });
      if (this.limit !== undefined && this.items === this.limit) queueMicrotask(() => this.reclaim());
    }
    reclaim() {
      if (this.state === 'closed') return;
      this.state = 'closed';
      events.push(`${kind} encoder taken back`);
      this.init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
    }
    async flush() {
      await Promise.resolve();
      if (this.state === 'closed') throw new DOMException('Cannot call flush on a closed codec.', 'InvalidStateError');
    }
    close() {
      this.state = 'closed';
    }
  };
}

class FakeOfflineAudioContext {
  destination = {};
  constructor(
    readonly channels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {}
  /** As the browser's: the bytes are handed over (the buffer is detached), and these ones are not sound. */
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    structuredClone(bytes, { transfer: [bytes] });
    return Promise.reject(new Error('not sound'));
  }
  createBufferSource() {
    return { buffer: null, loop: false, loopStart: 0, playbackRate: { value: 1 }, connect: <T,>(node: T) => node, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { value: 1 }, connect: <T,>(node: T) => node };
  }
  async startRendering() {
    const data = new Float32Array(this.length);
    return { length: this.length, sampleRate: this.sampleRate, numberOfChannels: 2, duration: this.length / this.sampleRate, getChannelData: () => data };
  }
}

/** One cut of `frames` frames on `srcUrl` at 24 fps. */
export function clip(id: string, srcUrl: string, frames: number): FrameClip {
  return { id, label: id, srcUrl, thumbUrl: null, sourceFps: FPS, sourceFrames: frames, inFrame: 0, phase: 0, frames, speedNum: 1, speedDen: 1, volume: 1, muted: false };
}

export function film(clips: FrameClip[]): FrameSequence {
  return { fps: FPS, aspect: '16:9', clips, captions: [] } as unknown as FrameSequence;
}

/** The answer `readFootage` gives for a clip. */
function factsAnswer(setup: ClipSetup): Promise<unknown> {
  const facts = setup.facts;
  if (facts === 'never') return new Promise(() => undefined);
  const answer =
    facts === 'unreadable'
      ? { answer: { ok: false, reason: 'unreadable' }, requests: 1, received: 0, mode: 'range', ms: 1 }
      : { answer: { ok: true, timing: { video: { fps: facts.fps, frames: facts.frames, variable: false, firstSec: 0 } } }, requests: 1, received: 0, mode: 'range', ms: 1 };
  return setup.factsDelayMs ? new Promise((resolve) => setTimeout(() => resolve(answer), setup.factsDelayMs)) : Promise.resolve(answer);
}

/**
 * Installs the fake browser and the fake facts module, and loads the real export. Call `vi.unstubAllGlobals()`
 * and `vi.doUnmock(...)` (`unloadExport`) after each test.
 */
export async function loadExport(options: HarnessOptions) {
  events.length = 0;
  made.videoEncoders = 0;
  made.audioEncoders = 0;
  made.videoFrames = 0;
  made.audioData = 0;
  made.factsReads = new Map();
  made.heads = [];
  vi.resetModules();
  const setupOf = (url: string) => {
    const setup = options.clips[url];
    if (!setup) throw new Error(`no clip set up for ${url}`);
    return setup;
  };
  const indexAnswer = (url: string) => {
    const setup = setupOf(url);
    return Promise.resolve(setup.index === 'refused' ? { ok: false, reason: 'codec', requests: 1, received: 0 } : { ok: true, index: setup.index, requests: 1, received: 0 });
  };
  vi.doMock('@/components/brand-studio/editor-v2/footage-facts', () => ({
    readFootage: (url: string) => {
      made.factsReads.set(url, (made.factsReads.get(url) ?? 0) + 1);
      return factsAnswer(setupOf(url)).then((answer) => (events.push(`facts ${url}`), answer));
    },
    readPictureIndex: indexAnswer,
    exportIndexReads: () => indexAnswer,
    footageBytes: () => async (start: number, end: number) => ({ status: 206, body: null, arrayBuffer: async () => new ArrayBuffer(end - start + 1), headers: { get: () => null } }),
  }));
  vi.doMock('@/lib/brand-studio/compose/export-client', () => ({ applyProjectColorGradeFrame: () => undefined, drawCaptionsOverlay: () => undefined }));

  const doc = Object.assign(new Listeners(), {
    hidden: false,
    visibilityState: 'visible' as DocumentVisibilityState,
    fonts: { ready: Promise.resolve() },
    body: { appendChild: <T,>(child: T) => child },
    createElement: (tag: string) => (tag === 'video' ? new FakeVideo() : tag === 'canvas' ? canvas() : element()),
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', {
    setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
    requestAnimationFrame: (callback: (now: number) => void) => setTimeout(() => callback(performance.now()), 16),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: (now: number) => void) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('HTMLVideoElement', FakeVideo);
  vi.stubGlobal('VideoEncoder', encoderClass('video', () => options.reclaimVideoAfter ?? []));
  vi.stubGlobal('AudioEncoder', encoderClass('audio', () => options.reclaimAudioAfter ?? []));
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('AudioData', FakeAudioData);
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
  // Yielding to the page goes through a message: answered in a microtask here.
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1: { onmessage: (() => void) | null; close(): void } = { onmessage: null, close() {} };
      port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage?.()) };
    },
  );
  vi.stubGlobal(
    'VideoDecoder',
    class extends FakeDecoder {
      static async isConfigSupported(config: unknown) {
        events.push('decoder supported');
        return { supported: true, config };
      }
    },
  );
  vi.stubGlobal(
    'EncodedVideoChunk',
    class {
      readonly timestamp: number;
      constructor(init: { timestamp: number }) {
        this.timestamp = init.timestamp;
      }
    },
  );
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; signal?: AbortSignal }) => {
    const plain = url.split('?')[0]!;
    if (init?.method === 'HEAD') {
      made.heads.push(plain);
      const length = options.headLength ? options.headLength(plain) : 1000;
      if (length === 'never') return new Promise(() => undefined);
      return new Response(null, { status: 200, headers: length === null ? {} : { 'content-length': String(length) } });
    }
    const status = options.getStatus ? options.getStatus(plain) : 200;
    if (status !== 200) return new Response(null, { status });
    const body = options.getBody ? options.getBody(plain) : new Uint8Array(100);
    return new Response(body.slice().buffer as ArrayBuffer, { status: 200, headers: { 'content-length': String(body.length) } });
  });
  return import('@/components/brand-studio/editor-v2/export-film');
}

export function unloadExport() {
  vi.doUnmock('@/components/brand-studio/editor-v2/footage-facts');
  vi.doUnmock('@/lib/brand-studio/compose/export-client');
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
}

/** Runs `work` with fake timers advanced a second at a time until it settles; answers its outcome and the fake time it took. */
export async function settle<T>(work: Promise<T>, limitMs = 900_000): Promise<{ value?: T; error?: unknown; ms: number }> {
  let outcome: { value?: T; error?: unknown } | null = null;
  work.then(
    (value) => (outcome = { value }),
    (error: unknown) => (outcome = { error }),
  );
  const start = Date.now();
  while (!outcome && Date.now() - start < limitMs) await vi.advanceTimersByTimeAsync(250);
  if (!outcome) throw new Error(`still running after ${limitMs} ms`);
  return { ...(outcome as { value?: T; error?: unknown }), ms: Date.now() - start };
}
