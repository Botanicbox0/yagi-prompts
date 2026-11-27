import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { PLAYHEAD_CHIP_KEY } from '@/components/brand-studio/editor-v2/chat-model';
import { createPlayheadBus } from '@/components/brand-studio/editor-v2/chat-panel';
import { editorChatStorageKey } from '@/components/brand-studio/editor-v2/chat-store';
import { LAYOUT_STORAGE_KEY } from '@/components/brand-studio/editor-v2/layout-model';
import { composeStorageKey, emptyComposerProject, type ComposeClip } from '@/lib/brand-studio/compose/timeline';
import { composeStreamUrl, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatKo } from '@/messages/studio-editor-chat';
import type { MountedDom } from '@/tests/brands/_dom-harness';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '11111111-1111-4111-8111-111111111111';
const ASSET_1 = '40000000-0000-4000-8000-000000000001';
const ASSET_2 = '40000000-0000-4000-8000-000000000002';

const SOURCES: EditorSource[] = [
  {
    key: `a:${ASSET_1}`,
    kind: 'asset',
    id: ASSET_1,
    label: 'opening.mp4',
    srcUrl: composeStreamUrl(ORG, 'asset', ASSET_1),
    thumbUrl: '/api/brand-studio/media/thumb-1.jpg',
    seconds: 4,
    durationMs: 4000,
    createdAt: '2026-11-20T10:00:00.000Z',
  },
  {
    key: `a:${ASSET_2}`,
    kind: 'asset',
    id: ASSET_2,
    label: 'closing.mp4',
    srcUrl: composeStreamUrl(ORG, 'asset', ASSET_2),
    thumbUrl: '/api/brand-studio/media/thumb-2.jpg',
    seconds: 5,
    durationMs: 5000,
    createdAt: '2026-11-20T10:05:00.000Z',
  },
];

function makeStoredFilm() {
  const base = emptyComposerProject('16:9');
  const clips: ComposeClip[] = [
    {
      id: 'cut-1',
      sourceKind: 'asset',
      assetId: ASSET_1,
      label: 'opening.mp4',
      srcUrl: SOURCES[0]!.srcUrl,
      thumbUrl: SOURCES[0]!.thumbUrl,
      durationSec: 4,
      trimStartSec: 0,
      trimEndSec: 4,
      volume: 1,
      muted: false,
    },
    {
      id: 'cut-2',
      sourceKind: 'asset',
      assetId: ASSET_2,
      label: 'closing.mp4',
      srcUrl: SOURCES[1]!.srcUrl,
      thumbUrl: SOURCES[1]!.thumbUrl,
      durationSec: 5,
      trimStartSec: 0,
      trimEndSec: 5,
      volume: 1,
      muted: false,
    },
  ];
  return { ...base, clips };
}

vi.mock('@/components/brand-studio/editor-v2/measure-fps', () => ({
  measureSource: vi.fn(async (_src: string, durationSec: number | null) => ({
    fps: 30,
    frames: Math.round((durationSec ?? 5) * 30),
  })),
}));

