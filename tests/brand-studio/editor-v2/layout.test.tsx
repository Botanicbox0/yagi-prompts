import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiler, createElement as h } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { LAYOUT_STORAGE_KEY } from '@/components/brand-studio/editor-v2/layout-model';
import { composeStreamUrl, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';
import type { MountedDom } from '@/tests/brands/_dom-harness';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ASSET = '40000000-0000-4000-8000-000000000001';

const SOURCE: EditorSource = {
  key: `a:${ASSET}`,
  kind: 'asset',
  id: ASSET,
  label: 'runway walk.mp4',
  srcUrl: composeStreamUrl(ORG, 'asset', ASSET),
  thumbUrl: '/api/brand-studio/media/thumb.jpg',
  seconds: 5.7,
  durationMs: 5705,
  createdAt: '2026-11-20T10:00:00.000Z',
};

const REAL = {
  organizationId: ORG,
  organizationName: 'Sample Brand',
  canEdit: true,
  sources: [SOURCE],
  sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}`,
};

let dom: MountedDom | null = null;

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function makeEvent(
  type: string,
  init: {
    bubbles?: boolean;
    cancelable?: boolean;
    clientX?: number;
    clientY?: number;
    deltaX?: number;
    deltaY?: number;
    button?: number;
    pointerId?: number;
    key?: string;
    code?: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  } = {},
) {
  return {
    type,
    bubbles: init.bubbles ?? true,
    cancelable: init.cancelable ?? true,
    defaultPrevented: false,
    cancelBubble: false,
    target: null as unknown,
    currentTarget: null as unknown,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
    key: init.key ?? '',
    code: init.code ?? init.key ?? '',
    shiftKey: Boolean(init.shiftKey),
    ctrlKey: Boolean(init.ctrlKey),
    metaKey: Boolean(init.metaKey),
    altKey: Boolean(init.altKey),
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
    stopImmediatePropagation() {
      this.cancelBubble = true;
    },
  };
}

function patchDomElementProto(doc: MountedDom['document']) {
  const select = Object.getPrototypeOf(doc.createElement('select')) as object;
  const element = Object.getPrototypeOf(select) as Record<string, unknown>;
  if (!('dataset' in element)) {
    Object.defineProperty(element, 'dataset', {
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
  const captured = new Map<unknown, Set<number>>();
  element.setPointerCapture = function setPointerCapture(this: unknown, id: number) {
    let set = captured.get(this);
    if (!set) {
      set = new Set();
      captured.set(this, set);
    }
    set.add(id);
  };
  element.hasPointerCapture = function hasPointerCapture(this: unknown, id: number) {
    return captured.get(this)?.has(id) ?? false;
  };
  element.releasePointerCapture = function releasePointerCapture(this: unknown, id: number) {
    captured.get(this)?.delete(id);
  };
  for (const prop of ['scrollTop', 'scrollLeft', 'scrollHeight', 'clientHeight', 'offsetHeight', 'scrollWidth', 'clientWidth'] as const) {
    if (!(prop in element)) {
      const store = new WeakMap<object, number>();
      Object.defineProperty(element, prop, {
        configurable: true,
        get(this: object) {
          return store.get(this) ?? 0;
        },
        set(this: object, val: number) {
          store.set(this, val);
        },
      });
    }
  }
}

async function mountEditor(
  opts: {
    initialSaved?: unknown;
    real?: typeof REAL | null;
    editorHeight?: number;
    onRender?: () => void;
    raf?: (cb: FrameRequestCallback) => number;
    cancelRaf?: (id: number) => void;
  } = {},
) {
  vi.stubGlobal('requestAnimationFrame', opts.raf ?? (() => 1));
  vi.stubGlobal('cancelAnimationFrame', opts.cancelRaf ?? (() => undefined));
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        Promise.resolve().then(() => this.onerror?.());
      }
    },
  );
  const storageMap = new Map<string, string>();
  if (opts.initialSaved !== undefined) {
    storageMap.set(LAYOUT_STORAGE_KEY, typeof opts.initialSaved === 'string' ? opts.initialSaved : JSON.stringify(opts.initialSaved));
  }
  const getItem = vi.fn((key: string) => storageMap.get(key) ?? null);
  const setItem = vi.fn((key: string, val: string) => {
    storageMap.set(key, val);
  });
  vi.stubGlobal('localStorage', {
    getItem,
    setItem,
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  });

  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { act } = await import('react');
  const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
  dom = await mountDom(null);
  patchDomElementProto(dom.document);

  let currentEditorHeight = opts.editorHeight ?? 900;
  let currentTimelineHeight = 244;

  const node = h(EditorV2, {
    copy: studioEditorKo,
    currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`,
    initialWorkspace: 'cut',
    real: opts.real === undefined ? null : opts.real,
  });
  await dom.rerender(
    opts.onRender ? h(Profiler, { id: 'editor', onRender: () => opts.onRender?.() }, node) : node,
  );

  const rootEl = dom.query('[data-studio-editor-v2]')!;
  const timelineEl = dom.query('[data-editor-timeline]')!;
  rootEl.getBoundingClientRect = () => ({
    top: 12,
    left: 0,
    bottom: 12 + currentEditorHeight,
    right: 1440,
    width: 1440,
    height: currentEditorHeight,
  });
  timelineEl.getBoundingClientRect = () => ({
    top: 644,
    left: 0,
    bottom: 644 + currentTimelineHeight,
    right: 1420,
    width: 1420,
    height: currentTimelineHeight,
  });

  // Trigger resize once so EditorV2 reads mocked root height cleanly if needed.
  await act(async () => {
    (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent(makeEvent('resize'));
  });

  const dispatchOn = async (target: NonNullable<ReturnType<MountedDom['query']>>, type: string, init: Parameters<typeof makeEvent>[1] = {}) => {
    const ev = makeEvent(type, init);
    await act(async () => {
      target.dispatchEvent(ev as never);
    });
    return ev;
  };

  return {
    act,
    dom,
    storageMap,
    getItem,
    setItem,
    rootEl,
    timelineEl,
    dispatchOn,
    setMockHeights(editorHeight: number, timelineHeight = currentTimelineHeight) {
      currentEditorHeight = editorHeight;
      currentTimelineHeight = timelineHeight;
    },
  };
}

