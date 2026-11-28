import { createElement as h, Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  composeStorageKey,
  emptyComposerProject,
  serializeProjectForStorage,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import {
  audioPlan,
  filmSampleCount,
  notIncluded,
  soundReads,
  videoPlan,
} from '@/lib/brand-studio/editor-v2/export-plan';
import { fromStored, storedFilmView } from '@/lib/brand-studio/editor-v2/stored';
import { EMPTY_OVERLAY_TRACKS, overlayTracksOf, type OverlayTrack } from '@/lib/brand-studio/editor-v2/tracks';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorTracksKo } from '@/messages/studio-editor-tracks';
import type { MountedDom } from '@/tests/brands/_dom-harness';
import type { ExportRequest } from '@/components/brand-studio/editor-v2/export-job';

/**
 * E-T T1 Fix Round 4 — Fault #1 parity tests:
 * (a) For a 3-cut film with NO overlay clips, the export plan and `startExport` job inputs are deep-equal
 *     whether `BRAND_STUDIO_EDITOR_V2_TRACKS` is open or closed.
 * (b) Full mounted `<EditorV2>` + `<ExportSheet>` running 20 exported frames with the encoder stubbed:
 *     `<video>` count, `<canvas>` count, `requestAnimationFrame` callbacks scheduled during the 20 frames,
 *     and React commits of `Timeline` and `Preview` (measured via `React.Profiler` in test code only) are
 *     identical between open and closed.
 */

const commitCounts = { timeline: 0, preview: 0 };

vi.mock('@/components/brand-studio/editor-v2/timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-studio/editor-v2/timeline')>();
  return {
    ...actual,
    Timeline: (props: Parameters<typeof actual.Timeline>[0]) =>
      h(
        Profiler,
        {
          id: 'timeline',
          onRender: () => {
            commitCounts.timeline += 1;
          },
        },
        h(actual.Timeline, props),
      ),
  };
});

vi.mock('@/components/brand-studio/editor-v2/preview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-studio/editor-v2/preview')>();
  return {
    ...actual,
    Preview: (props: Parameters<typeof actual.Preview>[0]) =>
      h(
        Profiler,
        {
          id: 'preview',
          onRender: () => {
            commitCounts.preview += 1;
          },
        },
        h(actual.Preview, props),
      ),
  };
});

vi.mock('@/components/brand-studio/editor-v2/measure-fps', () => ({
  measureSource: vi.fn(async () => ({ fps: 24, frames: 120 })),
}));

vi.mock('@/components/brand-studio/editor-v2/footage-facts', () => ({
  footageNotFound: () => false,
  readFootage: vi.fn(async () => ({
    answer: { ok: true, timing: { video: { fps: 24, frames: 120, variable: false, firstSec: 0 }, sound: null } },
    requests: 1,
    received: 0,
    mode: 'range',
    ms: 1,
  })),
  readPictureIndex: vi.fn(async () => ({ ok: false, reason: 'unreadable', requests: 1, received: 0 })),
  exportIndexReads: () => async () => ({ ok: false, reason: 'unreadable', requests: 1, received: 0 }),
  footageBytes: () => async () => new Response(new Uint8Array(0)),
}));

vi.mock('@/components/brand-studio/editor-v2/frame-thumbs', () => ({
  FrameThumbs: class {
    subscribe() { return () => {}; }
    setTrackRatios() {}
    ratioOf() { return 16 / 9; }
    get() { return undefined; }
    fallback() { return undefined; }
    want() {}
    usage() { return { pictures: 0, bytes: 0 }; }
    dispose() {}
  },
}));

vi.mock('@/components/brand-studio/editor-v2/export-record', () => ({
  EXPORT_RECORD_PREFIX: 'ed2',
  exportRecordInput: vi.fn(),
  recordExport: vi.fn(),
}));

const ORG = 'org-export-parity';
const SRC_1 = 'https://media.example.invalid/cut-1.mp4';
const SRC_2 = 'https://media.example.invalid/cut-2.mp4';
const SRC_3 = 'https://media.example.invalid/cut-3.mp4';
const AVCC = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xce);