let dom: MountedDom | null = null;

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mountRealChatEditor(opts: {
  canEdit?: boolean;
  filmId?: string;
  storage?: Map<string, string>;
  throwOnSetItem?: boolean;
  wideViewport?: boolean;
  skipFlush?: boolean;
} = {}) {
  const fetchSpy = vi.fn(() => {
    throw new Error('Sample fallback mode must not call fetch');
  });
  vi.stubGlobal('fetch', fetchSpy);
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

  const storageMap = opts.storage ?? new Map<string, string>();
  if (!storageMap.has(composeStorageKey(ORG))) {
    storageMap.set(composeStorageKey(ORG), JSON.stringify(makeStoredFilm()));
  }

  const removeItemSpy = vi.fn((key: string) => {
    storageMap.delete(key);
  });
  const setItemSpy = vi.fn((key: string, val: string) => {
    if (opts.throwOnSetItem && key.startsWith('twings_editor_chat_v1:')) {
      throw new Error('QuotaExceededError');
    }
    storageMap.set(key, val);
  });

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: setItemSpy,
    removeItem: removeItemSpy,
    clear: () => storageMap.clear(),
  });

  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { act } = await import('react');
  const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
  dom = await mountDom(null);
  if (opts.wideViewport) {
    (window as unknown as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: query.includes('1361'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  }

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
  for (const prop of ['scrollTop', 'scrollHeight', 'clientHeight', 'clientWidth'] as const) {
    if (!(prop in element)) {
      const store = new WeakMap<object, number>();
      const fallback = prop === 'clientWidth' ? 960 : 0;
      Object.defineProperty(element, prop, {
        configurable: true,
        get(this: object) {
          return store.get(this) ?? fallback;
        },
        set(this: object, val: number) {
          store.set(this, val);
        },
      });
    }
  }
  const textareaProto = Object.getPrototypeOf(dom.document.createElement('textarea')) as Record<string, unknown>;
  if (!('defaultValue' in textareaProto)) {
    const defaults = new WeakMap<object, string>();
    Object.defineProperty(textareaProto, 'defaultValue', {
      configurable: true,
      get(this: object) {
        return defaults.get(this) ?? '';
      },
      set(this: { _value?: string }, val: string) {
        const next = String(val ?? '');
        defaults.set(this, next);
        this._value = next;
      },
    });
  }

  const filmId = opts.filmId ?? 'film-main';

  await dom.rerender(
    h(EditorV2, {
      copy: studioEditorKo,
      currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
      initialWorkspace: 'cut',
      real: {
        organizationId: ORG,
        organizationName: 'Sample Brand',
        canEdit: opts.canEdit ?? true,
        sources: SOURCES,
        sampleBase: null,
        filmId,
      },
      realChat: { userId: USER, filmId, assistEnabled: false },
      chatCopy: studioEditorChatKo,
    }),
  );

  if (!opts.skipFlush) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  return { dom, act, storageMap, fetchSpy, removeItemSpy, setItemSpy, filmId };
}

describe('editor-v2 right-side chat panel (Batch 1)', () => {
  it('renders CSS-driven tab structure on SSR (1280 first paint), defaults to side dock, folds/reopens with persistence, and makes zero network calls', async () => {
    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const ssr = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: {
          organizationId: ORG,
          organizationName: 'Sample Brand',
          canEdit: true,
          sources: SOURCES,
          sampleBase: null,
          filmId: 'film-ssr',
        },
        realChat: { userId: USER, filmId: 'film-ssr' },
        chatCopy: studioEditorChatKo,
      }),
    );
    expect(ssr).toContain('data-dock="side"');
    expect(ssr).toContain('data-editor-right-dock=""');
    expect(ssr).toContain('data-active-tab="chat"');
    expect(ssr).toContain('role="tablist"');
    expect(ssr).toContain('role="tabpanel"');
    expect(ssr).toContain('aria-controls="');
    expect(ssr).toContain('data-editor-chat="side"');
    expect(ssr).not.toContain('data-editor-assist-sample');
    // W4: SSR (before client hydration) and pending filmId draw NO empty-state hint or examples
    expect(ssr).not.toContain('data-editor-chat-empty');
    expect(ssr).not.toContain('data-editor-chat-example');

    const pendingSsr = renderToStaticMarkup(
      h(EditorV2, {
        copy: studioEditorKo,
        currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
        initialWorkspace: 'cut',
        real: {
          organizationId: ORG,
          organizationName: 'Sample Brand',
          canEdit: true,
          sources: SOURCES,
          sampleBase: null,
        },
        realChat: { userId: USER, filmId: null },
        chatCopy: studioEditorChatKo,
      }),
    );
    expect(pendingSsr).not.toContain('data-editor-chat-empty');
    expect(pendingSsr).not.toContain('data-editor-chat-example');

    const m = await mountRealChatEditor();
    expect(m.dom.query('[data-studio-editor-v2]')!.getAttribute('data-dock')).toBe('side');
    expect(m.dom.query('[data-editor-chat="side"]')).not.toBeNull();

    // Accessible tablist: click & arrow-key navigation switch tab & preserve unsent draft (S2)
    await m.dom.setValue('[data-editor-chat-input]', '초안 유지 테스트');
    const chatTab = m.dom.query('[data-editor-right-tab="chat"]')!;
    const inspectorTab = m.dom.query('[data-editor-right-tab="inspector"]')!;
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
    expect(inspectorTab.getAttribute('aria-controls')).toBe(m.dom.query('[data-editor-right-pane="inspector"]')!.getAttribute('id'));
    expect(chatTab.getAttribute('aria-controls')).toBe(m.dom.query('[data-editor-right-pane="chat"]')!.getAttribute('id'));

    await m.dom.click(inspectorTab);
    expect(m.dom.query('[data-editor-right-dock]')!.getAttribute('data-active-tab')).toBe('inspector');
    await m.dom.click(chatTab);
    expect(m.dom.query('[data-editor-right-dock]')!.getAttribute('data-active-tab')).toBe('chat');
    expect((m.dom.query('[data-editor-chat-input]') as unknown as { value: string }).value).toBe('초안 유지 테스트');

    await m.dom.keyDown('ArrowLeft', { target: chatTab });
    expect(m.dom.query('[data-editor-right-dock]')!.getAttribute('data-active-tab')).toBe('inspector');
    expect(inspectorTab.getAttribute('aria-selected')).toBe('true');
    expect(m.dom.document.activeElement).toBe(inspectorTab);

    await m.dom.keyDown('ArrowRight', { target: inspectorTab });
    expect(m.dom.query('[data-editor-right-dock]')!.getAttribute('data-active-tab')).toBe('chat');
    expect((m.dom.query('[data-editor-chat-input]') as unknown as { value: string }).value).toBe('초안 유지 테스트');

    // Fold to bar -> persists assistDock: 'bar' + assistDockSet: true
    await m.dom.click('[data-editor-chat-fold]');
    expect(m.dom.query('[data-studio-editor-v2]')!.getAttribute('data-dock')).toBe('bar');
    expect(m.dom.query('[data-editor-chat="bar"]')).not.toBeNull();
    expect(JSON.parse(m.storageMap.get(LAYOUT_STORAGE_KEY)!)).toMatchObject({
      assistDock: 'bar',
      assistDockSet: true,
    });

    const persisted = new Map(m.storageMap);
    await m.dom.unmount();
    dom = null;

    const m2 = await mountRealChatEditor({ storage: persisted });
    expect(m2.dom.query('[data-studio-editor-v2]')!.getAttribute('data-dock')).toBe('bar');
    await m2.dom.click('[data-editor-chat-expand]');
    expect(m2.dom.query('[data-studio-editor-v2]')!.getAttribute('data-dock')).toBe('side');
    expect(m.fetchSpy).not.toHaveBeenCalled();
    expect(m2.fetchSpy).not.toHaveBeenCalled();
  });

  it('hydrates stored thread synchronously before first paint (useLayoutEffect), never deletes on mount even if setItem throws, and isolates two films in one organization', async () => {
    const keyA = editorChatStorageKey({ organizationId: ORG, userId: USER, filmId: 'film-a' });
    const keyB = editorChatStorageKey({ organizationId: ORG, userId: USER, filmId: 'film-b' });
    const seeded = new Map<string, string>([
      [
        keyA,
        JSON.stringify({
          v: 1,
          updatedAt: Date.now(),
          entries: [
            { id: 'u-seed', kind: 'user', text: '기존 대화' },
            { id: 'n-seed', kind: 'note', text: '저장된 답변' },
          ],
          draft: '이어쓰기',
        }),
      ],
    ]);

    // Mount film-a with skipFlush + setItem throwing: useLayoutEffect populates the thread synchronously
    // on initial commit (before any timers or rAF run), with zero removeItem wipe.
    const mA = await mountRealChatEditor({ filmId: 'film-a', storage: seeded, throwOnSetItem: true, skipFlush: true });
    expect(mA.removeItemSpy).not.toHaveBeenCalledWith(keyA);
    expect(seeded.has(keyA)).toBe(true);
    expect(mA.dom.query('[data-editor-chat-entry="user"]')?.textContent).toContain('기존 대화');
    expect(mA.dom.query('[data-editor-chat-empty]')).toBeNull();
    expect((mA.dom.query('[data-editor-chat-input]') as unknown as { value: string }).value).toBe('이어쓰기');
    await mA.dom.unmount();
    dom = null;

    // Mount film-b in the SAME organization -> completely separate empty thread.
    const mB = await mountRealChatEditor({ filmId: 'film-b', storage: seeded });
    expect(mB.dom.query('[data-editor-chat-empty]')).not.toBeNull();
    await mB.dom.setValue('[data-editor-chat-input]', '세로 영상으로 바꿔 줘');
    await mB.dom.submit('[data-editor-chat="side"] form');
    expect(seeded.has(keyB)).toBe(true);
    expect(seeded.get(keyA)).toContain('기존 대화');
    await mB.dom.unmount();
    dom = null;

    // Reload film-a -> still finds film-a's thread, untouched by film-b.
    const mA2 = await mountRealChatEditor({ filmId: 'film-a', storage: seeded });
    expect(mA2.dom.query('[data-editor-chat-entry="user"]')?.textContent).toContain('기존 대화');
    expect(mA2.fetchSpy).not.toHaveBeenCalled();
  });

  it('causes 0 EditorChatPanel / ChatThread re-renders across 30 playhead changes (no production test hook) while updating the playhead chip leaf (S3)', async () => {
    // 1. Instrument chatCopy.heading (read only by EditorChatPanel) and chatCopy.threadLabel (read only by ChatThread)
    // via a Proxy — neither key is touched by PlayheadChipLeaf, proving 0 renders of both parent & thread across 30 ticks.
    const { act } = await import('react');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { EditorChatPanel } = await import('@/components/brand-studio/editor-v2/chat-panel');
    const bus = createPlayheadBus(0);
    let panelRenders = 0;
    let threadRenders = 0;
    const trackedCopy = new Proxy(studioEditorChatKo, {
      get(target, prop, receiver) {
        if (prop === 'heading') panelRenders += 1;
        if (prop === 'threadLabel') threadRenders += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
    const seq = {
      fps: 30,
      aspect: '16:9' as const,
      clips: [
        {
          id: 'cut-1',
          label: 'opening.mp4',
          srcUrl: SOURCES[0]!.srcUrl,
          thumbUrl: null,
          sourceFps: 30,
          sourceFrames: 120,
          inFrame: 0,
          frames: 120,
          speedNum: 1,
          speedDen: 1,
          phase: 0,
          volume: 1,
          muted: false,
        },
      ],
      captions: [],
    };
    const stubSession = {
      entries: [],
      draft: '',
      setDraft: () => undefined,
      threadReady: true,
      cutChips: [],
      showPlayheadChip: true,
      attachments: [],
      attachNotice: null,
      insertingAttachmentId: null,
      attachFiles: () => undefined,
      attachDraggedSource: () => false,
      retryAttachment: () => undefined,
      removeAttachment: () => undefined,
      insertAttachment: () => undefined,
      getContextPayload: () => ({ selectedClipIds: [] }),
      dismissChip: () => undefined,
      submit: () => undefined,
      answerAsk: () => undefined,
      applyProposal: () => undefined,
      dismissProposal: () => undefined,
      undoEntry: () => undefined,
      clearThread: () => undefined,
      focusEntryId: null,
      openProposal: false,
      activeDraft: null,
      activeDraftInherit: null,
      busy: false,
      assistEnabled: false,
      blocked: false,
    };
    dom = await mountDom(
      h(EditorChatPanel, {
        session: stubSession,
        sequence: seq,
        canUndo: false,
        readOnly: false,
        status: 'ready',
        chatCopy: trackedCopy,
        examples: [],
        playheadBus: bus,
        placement: 'side',
        onSetDock: () => undefined,
      }),
    );
    expect(panelRenders).toBeGreaterThan(0);
    expect(threadRenders).toBeGreaterThan(0);
    panelRenders = 0;
    threadRenders = 0;
    for (let f = 1; f <= 30; f += 1) {
      await act(async () => {
        bus.set(f, false, f * 33);
      });
    }
    expect(panelRenders).toBe(0);
    expect(threadRenders).toBe(0);
    expect(dom.query('[data-editor-chat-chip="playhead"]')?.textContent).toContain('0:01:00');
    await dom.unmount();
    dom = null;

    // 2. Mounted full EditorV2: 30 ArrowRight ticks leave [data-editor-chat-thread] untouched while updating playhead chip
    const m = await mountRealChatEditor();
    const threadEl = m.dom.query('[data-editor-chat-thread]')!;
    const threadHtmlBefore = threadEl.textContent;
    const threadFirstChildBefore = threadEl.firstChild;

    for (let i = 0; i < 30; i += 1) {
      await m.act(async () => {
        (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent({
          type: 'keydown',
          key: 'ArrowRight',
          code: 'ArrowRight',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          isComposing: false,
          keyCode: 39,
          target: m.dom.document.body,
          preventDefault() {},
          stopPropagation() {},
        });
      });
    }
    expect(m.dom.query('[data-editor-preview]')!.getAttribute('data-editor-playhead')).toBe('30');
    expect(threadEl.textContent).toBe(threadHtmlBefore);
    expect(threadEl.firstChild).toBe(threadFirstChildBefore);
    expect(m.dom.query('[data-editor-chat-chip="playhead"]')?.textContent).toContain('0:01:00');
    expect(m.fetchSpy).not.toHaveBeenCalled();
  });

  it('drives the parser from visible chips, supports undo -> redo -> undo, and auto-scrolls only when pinned to bottom', async () => {
    const m = await mountRealChatEditor();
    const thread = m.dom.query('[data-editor-chat-thread]') as unknown as {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      dispatchEvent(ev: unknown): boolean;
    };

    // Pin at bottom and verify auto-scroll on new turn
    thread.scrollHeight = 400;
    thread.clientHeight = 200;
    thread.scrollTop = 200;

    // Select cut 2 in timeline (timeline clips select via pointerdown or Enter) -> chip shows "컷 2"
    await m.dom.keyDown('Enter', { target: m.dom.query('[data-editor-clip="2"]')! });
    expect(m.dom.query('[data-editor-chat-chip="cut"]')?.textContent).toContain('컷 2');
    await m.dom.setValue('[data-editor-chat-input]', '2초로 줄여 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    const proposal = m.dom.query('[data-editor-chat-proposal="open"]');
    expect(proposal).not.toBeNull();
    expect(proposal!.getAttribute('tabindex')).toBe('-1');
    expect(proposal!.textContent).toContain('2번 컷이 2초가 됩니다');
    expect(m.dom.document.activeElement).toBe(proposal);
    expect(thread.scrollTop).toBe(400);

    // Apply -> Undo -> Redo -> Undo lifecycle on applied card
    await m.dom.click('[data-editor-chat-apply]');
    expect(m.dom.query('[data-editor-chat-applied="active"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-undo]')).not.toBeNull();

    await m.dom.click('[data-editor-chat-undo]');
    expect(m.dom.query('[data-editor-chat-applied="undone"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-undo]')).toBeNull();

    // Redo via top bar -> applied card restores active state & undo button!
    const redoBtn = m.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.top.redo)!;
    await m.dom.click(redoBtn);
    expect(m.dom.query('[data-editor-chat-applied="active"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-undo]')).not.toBeNull();

    // Undo a second time works cleanly
    await m.dom.click('[data-editor-chat-undo]');
    expect(m.dom.query('[data-editor-chat-applied="undone"]')).not.toBeNull();

    // Aspect proposal actually updates preview [data-editor-frame][data-aspect] on apply and restores on undo (S2)
    expect(m.dom.query('[data-editor-frame]')!.getAttribute('data-aspect')).toBe('16:9');
    await m.dom.setValue('[data-editor-chat-input]', '세로 영상으로 바꿔 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await m.dom.click('[data-editor-chat-apply]');
    expect(m.dom.query('[data-editor-frame]')!.getAttribute('data-aspect')).toBe('9:16');
    await m.dom.click('[data-editor-chat-undo]');
    expect(m.dom.query('[data-editor-frame]')!.getAttribute('data-aspect')).toBe('16:9');

    // Scroll UP away from bottom -> new turn must NOT force scrollTop to bottom!
    thread.scrollHeight = 800;
    thread.clientHeight = 200;
    thread.scrollTop = 50;
    await m.act(async () => {
      thread.dispatchEvent({ type: 'scroll', bubbles: false, cancelable: false, target: thread, currentTarget: thread });
    });

    // Dismiss cut 2 chip -> cut-less trim must NOT target cut 2, and note carries pressable example chips (W6)
    await m.dom.click('[data-editor-chat-chip-remove="cut:cut-2"]');
    expect(m.dom.query('[data-editor-chat-chips]')).toBeNull();
    await m.dom.setValue('[data-editor-chat-input]', '2초로 줄여 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    expect(m.dom.query('[data-editor-chat-note] p')?.textContent).toBe(studioEditorKo.real.assistUnknown);
    expect(thread.scrollTop).toBe(50);

    // W6: pressing a note example chip fills the text box without sending
    const entriesBeforeChip = m.dom.queryAll('[data-editor-chat-entry]').length;
    const noteChip = m.dom.query('[data-editor-chat-note-example="aspect"]');
    expect(noteChip).not.toBeNull();
    await m.dom.click(noteChip!);
    expect((m.dom.query('[data-editor-chat-input]') as unknown as { value: string }).value).toBe(noteChip!.textContent);
    expect(m.dom.document.activeElement).toBe(m.dom.query('[data-editor-chat-input]'));
    expect(m.dom.queryAll('[data-editor-chat-entry]').length).toBe(entriesBeforeChip);

    // Clear thread wipes UI and storage
    const chatKey = editorChatStorageKey({ organizationId: ORG, userId: USER, filmId: m.filmId });
    expect(m.storageMap.has(chatKey)).toBe(true);
    await m.dom.click('[data-editor-chat-clear]');
    expect(m.dom.query('[data-editor-chat-empty]')).not.toBeNull();
    expect(m.storageMap.has(chatKey)).toBe(false);
    expect(m.fetchSpy).not.toHaveBeenCalled();
  });

  it('guards Enter / Shift+Enter / Escape / IME composition, supports / shortcut & Esc focus return (W5), ignores / in text/number inputs, throttles playback over 10s (W4), shows earlier / conflict in ShortcutsPanel, switches above-1360 ARIA to regions, and disables read-only films', async () => {
    // W4: PlayheadBus throttles 60fps playback over 10s under fake timers to <= 4/s (<= 40 notifies) and flushes exact frame on stop
    vi.useFakeTimers();
    try {
      const bus = createPlayheadBus(0, 250);
      let busNotifies = 0;
      bus.subscribe(() => {
        busNotifies += 1;
      });
      for (let f = 1; f <= 600; f += 1) {
        vi.advanceTimersByTime(1000 / 60);
        bus.set(f, true, Date.now());
      }
      expect(busNotifies).toBeLessThanOrEqual(40);
      expect(bus.get()).toBe(600);
      bus.set(600, false, Date.now() + 20);
      expect(bus.getDisplay()).toBe(600);
    } finally {
      vi.useRealTimers();
    }

    const m = await mountRealChatEditor();
    const input = m.dom.query('[data-editor-chat-input]')!;
    const preview = m.dom.query('[data-editor-preview]')!;
    const exportBtn = m.dom.query('[data-editor-export]')!;

    // W5: '/' focuses chat input from anywhere outside text fields, and Esc returns focus to previous control
    exportBtn.focus();
    expect(m.dom.document.activeElement).toBe(exportBtn);
    await m.act(async () => {
      (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent({
        type: 'keydown',
        key: '/',
        code: 'Slash',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
        keyCode: 191,
        target: exportBtn,
        preventDefault() {},
        stopPropagation() {},
      });
    });
    expect(m.dom.document.activeElement).toBe(input);

    // Esc returns focus back to exportBtn
    await m.dom.keyDown('Escape', { target: input });
    expect(m.dom.document.activeElement).toBe(exportBtn);

    // '/' pressed while focused inside <input type="text"> or <input type="number"> does NOT steal focus to chat
    for (const inputType of ['text', 'number'] as const) {
      const otherInput = m.dom.document.createElement('input');
      otherInput.setAttribute('type', inputType);
      (otherInput as unknown as { type: string }).type = inputType;
      m.dom.document.body.appendChild(otherInput);
      otherInput.focus();
      await m.act(async () => {
        (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent({
          type: 'keydown',
          key: '/',
          code: 'Slash',
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          isComposing: false,
          keyCode: 191,
          target: otherInput,
          preventDefault() {},
          stopPropagation() {},
        });
      });
      expect(m.dom.document.activeElement, `input[type=${inputType}]`).toBe(otherInput);
      m.dom.document.body.removeChild(otherInput);
    }

    // Shortcut appears in ShortcutsPanel for open chat
    await m.dom.click('[data-editor-shortcuts-button]');
    const focusRow = m.dom.query('[data-editor-shortcut-row="focusChat"]');
    expect(focusRow).not.toBeNull();
    expect(focusRow!.textContent).toContain(studioEditorChatKo.shortcutFocusChat);
    expect(focusRow!.textContent).toContain('/');
    await m.dom.click('[data-editor-shortcuts-button]');

    input.focus();

    // Dismiss playhead chip works via stable key
    await m.dom.click(`[data-editor-chat-chip-remove="${PLAYHEAD_CHIP_KEY}"]`);
    expect(m.dom.query('[data-editor-chat-chips]')).toBeNull();

    await m.dom.setValue(input, '세로 영상으로 바꿔 줘');
    await m.dom.keyDown('ArrowRight', { target: input });
    expect(preview.getAttribute('data-editor-playhead')).toBe('0');

    await m.dom.keyDown('Enter', { target: input, shiftKey: true });
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).toBeNull();

    await m.act(async () => {
      input.dispatchEvent({
        type: 'keydown',
        key: 'Enter',
        code: 'Enter',
        keyCode: 229,
        isComposing: true,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
      } as never);
    });
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).toBeNull();

    let blurred = false;
    (input as unknown as { blur: () => void }).blur = () => {
      blurred = true;
    };
    await m.dom.keyDown('Escape', { target: input });
    expect(blurred).toBe(true);

    input.focus();
    await m.dom.keyDown('Enter', { target: input });
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();
    expect(m.fetchSpy).not.toHaveBeenCalled();

    await m.dom.unmount();
    dom = null;

    // Read-only film disables input, send, and examples
    const ro = await mountRealChatEditor({ canEdit: false });
    expect(ro.dom.query('[data-editor-chat-input]')!.hasAttribute('disabled')).toBe(true);
    expect(ro.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(true);
    expect(ro.dom.query('[data-editor-chat-input]')!.getAttribute('placeholder')).toBe(studioEditorChatKo.placeholderReadOnly);
    expect(ro.dom.query('[data-editor-chat-example="aspect"]')!.hasAttribute('disabled')).toBe(true);
    expect(ro.fetchSpy).not.toHaveBeenCalled();
    await ro.dom.unmount();
    dom = null;

    // SMALL: earlier '/' shortcut conflict shows notice on focusChat row & allows taking it
    const conflictStorage = new Map<string, string>([
      [
        'twings_editor_shortcuts_v1',
        JSON.stringify({ set: 'everyday', overrides: { everyday: { play: ['Slash'] }, pro: {} } }),
      ],
    ]);
    const mc = await mountRealChatEditor({ storage: conflictStorage });
    await mc.dom.click('[data-editor-shortcuts-button]');
    const conflictNotice = mc.dom.query('[data-editor-shortcut-row="focusChat"] [data-editor-shortcut-notice="taken"]');
    expect(conflictNotice).not.toBeNull();
    expect(conflictNotice!.textContent).toContain(studioEditorKo.shortcuts.actions.play);
    await mc.dom.click('[data-editor-shortcut-row="focusChat"] [data-editor-shortcut-take]');
    expect(mc.dom.query('[data-editor-shortcut-row="focusChat"]')?.textContent).toContain('/');
    await mc.dom.unmount();
    dom = null;

    // SMALL: above 1360px, hidden tab bar is aria-hidden without role=tablist and both panes present as labeled regions
    const wide = await mountRealChatEditor({ wideViewport: true });
    const tabBar = wide.dom.query('[data-editor-right-tabs]')!;
    expect(tabBar.getAttribute('aria-hidden')).toBe('true');
    expect(tabBar.getAttribute('role')).toBeNull();
    expect(wide.dom.query('[data-editor-right-pane="inspector"]')!.getAttribute('role')).toBe('region');
    expect(wide.dom.query('[data-editor-right-pane="inspector"]')!.getAttribute('aria-label')).toBe(studioEditorChatKo.tabInspector);
    expect(wide.dom.query('[data-editor-right-pane="chat"]')!.getAttribute('role')).toBe('region');
    expect(wide.dom.query('[data-editor-right-pane="chat"]')!.getAttribute('aria-label')).toBe(studioEditorChatKo.tabChat);
  });

  it('applies stored bar dock via pre-paint script before hydrateRoot with zero hydration warnings (W2)', async () => {
    const storageMap = new Map<string, string>([
      [composeStorageKey(ORG), JSON.stringify(makeStoredFilm())],
      [LAYOUT_STORAGE_KEY, JSON.stringify({ v: 1, lanes: {}, timelineHeight: null, assistDock: 'bar', assistDockSet: true })],
    ]);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network'); }));
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('Image', class { onerror: (() => void) | null = null; set src(_v: string) { Promise.resolve().then(() => this.onerror?.()); } });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storageMap.get(k) ?? null,
      setItem: (k: string, v: string) => storageMap.set(k, v),
      removeItem: (k: string) => storageMap.delete(k),
      clear: () => storageMap.clear(),
    });

    const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
    const element = h(EditorV2, {
      copy: studioEditorKo,
      currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
      initialWorkspace: 'cut',
      real: {
        organizationId: ORG,
        organizationName: 'Sample Brand',
        canEdit: true,
        sources: SOURCES,
        sampleBase: null,
        filmId: 'film-w2',
      },
      realChat: { userId: USER, filmId: 'film-w2' },
      chatCopy: studioEditorChatKo,
      nonce: 'w2-nonce',
    });
    const html = renderToString(element);
    expect(html).toContain('data-dock="side"');
    expect(html).toContain('data-ev-prepaint=""');

    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    const localDom = await mountDom(null);
    const selectProto = Object.getPrototypeOf(localDom.document.createElement('select')) as object;
    const elProto = Object.getPrototypeOf(selectProto) as Record<string, unknown>;
    if (!('clientWidth' in elProto)) {
      Object.defineProperty(elProto, 'clientWidth', { configurable: true, get: () => 960 });
    }
    if (!('dataset' in elProto)) {
      Object.defineProperty(elProto, 'dataset', {
        get(this: { attributes: Record<string, string> }) {
          const attrs = this.attributes;
          return new Proxy({}, {
            get: (_t, k) => attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`],
            set: (_t, k, v) => ((attrs[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(v)), true),
          });
        },
      });
    }
    const taProto = Object.getPrototypeOf(localDom.document.createElement('textarea')) as Record<string, unknown>;
    if (!('defaultValue' in taProto)) {
      const defaults = new WeakMap<object, string>();
      Object.defineProperty(taProto, 'defaultValue', {
        configurable: true,
        get(this: object) { return defaults.get(this) ?? ''; },
        set(this: { _value?: string }, val: string) { const s = String(val ?? ''); defaults.set(this, s); this._value = s; },
      });
    }

    // Parse SSR HTML into host (keeping <script> body intact) and run pre-paint script before hydration
    const host = localDom.document.createElement('div');
    localDom.document.body.appendChild(host);
    const tokens = html.match(/<!--[\s\S]*?-->|<script[^>]*>[\s\S]*?<\/script>|<\/?[a-zA-Z][^>]*>|[^<]+/g) ?? [];
    const stack: unknown[] = [host];
    const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    for (const tok of tokens) {
      const parent = stack[stack.length - 1] as { appendChild(n: unknown): void };
      if (tok.startsWith('<!--')) {
        parent.appendChild(localDom.document.createComment(tok.slice(4, -3)));
      } else if (tok.startsWith('<script')) {
        const sm = tok.match(/^<script([^>]*)>([\s\S]*?)<\/script>$/i);
        if (!sm) continue;
        const node = localDom.document.createElement('script');
        for (const a of (sm[1] ?? '').matchAll(/([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g)) {
          node.setAttribute(a[1]!, a[2] !== undefined ? decode(a[2]) : '');
        }
        node.appendChild(localDom.document.createTextNode(sm[2] ?? ''));
        Object.defineProperty(node, 'innerHTML', {
          get: () => node.textContent,
          set: () => undefined,
          configurable: true,
        });
        parent.appendChild(node);
      } else if (tok.startsWith('</')) {
        if (stack.length > 1) stack.pop();
      } else if (tok.startsWith('<')) {
        const selfClose = tok.endsWith('/>');
        const m = tok.match(/^<([a-zA-Z0-9:-]+)([\s\S]*?)\/?>$/);
        if (!m) continue;
        const tag = m[1]!.toLowerCase();
        const node = localDom.document.createElement(tag);
        for (const a of (m[2] ?? '').matchAll(/([a-zA-Z0-9_:-]+)(?:="([^"]*)")?/g)) {
          const name = a[1]!.toLowerCase();
          const val = a[2] !== undefined ? decode(a[2]) : '';
          node.setAttribute(name, val);
          if (name === 'style') {
            for (const decl of val.split(';')) {
              const i = decl.indexOf(':');
              if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
            }
          }
        }
        if (tag === 'video') {
          (node as unknown as { muted: boolean; playsInline: boolean }).muted = node.hasAttribute('muted');
          (node as unknown as { muted: boolean; playsInline: boolean }).playsInline = node.hasAttribute('playsinline');
        }
        if (tag === 'input') {
          (node as unknown as { multiple: boolean }).multiple = node.hasAttribute('multiple');
        }
        const origGet = node.getAttribute.bind(node);
        const origHas = node.hasAttribute.bind(node);
        node.getAttribute = (k: string) => origGet(k) ?? origGet(k.toLowerCase());
        node.hasAttribute = (k: string) => origHas(k) || origHas(k.toLowerCase());
        parent.appendChild(node);
        if (!selfClose && !voidTags.has(tag)) stack.push(node);
      } else {
        parent.appendChild(localDom.document.createTextNode(decode(tok)));
      }
    }

    const ssrRoot = host.querySelector('[data-studio-editor-v2]')!;
    const scriptNode = ssrRoot.querySelector('script')!;
    scriptNode.removeAttribute('nonce');
    (localDom.document as unknown as { currentScript: unknown }).currentScript = scriptNode;
    new Function(scriptNode.textContent)();
    (localDom.document as unknown as { currentScript: unknown }).currentScript = null;

    // Pre-paint script flipped data-dock to 'bar' at 0ms before hydration!
    expect(ssrRoot.getAttribute('data-dock')).toBe('bar');

    const { hydrateRoot } = await import('react-dom/client');
    const recoverableSpy = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let hydrated: ReturnType<typeof hydrateRoot> | null = null;
    try {
      await act(async () => {
        hydrated = hydrateRoot(host as unknown as Element, element, { onRecoverableError: recoverableSpy });
      });
      expect(recoverableSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(host.querySelector('[data-studio-editor-v2]')!.getAttribute('data-dock')).toBe('bar');
      expect(host.querySelector('[data-editor-chat="bar"]')).not.toBeNull();
      expect(host.querySelector('[data-editor-chat="side"]')).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
      if (hydrated) {
        await act(async () => {
          hydrated!.unmount();
        });
      }
      await localDom.unmount();
    }
  });
});