describe('Rule 1 parity & hydration safety', () => {
  it('renders identical default state with and without saved storage before mount, and matches default CSS variables and handles', async () => {
    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const storageMap = new Map<string, string>([
      [LAYOUT_STORAGE_KEY, JSON.stringify({ v: 1, timelineHeight: 380, lanes: { video: 120 }, assistDock: 'side' })],
    ]);
    const getItem = vi.fn((k: string) => storageMap.get(k) ?? null);
    vi.stubGlobal('window', { localStorage: { getItem } });

    const sampleMarkup = renderToStaticMarkup(
      h(EditorV2, { copy: studioEditorKo, currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`, initialWorkspace: 'cut', real: null }),
    );
    const realMarkup = renderToStaticMarkup(
      h(EditorV2, { copy: studioEditorKo, currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`, initialWorkspace: 'cut', real: REAL }),
    );
    // Server/first render never reads browser storage, so saved layout cannot cause a hydration mismatch.
    expect(getItem).not.toHaveBeenCalled();

    expect(sampleMarkup).toContain('--ev-timeline-h:auto');
    expect(sampleMarkup).toContain('data-dock="bar"');
    expect(sampleMarkup).toContain('--h-titles:22px;--h-video:54px;--h-captions:22px;--h-voice:28px;--h-music:28px');
    expect(sampleMarkup).toContain('data-editor-timeline-resize=""');
    expect(sampleMarkup).toContain(`aria-label="${studioEditorKo.timeline.resizeTimeline}"`);
    for (const lane of ['titles', 'video', 'captions', 'voice', 'music'] as const) {
      expect(sampleMarkup).toContain(`data-editor-lane-resize="${lane}"`);
    }

    expect(realMarkup).toContain('--ev-timeline-h:auto');
    expect(realMarkup).toContain('--h-video:64px;--h-captions:24px');
    expect(realMarkup).toContain('data-editor-timeline-resize=""');
    expect(realMarkup).toContain('data-editor-lane-resize="video"');
    expect(realMarkup).toContain('data-editor-lane-resize="captions"');
    expect(realMarkup).not.toContain('data-editor-lane-resize="titles"');
    expect(realMarkup).not.toContain('data-editor-lane-resize="voice"');
    expect(realMarkup).not.toContain('data-editor-lane-resize="music"');

    // Also verify English accessible names exist.
    const enMarkup = renderToStaticMarkup(
      h(EditorV2, { copy: studioEditorEn, currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`, initialWorkspace: 'cut', real: null }),
    );
    expect(enMarkup).toContain(`aria-label="${studioEditorEn.timeline.resizeTimeline}"`);
    expect(enMarkup).toContain('aria-label="Video lane height"');
  });

  it('first client render matches server render even when saved layout exists, then hydrates layout after mount', async () => {
    const saved = { v: 1, timelineHeight: 360, lanes: { video: 120 }, assistDock: 'side' as const };
    const m = await mountEditor({ initialSaved: saved });
    expect(m.getItem).toHaveBeenCalledWith(LAYOUT_STORAGE_KEY);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('360px');
    expect(m.rootEl.getAttribute('data-dock')).toBe('side');
    expect(m.timelineEl.style['--h-video']).toBe('120px');
  });
});

describe('Main timeline resize handle, lane handles, keyboard, scroll sync, video stability & persistence', () => {
  it('drags main handle with pointer capture, updates CSS var live, and writes storage once on pointerup', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const handle = m.dom.query('[data-editor-timeline-resize]')!;
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('tabindex')).toBe('0');

    const handleWithCapture = handle as unknown as { hasPointerCapture(id: number): boolean };
    expect(m.setItem).not.toHaveBeenCalled();
    await m.dispatchOn(handle, 'pointerdown', { button: 0, pointerId: 7, clientY: 600 });
    expect(handleWithCapture.hasPointerCapture(7)).toBe(true);
    expect(handle.hasAttribute('data-dragging')).toBe(true);
    expect(m.rootEl.hasAttribute('data-sized')).toBe(false);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');
    expect(m.setItem).not.toHaveBeenCalled();

    // Sub-threshold (2px) pointermove does NOT activate data-sized or fixed height (R2)
    await m.dispatchOn(handle, 'pointermove', { pointerId: 7, clientY: 598 });
    expect(m.rootEl.hasAttribute('data-sized')).toBe(false);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');

    // Dragging up by 60px passes 3px threshold and makes timeline taller: 244 + 60 = 304px
    await m.dispatchOn(handle, 'pointermove', { pointerId: 7, clientY: 540 });
    expect(m.rootEl.hasAttribute('data-sized')).toBe(true);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('304px');
    expect(m.setItem).not.toHaveBeenCalled();

    // Dragging further up by 40px: 244 + 100 = 344px
    await m.dispatchOn(handle, 'pointermove', { pointerId: 7, clientY: 500 });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('344px');
    expect(m.setItem).not.toHaveBeenCalled();

    await m.dispatchOn(handle, 'pointerup', { pointerId: 7, clientY: 500 });
    expect(handleWithCapture.hasPointerCapture(7)).toBe(false);
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(m.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!)).toMatchObject({
      v: 1,
      timelineHeight: 344,
      assistDock: 'bar',
    });

    // Double-click resets back to auto
    await m.dispatchOn(handle, 'dblclick');
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!).timelineHeight).toBeNull();
  });

  it('ends drag cleanly on pointercancel and window blur while preserving last valid size', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const handle = m.dom.query('[data-editor-timeline-resize]')!;

    await m.dispatchOn(handle, 'pointerdown', { button: 0, pointerId: 3, clientY: 600 });
    await m.dispatchOn(handle, 'pointermove', { pointerId: 3, clientY: 520 }); // 244 + 80 = 324px
    expect(m.rootEl.style['--ev-timeline-h']).toBe('324px');

    await m.dispatchOn(handle, 'pointercancel', { pointerId: 3 });
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('324px');
    expect(m.setItem).toHaveBeenCalledTimes(1);

    // Further move after cancel must be ignored
    await m.dispatchOn(handle, 'pointermove', { pointerId: 3, clientY: 300 });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('324px');

    // Now test window blur ending drag cleanly
    await m.dispatchOn(handle, 'pointerdown', { button: 0, pointerId: 4, clientY: 520 });
    await m.dispatchOn(handle, 'pointermove', { pointerId: 4, clientY: 480 }); // 324 + 40 = 364px
    await m.act(async () => {
      (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent(makeEvent('blur'));
    });
    expect(handle.hasAttribute('data-dragging')).toBe(false);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('364px');
    expect(m.setItem).toHaveBeenCalledTimes(2);
  });

  it('resizes individual lanes, persists once on pointerup, inherits across workspaces, and resets on double-click', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const videoHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    expect(videoHandle.getAttribute('role')).toBe('separator');
    expect(videoHandle.getAttribute('tabindex')).toBe('0');

    await m.dispatchOn(videoHandle, 'pointerdown', { button: 0, pointerId: 2, clientY: 100 });
    await m.dispatchOn(videoHandle, 'pointermove', { pointerId: 2, clientY: 146 }); // 54 + 46 = 100
    expect(m.timelineEl.style['--ev-h-video']).toBe('100px');
    expect(m.timelineEl.style['--h-video']).toBe('54px');
    expect(m.setItem).not.toHaveBeenCalled();

    await m.dispatchOn(videoHandle, 'pointerup', { pointerId: 2, clientY: 146 });
    expect(m.timelineEl.style['--h-video']).toBe('100px');
    expect(m.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!).lanes).toEqual({ video: 100 });

    // Switch workspace to 'color': customer-set video stays 100px, untouched voice takes color default 22px
    await m.dom.click('[data-editor-workspace="color"]');
    expect(m.timelineEl.style['--h-video']).toBe('100px');
    expect(m.timelineEl.style['--h-voice']).toBe('22px');

    // Double-click resets video lane to color default (66px)
    const videoHandleColor = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(videoHandleColor, 'dblclick');
    expect(m.timelineEl.style['--h-video']).toBe('66px');
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!).lanes).toEqual({});
  });

  it('supports keyboard controls on both handle kinds without changing playhead', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const previewEl = m.dom.query('[data-editor-preview]')!;
    expect(previewEl.getAttribute('data-editor-playhead')).toBe('0');

    const mainHandle = m.dom.query('[data-editor-timeline-resize]')!;
    mainHandle.focus();
    await m.dom.keyDown('ArrowUp', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('260px'); // 244 + 16
    await m.dom.keyDown('ArrowDown', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('244px');
    await m.dom.keyDown('End', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('550px'); // 900 - 44 - 16 - (180 + 58) - 44 - 8
    await m.dom.keyDown('Home', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('154px'); // 46 + 24 + 22 + 8 + 54 (W1 / Note 4)
    await m.dom.keyDown('Enter', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');

    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    laneHandle.focus();
    await m.dom.keyDown('ArrowDown', { target: laneHandle });
    expect(m.timelineEl.style['--h-video']).toBe('58px'); // 54 + 4
    await m.dom.keyDown('ArrowUp', { target: laneHandle });
    expect(m.timelineEl.style['--h-video']).toBe('54px');
    await m.dom.keyDown('End', { target: laneHandle });
    expect(m.timelineEl.style['--h-video']).toBe('160px');
    await m.dom.keyDown('Home', { target: laneHandle });
    expect(m.timelineEl.style['--h-video']).toBe('22px');
    await m.dom.keyDown('Enter', { target: laneHandle });
    expect(m.timelineEl.style['--h-video']).toBe('54px');

    expect(previewEl.getAttribute('data-editor-playhead')).toBe('0');
  });

  it('re-clamps saved timeline height when window resizes smaller', async () => {
    const m = await mountEditor({ initialSaved: { v: 1, timelineHeight: 560, lanes: {}, assistDock: 'bar' }, editorHeight: 900 });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('550px'); // 900px bar dock preview+chrome max

    m.setMockHeights(700);
    await m.act(async () => {
      (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent(makeEvent('resize'));
    });
    // On 700px editor with bar dock: 700 - 44 - 16 - (180 + 58) - 44 - 8 = 350px max (W5)
    expect(m.rootEl.style['--ev-timeline-h']).toBe('350px');
  });

  it('synchronizes vertical scroll one-way from laneScroll to laneNames, compensates hBar, and forwards wheel over laneNames', async () => {
    const m = await mountEditor({ initialSaved: { v: 1, timelineHeight: 200, lanes: { video: 120 }, assistDock: 'bar' } });
    const laneNames = m.timelineEl.children[1]! as unknown as {
      scrollTop: number;
      style: Record<string, string>;
      dispatchEvent(ev: unknown): boolean;
      getAttribute(k: string): string | null;
    };
    const laneScroll = m.timelineEl.children[2]! as unknown as {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      offsetHeight: number;
      children: Array<{ style: Record<string, string> }>;
      dispatchEvent(ev: unknown): boolean;
      getAttribute(k: string): string | null;
    };
    const laneContent = laneScroll.children[0]!;
    const playheadEl = m.dom.query('[data-editor-playhead-mark]')!;
    expect(laneNames.getAttribute('class')).toContain('laneNames');
    expect(laneScroll.getAttribute('class')).toContain('laneScroll');

    // Mock vertical overflow + 12px horizontal scrollbar on laneScroll
    laneScroll.scrollHeight = 400;
    laneScroll.clientHeight = 140;
    laneScroll.offsetHeight = 152;
    laneScroll.scrollTop = 48;
    await m.dispatchOn(laneScroll as never, 'scroll', { bubbles: false, cancelable: false });
    expect(laneNames.scrollTop).toBe(48);
    expect(laneNames.style.paddingBottom).toBe('12px');
    expect(playheadEl.style['--ev-scroll-y']).toBe('48px'); // Note 7 & R3: scoped directly to .playhead, never clips
    expect(laneContent.style['--ev-scroll-y']).toBeUndefined();

    // Scrolling laneNames directly must NOT reverse-sync laneScroll (S2: strictly one-way)
    laneNames.scrollTop = 10;
    await m.dispatchOn(laneNames as never, 'scroll', { bubbles: false, cancelable: false });
    expect(laneScroll.scrollTop).toBe(48);

    // Wheel over laneNames forwards vertical scroll to laneScroll and updates laneNames + --ev-scroll-y
    const wheelEv = await m.dispatchOn(laneNames as never, 'wheel', { deltaY: 36, deltaX: 0, bubbles: true, cancelable: true });
    expect(wheelEv.defaultPrevented).toBe(true);
    expect(laneScroll.scrollTop).toBe(84);
    expect(laneNames.scrollTop).toBe(84);
    expect(playheadEl.style['--ev-scroll-y']).toBe('84px');
    expect(laneContent.style['--ev-scroll-y']).toBeUndefined();
  });

  it('keeps the exact same preview <video> DOM node and makes zero play/pause calls while dragging handles', async () => {
    const m = await mountEditor();
    const video = m.dom.query('video')!;
    const playSpy = vi.spyOn(video, 'play');
    const pauseSpy = vi.spyOn(video, 'pause');

    const mainHandle = m.dom.query('[data-editor-timeline-resize]')!;
    await m.dispatchOn(mainHandle, 'pointerdown', { button: 0, pointerId: 1, clientY: 600 });
    await m.dispatchOn(mainHandle, 'pointermove', { pointerId: 1, clientY: 500 });
    await m.dispatchOn(mainHandle, 'pointerup', { pointerId: 1, clientY: 500 });

    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(laneHandle, 'pointerdown', { button: 0, pointerId: 2, clientY: 100 });
    await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 2, clientY: 140 });
    await m.dispatchOn(laneHandle, 'pointerup', { pointerId: 2, clientY: 140 });

    expect(m.dom.query('video')).toBe(video);
    expect(playSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('remembers assistDock via layout store and shares layout seamlessly between sample and real mode', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const dockBtn = m.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.assist.dock)!;
    await m.dom.click(dockBtn);
    expect(m.rootEl.getAttribute('data-dock')).toBe('side');
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!).assistDock).toBe('side');

    // Unmount sample mode, mount real mode with same storage contents
    const savedRaw = m.storageMap.get(LAYOUT_STORAGE_KEY)!;
    await m.dom.unmount();
    dom = null;

    const mReal = await mountEditor({ initialSaved: savedRaw, real: REAL, editorHeight: 900 });
    expect(mReal.rootEl.getAttribute('data-editor-mode')).toBe('real');
    expect(mReal.rootEl.getAttribute('data-dock')).toBe('side');
  });
});

describe('Fix round 1: zero-render drag (B2), filmstrip (B1/W4), render/bounds guards (S1-S4, Notes 1-8, W1-W5) & real hydration', () => {
  it('B2: performs ZERO React re-renders during pointerdown/pointermove on main & lane handles, committing once on pointerup', async () => {
    let renders = 0;
    const m = await mountEditor({ editorHeight: 900, onRender: () => { renders += 1; } });
    renders = 0;

    const mainHandle = m.dom.query('[data-editor-timeline-resize]')!;
    await m.dispatchOn(mainHandle, 'pointerdown', { button: 0, pointerId: 11, clientY: 600 });
    for (let i = 1; i <= 20; i += 1) {
      await m.dispatchOn(mainHandle, 'pointermove', { pointerId: 11, clientY: 600 - i * 4 });
    }
    expect(renders).toBe(0);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('324px');
    expect(mainHandle.getAttribute('aria-valuenow')).toBe('324');
    expect(mainHandle.getAttribute('aria-valuetext')).toBe('324px');

    await m.dispatchOn(mainHandle, 'pointerup', { pointerId: 11, clientY: 520 });
    expect(renders).toBe(1);
    expect(m.setItem).toHaveBeenCalledTimes(1);

    renders = 0;
    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(laneHandle, 'pointerdown', { button: 0, pointerId: 12, clientY: 100 });
    for (let i = 1; i <= 20; i += 1) {
      await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 12, clientY: 100 + i * 2 });
    }
    expect(renders).toBe(0);
    expect(m.timelineEl.style['--ev-h-video']).toBe('94px');
    expect(m.timelineEl.style['--h-video']).toBe('54px');
    expect(laneHandle.getAttribute('aria-valuenow')).toBe('94');
    expect(laneHandle.getAttribute('aria-valuetext')).toBe('94px');

    await m.dispatchOn(laneHandle, 'pointerup', { pointerId: 12, clientY: 140 });
    expect(renders).toBe(1);
    expect(m.timelineEl.style['--h-video']).toBe('94px');
    expect(m.setItem).toHaveBeenCalledTimes(2);
  });

  it('S1 & R1: executes ZERO getBoundingClientRect or vertical metric (scrollTop/scrollHeight/clientHeight/offsetHeight) reads across 30 playhead ticks in default state', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const rootRectSpy = vi.fn(() => ({ top: 12, left: 0, bottom: 912, right: 1440, width: 1440, height: 900 }));
    const tlRectSpy = vi.fn(() => ({ top: 644, left: 0, bottom: 888, right: 1420, width: 1420, height: 244 }));
    m.rootEl.getBoundingClientRect = rootRectSpy;
    m.timelineEl.getBoundingClientRect = tlRectSpy;

    const namesEl = m.timelineEl.children[1]! as unknown as Record<string, unknown>;
    const scrollEl = m.timelineEl.children[2]! as unknown as Record<string, unknown>;
    let metricReads = 0;
    let metricWrites = 0;
    for (const el of [namesEl, scrollEl]) {
      for (const prop of ['scrollTop', 'scrollHeight', 'clientHeight', 'offsetHeight'] as const) {
        let cur = Number(el[prop] ?? 0);
        Object.defineProperty(el, prop, {
          configurable: true,
          get() {
            metricReads += 1;
            return cur;
          },
          set(val: number) {
            metricWrites += 1;
            cur = val;
          },
        });
      }
    }

    for (let i = 0; i < 30; i += 1) {
      await m.act(async () => {
        (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent(
          makeEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' }),
        );
      });
    }
    expect(m.dom.query('[data-editor-preview]')!.getAttribute('data-editor-playhead')).toBe('30');
    expect(rootRectSpy).not.toHaveBeenCalled();
    expect(tlRectSpy).not.toHaveBeenCalled();
    expect(metricReads).toBe(0);
    expect(metricWrites).toBe(0);
  });

  it('S3 & S4 & Note 6: untouched editor (including dock=side) omits data-sized; all 5 lanes at 160px auto height caps at --ev-timeline-max and keeps preview split button intact', async () => {
    const mUntouchedSide = await mountEditor({ initialSaved: { v: 1, timelineHeight: null, lanes: {}, assistDock: 'side' }, editorHeight: 700 });
    expect(mUntouchedSide.rootEl.hasAttribute('data-sized')).toBe(false);
    expect(mUntouchedSide.timelineEl.hasAttribute('data-sized')).toBe(false);
    await mUntouchedSide.dom.unmount();
    dom = null;

    const mAllTall = await mountEditor({
      initialSaved: {
        v: 1,
        timelineHeight: null,
        lanes: { titles: 160, video: 160, captions: 160, voice: 160, music: 160 },
        assistDock: 'bar',
      },
      editorHeight: 700,
    });
    expect(mAllTall.rootEl.hasAttribute('data-sized')).toBe(true);
    expect(mAllTall.timelineEl.hasAttribute('data-sized')).toBe(true);
    expect(mAllTall.rootEl.style['--ev-timeline-h']).toBe('auto');
    expect(mAllTall.rootEl.style['--ev-timeline-max']).toBe('350px');
    expect(mAllTall.dom.query('[data-editor-split-button]')).not.toBeNull();

    // Note 6: noun aria-labels and px valuetext
    const mainHandle = mAllTall.dom.query('[data-editor-timeline-resize]')!;
    expect(mainHandle.getAttribute('aria-label')).toBe(studioEditorKo.timeline.resizeTimeline);
    expect(mainHandle.getAttribute('aria-valuetext')).toBe('244px');
    const videoHandle = mAllTall.dom.query('[data-editor-lane-resize="video"]')!;
    expect(videoHandle.getAttribute('aria-valuetext')).toBe('160px');
  });

  it('Note 1, Note 2, Note 3 & W1: keyboard starts from measured height, ignores modified chords, real min=138, and unmount aborts drag without commit', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    // Note 1: mock timeline rect height at 270 while timelineHeight is null
    m.setMockHeights(900, 270);
    const mainHandle = m.dom.query('[data-editor-timeline-resize]')!;
    mainHandle.focus();
    // Note 2: Shift+ArrowUp is ignored on main & lane handles
    await m.dom.keyDown('ArrowUp', { target: mainHandle, shiftKey: true });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');
    expect(m.setItem).not.toHaveBeenCalled();

    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    laneHandle.focus();
    await m.dom.keyDown('ArrowDown', { target: laneHandle, shiftKey: true });
    expect(m.timelineEl.style['--h-video']).toBe('54px');

    mainHandle.focus();
    await m.dom.keyDown('ArrowUp', { target: mainHandle });
    expect(m.rootEl.style['--ev-timeline-h']).toBe('286px'); // 270 + 16 (matches drag startHeight)

    // Note 3: Start dragging lane handle and unmount BEFORE pointerup -> zero commits
    const callsBefore = m.setItem.mock.calls.length;
    await m.dispatchOn(laneHandle, 'pointerdown', { button: 0, pointerId: 9, clientY: 100 });
    await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 9, clientY: 150 });
    await m.dom.unmount();
    dom = null;
    expect(m.setItem).toHaveBeenCalledTimes(callsBefore);

    // Real mode Home min = 46 + 24 + 4 + 64 = 138px
    const mReal = await mountEditor({ real: REAL, editorHeight: 900 });
    const realMain = mReal.dom.query('[data-editor-timeline-resize]')!;
    realMain.focus();
    await mReal.dom.keyDown('Home', { target: realMain });
    expect(mReal.rootEl.style['--ev-timeline-h']).toBe('138px');
  });

  it('B1 & W4: keeps 96px/72px untouched across workspaces, decodes stepped heights & clip ratios after drop, and guards 9:16 density', async () => {
    const { FrameThumbs } = await import('@/components/brand-studio/editor-v2/frame-thumbs');
    const wantSpy = vi.spyOn(FrameThumbs.prototype, 'want');

    const m = await mountEditor({ editorHeight: 900 });
    // Zoom to frames (64px) then step out twice to 25px/frame (between REAL_FRAMES_PX=6 and FRAME_STRIP_PX=48)
    await m.dom.click('[data-editor-zoom="frames"]');
    const zoomOutBtn = m.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.timeline.zoomOut)!;
    await m.dom.click(zoomOutBtn);
    await m.dom.click(zoomOutBtn);
    expect(Number(m.timelineEl.getAttribute('data-editor-ppf'))).toBeCloseTo(25, 0);

    // Check sound workspace (34px video) when untouched: all tiles remain 96px wide and requested height is 72
    await m.dom.click('[data-editor-workspace="sound"]');
    const clip1UntouchedTiles = m.dom.query('[data-editor-clip="1"]')!.querySelectorAll('i');
    expect(clip1UntouchedTiles.length).toBeGreaterThan(1);
    expect(clip1UntouchedTiles[0]!.style.width).toBe('96px');
    expect(wantSpy.mock.calls.at(-1)?.[0]?.[0]?.height).toBe(72);

    // During pointer drag of video lane handle: zero new want() calls (B1 & B2)
    wantSpy.mockClear();
    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(laneHandle, 'pointerdown', { button: 0, pointerId: 15, clientY: 100 });
    await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 15, clientY: 156 });
    await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 15, clientY: 206 }); // +106 => 34 + 106 = 140px
    expect(wantSpy).not.toHaveBeenCalled();

    // Commit on pointerup at 140px => decodeHeight=144, 16:9 clip1 tiles=256px
    await m.dispatchOn(laneHandle, 'pointerup', { pointerId: 15, clientY: 206 });
    expect(m.dom.query('[data-editor-clip="1"]')!.querySelectorAll('i')[0]!.style.width).toBe('256px');
    expect(wantSpy.mock.calls.at(-1)?.[0]?.[0]?.height).toBe(144);

    // Move playhead into clip 4 (m4, 4:3 aspect ratio) so clip 4 tiles enter view and verify 4:3 width = 192px
    for (let i = 0; i < 3; i += 1) {
      await m.act(async () => {
        (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent(makeEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown' }));
      });
    }
    const scrollEl = m.timelineEl.children[2]! as unknown as { scrollLeft: number; dispatchEvent(ev: unknown): boolean };
    scrollEl.scrollLeft = 635 * Number(m.timelineEl.getAttribute('data-editor-ppf'));
    await m.dispatchOn(scrollEl as never, 'scroll', { bubbles: false, cancelable: false });
    await m.act(async () => {
      await Promise.resolve();
    });
    const clip4Tiles = m.dom.query('[data-editor-clip="4"]')!.querySelectorAll('i');
    if (clip4Tiles.length > 0) {
      expect(clip4Tiles[0]!.style.width).toBe('192px');
    }

    // Portrait 9:16 density guard in Timeline (mock video metadata ratio 9:16 at 110px video lane -> 64px tiles, decode density <= 96px rule)
    await m.dom.unmount();
    dom = null;
    const ratioSpy = vi.spyOn(FrameThumbs.prototype, 'ratioOf').mockReturnValue(9 / 16);
    wantSpy.mockClear();
    const m916 = await mountEditor({ initialSaved: { v: 1, timelineHeight: null, lanes: { video: 110 }, assistDock: 'bar' }, editorHeight: 900 });
    await m916.dom.click('[data-editor-zoom="frames"]');
    const out916 = m916.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.timeline.zoomOut)!;
    await m916.dom.click(out916);
    await m916.dom.click(out916);
    const clipTiles916 = m916.dom.query('[data-editor-clip="1"]')!.querySelectorAll('i');
    expect(clipTiles916.length).toBeGreaterThanOrEqual(4);
    expect(clipTiles916[0]!.style.width).toBe('64px');
    const lastWant = wantSpy.mock.calls.at(-1)?.[0] ?? [];
    const uniqueFrames = new Set(lastWant.map((r) => `${r.src}#${r.sourceFrame}`)).size;
    expect(uniqueFrames).toBeLessThan(clipTiles916.length);
    expect(uniqueFrames).toBeLessThanOrEqual(Math.ceil((clipTiles916.length * 64) / 96));

    ratioSpy.mockRestore();
    wantSpy.mockRestore();

    // Direct FrameThumbs test for ratio tracking opt-in, height cache keys, byte cap eviction, canvas dimensions & fallback
    const thumbs = new FrameThumbs();
    const origCreate = document.createElement.bind(document);
    const createdCanvasSizes: Array<{ width: number; height: number }> = [];
    let nextBlobSize = 0;
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') {
        const listeners = new Map<string, Array<() => void>>();
        const vid = {
          muted: false,
          playsInline: false,
          preload: '',
          src: '',
          readyState: 2,
          currentTime: 0,
          videoWidth: 540,
          videoHeight: 960,
          removeAttribute: () => undefined,
          load: () => undefined,
          addEventListener: (ev: string, fn: () => void) => {
            listeners.set(ev, [...(listeners.get(ev) ?? []), fn]);
            if (ev === 'seeked') Promise.resolve().then(fn);
          },
        };
        return vid as unknown as HTMLElement;
      }
      if (tag === 'canvas') {
        const size = { width: 0, height: 0 };
        createdCanvasSizes.push(size);
        return {
          set width(w: number) { size.width = w; },
          get width() { return size.width; },
          set height(h: number) { size.height = h; },
          get height() { return size.height; },
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (cb: (b: Blob | null) => void) => cb(nextBlobSize > 0 ? new Blob([new Uint8Array(nextBlobSize)]) : new Blob(['ok'])),
        } as unknown as HTMLElement;
      }
      return origCreate(tag);
    }) as typeof document.createElement);
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => `blob:thumb-${createdCanvasSizes.length}`, revokeObjectURL: revokeSpy });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      Promise.resolve().then(() => cb(16));
      return 1;
    });

    // Note 2: default trackRatios=false skips recordRatio & extra notify while still storing decoded blobs
    const notifySpy = vi.spyOn(thumbs as unknown as { notify(): void }, 'notify');
    const defaultRepaint = vi.fn();
    const offDefault = thumbs.subscribe(defaultRepaint);
    thumbs.want([{ src: '/v-default.mp4', sourceFrame: 0, seekSec: 0, height: 72 }]);
    await vi.waitFor(() => {
      expect(thumbs.get('/v-default.mp4', 0, 72)).toBe('blob:thumb-1');
    });
    expect(thumbs.ratioOf('/v-default.mp4')).toBeUndefined();
    expect(notifySpy).toHaveBeenCalledTimes(1); // Only store(), zero notify() from recordRatio
    expect(defaultRepaint).toHaveBeenCalled();
    offDefault();

    // Custom video lane height enables trackRatios (and backfills already-loaded videos)
    thumbs.setTrackRatios(true);
    expect(thumbs.ratioOf('/v-default.mp4')).toBeCloseTo(9 / 16, 4);
    notifySpy.mockClear();
    thumbs.want([{ src: '/v.mp4', sourceFrame: 0, seekSec: 0, height: 72 }]);
    await vi.waitFor(() => {
      expect(thumbs.get('/v.mp4', 0, 72)).toBe('blob:thumb-2');
    });
    expect(thumbs.ratioOf('/v.mp4')).toBeCloseTo(9 / 16, 4);
    expect(notifySpy).toHaveBeenCalledTimes(2); // recordRatio() + store()
    expect(createdCanvasSizes[1]).toEqual({ width: 41, height: 72 });
    const baseUrl = thumbs.get('/v.mp4', 0, 72);
    expect(baseUrl).toBeTruthy();
    // While 144px is undecoded, fallback returns base 72px picture rather than blank
    expect(thumbs.fallback('/v.mp4', 0, 144)).toBe(baseUrl);

    thumbs.want([{ src: '/v.mp4', sourceFrame: 0, seekSec: 0, height: 144 }]);
    await vi.waitFor(() => {
      expect(thumbs.get('/v.mp4', 0, 144)).toBe('blob:thumb-3');
    });
    expect(createdCanvasSizes[2]).toEqual({ width: 81, height: 144 });

    // Byte ceiling (3 MB) evicts oldest >72px upgraded blobs before entry limit (600) is reached
    nextBlobSize = 1024 * 1024;
    thumbs.want([
      { src: '/heavy.mp4', sourceFrame: 0, seekSec: 0, height: 144 },
      { src: '/heavy.mp4', sourceFrame: 1, seekSec: 0.1, height: 144 },
      { src: '/heavy.mp4', sourceFrame: 2, seekSec: 0.2, height: 144 },
      { src: '/heavy.mp4', sourceFrame: 3, seekSec: 0.3, height: 144 },
      { src: '/heavy.mp4', sourceFrame: 4, seekSec: 0.4, height: 144 },
    ]);
    await vi.waitFor(() => {
      expect(thumbs.get('/heavy.mp4', 4, 144)).toBeTruthy();
    });
    expect(thumbs.get('/heavy.mp4', 0, 144)).toBeUndefined();
    expect(thumbs.get('/heavy.mp4', 1, 144)).toBeUndefined();
    expect(thumbs.get('/heavy.mp4', 2, 144)).toBeTruthy();
    expect(thumbs.usage()).toEqual({ pictures: 3, bytes: 3 * 1024 * 1024 });
    expect(revokeSpy).toHaveBeenCalledTimes(5); // 3 earlier small blobs + 2 earliest heavy blobs evicted

    thumbs.dispose();
    createSpy.mockRestore();
  });