function threeCutNoOverlayProject(framesPerCut = 7): ComposerProject {
  const sec = framesPerCut / 24;
  return {
    ...emptyComposerProject('9:16'),
    clips: [
      { id: 'c1', label: 'Cut 1', sourceKind: 'asset', assetId: 'a1', srcUrl: SRC_1, thumbUrl: '/p1.jpg', durationSec: 5, trimStartSec: 0, trimEndSec: sec, volume: 1, muted: true },
      { id: 'c2', label: 'Cut 2', sourceKind: 'asset', assetId: 'a2', srcUrl: SRC_2, thumbUrl: '/p2.jpg', durationSec: 5, trimStartSec: 0, trimEndSec: sec, volume: 1, muted: true },
      { id: 'c3', label: 'Cut 3', sourceKind: 'asset', assetId: 'a3', srcUrl: SRC_3, thumbUrl: '/p3.jpg', durationSec: 5, trimStartSec: 0, trimEndSec: sec, volume: 1, muted: true },
    ],
  };
}

let dom: MountedDom | null = null;

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('E-T T1 Fix Round 4 — Fault #1: 0-overlay export parity (open vs closed)', () => {
  it('(a) export plan and export job inputs for a 3-cut film without overlays are deep-equal with tracks open and closed', () => {
    const project = threeCutNoOverlayProject(289); // 3 × 289 = 867 frames
    const measured = {
      [SRC_1]: { fps: 24, frames: 289 },
      [SRC_2]: { fps: 24, frames: 289 },
      [SRC_3]: { fps: 24, frames: 289 },
    };

    const closedLoaded = fromStored(project, measured, { loadOverlays: false });
    const openLoaded = fromStored(project, measured, { loadOverlays: true });
    expect(openLoaded).toEqual(closedLoaded);

    const closedView = storedFilmView(closedLoaded.sequence, project, { writeOverlays: false });
    const openView = storedFilmView(openLoaded.sequence, project, { writeOverlays: true });
    expect(openView).toEqual(closedView);

    expect(videoPlan(openView.sequence)).toEqual(videoPlan(closedView.sequence));
    expect(audioPlan(openView.sequence)).toEqual(audioPlan(closedView.sequence));
    expect(filmSampleCount(openView.sequence)).toEqual(filmSampleCount(closedView.sequence));
    expect(notIncluded({ sequence: openView.sequence, doc: null, extras: openView.film })).toEqual(
      notIncluded({ sequence: closedView.sequence, doc: null, extras: closedView.film }),
    );
    expect(soundReads(openView.sequence, openView.film)).toEqual(soundReads(closedView.sequence, closedView.film));
  });

  it('R4 + F4: exported EMPTY_OVERLAY_TRACKS returned by overlayTracksOf is frozen and throws on write in strict mode', () => {
    const emptyTracks = overlayTracksOf({ overlayTracks: undefined });
    expect(emptyTracks).toBe(EMPTY_OVERLAY_TRACKS);
    expect(emptyTracks).toHaveLength(0);
    expect(Object.isFrozen(EMPTY_OVERLAY_TRACKS)).toBe(true);
    expect(() => {
      (emptyTracks as OverlayTrack[]).push({ id: 'ov-mutated', clips: [] });
    }).toThrow(TypeError);
    expect(overlayTracksOf({ overlayTracks: [] })).toBe(EMPTY_OVERLAY_TRACKS);
  });

  it('(b) mounted EditorV2 + ExportSheet running 20 exported frames matches open vs closed on videos, canvases, rAF, job inputs, and Timeline/Preview React commits', async () => {
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const exportJobMod = await import('@/components/brand-studio/editor-v2/export-job');

    const runScenario = async (tracksOpen: boolean) => {
      commitCounts.timeline = 0;
      commitCounts.preview = 0;

      // 3 cuts × 7 frames = 21 frames (> 20 exported frames).
      const project = threeCutNoOverlayProject(7);
      const storageMap = new Map<string, string>([[composeStorageKey(ORG), serializeProjectForStorage(project)]]);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => { storageMap.set(key, value); },
        removeItem: (key: string) => { storageMap.delete(key); },
        clear: () => storageMap.clear(),
      });

      let createdCanvases = 0;
      let createdVideos = 0;
      let encodedFrames = 0;
      let rafCallsDuringExport = 0;
      let exportActive = false;
      let capturedRequest: Omit<ExportRequest, 'notify'> | null = null;

      class StubVideoFrame {
        readonly timestamp: number;
        constructor(_source: unknown, init: { timestamp: number }) {
          this.timestamp = init.timestamp;
        }
        close() {}
      }
      class StubAudioData {
        close() {}
      }
      function makeEncoderClass(kind: 'video' | 'audio') {
        return class StubEncoder {
          static async isConfigSupported(config: unknown) {
            return { supported: true, config };
          }
          state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
          encodeQueueSize = 0;
          private items = 0;
          private readonly init: { output: (chunk: unknown, meta?: unknown) => void; error: (err: unknown) => void };
          constructor(init: { output: (chunk: unknown, meta?: unknown) => void; error: (err: unknown) => void }) {
            this.init = init;
          }
          configure() {
            this.state = 'configured';
          }
          encode(item: { timestamp?: number }, opts?: { keyFrame?: boolean }) {
            this.items += 1;
            if (kind === 'video') encodedFrames += 1;
            const first = this.items === 1;
            const chunk = {
              byteLength: 4,
              type: opts?.keyFrame || kind === 'audio' ? 'key' : 'delta',
              timestamp: item.timestamp ?? 0,
              copyTo: (to: Uint8Array) => to.set([0, 0, 0, 1]),
            };
            const meta = first
              ? { decoderConfig: { description: kind === 'video' ? AVCC : Uint8Array.of(0x12, 0x10) } }
              : undefined;
            queueMicrotask(() => {
              if (this.state !== 'closed') this.init.output(chunk, meta);
            });
          }
          async flush() {
            await Promise.resolve();
          }
          close() {
            this.state = 'closed';
          }
          addEventListener() {}
          removeEventListener() {}
        };
      }
      class StubOfflineAudioContext {
        destination = {};
        readonly length: number;
        readonly sampleRate: number;
        constructor(_channels: number, length: number, sampleRate: number) {
          this.length = length;
          this.sampleRate = sampleRate;
        }
        createBufferSource() {
          return { buffer: null, loop: false, loopStart: 0, playbackRate: { value: 1 }, connect: <T,>(n: T) => n, start() {}, stop() {} };
        }
        createGain() {
          return { gain: { value: 1 }, connect: <T,>(n: T) => n };
        }
        async startRendering() {
          const data = new Float32Array(this.length);
          return { length: this.length, sampleRate: this.sampleRate, numberOfChannels: 2, duration: this.length / this.sampleRate, getChannelData: () => data };
        }
      }

      vi.stubGlobal('VideoEncoder', makeEncoderClass('video'));
      vi.stubGlobal('AudioEncoder', makeEncoderClass('audio'));
      vi.stubGlobal('VideoFrame', StubVideoFrame);
      vi.stubGlobal('AudioData', StubAudioData);
      vi.stubGlobal('OfflineAudioContext', StubOfflineAudioContext);
      vi.stubGlobal('HTMLVideoElement', class { requestVideoFrameCallback() { return 1; } });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })));

      const origStartExport = exportJobMod.startExport;
      const startSpy = vi.spyOn(exportJobMod, 'startExport').mockImplementation((req) => {
        const { notify: _notify, ...rest } = req;
        capturedRequest = rest;
        origStartExport(req);
      });

      dom = await mountDom(null);
      const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
      const elementProto = Object.getPrototypeOf(select) as Record<string, unknown>;
      if (!('dataset' in elementProto)) {
        Object.defineProperty(elementProto, 'dataset', {
          get(this: { attributes: Record<string, string> }) {
            const attributes = this.attributes;
            const name = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
            return new Proxy(
              {},
              {
                get: (_t, key) => attributes[name(String(key))],
                set: (_t, key, value) => ((attributes[name(String(key))] = String(value)), true),
              },
            );
          },
        });
      }
      for (const prop of ['scrollTop', 'scrollLeft', 'scrollHeight', 'clientHeight', 'offsetHeight', 'scrollWidth', 'clientWidth'] as const) {
        if (!(prop in elementProto)) {
          const store = new WeakMap<object, number>();
          const fallback = prop === 'clientWidth' ? 960 : 0;
          Object.defineProperty(elementProto, prop, {
            configurable: true,
            get(this: object) { return store.get(this) ?? fallback; },
            set(this: object, val: number) { store.set(this, val); },
          });
        }
      }

      if (!('remove' in elementProto)) {
        elementProto.remove = function (this: { parentNode?: { removeChild: (n: unknown) => void } | null }) {
          this.parentNode?.removeChild(this);
        };
      }
      const origCreateElement = dom.document.createElement.bind(dom.document);
      vi.spyOn(dom.document, 'createElement').mockImplementation(((tagName: string) => {
        const el = origCreateElement(tagName) as unknown as Record<string, unknown>;
        const tag = String(tagName).toLowerCase();
        if (tag === 'canvas') {
          createdCanvases += 1;
          const store: Record<string | symbol, unknown> = {};
          const ctx = new Proxy(store, {
            get: (t, k) => (k in t ? t[k] : () => undefined),
            set: (t, k, v) => { t[k] = v; return true; },
          });
          el.getContext = () => ctx;
        } else if (tag === 'video') {
          createdVideos += 1;
          let time = 0;
          let nextHandle = 1;
          const cbs = new Map<number, (now: number, meta: { mediaTime: number }) => void>();
          el.videoWidth = 640;
          el.videoHeight = 360;
          el.ended = false;
          el.duration = 5;
          el.pause = () => {};
          const emit = (type: string) => {
            (el as unknown as { dispatchEvent: (ev: { type: string }) => boolean }).dispatchEvent({ type });
          };
          el.load = () => {
            if (el.src) {
              setTimeout(() => {
                emit('loadeddata');
              }, 0);
            }
          };
          el.requestVideoFrameCallback = (cb: (now: number, meta: { mediaTime: number }) => void) => {
            const id = nextHandle++;
            cbs.set(id, cb);
            return id;
          };
          el.cancelVideoFrameCallback = (id: number) => {
            cbs.delete(id);
          };
          Object.defineProperty(el, 'currentTime', {
            configurable: true,
            get: () => time,
            set: (sec: number) => {
              time = sec;
              setTimeout(() => {
                const shown = Math.floor(sec * 24 + 1e-6) / 24;
                const waiting = [...cbs.values()];
                cbs.clear();
                for (const cb of waiting) cb(performance.now(), { mediaTime: shown });
                emit('seeked');
              }, 0);
            },
          });
        }
        return el as unknown as HTMLElement;
      }) as typeof document.createElement);

      let nextRafId = 1;
      const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
      const winObj = window as unknown as Record<string, unknown>;
      const prevRaf = winObj.requestAnimationFrame;
      const prevCancelRaf = winObj.cancelAnimationFrame;
      const wrappedRaf = (cb: FrameRequestCallback) => {
        if (exportActive) rafCallsDuringExport += 1;
        const id = nextRafId++;
        rafTimers.set(
          id,
          setTimeout(() => {
            rafTimers.delete(id);
            cb(performance.now());
          }, 16),
        );
        return id;
      };
      const wrappedCancelRaf = (id: number) => {
        const timer = rafTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          rafTimers.delete(id);
        }
      };
      winObj.requestAnimationFrame = wrappedRaf;
      winObj.cancelAnimationFrame = wrappedCancelRaf;
      vi.stubGlobal('requestAnimationFrame', wrappedRaf);
      vi.stubGlobal('cancelAnimationFrame', wrappedCancelRaf);

      await dom.rerender(
        h(EditorV2, {
          copy: studioEditorKo,
          currentEditorHref: '/brand/studio/compose?classic=1',
          autoDownload: false,
          real: {
            organizationId: ORG,
            organizationName: '테스트 브랜드',
            canEdit: true,
            sources: [],
            assets: { ids: ['a1', 'a2', 'a3'], complete: true },
            sampleBase: null,
          },
          ...(tracksOpen ? { tracksOpen: true, tracksCopy: studioEditorTracksKo } : {}),
        }),
      );

      // Wait for real film open to settle.
      for (let i = 0; i < 8; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }

      // Open ExportSheet.
      await dom.click('[data-editor-export]');
      for (let i = 0; i < 4; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }
      expect(dom.query('[data-editor-export-sheet]')).not.toBeNull();
      expect(dom.query('[data-editor-export-start]')?.hasAttribute('disabled')).toBe(false);

      // Snapshot counters right before pressing 영상 내보내기.
      const timelineBeforeExport = commitCounts.timeline;
      const previewBeforeExport = commitCounts.preview;
      const domVideosBeforeExport = dom.document.querySelectorAll('video').length;
      const domCanvasesBeforeExport = dom.document.querySelectorAll('canvas').length;
      createdVideos = 0;
      createdCanvases = 0;
      exportActive = true;

      await dom.click('[data-editor-export-start]');

      // Wait until the real export finishes all 21 frames (> 20 exported frames).
      const deadline = Date.now() + 8000;
      while (exportJobMod.exportJobSnapshot().status === 'running' && Date.now() < deadline) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });
      }
      exportActive = false;
      if (exportJobMod.exportJobSnapshot().status === 'running') {
        exportJobMod.cancelExport();
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
      }

      const finalJob = exportJobMod.exportJobSnapshot();
      const result = {
        status: finalJob.status,
        encodedFrames,
        domVideosBeforeExport,
        domCanvasesBeforeExport,
        createdVideosDuringExport: createdVideos,
        createdCanvasesDuringExport: createdCanvases,
        domVideosAfterExport: dom.document.querySelectorAll('video').length,
        domCanvasesAfterExport: dom.document.querySelectorAll('canvas').length,
        timelineCommitsDuringExport: commitCounts.timeline - timelineBeforeExport,
        previewCommitsDuringExport: commitCounts.preview - previewBeforeExport,
        rafPerFrame: encodedFrames > 0 ? rafCallsDuringExport / encodedFrames : 0,
        capturedRequest,
      };

      for (const timer of rafTimers.values()) clearTimeout(timer);
      rafTimers.clear();
      winObj.requestAnimationFrame = prevRaf;
      winObj.cancelAnimationFrame = prevCancelRaf;
      startSpy.mockRestore();
      await dom.unmount();
      dom = null;
      return result;
    };

    const closed = await runScenario(false);
    const open = await runScenario(true);

    expect(closed.status).toBe('done');
    expect(open.status).toBe('done');
    expect(closed.encodedFrames).toBe(21);
    expect(open.encodedFrames).toBe(21);

    // Job inputs deep-equal (open vs closed).
    expect(open.capturedRequest).toEqual(closed.capturedRequest);

    // Video & canvas element counts identical before, during, and after export.
    expect(open.domVideosBeforeExport).toBe(closed.domVideosBeforeExport);
    expect(open.domCanvasesBeforeExport).toBe(closed.domCanvasesBeforeExport);
    expect(open.createdVideosDuringExport).toBe(closed.createdVideosDuringExport);
    expect(open.createdCanvasesDuringExport).toBe(closed.createdCanvasesDuringExport);
    expect(open.domVideosAfterExport).toBe(closed.domVideosAfterExport);
    expect(open.domCanvasesAfterExport).toBe(closed.domCanvasesAfterExport);

    // Zero React commits of Timeline and Preview during all 21 exported frames in BOTH modes.
    expect(closed.timelineCommitsDuringExport).toBe(0);
    expect(open.timelineCommitsDuringExport).toBe(0);
    expect(closed.previewCommitsDuringExport).toBe(0);
    expect(open.previewCommitsDuringExport).toBe(0);

    // Same rAF rate (only `watchRefresh`'s single loop; no extra rAF loop in open mode).
    expect(Math.abs(open.rafPerFrame - closed.rafPerFrame)).toBeLessThanOrEqual(0.5);
  });
});
