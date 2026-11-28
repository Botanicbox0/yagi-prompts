import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutPrepaintScript } from '@/components/brand-studio/editor-v2/layout-store';
import { brandStudioEditorV2TracksOpenFor } from '@/lib/flags';
import {
  composeStorageKey,
  emptyComposerProject,
  serializeProjectForStorage,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { TRACKS_PREFS_KEY } from '@/components/brand-studio/editor-v2/shortcut-store';
import {
  OVERLAY_PLAY_DRIFT_SEC,
  overlayDriftLimitSec,
  overlaySettleKey,
} from '@/components/brand-studio/editor-v2/preview';
import { oldEditorLinkTitle } from '@/components/brand-studio/editor-v2/editor-v2';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  MAX_OVERLAY_TRACKS,
  computeDropTarget,
  type TrackRowRect,
} from '@/lib/brand-studio/editor-v2/tracks';
import type { FrameClip, FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatKo } from '@/messages/studio-editor-chat';
import { studioEditorTracksKo } from '@/messages/studio-editor-tracks';
import type { MountedDom } from '@/tests/brands/_dom-harness';

vi.mock('@/components/brand-studio/editor-v2/measure-fps', () => ({
  measureSource: vi.fn(async () => ({ fps: 24, frames: 120 })),
}));
vi.mock('@/components/brand-studio/editor-v2/footage-facts', () => ({
  footageNotFound: () => false,
  readFootage: vi.fn(async () => ({ ok: false, answer: { ok: false, reason: 'unavailable' } })),
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
vi.mock('@/components/brand-studio/editor-v2/assist-client', () => ({
  ASSIST_CLIENT_TIMEOUT_MS: 20_000,
  requestAssistPlan: vi.fn(async () => ({
    ok: true,
    kind: 'plan',
    steps: [{ do: 'remove', clip: { clipId: 'c2' } }],
  })),
}));

const ROOT = process.cwd();
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const ORG = 'org-tracks-test';
const REAL_PROPS = {
  organizationId: ORG,
  organizationName: '테스트 브랜드',
  canEdit: true,
  sources: [],
  assets: { ids: ['a1', 'a2', 'a3'], complete: true },
  sampleBase: null,
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
    button?: number;
    buttons?: number;
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
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
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

function makeSeedProject(clipsCount = 3, withThumbs = false): ComposerProject {
  return {
    ...emptyComposerProject('9:16'),
    clips: Array.from({ length: clipsCount }, (_, i) => ({
      id: `c${i + 1}`,
      label: `Cut ${i + 1}`,
      sourceKind: 'asset' as const,
      assetId: `a${i + 1}`,
      srcUrl: `https://media.example.invalid/c${i + 1}.mp4`,
      thumbUrl: withThumbs ? `https://media.example.invalid/c${i + 1}.jpg` : null,
      durationSec: 5,
      trimStartSec: 0,
      trimEndSec: 3,
      volume: 1,
      muted: false,
    })),
  };
}

function makeClip(id: string, frames = 48): FrameClip {
  return {
    id,
    label: id,
    srcUrl: `https://media.example.invalid/${id}.mp4`,
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 240,
    inFrame: 0,
    phase: 0,
    frames,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
  };
}

async function mountEditor(opts: {
  tracksOpen?: boolean;
  withChat?: boolean;
  clipsCount?: number;
  withThumbs?: boolean;
} = {}) {
  const storageMap = new Map<string, string>();
  storageMap.set(composeStorageKey(ORG), serializeProjectForStorage(makeSeedProject(opts.clipsCount ?? 3, opts.withThumbs)));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => { storageMap.set(key, val); },
    removeItem: (key: string) => { storageMap.delete(key); },
    clear: () => storageMap.clear(),
  });
  let nextRaf = 1;
  const rafQueue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRaf++;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    rafQueue.delete(id);
  });
  const flushRaf = () => {
    const pending = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of pending) cb(0);
  };
  vi.stubGlobal('HTMLVideoElement', class { requestVideoFrameCallback() { return 1; } });
  vi.stubGlobal('VideoEncoder', class {});
  vi.stubGlobal('VideoFrame', class {});
  vi.stubGlobal('AudioEncoder', class {});
  vi.stubGlobal('AudioData', class {});
  vi.stubGlobal('OfflineAudioContext', class {});
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        Promise.resolve().then(() => this.onerror?.());
      }
    },
  );

  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { act } = await import('react');
  const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
  dom = await mountDom(null);

  const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
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
  for (const prop of ['scrollTop', 'scrollLeft', 'scrollHeight', 'clientHeight', 'offsetHeight', 'scrollWidth', 'clientWidth'] as const) {
    if (!(prop in element)) {
      const store = new WeakMap<object, number>();
      const fallback = prop === 'clientWidth' ? 960 : 0;
      Object.defineProperty(element, prop, {
        configurable: true,
        get(this: object) { return store.get(this) ?? fallback; },
        set(this: object, val: number) { store.set(this, val); },
      });
    }
  }
  if (!('setPointerCapture' in element)) {
    element.setPointerCapture = () => undefined;
    element.releasePointerCapture = () => undefined;
  }
  if (!('getAttributeNames' in element)) {
    element.getAttributeNames = function (this: { attributes?: Record<string, string> }) {
      return Object.keys(this.attributes ?? {});
    };
  }
  const textareaProto = Object.getPrototypeOf(dom.document.createElement('textarea')) as Record<string, unknown>;
  if (!('defaultValue' in textareaProto)) {
    const defaults = new WeakMap<object, string>();
    Object.defineProperty(textareaProto, 'defaultValue', {
      configurable: true,
      get(this: object) { return defaults.get(this) ?? ''; },
      set(this: { _value?: string }, val: string) {
        const next = String(val ?? '');
        defaults.set(this, next);
        this._value = next;
      },
    });
  }

  await dom.rerender(
    h(EditorV2, {
      copy: studioEditorKo,
      currentEditorHref: '/brand/studio/compose?classic=1',
      real: { ...REAL_PROPS, ...(opts.withChat ? { filmId: 'f-1' } : {}) },
      ...(opts.withChat ? { realChat: { userId: 'u-1', filmId: 'f-1', assistEnabled: true, locale: 'ko' as const }, chatCopy: studioEditorChatKo } : {}),
      ...(opts.tracksOpen ? { tracksOpen: true, tracksCopy: studioEditorTracksKo } : {}),
    }),
  );
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }

  const fireWindowKey = async (init: Parameters<typeof makeEvent>[1]) => {
    await act(async () => {
      (window as unknown as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(makeEvent('keydown', init));
    });
  };
  const firePointer = async (target: unknown, type: string, init: Parameters<typeof makeEvent>[1] = {}) => {
    await act(async () => {
      (target as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(makeEvent(type, init));
      flushRaf();
    });
  };

  return { dom, act, fireWindowKey, firePointer, flushRaf };
}

describe('E-T Batch T1 — flag & C6 closed-switch parity', () => {
  it('flag helper brandStudioEditorV2TracksOpenFor obeys orgListSwitchOpen and rejects blank org ids', () => {
    expect(brandStudioEditorV2TracksOpenFor('org-1', {})).toBe(false);
    expect(brandStudioEditorV2TracksOpenFor('org-1', { BRAND_STUDIO_EDITOR_V2_TRACKS: 'off' })).toBe(false);
    expect(brandStudioEditorV2TracksOpenFor('', { BRAND_STUDIO_EDITOR_V2_TRACKS: 'on' })).toBe(false);
    expect(brandStudioEditorV2TracksOpenFor('   ', { BRAND_STUDIO_EDITOR_V2_TRACKS: 'on' })).toBe(false);
    expect(brandStudioEditorV2TracksOpenFor('org-1', { BRAND_STUDIO_EDITOR_V2_TRACKS: 'on' })).toBe(true);
    expect(
      brandStudioEditorV2TracksOpenFor('ORG-1', {
        BRAND_STUDIO_EDITOR_V2_TRACKS: 'on',
        BRAND_STUDIO_EDITOR_V2_TRACKS_ORGS: 'org-2, org-1',
      }),
    ).toBe(true);
    expect(
      brandStudioEditorV2TracksOpenFor('org-3', {
        BRAND_STUDIO_EDITOR_V2_TRACKS: 'on',
        BRAND_STUDIO_EDITOR_V2_TRACKS_ORGS: 'org-2, org-1',
      }),
    ).toBe(false);
  });

  it('C6: closed SSR markup (with and without nonce), pre-paint script, and studio-editor.ts stay byte-identical', async () => {
    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const studioEditorRaw = readFileSync(join(ROOT, 'messages/studio-editor.ts'), 'utf8');
    expect(sha256(studioEditorRaw)).toBe('dda9c96b853e2ace528b0683f75f9f111b139b4e9d93f49e634a1c573971e356');
    expect(sha256(layoutPrepaintScript('bar'))).toBe('a1073f292f1e1d12350cadf12908959c7f78356cf742afdc3c6d92247695e0aa');

    const closedWithoutNonce = renderToStaticMarkup(
      h(EditorV2, { copy: studioEditorKo, currentEditorHref: '/brand/studio/compose?classic=1', real: REAL_PROPS }),
    );
    const closedWithNonce = renderToStaticMarkup(
      h(EditorV2, { copy: studioEditorKo, currentEditorHref: '/brand/studio/compose?classic=1', real: REAL_PROPS, nonce: 'n-1' }),
    );
    expect(closedWithoutNonce).not.toContain('data-editor-linkage');
    expect(closedWithoutNonce).not.toContain('data-editor-linkage-settings');
    expect(closedWithoutNonce).not.toContain('data-editor-snap');
    expect(closedWithoutNonce).not.toContain('data-editor-split-all');
    expect(closedWithoutNonce).not.toContain('data-overlay-track');
    expect(closedWithNonce).toContain('data-ev-prepaint');
    expect(closedWithNonce).not.toContain('data-editor-linkage');
    // SMALL: verify exact closed SSR hash parity against pinned baseline (only diff vs T1 is -24 bytes for `<kbd>S</kbd>` removal).
    expect({ sha256: sha256(closedWithoutNonce), length: closedWithoutNonce.length }).toEqual({
      sha256: '88988602a80308cf10e9b3ec6c3f976e52b34d26a87bcdd385e4765c4f0b0638',
      length: 13381,
    });
    expect(closedWithoutNonce).not.toContain('<kbd>S</kbd>');
  });

  it('C6 + SMALL: closed ShortcutsPanel hides tracks-only actions and never writes tracks-only keys to browser storage', async () => {
    const closed = await mountEditor({ tracksOpen: false });
    await closed.dom.click('[data-editor-shortcuts-button]');
    expect(closed.dom.query('[data-editor-shortcut-row="toggleLinkage"]')).toBeNull();
    expect(closed.dom.query('[data-editor-shortcut-row="splitAll"]')).toBeNull();
    expect(closed.dom.query('[data-editor-shortcut-row="moveTrackUp"]')).toBeNull();
    expect(closed.dom.query('[data-editor-shortcut-row="moveTrackDown"]')).toBeNull();
    // Binding `Ctrl+Shift+B` (which belongs to hidden `splitAll`) when closed MUST really bind `play:1`
    // AND MUST NOT write `splitAll: []` or any tracks-only action to browser storage!
    await closed.dom.click('[data-editor-shortcut-slot="play:1"]');
    await closed.fireWindowKey({ code: 'KeyB', ctrlKey: true, shiftKey: true });
    const storedClosed = JSON.parse(window.localStorage.getItem('twings_editor_shortcuts_v1') ?? '{}');
    expect(storedClosed?.overrides?.everyday?.play).toContain('Mod+Shift+KeyB');
    expect(storedClosed?.overrides?.everyday?.splitAll).toBeUndefined();
    expect(storedClosed?.overrides?.everyday?.toggleLinkage).toBeUndefined();
    await closed.dom.unmount();
    dom = null;

    const open = await mountEditor({ tracksOpen: true });
    await open.dom.click('[data-editor-shortcuts-button]');
    expect(open.dom.query('[data-editor-shortcut-row="toggleLinkage"]')).not.toBeNull();
    expect(open.dom.query('[data-editor-shortcut-row="splitAll"]')).not.toBeNull();
    expect(open.dom.query('[data-editor-shortcut-row="moveTrackUp"]')).not.toBeNull();
    expect(open.dom.query('[data-editor-shortcut-row="moveTrackDown"]')).not.toBeNull();
    expect(open.dom.query('[data-editor-shortcut-slot="moveTrackUp:0"]')?.hasAttribute('data-empty')).toBe(true);
    expect(open.dom.query('[data-editor-shortcut-slot="moveTrackDown:0"]')?.hasAttribute('data-empty')).toBe(true);
  });
});

describe('E-T Batch T1 — UI interactions, drop zones, snap guide, export block & draft lock', () => {
  it('all drop zones map pointer coordinates -> drop target accurately (drop line ONLY for new track, ghost ONLY for existing row)', () => {
    const seq: FrameSequence = {
      fps: 24,
      aspect: '9:16',
      clips: [makeClip('m1', 60), makeClip('m2', 60)],
      captions: [],
      overlayTracks: [
        { id: 'ov-1', clips: [{ ...makeClip('o1', 40), startFrame: 0, link: { clipId: 'm1', sourceFrame: 0 } }] },
        { id: 'ov-2', clips: [{ ...makeClip('o2', 40), startFrame: 0, link: { clipId: 'm1', sourceFrame: 0 } }] },
      ],
    };
    const rows: TrackRowRect[] = [
      { kind: 'overlay', trackIndex: 1, top: 40, bottom: 94 },
      { kind: 'overlay', trackIndex: 0, top: 102, bottom: 156 },
      { kind: 'main', top: 164, bottom: 228 },
    ];
    const mainRow = { top: 164, bottom: 228 };

    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'main', index: 1 }, clientY: 15, dropFrame: 20, rows, mainRow }).kind,
    ).toBe('new-track');
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'main', index: 1 }, clientY: 98, dropFrame: 20, rows, mainRow }),
    ).toEqual({ kind: 'new-track', insertTrackIndex: 1, startFrame: 20, lineY: 98 });
    // Main drag inside 16px lift hysteresis band stays in horizontal main reorder (C2).
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'main', index: 1 }, clientY: 160, dropFrame: 20, rows, mainRow }),
    ).toEqual({ kind: 'main-track', insertIndex: 0, isReorder: true });
    // Overlay drag in the gap directly above main creates a new track at index 0.
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'overlay', clipId: 'o2', trackIndex: 1 }, clientY: 160, dropFrame: 20, rows, mainRow }),
    ).toEqual({ kind: 'new-track', insertTrackIndex: 0, startFrame: 20, lineY: 160 });
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'main', index: 1 }, clientY: 120, dropFrame: 50, rows, mainRow }),
    ).toEqual({ kind: 'overlay-row', trackIndex: 0, startFrame: 50 });
    // C4 (observed): dropping onto an occupied overlay video span ALWAYS goes to a new track directly ABOVE (never below).
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'main', index: 1 }, clientY: 110, dropFrame: 10, rows, mainRow }),
    ).toEqual({ kind: 'new-track', insertTrackIndex: 1, startFrame: 10, lineY: 102 });
    expect(
      computeDropTarget({ sequence: seq, source: { kind: 'overlay', clipId: 'o2', trackIndex: 1 }, clientY: 150, dropFrame: 10, rows, mainRow }),
    ).toEqual({ kind: 'new-track', insertTrackIndex: 1, startFrame: 10, lineY: 102 });
    const fullSeq: FrameSequence = {
      ...seq,
      overlayTracks: Array.from({ length: MAX_OVERLAY_TRACKS }, (_, i) => ({
        id: `ov-${i + 1}`,
        clips: [{ ...makeClip(`o${i + 1}`, 40), startFrame: 0, link: { clipId: 'm1', sourceFrame: 0 } }],
      })),
    };
    expect(
      computeDropTarget({ sequence: fullSeq, source: { kind: 'main', index: 1 }, clientY: 15, dropFrame: 10, rows, mainRow }),
    ).toEqual({ kind: 'refused', reason: 'track_limit' });
  });

  it('toggles, shortcuts, track move buttons, stacked preview video, and export block notice work end-to-end', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });

    const linkageBtn = view.dom.query('[data-editor-linkage]')!;
    const snapBtn = view.dom.query('[data-editor-snap]')!;
    expect(linkageBtn.getAttribute('aria-pressed')).toBe('true');
    expect(snapBtn.getAttribute('aria-pressed')).toBe('true');

    // Observed §1 / A1: Linkage switch is ON by default, Linkage settings -> Overlay kind is OFF by default and persisted.
    await view.dom.click('[data-editor-linkage-settings]');
    expect(view.dom.query('[data-editor-linkage-popover]')).not.toBeNull();
    const overlayKind = view.dom.query('[data-editor-linkage-kind="overlay"]')!;
    expect(overlayKind.checked).toBe(false);
    await view.act(async () => {
      overlayKind.checked = true;
      overlayKind.dispatchEvent(makeEvent('click', { bubbles: true, cancelable: true }) as never);
    });
    expect(JSON.parse(window.localStorage.getItem(TRACKS_PREFS_KEY) ?? '{}').linkageOverlay).toBe(true);
    await view.dom.click('[data-editor-linkage-settings]');
    expect(view.dom.query('[data-editor-linkage-popover]')).toBeNull();

    await view.fireWindowKey({ code: 'Backquote' });
    expect(linkageBtn.getAttribute('aria-pressed')).toBe('false');
    await view.fireWindowKey({ code: 'Backquote' });
    expect(linkageBtn.getAttribute('aria-pressed')).toBe('true');
    await view.fireWindowKey({ code: 'KeyN' });
    expect(snapBtn.getAttribute('aria-pressed')).toBe('false');
    await view.fireWindowKey({ code: 'KeyN' });
    expect(snapBtn.getAttribute('aria-pressed')).toBe('true');

    const cut2 = view.dom.query('[data-clip-id="c2"]')!;
    await view.firePointer(cut2, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    const moveUpBtn = view.dom.query('[data-editor-move-track-up]')!;
    expect(moveUpBtn).not.toBeNull();
    await view.dom.click(moveUpBtn);

    expect(view.dom.query('[data-overlay-track="0"]')).not.toBeNull();
    expect(view.dom.query('[data-overlay-clip="c2"]')).not.toBeNull();
    // Never uses `data-editor-track` (banned by `real-mode.test.tsx`).
    expect(view.dom.query('[data-editor-track]')).toBeNull();
    // C7: while playhead is at 0 (72 frames away from c2 at frame 72), idle overlay video is not mounted yet.
    expect(view.dom.query('[data-overlay-video="0"]')).toBeNull();
    // Step playhead to cut boundary (frame 72) where c2 sits on overlay track 0 -> stacked <video> mounts transparent & fit (Experiment F).
    await view.fireWindowKey({ code: 'ArrowDown' });
    const overlayVideo = view.dom.query('[data-overlay-video="0"]');
    expect(overlayVideo).not.toBeNull();
    expect(overlayVideo?.getAttribute('crossorigin')).toBeNull();
    expect(overlayVideo?.style.backgroundColor).toBe('transparent');
    expect(overlayVideo?.style.objectFit).toBe('contain');

    await view.dom.click('[data-editor-export]');
    const blockedNote = view.dom.query('[data-editor-export-blocked="overlay-tracks"]');
    expect(blockedNote?.textContent).toBe(studioEditorTracksKo.export.blocked);
    expect(view.dom.query('[data-editor-export-start]')?.hasAttribute('disabled')).toBe(true);
    await view.dom.click('[data-editor-export]');

    const moveDownBtn = view.dom.query('[data-editor-move-track-down]')!;
    expect(moveDownBtn).not.toBeNull();
    await view.dom.click(moveDownBtn);
    expect(view.dom.query('[data-overlay-track="0"]')).toBeNull();
  });

  it('S7 + SMALL: draft lock prevents track edits AND locks linkage/overlay-kind while a chat proposal draft is open', async () => {
    const view = await mountEditor({ tracksOpen: true, withChat: true, clipsCount: 3 });

    // Select c1 (which survives the proposal removing c2) so `moveUpBtn` MUST be present in the inspector (test fails if missing!).
    const cut1 = view.dom.query('[data-clip-id="c1"]')!;
    await view.firePointer(cut1, 'pointerdown', { clientX: 20, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    expect(view.dom.query('[data-editor-move-track-up]')).not.toBeNull();

    await view.dom.setValue('[data-editor-chat-input]', '마지막 컷 지워줘');
    await view.dom.submit('[data-editor-chat="side"] form');
    for (let i = 0; i < 6; i += 1) {
      await view.act(async () => {
        await Promise.resolve();
      });
    }
    expect(view.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();

    const moveUpBtn = view.dom.query('[data-editor-move-track-up]');
    expect(moveUpBtn).not.toBeNull();
    expect(moveUpBtn!.hasAttribute('disabled')).toBe(true);
    await view.dom.click(moveUpBtn!);
    await view.fireWindowKey({ code: 'KeyB', ctrlKey: true, shiftKey: true });
    expect(view.dom.query('[data-overlay-track="0"]')).toBeNull();

    // S7: 연동 switch and 오버레이 kind are locked while the draft is open.
    const linkageBtn = view.dom.query('[data-editor-linkage]')!;
    expect(linkageBtn.getAttribute('aria-pressed')).toBe('true');
    expect(linkageBtn.hasAttribute('disabled')).toBe(true);
    await view.fireWindowKey({ code: 'Backquote' });
    expect(linkageBtn.getAttribute('aria-pressed')).toBe('true');

    await view.dom.click('[data-editor-linkage-settings]');
    const overlayKind = view.dom.query('[data-editor-linkage-kind="overlay"]')!;
    expect(overlayKind.hasAttribute('disabled')).toBe(true);
    expect(overlayKind.checked).toBe(false);
  });

  it('W5 + W6 + W8 + W10 + W11 + S6 + SMALL: popover Esc/outside-click, tooltip, selection, zoom lock, inspector copy, export contents, classic warning, and chat upperOnlyNote', async () => {
    const view = await mountEditor({ tracksOpen: true, withChat: true, clipsCount: 3 });

    // SMALL: linkage tooltip names that nothing is linked when linkage ON + overlay kind OFF.
    const linkageBtn = view.dom.query('[data-editor-linkage]')!;
    expect(linkageBtn.getAttribute('title')).toContain(studioEditorTracksKo.toolbar.linkageNoneActive);

    // W5: 연동 설정 button has accessible name/tooltip, closes on Esc (returning focus) and outside pointerdown.
    const settingsBtn = view.dom.query('[data-editor-linkage-settings]')!;
    expect(settingsBtn.getAttribute('aria-label')).toBe(studioEditorTracksKo.toolbar.linkageSettings);
    expect(settingsBtn.getAttribute('title')).toBe(studioEditorTracksKo.toolbar.linkageSettings);
    let focusedTrigger = false;
    settingsBtn.focus = () => {
      focusedTrigger = true;
    };
    await view.dom.click(settingsBtn);
    expect(view.dom.query('[data-editor-linkage-popover]')).not.toBeNull();
    await view.fireWindowKey({ key: 'Escape', code: 'Escape' });
    expect(view.dom.query('[data-editor-linkage-popover]')).toBeNull();
    expect(focusedTrigger).toBe(true);

    await view.dom.click(settingsBtn);
    expect(view.dom.query('[data-editor-linkage-popover]')).not.toBeNull();
    await view.act(async () => {
      const evt = makeEvent('pointerdown', { bubbles: true, cancelable: true });
      evt.target = view.dom.query('[data-editor-timeline]');
      (document as unknown as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(evt as never);
    });
    expect(view.dom.query('[data-editor-linkage-popover]')).toBeNull();

    // W6: clicking an already-selected clip keeps it selected when tracks switch is open; Alt+X deselects.
    const cut2 = view.dom.query('[data-clip-id="c2"]')!;
    await view.firePointer(cut2, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    expect(view.dom.query('[data-clip-id="c2"]')?.hasAttribute('data-selected')).toBe(true);
    await view.firePointer(view.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    expect(view.dom.query('[data-clip-id="c2"]')?.hasAttribute('data-selected')).toBe(true);
    await view.fireWindowKey({ code: 'KeyX', altKey: true });
    expect(view.dom.query('[data-clip-id="c2"]')?.hasAttribute('data-selected')).toBe(false);

    // Re-select c2 and check W8 (zoom preserved across lift).
    const ppfBeforeLift = view.dom.query('[data-editor-timeline]')?.getAttribute('data-editor-ppf');
    await view.firePointer(view.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    await view.dom.click('[data-editor-move-track-up]');
    const ppfAfterLift = view.dom.query('[data-editor-timeline]')?.getAttribute('data-editor-ppf');
    expect(ppfAfterLift).toBe(ppfBeforeLift);

    // W10: lone clip on top track disables `위 트랙으로`, and `아래 트랙으로` on lowest row has main-insert tooltip.
    expect(view.dom.query('[data-editor-move-track-up]')?.hasAttribute('disabled')).toBe(true);
    expect(view.dom.query('[data-editor-move-track-down]')?.getAttribute('title')).toBe(
      studioEditorTracksKo.actions.moveDownToMainTip,
    );
    // W11: overlay inspector delete button says `클립 지우기`.
    expect(view.dom.query('[data-editor-remove-overlay]')?.textContent).toContain(studioEditorTracksKo.actions.removeClip);
    // SMALL: chat side panel shows `upperOnlyNote` when overlay clips are present.
    expect(view.dom.query('[data-editor-chat-upper-note]')?.textContent).toBe(studioEditorTracksKo.chat.upperOnlyNote);
    // S6: header classic link carries the overlay warning in title & aria-describedby; locked panel shows it too.
    const classicLink = view.dom.query('[data-editor-current]')!;
    expect(classicLink.getAttribute('title')).toContain(studioEditorTracksKo.classic.overlaysNote);
    expect(classicLink.getAttribute('aria-describedby')).toBeTruthy();
    expect(oldEditorLinkTitle(studioEditorKo, false, studioEditorTracksKo.classic.overlaysNote)).toContain(
      studioEditorTracksKo.classic.overlaysNote,
    );

    // W11 + F3: export contents separates owned overlay clips into `[data-editor-contents-owned="overlays"]`
    // while keeping `[data-editor-contents]` exclusively for cuts + old-editor rows.
    await view.dom.click('[data-editor-export]');
    const exportContentsEl = view.dom.query('[data-editor-export-contents]')!;
    expect(exportContentsEl.querySelectorAll('[data-editor-contents]')).toHaveLength(1);
    expect(exportContentsEl.querySelector('[data-editor-contents]')?.getAttribute('data-editor-contents')).toBe('cuts');
    expect(exportContentsEl.querySelector('[data-editor-contents] [data-editor-contents-row="overlays"]')).toBeNull();
    expect(exportContentsEl.querySelector('[data-editor-contents-owned="overlays"] [data-editor-contents-row="overlays"]')?.textContent).toBe('오버레이 트랙 클립 1개');
    await view.dom.click('[data-editor-export]');

    // W10: lifting a second cut c3 onto track 0 (now 2 clips on track 0) enables `위 트랙으로` to create track 1!
    await view.firePointer(view.dom.query('[data-clip-id="c3"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    await view.dom.click('[data-editor-move-track-up]');
    const upOnTwoClipRow = view.dom.query('[data-editor-move-track-up]')!;
    expect(upOnTwoClipRow.hasAttribute('disabled')).toBe(false);
    await view.dom.click(upOnTwoClipRow);
    expect(view.dom.query('[data-overlay-track="1"]')).not.toBeNull();

    // W7: overlay clips draw filmstrip `<i class="...tile..." />` elements using the same thumbnail pipeline as main cuts.
    const ovClipEl = view.dom.query('[data-overlay-clip="c3"]')!;
    expect(ovClipEl.querySelectorAll('i').length).toBeGreaterThan(0);

    // Closed switch preserves toggle-off on clicking already-selected clip (W6 closed parity).
    await view.dom.unmount();
    dom = null;
    const closedView = await mountEditor({ tracksOpen: false, clipsCount: 2 });
    const c1 = closedView.dom.query('[data-clip-id="c1"]')!;
    await closedView.firePointer(c1, 'pointerdown', { clientX: 20, clientY: 120 });
    await closedView.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    expect(closedView.dom.query('[data-clip-id="c1"]')?.hasAttribute('data-selected')).toBe(true);
    await closedView.firePointer(closedView.dom.query('[data-clip-id="c1"]')!, 'pointerdown', { clientX: 20, clientY: 120 });
    await closedView.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    expect(closedView.dom.query('[data-clip-id="c1"]')?.hasAttribute('data-selected')).toBe(false);
  });

  it('S3 + W2 + W3 + W4: live main reorder reflow, clip ghost under pointer, below-main refusal, and cancel/blur drag cleanup', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });

    const content = view.dom.query('[data-editor-ruler]')!.parentElement!;
    const scrollBox = content.parentElement!;
    const mainLane = content.querySelector('[data-lane="video"]')!;
    scrollBox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    mainLane.getBoundingClientRect = () => ({ left: 0, top: 120, right: 960, bottom: 184, width: 960, height: 64 });
    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };

    // W2: reordering c1 past c2's closed midpoint shifts c2 LIVE to left=0px BEFORE pointerup.
    const cut1 = view.dom.query('[data-clip-id="c1"]')!;
    const cut2BeforeLeft = view.dom.query('[data-clip-id="c2"]')!.style.left;
    expect(cut2BeforeLeft).not.toBe('0px');
    await view.firePointer(cut1, 'pointerdown', { clientX: 50, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 400, clientY: 150 });
    expect(Number.parseFloat(view.dom.query('[data-clip-id="c2"]')!.style.left ?? '')).toBe(0);
    // S3: pointercancel aborts cleanly without committing and clears dragging state.
    await view.firePointer(win, 'pointercancel');
    expect(view.dom.query('[data-overlay-new-zone]')).toBeNull();
    expect(view.dom.query('[data-clip-id="c2"]')!.style.left).toBe(cut2BeforeLeft);

    // W3: lifting c2 above main lane renders `[data-overlay-drag-ghost="c2"]` with label.
    await view.firePointer(view.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 340, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 340, clientY: 60 });
    const ghost = view.dom.query('[data-overlay-drag-ghost="c2"]');
    expect(ghost).not.toBeNull();
    expect(ghost?.textContent).toContain('Cut 2');
    // S3: window blur aborts cleanly without committing.
    await view.act(async () => {
      win.dispatchEvent(makeEvent('blur'));
    });
    expect(view.dom.query('[data-overlay-drag-ghost="c2"]')).toBeNull();
    expect(view.dom.query('[data-overlay-track="0"]')).toBeNull();

    // W4: dragging below mainRow.bottom (caption lane y=230) is refused, changes nothing, and shows refusal toast.
    await view.firePointer(view.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 340, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 340, clientY: 230 });
    await view.firePointer(win, 'pointerup');
    expect(view.dom.query('[data-overlay-track="0"]')).toBeNull();
    expect(view.dom.query('[data-editor-toast]')?.textContent).toBe(studioEditorTracksKo.toast.cannotDropBelowMain);
  });

  it('S4: Preview overlay rate-scaled drift, frame-keyed settle, refused play() muted retry + unmute button, and video resource release', async () => {
    expect(overlayDriftLimitSec(1)).toBeCloseTo(OVERLAY_PLAY_DRIFT_SEC, 6);
    expect(overlayDriftLimitSec(2)).toBeCloseTo(OVERLAY_PLAY_DRIFT_SEC * 2, 6);
    expect(overlayDriftLimitSec(4)).toBeCloseTo(OVERLAY_PLAY_DRIFT_SEC * 4, 6);
    expect(overlaySettleKey('a.mp4', 1.0)).not.toBe(overlaySettleKey('a.mp4', 1.0417));
    expect(overlaySettleKey('a.mp4', 1.0)).not.toBe(overlaySettleKey('b.mp4', 1.0));

    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });
    // Lift c1 onto track 0 at frame 0 so it is active immediately at playhead 0.
    await view.firePointer(view.dom.query('[data-clip-id="c1"]')!, 'pointerdown', { clientX: 20, clientY: 120 });
    await view.firePointer(window as unknown as { dispatchEvent: (e: unknown) => boolean }, 'pointerup');
    await view.dom.click('[data-editor-move-track-up]');

    const ovVideo = view.dom.query('[data-overlay-video="0"]') as unknown as {
      paused: boolean;
      muted: boolean;
      play: () => Promise<void>;
      pause: () => void;
      load: () => void;
      removeAttribute: (name: string) => void;
      getAttribute: (name: string) => string | null;
    };
    expect(ovVideo).not.toBeNull();
    let playAttempts = 0;
    let loadCalls = 0;
    let removedSrc = false;
    ovVideo.paused = true;
    ovVideo.pause = () => {
      ovVideo.paused = true;
    };
    ovVideo.load = () => {
      loadCalls += 1;
    };
    const origRemoveAttr = ovVideo.removeAttribute.bind(ovVideo);
    ovVideo.removeAttribute = (name: string) => {
      if (name === 'src') removedSrc = true;
      origRemoveAttr(name);
    };
    ovVideo.play = () => {
      playAttempts += 1;
      if (playAttempts === 1) return Promise.reject(new Error('NotAllowedError'));
      ovVideo.paused = false;
      return Promise.resolve();
    };

    // Start playback -> first play() rejects -> muted retry runs and `소리 켜기` affordance appears.
    await view.fireWindowKey({ code: 'Space' });
    for (let i = 0; i < 4; i += 1) {
      await view.act(async () => {
        await Promise.resolve();
      });
    }
    expect(playAttempts).toBeGreaterThanOrEqual(2);
    expect(ovVideo.muted).toBe(true);
    const unmuteBtn = view.dom.query('[data-editor-overlay-unmute]');
    expect(unmuteBtn).not.toBeNull();
    expect(unmuteBtn?.textContent).toBe(studioEditorTracksKo.preview.unmuteOverlay);

    // Clicking `소리 켜기` unmutes and hides the button.
    await view.dom.click(unmuteBtn!);
    expect(view.dom.query('[data-editor-overlay-unmute]')).toBeNull();

    // Unmounting releases `<video>` resources (`removeAttribute('src')` + `load()`).
    await view.dom.unmount();
    dom = null;
    expect(removedSrc).toBe(true);
    expect(loadCalls).toBeGreaterThan(0);
  });

  it('W1 + W12: old editor disables render and warns when film has v2 overlays, stays byte-identical without them; chat CSS prevents intro overlap', async () => {
    const { VideoComposer } = await import('@/components/brand-studio/compose/video-composer');
    const dict = getDictionary('ko');
    const plainProject: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: [
        {
          id: 'c1',
          label: 'Cut 1',
          sourceKind: 'asset',
          assetId: 'a1',
          srcUrl: '/a1.mp4',
          thumbUrl: null,
          durationSec: 5,
          trimStartSec: 0,
          trimEndSec: 5,
          volume: 1,
          muted: false,
        },
      ],
    };
    const commonProps = {
      organizationId: ORG,
      locale: 'ko' as const,
      canCreate: true,
      copy: dict.studioCompose,
      videoStudioHref: '/brand/studio/video',
      initialAllowance: {
        capKrw: 100000,
        spentKrw: 0,
        remainingKrw: 100000,
        cycleStart: '2026-11-01',
        cycleEnd: '2026-12-01',
        planKey: 'growth',
        status: 'active',
      } as never,
      initialAssets: [],
      initialVideoOutputs: [],
    };
    const plainHtml = renderToStaticMarkup(h(VideoComposer, { ...commonProps, initialProject: plainProject }));
    expect(plainHtml).not.toContain('data-compose-v2-overlays-blocked');
    expect(plainHtml).not.toContain('data-compose-clips-v2-overlays-notice');
    // W1: stored-hash parity for VideoComposer on a film without v2 overlay blocks (byte-identical to pre-guard markup).
    expect({ sha256: sha256(plainHtml), length: plainHtml.length }).toEqual({
      sha256: 'c80663805befb8bc1efe91c649f9f86a4d79848de1b97db824995ad43fe712b2',
      length: 7101,
    });

    const projectWithV2Overlays: ComposerProject = {
      ...plainProject,
      overlays: [
        {
          id: 'ov-v2',
          label: 'Upper Cut',
          sourceKind: 'asset',
          assetId: 'a2',
          srcUrl: '/a2.mp4',
          mediaKind: 'video',
          startSec: 0,
          endSec: 3,
          x: 0.5,
          y: 0.5,
          scale: 1,
          opacity: 1,
          frameV2: {
            fps: 24,
            trackIndex: 0,
            trackId: 'ov-1',
            startFrame: 0,
            link: { clipId: 'c1', sourceFrame: 0 },
            inFrame: 0,
            phase: 0,
            frames: 72,
            speedNum: 1,
            speedDen: 1,
            sourceFps: 24,
            sourceFrames: 120,
            srcUrl: '/a2.mp4',
            durationSec: 5,
            volume: 1,
            muted: false,
            mirror: { startSec: 0, endSec: 3 },
          },
        } as ComposerProject['overlays'] extends Array<infer T> ? T : never,
      ],
    };
    const blockedHtml = renderToStaticMarkup(h(VideoComposer, { ...commonProps, initialProject: projectWithV2Overlays }));
    expect(blockedHtml).toContain('data-compose-v2-overlays-blocked');
    // W3: notice appears ONCE (next to render controls), NOT duplicated above the cut list.
    expect(blockedHtml).not.toContain('data-compose-clips-v2-overlays-notice');
    expect(blockedHtml.split(studioEditorTracksKo.classic.renderBlocked).length - 1).toBe(3); // 1 status text + 2 disabled button titles (MP4 + NLE)
    expect(blockedHtml).toMatch(/disabled=""[^>]*data-compose-export="true"|data-compose-export="true"[^>]*disabled=""/);
    expect(blockedHtml).toMatch(/disabled=""[^>]*data-compose-export-nle="true"|data-compose-export-nle="true"[^>]*disabled=""/);

    // W12: chat panel CSS prevents intro text from hiding behind playhead chips at 1280 when timeline is taller.
    const css = readFileSync(join(ROOT, 'components/brand-studio/editor-v2/editor-v2.module.css'), 'utf8');
    expect(css).toMatch(/\.chatSide\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.chatEmpty\s*\{[^}]*flex:\s*1 0 auto[^}]*min-height:\s*min-content/);
    expect(css).toMatch(/\.chatChips\s*\{[^}]*flex:\s*none[^}]*z-index:\s*1/);
  });

  it('DOM pointer drag renders horizontal drop line ONLY for new track, ghost ONLY in existing row, and vertical snap guide', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });

    const content = view.dom.query('[data-editor-ruler]')!.parentElement!;
    const scrollBox = content.parentElement!;
    const mainLane = content.querySelector('[data-lane="video"]')!;
    scrollBox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    mainLane.getBoundingClientRect = () => ({ left: 0, top: 120, right: 960, bottom: 184, width: 960, height: 64 });

    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };
    const cut2 = view.dom.query('[data-clip-id="c2"]')!;
    // c2 starts at frame 72 (~320px); grabbing at clientX=340 gives a ~20px grab offset.
    await view.firePointer(cut2, 'pointerdown', { clientX: 340, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 340, clientY: 60 });
    expect(view.dom.query('[data-overlay-drop-line]')).not.toBeNull();
    expect(view.dom.query('[data-overlay-ghost]')).toBeNull();

    // Drag left so rawStart sits at 0 (<= 2px engage threshold, D5) -> vertical snap guide appears.
    await view.firePointer(win, 'pointermove', { clientX: 20, clientY: 60 });
    expect(view.dom.query('[data-snap-guide]')).not.toBeNull();

    // Holding Shift does NOT suspend snapping (D6); the N switch is the control.
    await view.firePointer(win, 'pointermove', { clientX: 20, clientY: 60, shiftKey: true });
    expect(view.dom.query('[data-snap-guide]')).not.toBeNull();

    // Hysteresis release (D5): dragging past 6px (> 6px from time 0, e.g. clientX=42 -> ~22px) releases snap guide.
    await view.firePointer(win, 'pointermove', { clientX: 42, clientY: 60 });
    expect(view.dom.query('[data-snap-guide]')).toBeNull();
    await view.firePointer(win, 'pointerup');

    const ovRow = view.dom.query('[data-overlay-track="0"]')!;
    expect(ovRow).not.toBeNull();
    ovRow.getBoundingClientRect = () => ({ left: 0, top: 60, right: 960, bottom: 114, width: 960, height: 54 });
    const ovClip = view.dom.query('[data-overlay-clip="c2"]')!;
    await view.firePointer(ovClip, 'pointerdown', { clientX: 20, clientY: 85 });
    await view.firePointer(win, 'pointermove', { clientX: 140, clientY: 85 });
    expect(view.dom.query('[data-overlay-ghost="0"]')).not.toBeNull();
    expect(view.dom.query('[data-overlay-drop-line]')).toBeNull();
    await view.firePointer(win, 'pointerup');
  });

  it('W2 + S5c: 36 s film opens fitted to timeline width (not 100 px/s) for both closed and open switches, and keeps zoom only after track ops when open', async () => {
    // 8 cuts * 108 frames = 864 frames = 36 s at 24 fps (each cut <= mock sourceFrames=120);
    // at 960 px width fitPpf = (960 - 40) / 864 ≈ 1.065 px/frame (~25.6 px/s), NOT 100 px/s (~4.17 px/frame)!
    const make36sProject = (): ComposerProject => ({
      ...emptyComposerProject('9:16'),
      clips: Array.from({ length: 8 }, (_, idx) => ({
        id: `c${idx + 1}`,
        label: `Cut ${idx + 1}`,
        sourceKind: 'asset' as const,
        assetId: `a${idx + 1}`,
        srcUrl: `https://media.example.invalid/c${idx + 1}.mp4`,
        thumbUrl: `https://media.example.invalid/c${idx + 1}.jpg`,
        durationSec: 5,
        trimStartSec: 0,
        trimEndSec: 4.5,
        volume: 1,
        muted: false,
      })),
    });

    for (const tracksOpen of [false, true]) {
      const storageMap = new Map<string, string>();
      storageMap.set(composeStorageKey(ORG), serializeProjectForStorage(make36sProject()));
      const view = await mountEditor({ tracksOpen, clipsCount: 3 });
      await view.dom.unmount();
      dom = null;

      const { mountDom } = await import('@/tests/brands/_dom-harness');
      const { act } = await import('react');
      const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, val: string) => { storageMap.set(key, val); },
        removeItem: (key: string) => { storageMap.delete(key); },
        clear: () => storageMap.clear(),
      });
      dom = await mountDom(null);
      await dom.rerender(
        h(EditorV2, {
          copy: studioEditorKo,
          currentEditorHref: '/brand/studio/compose?classic=1',
          real: REAL_PROPS,
          ...(tracksOpen ? { tracksOpen: true, tracksCopy: studioEditorTracksKo } : {}),
        }),
      );
      for (let i = 0; i < 6; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }
      const ppf = Number(dom.query('[data-editor-timeline]')?.getAttribute('data-editor-ppf') ?? '0');
      expect(ppf, `tracksOpen=${tracksOpen}`).toBeGreaterThan(0.9);
      expect(ppf, `tracksOpen=${tracksOpen}`).toBeLessThan(1.3);
      await dom.unmount();
      dom = null;
    }
  });

  it('S4 + W4 + SMALL(lostpointercapture): main reorder stays reorder 8px below main, lift ghost draws dimmed first thumbnail, and lostpointercapture cleans up drag', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3, withThumbs: true });
    const content = view.dom.query('[data-editor-ruler]')!.parentElement!;
    const mainLane = content.querySelector('[data-lane="video"]')!;
    content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    mainLane.getBoundingClientRect = () => ({ left: 0, top: 120, right: 960, bottom: 184, width: 960, height: 64 });
    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };

    // S4: drag main cut c1 slightly below mainRow.bottom (184 + 8 = 192 <= 184 + 16) -> stays reorder, NOT refused!
    const cut1 = view.dom.query('[data-clip-id="c1"]')!;
    await view.firePointer(cut1, 'pointerdown', { clientX: 40, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 600, clientY: 192 });
    // Main cut stays visible on main track (no lift ghost!)
    expect(view.dom.query('[data-overlay-drag-ghost]')).toBeNull();
    expect(view.dom.query('[data-clip-id="c1"]')).not.toBeNull();
    await view.firePointer(win, 'pointerup');
    // Reorder committed: c1 moved after c2/c3!
    const orderAfter = view.dom.queryAll('[data-editor-clip]').map((n) => n.getAttribute('data-clip-id'));
    expect(orderAfter[orderAfter.length - 1]).toBe('c1');

    // W4: lift c2 above main -> ghost renders dimmed first thumbnail (`data-overlay-drag-ghost-thumb`)!
    const cut2 = view.dom.query('[data-clip-id="c2"]')!;
    await view.firePointer(cut2, 'pointerdown', { clientX: 80, clientY: 150 });
    await view.firePointer(win, 'pointermove', { clientX: 80, clientY: 50 });
    const ghost = view.dom.query('[data-overlay-drag-ghost="c2"]');
    expect(ghost).not.toBeNull();
    expect(ghost?.hasAttribute('data-has-thumb')).toBe(true);
    expect(view.dom.query('[data-overlay-drag-ghost-thumb]')).not.toBeNull();

    // SMALL: lostpointercapture with buttons === 0 cleanly cancels/ends drag without leaving ghost stuck!
    await view.firePointer(cut2, 'lostpointercapture', { buttons: 0 });
    expect(view.dom.query('[data-overlay-drag-ghost]')).toBeNull();
  });

  it('Round 3 regression: dragging a main cut RIGHT and LEFT survives lostpointercapture(buttons=1) during live reflow, while Esc and pointercancel cancel cleanly', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });
    const content = view.dom.query('[data-editor-ruler]')!.parentElement!;
    const mainLane = content.querySelector('[data-lane="video"]')!;
    content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    mainLane.getBoundingClientRect = () => ({ left: 0, top: 120, right: 960, bottom: 184, width: 960, height: 64 });
    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };

    // 1) Drag cut 1 RIGHT across live reflow (past cut 2's closed-up midpoint ~153px, before cut 3's ~460px):
    // Chromium fires `lostpointercapture` with `buttons: 1` when React re-orders the DOM node;
    // drag MUST survive and commit the rightward reorder on pointerup!
    const cut1 = view.dom.query('[data-clip-id="c1"]')!;
    await view.firePointer(cut1, 'pointerdown', { clientX: 60, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 220, clientY: 150, buttons: 1 });
    await view.firePointer(cut1, 'lostpointercapture', { buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 260, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointerup', { clientX: 260, clientY: 150, buttons: 0 });
    expect(view.dom.queryAll('[data-editor-clip]').map((n) => n.getAttribute('data-clip-id'))).toEqual(['c2', 'c1', 'c3']);

    // 2) Drag cut 3 LEFT across live reflow with `lostpointercapture(buttons=1)` -> commits leftward reorder!
    const cut3 = view.dom.query('[data-clip-id="c3"]')!;
    await view.firePointer(cut3, 'pointerdown', { clientX: 780, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 40, clientY: 150, buttons: 1 });
    await view.firePointer(cut3, 'lostpointercapture', { buttons: 1 });
    await view.firePointer(win, 'pointerup', { clientX: 40, clientY: 150, buttons: 0 });
    expect(view.dom.queryAll('[data-editor-clip]').map((n) => n.getAttribute('data-clip-id'))).toEqual(['c3', 'c2', 'c1']);

    // 3) Real cancel via Escape: cut stays in place!
    const cut3Again = view.dom.query('[data-clip-id="c3"]')!;
    await view.firePointer(cut3Again, 'pointerdown', { clientX: 60, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 520, clientY: 150, buttons: 1 });
    await view.fireWindowKey({ key: 'Escape', code: 'Escape' });
    await view.firePointer(win, 'pointerup', { clientX: 520, clientY: 150, buttons: 0 });
    expect(view.dom.queryAll('[data-editor-clip]').map((n) => n.getAttribute('data-clip-id'))).toEqual(['c3', 'c2', 'c1']);

    // 4) Real cancel via pointercancel: cut stays in place!
    await view.firePointer(cut3Again, 'pointerdown', { clientX: 60, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 520, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointercancel');
    await view.firePointer(win, 'pointerup', { clientX: 520, clientY: 150, buttons: 0 });
    expect(view.dom.queryAll('[data-editor-clip]').map((n) => n.getAttribute('data-clip-id'))).toEqual(['c3', 'c2', 'c1']);
  });

  it('S3: Preview overlay muted retry remembers refusal across playhead ticks until user clicks 소리 켜기', async () => {
    const { Preview } = await import('@/components/brand-studio/editor-v2/preview');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    const { realDoc } = await import('@/lib/brand-studio/editor-v2/real');
    const { DEFAULT_SHORTCUT_PREFS, effectiveBindings } = await import('@/lib/brand-studio/editor-v2/shortcuts');

    const seq: FrameSequence = {
      fps: 24,
      aspect: '9:16',
      clips: [makeClip('m1', 120)],
      captions: [],
      overlayTracks: [
        {
          id: 'ov-1',
          clips: [{ ...makeClip('ov1', 80), startFrame: 0, link: { clipId: 'm1', sourceFrame: 0 } }],
        },
      ],
    };

    const playCalls: Array<{ muted: boolean }> = [];
    let rejectWithSound = true;
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    dom = await mountDom(null);
    const fakeEl = Object.getPrototypeOf(dom.document.createElement('video')) as Record<string, unknown>;
    if (!('dataset' in fakeEl)) {
      Object.defineProperty(fakeEl, 'dataset', {
        configurable: true,
        get(this: { attributes: Record<string, string> }) {
          const attributes = this.attributes;
          const name = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
          return new Proxy(
            {},
            {
              get: (_t, key) => attributes[name(String(key))],
              set: (_t, key, value) => ((attributes[name(String(key))] = String(value)), true),
              deleteProperty: (_t, key) => {
                delete attributes[name(String(key))];
                return true;
              },
            },
          );
        },
      });
    }
    if (!('pause' in fakeEl)) fakeEl.pause = () => undefined;
    if (!('load' in fakeEl)) fakeEl.load = () => undefined;
    const makeApi = (playhead: number, rate: number) => ({
      copy: studioEditorKo,
      doc: realDoc(seq),
      sequence: seq,
      frame: { frame: playhead, active: { clip: seq.clips[0]!, index: 0, offset: playhead, start: 0, mediaFrame: playhead, sourceFrame: playhead, seekSec: (playhead + 0.5) / 24 }, captions: [] },
      activeClip: { clip: seq.clips[0]!, index: 0, offset: playhead, start: 0, mediaFrame: playhead, sourceFrame: playhead, seekSec: (playhead + 0.5) / 24 },
      rate,
      workspace: 'cut',
      fps: 24,
      playhead,
      real: true,
      missingSources: {},
      filmView: null,
      storedFilm: null,
      seek: () => undefined,
      setRate: () => undefined,
      compare: false,
      shortcutMap: effectiveBindings(DEFAULT_SHORTCUT_PREFS),
      mac: false,
      tracksOpen: true,
      tracksCopy: studioEditorTracksKo,
      playing: rate !== 0,
      playheadSec: playhead / 24,
      durationSec: 120 / 24,
      total: 120,
      lastFrame: 119,
      tentative: false,
      setPlaying: () => undefined,
      step: () => undefined,
      toCut: () => undefined,
      shuttle: () => undefined,
      splitAtPlayhead: () => undefined,
      splitAllAtPlayhead: () => undefined,
      readOnly: false,
      setCompare: () => undefined,
    });

    // Mount paused first so we can instrument the overlay `<video>` element cleanly.
    await dom.rerender(h(Preview, { api: makeApi(0, 0) as never }));
    const ovVideo = dom.query('[data-overlay-video="0"]') as unknown as Record<string, unknown>;
    expect(ovVideo).not.toBeNull();
    let mutedVal = true;
    let pausedVal = true;
    let volumeVal = 1;
    Object.defineProperty(ovVideo, 'muted', { get: () => mutedVal, set: (v: boolean) => { mutedVal = v; } });
    Object.defineProperty(ovVideo, 'paused', { get: () => pausedVal, set: (v: boolean) => { pausedVal = v; } });
    Object.defineProperty(ovVideo, 'volume', { get: () => volumeVal, set: (v: number) => { volumeVal = v; } });
    ovVideo.readyState = 4;
    ovVideo.currentTime = 0;
    ovVideo.seeking = false;
    ovVideo.playbackRate = 1;
    ovVideo.pause = () => { pausedVal = true; };
    ovVideo.load = () => undefined;
    ovVideo.play = () => {
      playCalls.push({ muted: mutedVal });
      if (rejectWithSound && !mutedVal) {
        return Promise.reject(Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' }));
      }
      pausedVal = false;
      return Promise.resolve();
    };
    const mainVideo = dom.queryAll('video').find((v) => !v.hasAttribute('data-overlay-video')) as unknown as Record<string, unknown>;
    mainVideo.play = () => Promise.resolve();
    mainVideo.pause = () => undefined;

    // Start playing -> first play() unmuted rejects -> retries muted -> sets soundRefused & shows 소리 켜기!
    await dom.rerender(h(Preview, { api: makeApi(1, 1) as never }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(playCalls).toEqual([{ muted: false }, { muted: true }]);
    expect(mutedVal).toBe(true);
    expect(dom.query('[data-editor-overlay-unmute]')).not.toBeNull();

    // Advance playhead several ticks -> overlay MUST stay muted (NO unmute retry loop!).
    await dom.rerender(h(Preview, { api: makeApi(5, 1) as never }));
    await dom.rerender(h(Preview, { api: makeApi(10, 1) as never }));
    await dom.rerender(h(Preview, { api: makeApi(15, 1) as never }));
    expect(mutedVal).toBe(true);
    expect(playCalls).toHaveLength(2);

    // Clicking "소리 켜기" unmutes & calls play() synchronously inside the click gesture!
    rejectWithSound = false;
    await dom.click('[data-editor-overlay-unmute]');
    expect(mutedVal).toBe(false);
    expect(playCalls.at(-1)).toEqual({ muted: false });
    expect(dom.query('[data-editor-overlay-unmute]')).toBeNull();
  });

  it('SMALL(B1 + commitChatEdit): commitChatEdit runs mutate ONCE and moves linked overlays ONCE', async () => {
    const { useEditor } = await import('@/components/brand-studio/editor-v2/use-editor');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    const { applyResolvedStepsToSequence } = await import('@/lib/brand-studio/editor-v2/assist-apply');

    // Seed 2 cuts A (48f) and B (72f) with linked overlay ovB on B at frame 60, linkage + overlay kind ON.
    const baseProj: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: [
        { id: 'A', label: 'A', sourceKind: 'asset', assetId: 'a1', srcUrl: 'https://media.example.invalid/a.mp4', thumbUrl: null, durationSec: 2, trimStartSec: 0, trimEndSec: 2, volume: 1, muted: false },
        { id: 'B', label: 'B', sourceKind: 'asset', assetId: 'a2', srcUrl: 'https://media.example.invalid/b.mp4', thumbUrl: null, durationSec: 3, trimStartSec: 0, trimEndSec: 3, volume: 1, muted: false },
      ],
      overlays: [
        {
          id: 'ovB',
          label: 'ovB',
          sourceKind: 'asset',
          assetId: 'a3',
          srcUrl: 'https://media.example.invalid/ov.mp4',
          mediaKind: 'video',
          startSec: 2.5,
          endSec: 3.5,
          x: 0.5,
          y: 0.5,
          scale: 1,
          opacity: 1,
          frameV2: {
            fps: 24,
            trackIndex: 0,
            trackId: 'ov-1',
            startFrame: 60,
            link: { clipId: 'B', sourceFrame: 12 },
            inFrame: 0,
            phase: 0,
            frames: 24,
            speedNum: 1,
            speedDen: 1,
            sourceFps: 24,
            sourceFrames: 120,
            srcUrl: 'https://media.example.invalid/ov.mp4',
            durationSec: 5,
            volume: 1,
            muted: false,
            mirror: { startSec: 2.5, endSec: 3.5 },
          },
        } as ComposerProject['overlays'] extends Array<infer T> ? T : never,
      ],
    };
    const storageMap = new Map<string, string>([
      [composeStorageKey(ORG), serializeProjectForStorage(baseProj)],
      ['twings_editor_tracks_prefs_v1', JSON.stringify({ linkage: true, linkageOverlay: true, snap: true })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, val: string) => { storageMap.set(key, val); },
      removeItem: (key: string) => { storageMap.delete(key); },
      clear: () => storageMap.clear(),
    });
    let latestApi: ReturnType<typeof useEditor> | null = null;
    function Harness() {
      latestApi = useEditor(studioEditorKo, { real: REAL_PROPS, tracksOpen: true, tracksCopy: studioEditorTracksKo });
      return null;
    }
    dom = await mountDom(h(Harness));
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(latestApi!.sequence.clips.map((c) => c.id)).toEqual(['A', 'B']);
    expect(latestApi!.effectiveOverlayLinkage).toBe(true);
    const mapped = applyResolvedStepsToSequence(latestApi!.sequence, [{ do: 'remove', clip: { clipId: 'A' } }], { linkage: true });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;

    let mutateCalls = 0;
    const holder: { committed: FrameSequence | null } = { committed: null };
    await act(async () => {
      holder.committed = latestApi!.commitChatEdit(() => {
        mutateCalls += 1;
        return mapped.sequence;
      }, mapped.inherit);
    });
    // mutate ran STRICTLY ONCE on the normal path, and ovB moved ONCE from 60 -> 12 (never doubled to 0!).
    expect(mutateCalls).toBe(1);
    expect(holder.committed?.overlayTracks?.[0]?.clips[0]?.startFrame).toBe(12);
    expect(latestApi!.sequence.overlayTracks?.[0]?.clips[0]?.startFrame).toBe(12);

    // S1: when another edit is queued in React state right before `commitChatEdit` (not yet rendered to `docRef.current`),
    // `commitChatEdit` MUST rebuild from `current.doc` instead of overwriting the queued edit!
    await act(async () => {
      latestApi!.setAspect('16:9');
      latestApi!.commitChatEdit((seq) => ({ ...seq, clips: seq.clips.map((c) => ({ ...c, muted: true })) }));
    });
    expect(latestApi!.sequence.aspect).toBe('16:9');
    expect(latestApi!.sequence.clips[0]?.muted).toBe(true);
  });

  it('Round 4 Fault #2 + Round 5 R1–R3 + Round 6 F1/F3: 영상 전체 and ExportSheet separate owned overlays under data-editor-contents-owned, keep legacy image overlays under contents.note, and pin closed HTML to origin/main a2b36540', async () => {
    const { ActionPanel } = await import('@/components/brand-studio/editor-v2/panels');
    const { fromStored, storedFilmView } = await import('@/lib/brand-studio/editor-v2/stored');
    const { spansOf } = await import('@/lib/brand-studio/editor-v2/frames');

    // F1: Pinned literal `StoredContents` HTML derived by hand from `origin/main` commit `a2b36540`
    // (`panels.tsx` StoredContents + Section, `film-contents-list.tsx`, `film-contents.ts`, `messages/studio-editor.ts`).
    // Never constructed from this branch's own `FilmContentsList` or `filmContents`:
    //   (i)   captions (1) + music ('Morning Walk')
    //   (ii)  legacy image overlay only (no frameV2)
    //   (iii-a) owned video overlay in storage alone with tracksOpen: false (absent / '')
    //   (iii-b) owned video overlay + captions + music + legacy image overlay with tracksOpen: false
    const MAIN_A2B36540_STORED_CONTENTS = {
      capsMusic: {
        html: '<section class="_section_a87255"><h3>이 영상에 들어 있는 것</h3><div data-editor-film-contents="true"><ul class="_filmContents_a87255" data-editor-contents="captions music"><li data-editor-contents-row="captions">자막 1개</li><li data-editor-contents-row="music" data-quiet="">음악: Morning Walk · 이 미리 보기에서는 들리지 않습니다</li></ul><p class="_note_a87255">예전 편집기에서 넣은 것입니다. 내보낸 파일에 들어갑니다.</p></div></section>',
        sha256: 'dd0bd41135a034ef94f121df9843978ffa216eb723d5a8f9d7524438a2a0777c',
        length: 389,
      },
      legacyImg: {
        html: '<section class="_section_a87255"><h3>이 영상에 들어 있는 것</h3><div data-editor-film-contents="true"><ul class="_filmContents_a87255" data-editor-contents="stills"><li data-editor-contents-row="stills">화면 위 이미지 1개</li></ul><p class="_note_a87255">예전 편집기에서 넣은 것입니다. 내보낸 파일에 들어갑니다.</p></div></section>',
        sha256: 'b664a45932d0078de5e9295e6123698cea6d0532b02b0f803cd8b02bd2e01edc',
        length: 291,
      },
      ownedOnly: {
        html: '',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        length: 0,
      },
      mixed: {
        html: '<section class="_section_a87255"><h3>이 영상에 들어 있는 것</h3><div data-editor-film-contents="true"><ul class="_filmContents_a87255" data-editor-contents="captions music stills"><li data-editor-contents-row="captions">자막 1개</li><li data-editor-contents-row="music" data-quiet="">음악: Morning Walk · 이 미리 보기에서는 들리지 않습니다</li><li data-editor-contents-row="stills">화면 위 이미지 1개</li></ul><p class="_note_a87255">예전 편집기에서 넣은 것입니다. 내보낸 파일에 들어갑니다.</p></div></section>',
        sha256: 'dfd1c5263908ad5f3c9d01d30c02689236c20e6819d8485551830626ba9456be',
        length: 450,
      },
    } as const;

    const measured = {
      'https://media.example.invalid/c1.mp4': { fps: 24, frames: 120 },
      'https://media.example.invalid/c2.mp4': { fps: 24, frames: 120 },
    };
    const baseClips = [
      { id: 'c1', label: 'Cut 1', sourceKind: 'asset' as const, assetId: 'a1', srcUrl: 'https://media.example.invalid/c1.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
      { id: 'c2', label: 'Cut 2', sourceKind: 'asset' as const, assetId: 'a2', srcUrl: 'https://media.example.invalid/c2.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
    ];
    const legacyImageOverlay = {
      id: 'img1',
      label: 'Brand Logo',
      sourceKind: 'asset' as const,
      assetId: 'img-a1',
      srcUrl: 'https://media.example.invalid/logo.png',
      mediaKind: 'image' as const,
      startSec: 0,
      endSec: 3,
      x: 0.5,
      y: 0.5,
      scale: 0.3,
      opacity: 1,
    };
    const ownedVideoOverlay = {
      id: 'ov1',
      label: 'Overlay 1',
      sourceKind: 'asset' as const,
      assetId: 'a3',
      srcUrl: 'https://media.example.invalid/ov1.mp4',
      mediaKind: 'video' as const,
      startSec: 0,
      endSec: 2,
      x: 0.5,
      y: 0.5,
      scale: 1,
      opacity: 1,
      frameV2: {
        fps: 24,
        trackIndex: 0,
        trackId: 'ov-1',
        startFrame: 0,
        link: { clipId: 'c1', sourceFrame: 0 },
        inFrame: 0,
        phase: 0,
        frames: 48,
        speedNum: 1,
        speedDen: 1,
        sourceFps: 24,
        sourceFrames: 120,
        srcUrl: 'https://media.example.invalid/ov1.mp4',
        durationSec: 5,
        volume: 1,
        muted: false,
        mirror: { startSec: 0, endSec: 2 },
      },
    } as ComposerProject['overlays'] extends Array<infer T> ? T : never;

    const renderClosedFilmPanel = (project: ComposerProject) => {
      const loaded = fromStored(project, measured, { loadOverlays: false });
      const view = storedFilmView(loaded.sequence, project, { writeOverlays: false });
      const seq = view.sequence;
      const closedApi = {
        copy: studioEditorKo,
        real: true,
        locked: false,
        readOnly: false,
        workspace: 'cut' as const,
        selection: [] as string[],
        selectedTitleId: null,
        doc: { sequence: seq, titles: [], looks: {}, reframe: {}, sound: { speechClear: false, duck: false, loudness: false, fades: false, musicVolume: 1 }, captionSettings: { output: 'burn', styleId: 'clean', safeArea: 'none', lift: false }, music: null },
        sequence: seq,
        spans: spansOf(seq),
        fps: seq.fps,
        total: 240,
        playhead: 0,
        tentative: false,
        missingSources: {},
        unknownRates: {},
        variableRates: {},
        filmView: view,
        gradeNames: null,
        findings: { croppedIds: [] },
        centerOnSubject: () => {},
        tracksOpen: false,
        tracksCopy: null,
        locale: 'ko' as const,
        storedHasOwnedOverlays: false,
        shortcutMap: {
          play: ['Space'], split: ['Mod+KeyB'], trimStart: ['KeyQ'], trimEnd: ['KeyW'],
          stepForward: ['ArrowRight'], stepForward10: ['Shift+ArrowRight'], nextCut: ['ArrowDown'],
          remove: ['Delete'], undo: ['Mod+KeyZ'], zoomFrames: ['KeyZ'], magnet: ['KeyN'],
        },
        mac: false,
        setAspect: () => {},
        splitAtPlayhead: () => {},
        trimToPlayhead: () => {},
        setShortcutsOpen: () => {},
      };
      const panelHtml = renderToStaticMarkup(h(ActionPanel, { api: closedApi as never }));
      const sectionMatch = panelHtml.match(/<section[^>]*><h3[^>]*>[^<]*<\/h3><div data-editor-film-contents="true">[\s\S]*?<\/div><\/section>/);
      const storedBlockHtml = sectionMatch ? sectionMatch[0] : '';
      return { panelHtml, storedBlockHtml };
    };

    // (i) captions + music only
    const capsMusicProj: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: baseClips,
      captions: [{ id: 'cap1', text: '예전 자막', startSec: 0.5, endSec: 2, position: 'bottom', size: 'md' }],
      bgm: { label: 'Morning Walk', sourceKind: 'asset', assetId: 'm1', srcUrl: 'https://media.example.invalid/m.mp3', durationSec: 30, trimStartSec: 0, volume: 0.5 },
    };
    const r1CapsMusic = renderClosedFilmPanel(capsMusicProj);
    expect(r1CapsMusic.storedBlockHtml).toBe(MAIN_A2B36540_STORED_CONTENTS.capsMusic.html);
    expect({ sha256: sha256(r1CapsMusic.storedBlockHtml), length: r1CapsMusic.storedBlockHtml.length }).toEqual({
      sha256: MAIN_A2B36540_STORED_CONTENTS.capsMusic.sha256,
      length: MAIN_A2B36540_STORED_CONTENTS.capsMusic.length,
    });

    // (ii) legacy image overlay only (no frameV2)
    const legacyImgProj: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: baseClips,
      overlays: [legacyImageOverlay],
    };
    const r1LegacyImg = renderClosedFilmPanel(legacyImgProj);
    expect(r1LegacyImg.storedBlockHtml).toBe(MAIN_A2B36540_STORED_CONTENTS.legacyImg.html);
    expect({ sha256: sha256(r1LegacyImg.storedBlockHtml), length: r1LegacyImg.storedBlockHtml.length }).toEqual({
      sha256: MAIN_A2B36540_STORED_CONTENTS.legacyImg.sha256,
      length: MAIN_A2B36540_STORED_CONTENTS.legacyImg.length,
    });

    // (iii-a) owned video overlay in storage (alone) with tracksOpen: false -> absent, byte-identical to plain film
    const plainProj: ComposerProject = { ...emptyComposerProject('9:16'), clips: baseClips };
    const ownedOnlyProj: ComposerProject = { ...emptyComposerProject('9:16'), clips: baseClips, overlays: [ownedVideoOverlay] };
    const r1Plain = renderClosedFilmPanel(plainProj);
    const r1OwnedOnly = renderClosedFilmPanel(ownedOnlyProj);
    expect(r1OwnedOnly.storedBlockHtml).toBe(MAIN_A2B36540_STORED_CONTENTS.ownedOnly.html);
    expect({ sha256: sha256(r1OwnedOnly.storedBlockHtml), length: r1OwnedOnly.storedBlockHtml.length }).toEqual({
      sha256: MAIN_A2B36540_STORED_CONTENTS.ownedOnly.sha256,
      length: MAIN_A2B36540_STORED_CONTENTS.ownedOnly.length,
    });
    expect(r1OwnedOnly.panelHtml).toBe(r1Plain.panelHtml);

    // (iii-b) owned video overlay in storage + captions + music + legacy image overlay with tracksOpen: false -> byte-identical to origin/main a2b36540
    const legacyAllProj: ComposerProject = {
      ...capsMusicProj,
      overlays: [legacyImageOverlay],
    };
    const mixedProject: ComposerProject = {
      ...capsMusicProj,
      overlays: [legacyImageOverlay, ownedVideoOverlay],
    };
    const r1LegacyAll = renderClosedFilmPanel(legacyAllProj);
    const r1ClosedMixed = renderClosedFilmPanel(mixedProject);
    expect(r1ClosedMixed.storedBlockHtml).toBe(MAIN_A2B36540_STORED_CONTENTS.mixed.html);
    expect({ sha256: sha256(r1ClosedMixed.storedBlockHtml), length: r1ClosedMixed.storedBlockHtml.length }).toEqual({
      sha256: MAIN_A2B36540_STORED_CONTENTS.mixed.sha256,
      length: MAIN_A2B36540_STORED_CONTENTS.mixed.length,
    });
    expect(r1ClosedMixed.storedBlockHtml).toBe(r1LegacyAll.storedBlockHtml);
    expect(r1ClosedMixed.panelHtml).toBe(r1LegacyAll.panelHtml);

    // 1. Switch OPEN + film with ONLY new-editor overlays (2 overlay clips, no old-editor captions/music/grade/stills):
    const openOnlyOverlays = await mountEditor({ tracksOpen: true, clipsCount: 3 });
    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };
    // Lift c2 and c3 onto overlay tracks, then deselect so 영상 전체 panel shows.
    await openOnlyOverlays.firePointer(openOnlyOverlays.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await openOnlyOverlays.firePointer(win, 'pointerup');
    await openOnlyOverlays.dom.click('[data-editor-move-track-up]');
    await openOnlyOverlays.firePointer(openOnlyOverlays.dom.query('[data-clip-id="c3"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await openOnlyOverlays.firePointer(win, 'pointerup');
    await openOnlyOverlays.dom.click('[data-editor-move-track-up]');
    await openOnlyOverlays.fireWindowKey({ code: 'KeyX', altKey: true });

    const filmContentsBox = openOnlyOverlays.dom.query('[data-editor-film-contents]');
    expect(filmContentsBox).not.toBeNull();
    // R3: `data-editor-contents` belongs ONLY to old-editor rows; owned overlays use `data-editor-contents-owned`.
    expect(filmContentsBox?.querySelector('[data-editor-contents]')).toBeNull();
    expect(filmContentsBox?.querySelector('[data-editor-contents-owned="overlays"]')).not.toBeNull();
    expect(filmContentsBox?.querySelector('[data-editor-contents-row="overlays"]')?.textContent).toBe(
      '오버레이 트랙 클립 2개',
    );
    expect(filmContentsBox?.querySelector('[data-editor-contents-overlays-note]')?.textContent).toBe(
      studioEditorTracksKo.export.blocked,
    );
    expect(filmContentsBox?.textContent).not.toContain(studioEditorKo.real.contents.note);

    await openOnlyOverlays.dom.unmount();
    dom = null;

    // 2. R2 + R3: Switch OPEN + mixed film (captions + music + legacy IMAGE overlay + owned video overlay):
    const mountWithProject = async (tracksOpen: boolean) => {
      const { mountDom } = await import('@/tests/brands/_dom-harness');
      const { act } = await import('react');
      const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
      const storageMap = new Map<string, string>([[composeStorageKey(ORG), serializeProjectForStorage(mixedProject)]]);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storageMap.get(key) ?? null,
        setItem: (key: string, value: string) => { storageMap.set(key, value); },
        removeItem: (key: string) => { storageMap.delete(key); },
        clear: () => storageMap.clear(),
      });
      const mounted = await mountDom(
        h(EditorV2, {
          copy: studioEditorKo,
          currentEditorHref: '/brand/studio/compose?classic=1',
          real: REAL_PROPS,
          ...(tracksOpen ? { tracksOpen: true, tracksCopy: studioEditorTracksKo } : {}),
        }),
      );
      dom = mounted;
      for (let i = 0; i < 6; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }
      return mounted;
    };

    const openMixed = await mountWithProject(true);
    const mixedBox = openMixed.query('[data-editor-film-contents]')!;
    // R2 + R3: ONLY one `[data-editor-contents]` list (captions + music + legacy image overlay `stills`) under `contents.note`,
    // and the owned overlay sits in its own `[data-editor-contents-owned="overlays"]` list under `export.blocked`.
    const oldLists = [...mixedBox.querySelectorAll('[data-editor-contents]')];
    expect(oldLists).toHaveLength(1);
    expect(oldLists[0]?.getAttribute('data-editor-contents')).toBe('captions music stills');
    expect(oldLists[0]?.querySelector('[data-editor-contents-row="stills"]')).not.toBeNull();
    expect(oldLists[0]?.querySelector('[data-editor-contents-row="overlays"]')).toBeNull();
    const ownedList = mixedBox.querySelector('[data-editor-contents-owned="overlays"]');
    expect(ownedList).not.toBeNull();
    expect(ownedList?.querySelector('[data-editor-contents-row="overlays"]')?.textContent).toBe('오버레이 트랙 클립 1개');
    expect(mixedBox.textContent).toContain(studioEditorKo.real.contents.note);
    expect(mixedBox.querySelector('[data-editor-contents-overlays-note]')?.textContent).toBe(
      studioEditorTracksKo.export.blocked,
    );
    // F3: ExportSheet with switch OPEN mirrors the panel — owned overlays sit in `[data-editor-contents-owned="overlays"]`
    // while `[data-editor-contents]` holds only cuts + old-editor rows (`cuts captions music stills`).
    await openMixed.click('[data-editor-export]');
    const openExportContents = openMixed.query('[data-editor-export-contents]')!;
    expect(openExportContents.querySelectorAll('[data-editor-contents]')).toHaveLength(1);
    expect(openExportContents.querySelector('[data-editor-contents]')?.getAttribute('data-editor-contents')).toBe('cuts captions music stills');
    expect(openExportContents.querySelector('[data-editor-contents] [data-editor-contents-row="overlays"]')).toBeNull();
    expect(openExportContents.querySelector('[data-editor-contents-owned="overlays"] [data-editor-contents-row="overlays"]')?.textContent).toBe('오버레이 트랙 클립 1개');
    await openMixed.unmount();
    dom = null;

    // 3. Switch CLOSED mounted parity (panel + ExportSheet): ONLY `[data-editor-contents]` + `contents.note`, zero owned-overlay markers.
    const closedMixed = await mountWithProject(false);
    const closedBox = closedMixed.query('[data-editor-film-contents]')!;
    expect(closedBox.querySelectorAll('[data-editor-contents]')).toHaveLength(1);
    expect(closedBox.querySelector('[data-editor-contents]')?.getAttribute('data-editor-contents')).toBe('captions music stills');
    expect(closedBox.querySelector('[data-editor-contents-owned]')).toBeNull();
    expect(closedBox.querySelector('[data-editor-contents-row="overlays"]')).toBeNull();
    expect(closedBox.querySelector('[data-editor-contents-overlays-note]')).toBeNull();
    expect(closedBox.textContent).toContain(studioEditorKo.real.contents.note);
    // F3: ExportSheet with switch CLOSED keeps exact `origin/main` (`a2b36540`) markup — single `[data-editor-contents]` list, no owned list.
    await closedMixed.click('[data-editor-export]');
    const closedExportContents = closedMixed.query('[data-editor-export-contents]')!;
    expect(closedExportContents.querySelectorAll('[data-editor-contents]')).toHaveLength(1);
    expect(closedExportContents.querySelector('[data-editor-contents]')?.getAttribute('data-editor-contents')).toBe('cuts captions music stills');
    expect(closedExportContents.querySelector('[data-editor-contents-owned]')).toBeNull();
    expect(closedExportContents.querySelector('[data-editor-contents-row="overlays"]')).toBeNull();
    expect(closedExportContents.children.map((child) => child.tagName)).toEqual(['H3', 'UL']);
    expect([...closedExportContents.querySelectorAll('li')].map((li) => li.getAttribute('data-editor-contents-row'))).toEqual([
      'cuts',
      'captions',
      'music',
      'stills',
    ]);
  });

  it('Round 4 Fault #3 + Round 5 R5 + Round 6 F2: dragging an overlay clip DOWN onto main opens a live gap, shifts linked overlays + rounded midpoint snap targets, and Esc/pointercancel restore cleanly', async () => {
    const view = await mountEditor({ tracksOpen: true, clipsCount: 3 });
    const win = window as unknown as { dispatchEvent: (e: unknown) => boolean };

    // Lift c2 (120 frames) onto overlay track 0 so main has c1 (0..120) and c3 (120..240).
    await view.firePointer(view.dom.query('[data-clip-id="c2"]')!, 'pointerdown', { clientX: 50, clientY: 120 });
    await view.firePointer(win, 'pointerup');
    await view.dom.click('[data-editor-move-track-up]');
    expect(view.dom.query('[data-overlay-clip="c2"]')).not.toBeNull();

    const content = view.dom.query('[data-editor-ruler]')!.parentElement!;
    const scrollBox = content.parentElement!;
    const mainLane = content.querySelector('[data-lane="video"]')!;
    const ovLane = content.querySelector('[data-overlay-track="0"]')!;
    scrollBox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 260, width: 960, height: 260 });
    ovLane.getBoundingClientRect = () => ({ left: 0, top: 60, right: 960, bottom: 114, width: 960, height: 54 });
    mainLane.getBoundingClientRect = () => ({ left: 0, top: 120, right: 960, bottom: 184, width: 960, height: 64 });

    const leftOf = (id: string) => Number.parseFloat(view.dom.query(`[data-clip-id="${id}"]`)!.style.left ?? '0');
    const c1Initial = leftOf('c1');
    const c3Initial = leftOf('c3');
    expect(c1Initial).toBe(0);
    expect(c3Initial).toBeGreaterThan(0);
    const gapPx = c3Initial - c1Initial; // 120 frames * ppf (same length as c2)

    // 1) Drag c2 DOWN onto main over c1's left half (insertIndex = 0) -> both c1 and c3 shift right LIVE by gapPx!
    const ovEl = view.dom.query('[data-overlay-clip="c2"]')!;
    await view.firePointer(ovEl, 'pointerdown', { clientX: 50, clientY: 85, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 20, clientY: 150, buttons: 1 });
    expect(leftOf('c1')).toBeCloseTo(c1Initial + gapPx, 1);
    expect(leftOf('c3')).toBeCloseTo(c3Initial + gapPx, 1);

    // 2) Move right across c1's midpoint (insertIndex = 1) -> c1 returns to 0, c3 shifts right LIVE (gap between c1 and c3)!
    await view.firePointer(win, 'pointermove', { clientX: c3Initial + 10, clientY: 150, buttons: 1 });
    expect(leftOf('c1')).toBeCloseTo(c1Initial, 1);
    expect(leftOf('c3')).toBeCloseTo(c3Initial + gapPx, 1);

    // 3) Escape cancels cleanly and restores exact original positions!
    await view.fireWindowKey({ key: 'Escape', code: 'Escape' });
    expect(leftOf('c1')).toBeCloseTo(c1Initial, 1);
    expect(leftOf('c3')).toBeCloseTo(c3Initial, 1);
    expect(view.dom.query('[data-overlay-clip="c2"]')).not.toBeNull();

    // 4) Drag down again (insertIndex = 0) and cancel via pointercancel -> restores exact original positions!
    await view.firePointer(view.dom.query('[data-overlay-clip="c2"]')!, 'pointerdown', { clientX: 50, clientY: 85, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: 20, clientY: 150, buttons: 1 });
    expect(leftOf('c1')).toBeCloseTo(c1Initial + gapPx, 1);
    await view.firePointer(win, 'pointercancel');
    expect(leftOf('c1')).toBeCloseTo(c1Initial, 1);
    expect(leftOf('c3')).toBeCloseTo(c3Initial, 1);
    expect(view.dom.query('[data-overlay-clip="c2"]')).not.toBeNull();

    // 5) Drag down to insertIndex = 1 and release -> commits ['c1', 'c2', 'c3'] on main!
    await view.firePointer(view.dom.query('[data-overlay-clip="c2"]')!, 'pointerdown', { clientX: 50, clientY: 85, buttons: 1 });
    await view.firePointer(win, 'pointermove', { clientX: c3Initial + 10, clientY: 150, buttons: 1 });
    await view.firePointer(win, 'pointerup');
    expect(view.dom.query('[data-overlay-track="0"]')).toBeNull();
    const mainIds = [...mainLane.querySelectorAll('[data-clip-id]')].map((el) =>
      el.getAttribute('data-clip-id'),
    );
    expect(mainIds).toEqual(['c1', 'c2', 'c3']);
    await view.dom.unmount();
    dom = null;

    // 6) R5: With linkage + Overlay kind ON, dragging an overlay clip DOWN onto main ALSO shifts linked overlay clips LIVE
    //    and computes snap targets from the shifted positions; Esc and pointercancel restore both main and linked overlays!
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const r5Project: ComposerProject = {
      ...emptyComposerProject('9:16'),
      clips: [
        { id: 'm1', label: 'Main 1', sourceKind: 'asset', assetId: 'a1', srcUrl: 'https://media.example.invalid/m1.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
        { id: 'm2', label: 'Main 2', sourceKind: 'asset', assetId: 'a2', srcUrl: 'https://media.example.invalid/m2.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
      ],
      overlays: [
        {
          id: 'ovDrag',
          label: 'Drag Overlay',
          sourceKind: 'asset',
          assetId: 'a3',
          srcUrl: 'https://media.example.invalid/ov1.mp4',
          mediaKind: 'video',
          startSec: 0,
          endSec: 2,
          x: 0.5,
          y: 0.5,
          scale: 1,
          opacity: 1,
          frameV2: {
            fps: 24,
            trackIndex: 0,
            trackId: 'ov-1',
            startFrame: 0,
            link: { clipId: 'm1', sourceFrame: 0 },
            inFrame: 0,
            phase: 0,
            frames: 48,
            speedNum: 1,
            speedDen: 1,
            sourceFps: 24,
            sourceFrames: 120,
            srcUrl: 'https://media.example.invalid/ov1.mp4',
            durationSec: 5,
            volume: 1,
            muted: false,
            mirror: { startSec: 0, endSec: 2 },
          },
        } as ComposerProject['overlays'] extends Array<infer T> ? T : never,
        {
          id: 'ovLinked',
          label: 'Linked Overlay',
          sourceKind: 'asset',
          assetId: 'a4',
          srcUrl: 'https://media.example.invalid/ov2.mp4',
          mediaKind: 'video',
          startSec: 5,
          endSec: 7,
          x: 0.5,
          y: 0.5,
          scale: 1,
          opacity: 1,
          frameV2: {
            fps: 24,
            trackIndex: 1,
            trackId: 'ov-2',
            startFrame: 120,
            link: { clipId: 'm2', sourceFrame: 0 },
            inFrame: 0,
            phase: 0,
            frames: 48,
            speedNum: 1,
            speedDen: 1,
            sourceFps: 24,
            sourceFrames: 120,
            srcUrl: 'https://media.example.invalid/ov2.mp4',
            durationSec: 5,
            volume: 1,
            muted: false,
            mirror: { startSec: 5, endSec: 7 },
          },
        } as ComposerProject['overlays'] extends Array<infer T> ? T : never,
      ],
    };
    const r5Storage = new Map<string, string>([
      [composeStorageKey(ORG), serializeProjectForStorage(r5Project)],
      [TRACKS_PREFS_KEY, JSON.stringify({ linkage: true, linkageOverlay: true, snap: true })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => r5Storage.get(key) ?? null,
      setItem: (key: string, value: string) => { r5Storage.set(key, value); },
      removeItem: (key: string) => { r5Storage.delete(key); },
      clear: () => r5Storage.clear(),
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const r5Dom = await mountDom(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: '/brand/studio/compose?classic=1',
        real: REAL_PROPS,
        tracksOpen: true,
        tracksCopy: studioEditorTracksKo,
      }),
    );
    dom = r5Dom;
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const r5Content = r5Dom.query('[data-editor-ruler]')!.parentElement!;
    const r5Scroll = r5Content.parentElement!;
    const r5Main = r5Content.querySelector('[data-lane="video"]')!;
    const r5Ov0 = r5Content.querySelector('[data-overlay-track="0"]')!;
    const r5Ov1 = r5Content.querySelector('[data-overlay-track="1"]')!;
    r5Scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 320, width: 960, height: 320 });
    r5Content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 320, width: 960, height: 320 });
    r5Ov1.getBoundingClientRect = () => ({ left: 0, top: 30, right: 960, bottom: 84, width: 960, height: 54 });
    r5Ov0.getBoundingClientRect = () => ({ left: 0, top: 90, right: 960, bottom: 144, width: 960, height: 54 });
    r5Main.getBoundingClientRect = () => ({ left: 0, top: 150, right: 960, bottom: 214, width: 960, height: 64 });

    const r5Ppf = Number.parseFloat(r5Dom.query('[data-editor-timeline]')!.getAttribute('data-editor-ppf') ?? '1');
    const r5LeftOf = (id: string) => Number.parseFloat(r5Dom.query(`[data-clip-id="${id}"]`)!.style.left ?? '0');
    const m1Before = r5LeftOf('m1');
    const m2Before = r5LeftOf('m2');
    const linkedBefore = r5LeftOf('ovLinked');
    const shiftPx = 48 * r5Ppf; // ovDrag is 48 frames
    expect(m1Before).toBe(0);
    expect(m2Before).toBeCloseTo(120 * r5Ppf, 1);
    expect(linkedBefore).toBeCloseTo(120 * r5Ppf, 1);

    const fireR5 = async (
      target: { dispatchEvent: (e: never) => boolean },
      type: string,
      init: Parameters<typeof makeEvent>[1] = {},
    ) => {
      await act(async () => {
        target.dispatchEvent(makeEvent(type, init) as never);
      });
    };

    // Drag ovDrag (starting at frame 0, grabbed at clientX = 0) DOWN into main at insertIndex = 0 (over m1's left half).
    // Place pointer at shifted m1 start = 48 frames (48 * ppf, still < m1's midpoint 60 * ppf so insertIndex = 0):
    // -> m1 shifts 0 -> 48, m2 shifts 120 -> 168, ovLinked shifts 120 -> 168 LIVE, AND snap guide snaps to shifted 48!
    const dragOvEl = r5Dom.query('[data-overlay-clip="ovDrag"]')!;
    await fireR5(dragOvEl, 'pointerdown', { clientX: 0, clientY: 115, buttons: 1 });
    await fireR5(win, 'pointermove', { clientX: 48 * r5Ppf + 0.5, clientY: 180, buttons: 1 });
    expect(r5LeftOf('m1')).toBeCloseTo(m1Before + shiftPx, 1);
    expect(r5LeftOf('m2')).toBeCloseTo(m2Before + shiftPx, 1);
    expect(r5LeftOf('ovLinked')).toBeCloseTo(linkedBefore + shiftPx, 1);
    expect(r5Dom.query('[data-snap-guide="48"]')).not.toBeNull();

    // Esc cancels cleanly and restores BOTH main cuts AND linked overlay `ovLinked` to exact original positions!
    await fireR5(win, 'keydown', { key: 'Escape', code: 'Escape' });
    expect(r5LeftOf('m1')).toBeCloseTo(m1Before, 1);
    expect(r5LeftOf('m2')).toBeCloseTo(m2Before, 1);
    expect(r5LeftOf('ovLinked')).toBeCloseTo(linkedBefore, 1);

    // Repeat with pointercancel -> also restores BOTH main cuts AND linked overlay!
    await fireR5(r5Dom.query('[data-overlay-clip="ovDrag"]')!, 'pointerdown', { clientX: 0, clientY: 115, buttons: 1 });
    await fireR5(win, 'pointermove', { clientX: 48 * r5Ppf + 0.5, clientY: 180, buttons: 1 });
    expect(r5LeftOf('ovLinked')).toBeCloseTo(linkedBefore + shiftPx, 1);
    await fireR5(win, 'pointercancel');
    expect(r5LeftOf('m1')).toBeCloseTo(m1Before, 1);
    expect(r5LeftOf('m2')).toBeCloseTo(m2Before, 1);
    expect(r5LeftOf('ovLinked')).toBeCloseTo(linkedBefore, 1);

    // F2: Rounding agreement between snap targets and drop target at half a frame either side of m1's midpoint (60.0).
    // With a 60-frame overlay clip (`ovDrag60`) dragged over m1 (0..120, midpoint 60):
    //   - insertIndex = 0 shifts m1 to 60..180 -> frame 60 is a shifted cut edge (`[data-snap-guide="60"]`), 120 is not.
    //   - insertIndex = 1 keeps m1 at 0..120 -> frame 120 is m1's end (`[data-snap-guide="120"]` via right edge), 60 is not.
    // At pointerFrame = 59.5 (half frame left), 60.4 (sub-frame rounding boundary where unrounded > 60 while rounded == 60),
    // and 60.5 (half frame right), live gap AND snap guide MUST agree!
    await r5Dom.unmount();
    dom = null;
    const f2Project: ComposerProject = {
      ...r5Project,
      // Add 3 extra 5 s cuts (600 frames total) so fit-zoom places `f2Ppf <= 2 px/frame`, keeping 1-frame snap offsets within SNAP_ENGAGE_PX (2px).
      clips: [
        ...r5Project.clips,
        { id: 'm3', label: 'M3', sourceKind: 'asset' as const, assetId: 'a5', srcUrl: 'https://media.example.invalid/c2.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
        { id: 'm4', label: 'M4', sourceKind: 'asset' as const, assetId: 'a6', srcUrl: 'https://media.example.invalid/c2.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
        { id: 'm5', label: 'M5', sourceKind: 'asset' as const, assetId: 'a7', srcUrl: 'https://media.example.invalid/c2.mp4', thumbUrl: null, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false },
      ],
      overlays: [
        {
          ...(r5Project.overlays![0]!),
          id: 'ovDrag60',
          endSec: 2.5,
          frameV2: {
            ...((r5Project.overlays![0] as unknown as { frameV2: Record<string, unknown> }).frameV2),
            frames: 60,
            mirror: { startSec: 0, endSec: 2.5 },
          },
        } as ComposerProject['overlays'] extends Array<infer T> ? T : never,
        r5Project.overlays![1]!,
      ],
    };
    const f2Storage = new Map<string, string>([
      [composeStorageKey(ORG), serializeProjectForStorage(f2Project)],
      [TRACKS_PREFS_KEY, JSON.stringify({ linkage: true, linkageOverlay: true, snap: true })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => f2Storage.get(key) ?? null,
      setItem: (key: string, value: string) => { f2Storage.set(key, value); },
      removeItem: (key: string) => { f2Storage.delete(key); },
      clear: () => f2Storage.clear(),
    });
    const f2Dom = await mountDom(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: '/brand/studio/compose?classic=1',
        real: REAL_PROPS,
        tracksOpen: true,
        tracksCopy: studioEditorTracksKo,
      }),
    );
    dom = f2Dom;
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const f2Content = f2Dom.query('[data-editor-ruler]')!.parentElement!;
    const f2Scroll = f2Content.parentElement!;
    const f2Main = f2Content.querySelector('[data-lane="video"]')!;
    const f2Ov0 = f2Content.querySelector('[data-overlay-track="0"]')!;
    const f2Ov1 = f2Content.querySelector('[data-overlay-track="1"]')!;
    f2Scroll.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 320, width: 960, height: 320 });
    f2Content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 320, width: 960, height: 320 });
    f2Ov1.getBoundingClientRect = () => ({ left: 0, top: 30, right: 960, bottom: 84, width: 960, height: 54 });
    f2Ov0.getBoundingClientRect = () => ({ left: 0, top: 90, right: 960, bottom: 144, width: 960, height: 54 });
    f2Main.getBoundingClientRect = () => ({ left: 0, top: 150, right: 960, bottom: 214, width: 960, height: 64 });

    const f2LeftOf = (id: string) => Number.parseFloat(f2Dom.query(`[data-clip-id="${id}"]`)!.style.left ?? '0');
    // Derive exact IEEE-754 `ppf` from m2's rendered pixel offset (`120 * ppf`) instead of the 2-decimal `data-editor-ppf` display attribute.
    const f2Ppf = f2LeftOf('m2') / 120;

    // 1) Half a frame LEFT of midpoint (59.5): Math.round(59.5) === 60 -> insertIndex 0, m1 shifts to 60, guide snaps to 60.
    await fireR5(f2Dom.query('[data-overlay-clip="ovDrag60"]')!, 'pointerdown', { clientX: 0, clientY: 115, buttons: 1 });
    await fireR5(win, 'pointermove', { clientX: 59.5 * f2Ppf, clientY: 180, buttons: 1 });
    expect(f2LeftOf('m1')).toBeCloseTo(60 * f2Ppf, 1);
    expect(f2Dom.query('[data-snap-guide="60"]')).not.toBeNull();
    await fireR5(win, 'keydown', { key: 'Escape', code: 'Escape' });

    // 2) Sub-frame rounding boundary (60.4): unrounded > 60, but Math.round(60.4) === 60 -> STILL insertIndex 0 & guide 60 (never 120).
    await fireR5(f2Dom.query('[data-overlay-clip="ovDrag60"]')!, 'pointerdown', { clientX: 0, clientY: 115, buttons: 1 });
    await fireR5(win, 'pointermove', { clientX: 60.4 * f2Ppf, clientY: 180, buttons: 1 });
    expect(f2LeftOf('m1')).toBeCloseTo(60 * f2Ppf, 1);
    expect(f2Dom.query('[data-snap-guide="60"]')).not.toBeNull();
    expect(f2Dom.query('[data-snap-guide="120"]')).toBeNull();
    await fireR5(win, 'keydown', { key: 'Escape', code: 'Escape' });

    // 3) Half a frame RIGHT of midpoint (60.5): Math.round(60.5) === 61 -> insertIndex 1, m1 stays at 0, m2 shifts to 180, guide snaps to 120.
    await fireR5(f2Dom.query('[data-overlay-clip="ovDrag60"]')!, 'pointerdown', { clientX: 0, clientY: 115, buttons: 1 });
    await fireR5(win, 'pointermove', { clientX: 60.5 * f2Ppf, clientY: 180, buttons: 1 });
    expect(f2LeftOf('m1')).toBeCloseTo(0, 1);
    expect(f2LeftOf('m2')).toBeCloseTo(180 * f2Ppf, 0);
    expect(f2Dom.query('[data-snap-guide="120"]')).not.toBeNull();
    expect(f2Dom.query('[data-snap-guide="60"]')).toBeNull();
    await fireR5(win, 'keydown', { key: 'Escape', code: 'Escape' });
  });
});