function parseHtmlIntoHost(doc: MountedDom['document'], host: ReturnType<MountedDom['document']['createElement']>, html: string) {
  const decodeEntities = (s: string) =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const SVG_ATTR_CASE: Record<string, string> = {
    viewbox: 'viewBox',
    preserveaspectratio: 'preserveAspectRatio',
  };
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack: Array<ReturnType<typeof doc.createElement>> = [host];
  let pos = 0;
  let svgDepth = 0;
  while (pos < html.length) {
    if (html.startsWith('<!--', pos)) {
      const end = html.indexOf('-->', pos + 4);
      const commentEnd = end === -1 ? html.length : end + 3;
      stack[stack.length - 1]!.appendChild(doc.createComment(html.slice(pos + 4, end === -1 ? html.length : end)));
      pos = commentEnd;
    } else if (html[pos] === '<') {
      const gt = html.indexOf('>', pos + 1);
      const rawTag = html.slice(pos + 1, gt);
      pos = gt + 1;
      if (rawTag.startsWith('/')) {
        const popped = stack.pop();
        if (popped && popped.tagName.toLowerCase() === 'svg') svgDepth = Math.max(0, svgDepth - 1);
      } else {
        const selfClose = rawTag.endsWith('/');
        const inner = selfClose ? rawTag.slice(0, -1).trim() : rawTag.trim();
        const spaceIdx = inner.search(/\s/);
        const tagName = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();
        const attrStr = spaceIdx === -1 ? '' : inner.slice(spaceIdx + 1);
        const inSvg = svgDepth > 0 || tagName === 'svg';
        const node = inSvg ? doc.createElementNS('http://www.w3.org/2000/svg', tagName) : doc.createElement(tagName);
        const attrRe = /([^\s=/>]+)(?:\s*=\s*"([^"]*)"|\s*=\s*([^\s>]+))?/g;
        let mAttr: RegExpExecArray | null;
        while ((mAttr = attrRe.exec(attrStr))) {
          const rawName = mAttr[1]!;
          const lowerName = rawName.toLowerCase();
          const name = inSvg ? (SVG_ATTR_CASE[lowerName] ?? rawName) : lowerName;
          const val = decodeEntities(mAttr[2] ?? mAttr[3] ?? '');
          node.setAttribute(name, val);
          if (name === 'style') {
            for (const decl of val.split(';')) {
              const colon = decl.indexOf(':');
              if (colon > 0) node.style.setProperty(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
            }
          }
        }
        stack[stack.length - 1]!.appendChild(node);
        if (!inSvg) {
          const origGet = node.getAttribute.bind(node);
          const origHas = node.hasAttribute.bind(node);
          node.getAttribute = (k: string) => origGet(k) ?? origGet(k.toLowerCase());
          node.hasAttribute = (k: string) => origHas(k) || origHas(k.toLowerCase());
        }
        if (tagName === 'video') {
          (node as unknown as { muted: boolean; playsInline: boolean }).muted = node.hasAttribute('muted');
          (node as unknown as { muted: boolean; playsInline: boolean }).playsInline = node.hasAttribute('playsinline');
        }
        if (tagName === 'script' && !selfClose) {
          const closeIdx = html.indexOf('</script>', pos);
          const scriptBody = html.slice(pos, closeIdx);
          node.appendChild(doc.createTextNode(scriptBody));
          Object.defineProperty(node, 'innerHTML', {
            get: () => node.textContent,
            set: (_v: string) => undefined,
            configurable: true,
          });
          pos = closeIdx + '</script>'.length;
        } else if (!selfClose && !VOID_TAGS.has(tagName)) {
          if (tagName === 'svg') svgDepth += 1;
          stack.push(node);
        }
      }
    } else {
      const nextLt = html.indexOf('<', pos);
      const end = nextLt === -1 ? html.length : nextLt;
      const text = decodeEntities(html.slice(pos, end));
      if (text.length > 0) stack[stack.length - 1]!.appendChild(doc.createTextNode(text));
      pos = end;
    }
  }
}

  it('W2 & Note 8: inline pre-paint script applies saved layout at 0ms and hydrateRoot completes with zero recoverable or console errors', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          Promise.resolve().then(() => this.onerror?.());
        }
      },
    );
    const savedRaw = JSON.stringify({ v: 1, timelineHeight: 360, lanes: { video: 120 }, assistDock: 'side' });
    const storageMap = new Map<string, string>([[LAYOUT_STORAGE_KEY, savedRaw]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
    });

    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const withoutNonceHtml = renderToString(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: null,
      }),
    );
    expect(withoutNonceHtml).not.toContain('<script');

    const element = h(EditorV2, {
      copy: studioEditorKo,
      currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`,
      initialWorkspace: 'cut',
      real: null,
      nonce: 'test-csp-nonce',
    });
    const html = renderToString(element);
    expect(html).toContain('<script data-ev-prepaint="" nonce="test-csp-nonce"');

    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    dom = await mountDom(null);
    patchDomElementProto(dom.document);

    const host = dom.document.createElement('div');
    dom.document.body.appendChild(host);
    parseHtmlIntoHost(dom.document, host, html);

    // Verify raw SSR markup has default attributes before pre-paint script mutates the live DOM (Fix3 #4)
    const scriptStart = html.indexOf('<script');
    const scriptEnd = html.indexOf('</script>');
    const outsideScriptHtml = `${html.slice(0, scriptStart)}${html.slice(scriptEnd)}`;
    expect(outsideScriptHtml).not.toContain('data-sized');
    expect(outsideScriptHtml).toContain('--ev-timeline-h:auto');
    expect(outsideScriptHtml).not.toContain('--ev-h-video');

    // Execute the SSR inline <script> BEFORE hydrateRoot (0ms pre-paint) and simulate browser stripping nonce
    const ssrRoot = host.querySelector('[data-studio-editor-v2]')!;
    ssrRoot.getBoundingClientRect = () => ({ top: 12, left: 0, bottom: 912, right: 1440, width: 1440, height: 900 });
    const scriptNode = ssrRoot.querySelector('script')!;
    expect(scriptNode.getAttribute('nonce')).toBe('test-csp-nonce');
    scriptNode.removeAttribute('nonce');
    (dom.document as unknown as { currentScript: unknown }).currentScript = scriptNode;
    new Function(scriptNode.textContent)();
    (dom.document as unknown as { currentScript: unknown }).currentScript = null;

    expect(ssrRoot.getAttribute('data-dock')).toBe('bar'); // R4: pre-paint script leaves assistDock unchanged until React mount
    expect(ssrRoot.hasAttribute('data-sized')).toBe(true);
    expect(ssrRoot.style['--ev-timeline-h']).toBe('360px');
    expect(ssrRoot.style['--ev-h-video']).toBe('120px');
    expect(ssrRoot.style['--ev-timeline-max']).toBe('585px');

    const recoverableSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let hydratedRoot: ReturnType<typeof hydrateRoot> | null = null;
    try {
      await act(async () => {
        hydratedRoot = hydrateRoot(host as unknown as Element, element, { onRecoverableError: recoverableSpy });
      });
      expect(recoverableSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      const liveRoot = host.querySelector('[data-studio-editor-v2]')!;
      const liveTimeline = host.querySelector('[data-editor-timeline]')!;
      expect(liveRoot.getAttribute('data-dock')).toBe('side');
      expect(liveRoot.hasAttribute('data-sized')).toBe(true);
      expect(liveRoot.style['--ev-timeline-h']).toBe('360px');
      expect(liveTimeline.style['--h-video']).toBe('120px');
    } finally {
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
      if (hydratedRoot) {
        await act(async () => {
          hydratedRoot!.unmount();
        });
      }
    }
  });

  it('Fix3 #5: script uses loose safety bound so ordinary/side-dock saved heights do not shift on mount, clamping only when precise bound is exceeded', async () => {
    const runScenario = async (
      saved: { timelineHeight: number; assistDock: 'bar' | 'side'; editorHeight?: number },
      expectedScriptH: string,
      expectedLiveH: string,
    ) => {
      const editorHeight = saved.editorHeight ?? 900;
      vi.stubGlobal('requestAnimationFrame', () => 1);
      vi.stubGlobal('cancelAnimationFrame', () => undefined);
      vi.stubGlobal(
        'Image',
        class {
          onerror: (() => void) | null = null;
          set src(_value: string) {
            Promise.resolve().then(() => this.onerror?.());
          }
        },
      );
      const storageMap = new Map<string, string>([
        [LAYOUT_STORAGE_KEY, JSON.stringify({ v: 1, lanes: {}, timelineHeight: saved.timelineHeight, assistDock: saved.assistDock })],
      ]);
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => storageMap.set(k, v),
      });

      const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
      const element = h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: null,
        nonce: 'test-csp-nonce',
      });
      const html = renderToString(element);

      const { mountDom } = await import('@/tests/brands/_dom-harness');
      const { act } = await import('react');
      const localDom = await mountDom(null);
      patchDomElementProto(localDom.document);
      const host = localDom.document.createElement('div');
      localDom.document.body.appendChild(host);
      parseHtmlIntoHost(localDom.document, host, html);

      const ssrRoot = host.querySelector('[data-studio-editor-v2]')!;
      ssrRoot.getBoundingClientRect = () => ({ top: 12, left: 0, bottom: 12 + editorHeight, right: 1440, width: 1440, height: editorHeight });
      const scriptNode = ssrRoot.querySelector('script')!;
      scriptNode.removeAttribute('nonce');
      (localDom.document as unknown as { currentScript: unknown }).currentScript = scriptNode;
      new Function(scriptNode.textContent)();
      (localDom.document as unknown as { currentScript: unknown }).currentScript = null;

      expect(ssrRoot.style['--ev-timeline-h']).toBe(expectedScriptH);
      const timelineSetSpy = vi.spyOn(ssrRoot.style, 'setProperty');

      const recoverableSpy = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let hydratedRoot: ReturnType<typeof hydrateRoot> | null = null;
      try {
        await act(async () => {
          hydratedRoot = hydrateRoot(host as unknown as Element, element, { onRecoverableError: recoverableSpy });
        });
        expect(recoverableSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();

        const liveRoot = host.querySelector('[data-studio-editor-v2]')!;
        expect(liveRoot.style['--ev-timeline-h']).toBe(expectedLiveH);
        if (expectedScriptH === expectedLiveH) {
          const unexpectedWrites = timelineSetSpy.mock.calls.filter(
            ([prop, val]) => prop === '--ev-timeline-h' && val !== 'auto' && val !== expectedScriptH,
          );
          expect(unexpectedWrites).toHaveLength(0);
        }
      } finally {
        timelineSetSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        if (hydratedRoot) {
          await act(async () => {
            hydratedRoot!.unmount();
          });
        }
        await localDom.unmount();
        vi.resetModules();
      }
    };

    // Ordinary value (<60% = 456px on 760px; previously clamped to 422px by over=48) and side-dock value (565px <= 585px): zero shift after mount
    await runScenario({ editorHeight: 760, timelineHeight: 450, assistDock: 'side' }, '450px', '450px');
    await runScenario({ editorHeight: 900, timelineHeight: 565, assistDock: 'side' }, '565px', '565px');
    // Exceeding precise bar-dock bound (580px > 550px): loose safety cap leaves 580px pre-paint, React clamps to 550px
    await runScenario({ editorHeight: 900, timelineHeight: 580, assistDock: 'bar' }, '580px', '550px');
  });
});

describe('Fix round 2: default-state parity, 3px threshold, wheel behavior & zero forced metrics', () => {
  it('R2 & R3: plain clicks (<3px) and double-clicks on untouched handles preserve default state parity and write zero storage', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const lanes = ['titles', 'video', 'captions', 'voice', 'music'] as const;
    const initialLaneHeights = Object.fromEntries(lanes.map((k) => [k, m.timelineEl.style[`--h-${k}`]]));
    const initialTimelineClass = m.timelineEl.className;

    const mainHandle = m.dom.query('[data-editor-timeline-resize]')!;
    await m.dispatchOn(mainHandle, 'pointerdown', { button: 0, pointerId: 1, clientY: 600 });
    await m.dispatchOn(mainHandle, 'pointermove', { pointerId: 1, clientY: 598 });
    await m.dispatchOn(mainHandle, 'pointerup', { pointerId: 1, clientY: 598 });
    await m.dispatchOn(mainHandle, 'dblclick');

    for (const lane of lanes) {
      const handle = m.dom.query(`[data-editor-lane-resize="${lane}"]`)!;
      await m.dispatchOn(handle, 'pointerdown', { button: 0, pointerId: 2, clientY: 100 });
      await m.dispatchOn(handle, 'pointermove', { pointerId: 2, clientY: 102 });
      await m.dispatchOn(handle, 'pointerup', { pointerId: 2, clientY: 102 });
      await m.dispatchOn(handle, 'dblclick');
    }

    expect(m.setItem).not.toHaveBeenCalled();
    expect(m.rootEl.hasAttribute('data-sized')).toBe(false);
    expect(m.rootEl.style['--ev-timeline-h']).toBe('auto');
    expect(m.timelineEl.hasAttribute('data-sized')).toBe(false);
    expect(m.timelineEl.className).toBe(initialTimelineClass);
    for (const lane of lanes) {
      expect(m.timelineEl.style[`--h-${lane}`]).toBe(initialLaneHeights[lane]);
      expect(m.timelineEl.style[`--ev-h-${lane}`]).toBeUndefined();
    }
  });

  it('R3: plain vertical wheel in untouched default state always scrolls horizontally even when scrollHeight > clientHeight', async () => {
    const m = await mountEditor({ editorHeight: 900 });
    const scrollEl = m.timelineEl.children[2]! as unknown as {
      scrollWidth: number;
      clientWidth: number;
      scrollHeight: number;
      clientHeight: number;
      scrollLeft: number;
      dispatchEvent(ev: unknown): boolean;
    };
    scrollEl.scrollWidth = 1400;
    scrollEl.clientWidth = 960;
    scrollEl.scrollHeight = 400;
    scrollEl.clientHeight = 200;
    scrollEl.scrollLeft = 0;

    // Default state: plain wheel scrolls horizontally identically to main
    const defaultEv = await m.dispatchOn(scrollEl as never, 'wheel', { deltaY: 60, deltaX: 0, bubbles: true, cancelable: true });
    expect(defaultEv.defaultPrevented).toBe(true);
    expect(scrollEl.scrollLeft).toBe(60);

    // Drag video lane >= 3px so timeline enters sized mode -> vertical scroll now takes precedence on overflow
    const videoHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(videoHandle, 'pointerdown', { button: 0, pointerId: 5, clientY: 100 });
    await m.dispatchOn(videoHandle, 'pointermove', { pointerId: 5, clientY: 140 });
    await m.dispatchOn(videoHandle, 'pointerup', { pointerId: 5, clientY: 140 });
    expect(m.timelineEl.hasAttribute('data-sized')).toBe(true);

    scrollEl.scrollLeft = 0;
    const sizedEv = await m.dispatchOn(scrollEl as never, 'wheel', { deltaY: 60, deltaX: 0, bubbles: true, cancelable: true });
    expect(sizedEv.defaultPrevented).toBe(false);
    expect(scrollEl.scrollLeft).toBe(0);
  });
});

describe('Fix round 3: 72px 600-frame parity & 60-move drag playback freedom', () => {
  it('Fix3 #1: keeps 600 frames of 72px thumbs without byte-cap eviction (>3MB total) and evicts LRU frame 0 only at frame 601', async () => {
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    dom = await mountDom(null);
    const { FrameThumbs } = await import('@/components/brand-studio/editor-v2/frame-thumbs');
    const thumbs = new FrameThumbs();
    const origCreate = document.createElement.bind(document);
    let urlSeq = 0;
    const blobSize = 6 * 1024; // 600 * 6 KB = 3,686,400 B (> 3 MB tall-cache ceiling)
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') {
        const vid = {
          muted: false,
          playsInline: false,
          preload: '',
          src: '',
          readyState: 2,
          currentTime: 0,
          videoWidth: 540,
          videoHeight: 960,
          removeAttribute: () => undefined,
          load: () => undefined,
          addEventListener: (ev: string, fn: () => void) => {
            if (ev === 'seeked') Promise.resolve().then(fn);
          },
        };
        return vid as unknown as HTMLElement;
      }
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(blobSize)])),
        } as unknown as HTMLElement;
      }
      return origCreate(tag);
    }) as typeof document.createElement);
    const revokeSpy = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => `blob:fix3-${(urlSeq += 1)}`, revokeObjectURL: revokeSpy });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      Promise.resolve().then(() => cb(16));
      return 1;
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      // Decode 600 distinct 72px frames across chunks so every frame is queued cleanly without touching MRU order of frame 0.
      for (let base = 0; base < 600; base += 100) {
        thumbs.want(
          Array.from({ length: 100 }, (_, j) => ({
            src: '/sixhundred.mp4',
            sourceFrame: base + j,
            seekSec: (base + j) * 0.04,
            height: 72,
          })),
        );
        while (!thumbs.get('/sixhundred.mp4', base + 99, 72)) {
          await vi.advanceTimersByTimeAsync(1);
          await Promise.resolve();
        }
      }

      expect(thumbs.usage()).toEqual({ pictures: 600, bytes: 600 * blobSize });
      expect(revokeSpy).not.toHaveBeenCalled();

      // Adding the 601st 72px frame must now evict the oldest frame (sourceFrame 0) strictly by count LIMIT = 600.
      thumbs.want([{ src: '/sixhundred.mp4', sourceFrame: 600, seekSec: 24, height: 72 }]);
      while (!thumbs.get('/sixhundred.mp4', 600, 72)) {
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
      }
      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(thumbs.get('/sixhundred.mp4', 0, 72)).toBeUndefined();
      expect(thumbs.get('/sixhundred.mp4', 600, 72)).toBeTruthy();
      expect(thumbs.usage()).toEqual({ pictures: 600, bytes: 600 * blobSize });
    } finally {
      vi.useRealTimers();
      thumbs.dispose();
      createSpy.mockRestore();
    }
  });

  it('Fix3 #2: keeps video playback rAF loop running smoothly through 60 interleaved video-lane pointermove drags without thumb decodes or video pause', async () => {
    const { FrameThumbs } = await import('@/components/brand-studio/editor-v2/frame-thumbs');
    const wantSpy = vi.spyOn(FrameThumbs.prototype, 'want');
    const rafQueue = new Map<number, FrameRequestCallback>();
    let nextRafId = 1;
    let rafRuns = 0;

    const m = await mountEditor({
      editorHeight: 900,
      raf: (cb) => {
        const id = nextRafId++;
        rafQueue.set(id, cb);
        return id;
      },
      cancelRaf: (id) => {
        rafQueue.delete(id);
      },
    });

    const video = m.dom.query('video')! as unknown as {
      readyState: number;
      currentTime: number;
      duration: number;
      paused: boolean;
      ended: boolean;
      seeking: boolean;
      playbackRate: number;
      play: () => Promise<void>;
      pause: () => void;
    };
    video.readyState = 2;
    video.duration = 20;
    video.ended = false;
    video.seeking = false;
    video.playbackRate = 1;
    const pauseSpy = vi.spyOn(video, 'pause');

    await m.dom.click('[data-editor-zoom="frames"]');
    const playBtn = m.dom.query('[data-editor-play]')!;
    await m.dom.click(playBtn);
    expect(rafQueue.size).toBeGreaterThan(0);
    // Flush the first rAF tick so playForward invokes video.play() before starting drag moves
    const initialTicks = [...rafQueue.entries()];
    rafQueue.clear();
    await m.act(async () => {
      for (const [, cb] of initialTicks) cb(16);
    });
    expect(video.paused).toBe(false);
    expect(rafQueue.size).toBeGreaterThan(0);

    // Clear initial want() calls from zoom/mount so drag checks only new calls during pointer drag.
    wantSpy.mockClear();
    const laneHandle = m.dom.query('[data-editor-lane-resize="video"]')!;
    await m.dispatchOn(laneHandle, 'pointerdown', { button: 0, pointerId: 21, clientY: 100 });
    expect(m.timelineEl.hasAttribute('data-lane-dragging')).toBe(false); // Wait for 3px drag threshold

    for (let step = 1; step <= 60; step += 1) {
      await m.dispatchOn(laneHandle, 'pointermove', { pointerId: 21, clientY: 100 + step });
      if (step === 3) expect(m.timelineEl.hasAttribute('data-lane-dragging')).toBe(true);
      video.currentTime += 1 / 24;
      const pending = [...rafQueue.entries()];
      rafQueue.clear();
      expect(pending.length).toBeGreaterThan(0);
      await m.act(async () => {
        for (const [, cb] of pending) {
          rafRuns += 1;
          cb(16 + step * 42);
        }
      });
    }
    expect(m.timelineEl.hasAttribute('data-lane-dragging')).toBe(true);

    expect(rafRuns).toBeGreaterThanOrEqual(60);
    expect(rafQueue.size).toBeGreaterThan(0);
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(wantSpy).not.toHaveBeenCalled();
    // Sample cut workspace initial video lane height = 54px; +60px drag => 114px live CSS var, React state untouched at 54px until drop
    expect(m.timelineEl.style['--ev-h-video']).toBe('114px');
    expect(m.timelineEl.style['--h-video']).toBe('54px');

    await m.dispatchOn(laneHandle, 'pointerup', { pointerId: 21, clientY: 160 });
    expect(m.timelineEl.hasAttribute('data-lane-dragging')).toBe(false);
    expect(m.timelineEl.style['--h-video']).toBe('114px');
    expect(wantSpy).toHaveBeenCalled();
    expect(wantSpy.mock.calls.at(-1)?.[0]?.[0]?.height).toBe(144);
    expect(rafQueue.size).toBeGreaterThan(0);

    wantSpy.mockRestore();
    pauseSpy.mockRestore();
  });
});
