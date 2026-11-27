import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { fill } from '@/components/brand-studio/copy';
import { ASSIST_CUT_MAX_SEC } from '@/lib/brand-studio/editor-v2/assist-project';
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

function makeStoredFilm(clips?: ComposeClip[]) {
  const base = emptyComposerProject('16:9');
  const defaultClips: ComposeClip[] = [
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
  return { ...base, clips: clips ?? defaultClips };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === lower) return v;
        }
        return null;
      },
    },
    json: async () => body,
  };
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

async function mountPlannerEditor(opts: {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<unknown>;
  assistEnabled?: boolean;
  canEdit?: boolean;
  sample?: boolean;
  filmId?: string;
  storedClips?: ComposeClip[];
  sources?: EditorSource[];
} = {}) {
  const fetchSpy = vi.fn(
    opts.fetchImpl ??
      (async () =>
        jsonResponse({
          ok: true,
          kind: 'plan',
          steps: [{ do: 'aspect', aspect: '9:16' }],
        })),
  );
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

  const storageMap = new Map<string, string>();
  storageMap.set(composeStorageKey(ORG), JSON.stringify(makeStoredFilm(opts.storedClips)));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, val),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  });

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

  const filmId = opts.filmId ?? 'film-plan';
  const renderProps = (overrideFilmId = filmId) => ({
    copy: studioEditorKo,
    currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
    initialWorkspace: 'cut' as const,
    real: opts.sample
      ? null
      : {
          organizationId: ORG,
          organizationName: 'Sample Brand',
          canEdit: opts.canEdit ?? true,
          sources: opts.sources ?? SOURCES,
          sampleBase: null,
          filmId: overrideFilmId,
        },
    realChat: opts.sample
      ? null
      : {
          userId: USER,
          filmId: overrideFilmId,
          assistEnabled: opts.assistEnabled ?? true,
          locale: 'ko' as const,
        },
    chatCopy: opts.sample ? null : studioEditorChatKo,
  });

  await dom.rerender(h(EditorV2, renderProps()));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return { dom, act, fetchSpy, storageMap, EditorV2, renderProps };
}

async function flushAsync(act: (fn: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('editor-v2 real planner behind chat (Batch 2)', () => {
  it('runs happy path with draft preview, locks shortcuts & undo/redo while proposal is open, applies as 1 undo step, and supports undo answer', async () => {
    let callCount = 0;
    const m = await mountPlannerEditor({
      fetchImpl: async (_url, init) => {
        callCount += 1;
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { operation: string; input: Record<string, unknown> };
        expect(parsed.operation).toBe('assist.plan');
        if (callCount === 1) {
          return jsonResponse({
            ok: true,
            kind: 'plan',
            steps: [
              { do: 'aspect', aspect: '9:16' },
              { do: 'trim', clip: { clipId: 'cut-2' }, keep: 'start', seconds: 2 },
            ],
          });
        }
        return jsonResponse({ ok: true, kind: 'undo' });
      },
    });

    const preview = () => m.dom.query('[data-editor-preview]')!;
    const frame = () => m.dom.query('[data-editor-frame]')!;
    expect(frame().getAttribute('data-aspect')).toBe('16:9');

    await m.dom.setValue('[data-editor-chat-input]', '세로로 바꾸고 2번 컷 2초로 줄여 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);

    // Proposal opens with draft preview overlaid onto preview AND timeline
    const proposal = m.dom.query('[data-editor-chat-proposal="open"]');
    expect(proposal).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-draft-badge]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-draft-hint]')).not.toBeNull();
    expect(m.dom.query('[data-studio-editor-v2]')!.hasAttribute('data-chat-draft')).toBe(true);
    expect(frame().getAttribute('data-aspect')).toBe('9:16');
    expect(proposal!.textContent).toContain('화면을 세로 비율로 바꿉니다');
    expect(proposal!.textContent).toContain('2번 컷 길이 0:05:00 → 0:02:00');

    // S6: while draft is open, transport shortcuts (Space, ArrowRight, ArrowLeft, L/K/J, Home/End) WORK on the draft,
    // while editing actions (split, trimStart, trimEnd, remove), undo, and redo are BLOCKED!
    const undoTopBtn = m.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.top.undo)!;
    expect(undoTopBtn.hasAttribute('disabled')).toBe(true);
    const dispatchKey = async (key: string, code: string, extra: Record<string, unknown> = {}) => {
      await m.act(async () => {
        (window as unknown as { dispatchEvent(ev: unknown): boolean }).dispatchEvent({
          type: 'keydown',
          key,
          code,
          shiftKey: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          isComposing: false,
          keyCode: 0,
          target: m.dom.document.body,
          preventDefault() {},
          stopPropagation() {},
          ...extra,
        });
      });
    };

    // Transport works: ArrowRight steps forward 1 frame, Space toggles playback, KeyK stops, Home returns to 0
    await dispatchKey('ArrowRight', 'ArrowRight');
    expect(preview().getAttribute('data-editor-playhead')).toBe('1');
    await dispatchKey(' ', 'Space');
    await dispatchKey('k', 'KeyK');
    await dispatchKey('Home', 'Home');
    expect(preview().getAttribute('data-editor-playhead')).toBe('0');

    // Editing shortcuts are blocked: split (Ctrl+B), trim (Q/W), Delete, Undo (Ctrl+Z), Redo (Ctrl+Shift+Z)
    const clipCountBefore = m.dom.queryAll('[data-editor-clip]').length;
    await dispatchKey('ArrowRight', 'ArrowRight');
    await dispatchKey('b', 'KeyB', { ctrlKey: true });
    await dispatchKey('q', 'KeyQ');
    await dispatchKey('w', 'KeyW');
    await dispatchKey('Delete', 'Delete');
    await dispatchKey('z', 'KeyZ', { ctrlKey: true });
    await dispatchKey('Z', 'KeyZ', { ctrlKey: true, shiftKey: true });
    expect(m.dom.queryAll('[data-editor-clip]').length).toBe(clipCountBefore);
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();

    // Apply commits both steps in 1 undo step, removes draft lock, and W6: draftLockedHint disappears from applied card
    await m.dom.click('[data-editor-chat-apply]');
    expect(m.dom.query('[data-studio-editor-v2]')!.hasAttribute('data-chat-draft')).toBe(false);
    expect(m.dom.query('[data-editor-chat-applied="active"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-draft-hint]')).toBeNull();
    expect(frame().getAttribute('data-aspect')).toBe('9:16');
    expect(undoTopBtn.hasAttribute('disabled')).toBe(false);

    // Planner `undo` answer undoes the top-of-history chat apply in 1 step!
    await m.dom.setValue('[data-editor-chat-input]', '방금 거 취소해 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(frame().getAttribute('data-aspect')).toBe('16:9');
    expect(m.dom.query('[data-editor-chat-applied="undone"]')).not.toBeNull();

    // Asking to undo again when nothing is on top prints honest note
    await m.dom.setValue('[data-editor-chat-input]', '한 번 더 되돌려 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(m.dom.query('[data-editor-chat-note] p')?.textContent).toBe(studioEditorChatKo.noteNothingToUndo);
  });

  it('handles ask follow-up choices by re-sending original message + structured answer', async () => {
    const receivedInputs: Array<Record<string, unknown>> = [];
    const m = await mountPlannerEditor({
      fetchImpl: async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { input: Record<string, unknown> };
        receivedInputs.push(parsed.input);
        if (receivedInputs.length === 1) {
          return jsonResponse({
            ok: true,
            kind: 'ask',
            about: 'which_clip',
            choices: [{ clipId: 'cut-1' }, { clipId: 'cut-2' }],
          });
        }
        return jsonResponse({
          ok: true,
          kind: 'plan',
          steps: [{ do: 'trim', clip: { clipId: 'cut-2' }, keep: 'start', seconds: 2 }],
        });
      },
    });

    await m.dom.setValue('[data-editor-chat-input]', '2초로 줄여 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);

    const askCard = m.dom.query('[data-editor-chat-ask="open"]');
    expect(askCard).not.toBeNull();
    expect(askCard!.textContent).toContain(studioEditorChatKo.askWhichClip);
    expect(m.dom.query('[data-editor-chat-ask-choice="0"]')?.textContent).toBe('1번 컷');
    expect(m.dom.query('[data-editor-chat-ask-choice="1"]')?.textContent).toBe('2번 컷');

    await m.dom.click('[data-editor-chat-ask-choice="1"]');
    await flushAsync(m.act);

    expect(receivedInputs).toHaveLength(2);
    expect(receivedInputs[1]!.message).toBe('2초로 줄여 줘');
    expect(receivedInputs[1]!.answer).toEqual({ about: 'which_clip', value: { clipId: 'cut-2' } });
    expect(m.dom.query('[data-editor-chat-ask="answered"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();
  });

  it('guards double-send while in flight (keeps textarea editable), marks late answer stale if timeline changed, and aborts on unmount & film switch', async () => {
    let resolveFirst!: (val: unknown) => void;
    let firstSignal: AbortSignal | undefined;
    const m = await mountPlannerEditor({
      fetchImpl: (_url, init) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      },
    });

    const input = m.dom.query('[data-editor-chat-input]')!;
    await m.dom.setValue(input, '세로로 바꿔 줘');
    await m.dom.submit('[data-editor-chat="side"] form');

    // Pending bubble visible, send button disabled, textarea stays enabled for typing next thought
    expect(m.dom.query('[data-editor-chat-pending]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(true);
    expect(input.hasAttribute('disabled')).toBe(false);

    // Typing and pressing Enter / submitting while busy does NOT trigger a second fetch
    await m.dom.setValue(input, '다음 요청 미리 적기');
    await m.dom.keyDown('Enter', { target: input });
    await m.dom.submit('[data-editor-chat="side"] form');
    expect(m.fetchSpy).toHaveBeenCalledTimes(1);

    // Timeline changes by hand while waiting -> late answer arrives as `stale`, never opens preview!
    await m.dom.click('[data-editor-aspect="9:16"]');
    resolveFirst(
      jsonResponse({
        ok: true,
        kind: 'plan',
        steps: [{ do: 'trim', clip: { clipId: 'cut-2' }, keep: 'start', seconds: 2 }],
      }),
    );
    await flushAsync(m.act);

    expect(m.dom.query('[data-editor-chat-proposal="stale"]')).not.toBeNull();
    expect(m.dom.query('[data-editor-chat-proposal="open"]')).toBeNull();
    expect(m.dom.query('[data-editor-chat-draft-hint]')).toBeNull();
    expect(m.dom.query('[data-studio-editor-v2]')!.hasAttribute('data-chat-draft')).toBe(false);

    // Scope/film switch while in flight aborts cleanly with no error note
    await m.dom.setValue(input, '1번 컷 2초로');
    await m.dom.submit('[data-editor-chat="side"] form');
    const secondSignal = firstSignal!;
    expect(secondSignal.aborted).toBe(false);
    await m.dom.rerender(h(m.EditorV2, m.renderProps('film-other')));
    expect(secondSignal.aborted).toBe(true);
    expect(m.dom.query('[data-editor-chat-note]')).toBeNull();

    // W7: unmount while in flight aborts cleanly AND preserves the interrupted sentence as unsent draft in storage!
    await m.dom.setValue('[data-editor-chat-input]', '언마운트 테스트 문장');
    await m.dom.submit('[data-editor-chat="side"] form');
    const thirdSignal = firstSignal!;
    expect(thirdSignal.aborted).toBe(false);
    await m.dom.unmount();
    dom = null;
    expect(thirdSignal.aborted).toBe(true);
    const savedRaw = m.storageMap.get(`twings_editor_chat_v1:${ORG}:${USER}:film-other`);
    expect(savedRaw).toBeDefined();
    const savedParsed = JSON.parse(savedRaw!) as { draft?: string; entries: Array<{ text?: string }> };
    expect(savedParsed.draft).toBe('언마운트 테스트 문장');
    expect(savedParsed.entries.some((e) => e.text === '언마운트 테스트 문장')).toBe(false);
  });

  it('enforces 600s cut cap and 24-cut cap before calling fetch', async () => {
    const longSource: EditorSource = {
      ...SOURCES[0]!,
      seconds: 610,
      durationMs: 610_000,
    };
    const longClip: ComposeClip = {
      id: 'long-1',
      sourceKind: 'asset',
      assetId: ASSET_1,
      label: 'long.mp4',
      srcUrl: longSource.srcUrl,
      thumbUrl: null,
      durationSec: 610,
      trimStartSec: 0,
      trimEndSec: 610,
      volume: 1,
      muted: false,
    };
    const mLong = await mountPlannerEditor({ storedClips: [longClip], sources: [longSource] });
    await mLong.dom.setValue('[data-editor-chat-input]', '세로로 바꿔 줘');
    await mLong.dom.submit('[data-editor-chat="side"] form');
    expect(mLong.fetchSpy).not.toHaveBeenCalled();
    expect(mLong.dom.query('[data-editor-chat-note] p')?.textContent).toBe(
      fill(studioEditorChatKo.noteTooLongCut, { minutes: Math.round(ASSIST_CUT_MAX_SEC / 60) }),
    );
    await mLong.dom.unmount();
    dom = null;

    const manyClips: ComposeClip[] = Array.from({ length: 25 }, (_, i) => ({
      id: `many-${i + 1}`,
      sourceKind: 'asset' as const,
      assetId: ASSET_1,
      label: `c${i + 1}.mp4`,
      srcUrl: SOURCES[0]!.srcUrl,
      thumbUrl: null,
      durationSec: 2,
      trimStartSec: 0,
      trimEndSec: 2,
      volume: 1,
      muted: false,
    }));
    // Note: parseStoredProject caps loaded clips at 24 (MAX_COMPOSE_CLIPS), so validateSequenceForAssist's 24-cut
    // guard is verified directly in assist-project.test.ts while the mounted editor loads 24 cleanly.
    const mMany = await mountPlannerEditor({ storedClips: manyClips });
    expect(mMany.dom.queryAll('[data-editor-clip]').length).toBeLessThanOrEqual(24);
  });

  it('surfaces honest notes for every failure row while leaving the film untouched', async () => {
    const cases: Array<{ name: string; reply: () => Promise<unknown>; expectContains: string }> = [
      { name: 'network reject', reply: async () => { throw new Error('offline'); }, expectContains: studioEditorChatKo.noteUnavailable },
      { name: '429 rate_limited with retryAfterSec', reply: async () => jsonResponse({ ok: false, code: 'rate_limited', retryAfterSec: 45 }, 429), expectContains: '45초' },
      { name: '429 rate_limited without retryAfterSec (W5)', reply: async () => jsonResponse({ ok: false, code: 'rate_limited' }, 429), expectContains: studioEditorChatKo.noteRateLimitedNoWait },
      { name: '400 invalid', reply: async () => jsonResponse({ ok: false, code: 'invalid' }, 400), expectContains: studioEditorChatKo.noteInvalid },
      { name: '403 forbidden', reply: async () => jsonResponse({ ok: false, code: 'forbidden' }, 403), expectContains: studioEditorChatKo.noteForbidden },
      { name: '404 closed', reply: async () => jsonResponse({ ok: false, code: 'not_found' }, 404), expectContains: studioEditorChatKo.noteClosed },
      { name: '500 unavailable', reply: async () => jsonResponse({ ok: false }, 500), expectContains: studioEditorChatKo.noteUnavailable },
      { name: 'malformed JSON', reply: async () => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => { throw new SyntaxError('bad'); } }), expectContains: studioEditorChatKo.noteUnavailable },
      { name: 'malformed plan missing clip (S1)', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'trim', keep: 'start', seconds: 2 }] }), expectContains: studioEditorChatKo.noteCouldNotPlan },
      { name: 'empty steps shows no change (S2)', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [] }), expectContains: studioEditorChatKo.noteNoChange },
      { name: 'well-formed unknown kind shows generic not-available note (B1)', reply: async () => jsonResponse({ ok: true, kind: 'bogus' }), expectContains: studioEditorChatKo.noteUnmapped },
      { name: 'music remove:true shows unsupported_music (B1)', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'sound', target: 'music', remove: true }] }), expectContains: studioEditorChatKo.noteUnsupportedMusic },
      { name: 'set_clip_cuts shows unsupported_scene_split (B1)', reply: async () => jsonResponse({ ok: true, kind: 'patches', patches: [{ op: 'set_clip_cuts', clipIndex: 0, cutMarkers: [1.5] }] }), expectContains: studioEditorChatKo.noteUnsupportedSceneSplit },
      { name: 'cannot not_timeline_edit', reply: async () => jsonResponse({ ok: true, kind: 'cannot', reason: 'not_timeline_edit' }), expectContains: studioEditorChatKo.noteNotTimelineEdit },
      { name: 'cannot nothing_to_edit', reply: async () => jsonResponse({ ok: true, kind: 'cannot', reason: 'nothing_to_edit' }), expectContains: studioEditorChatKo.noteNothingToEdit },
      { name: 'cannot not_possible', reply: async () => jsonResponse({ ok: true, kind: 'cannot', reason: 'not_possible' }), expectContains: studioEditorChatKo.noteNotPossible },
      { name: 'cannot could_not_plan', reply: async () => jsonResponse({ ok: true, kind: 'cannot', reason: 'could_not_plan' }), expectContains: studioEditorChatKo.noteCouldNotPlan },
      { name: 'mixed plan trim + look refuses all (W3)', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'cut-1' }, keep: 'start', seconds: 2 }, { do: 'look', preset: 'kodak-2383-warm' }] }), expectContains: '아무것도 적용하지 않았어요' },
      { name: 'unsupported music', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'sound', target: 'music', muted: true }] }), expectContains: '아무것도 적용하지 않았어요' },
      { name: 'unsupported captions', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'caption_add', text: 'hi', where: 'start' }] }), expectContains: '아무것도 적용하지 않았어요' },
      { name: 'unsupported scene split', reply: async () => jsonResponse({ ok: true, kind: 'patches', patches: [{ op: 'split_clip_cuts', clipIndex: 0, cutMediaSecs: [1.5] }] }), expectContains: '아무것도 적용하지 않았어요' },
      { name: 'missing target cut', reply: async () => jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'remove', clip: { clipId: 'ghost-cut' } }] }), expectContains: studioEditorChatKo.noteTargetMissing },
    ];

    let idx = 0;
    const m = await mountPlannerEditor({
      fetchImpl: () => cases[idx++]!.reply(),
    });

    for (const c of cases) {
      await m.dom.setValue('[data-editor-chat-input]', `테스트 ${c.name}`);
      await m.dom.submit('[data-editor-chat="side"] form');
      await flushAsync(m.act);
      const notes = m.dom.queryAll('[data-editor-chat-note] p');
      const last = notes[notes.length - 1]?.textContent ?? '';
      expect(last, c.name).toContain(c.expectContains);
      if (c.name.includes('without retryAfterSec')) {
        expect(last).not.toContain('60초');
      }
      expect(m.dom.query('[data-editor-chat-pending]')).toBeNull();
      expect(m.dom.query('[data-editor-frame]')!.getAttribute('data-aspect')).toBe('16:9');
      expect(m.dom.query('[data-editor-chat-proposal="open"]')).toBeNull();
    }
  });

  it('sends request body matching visible chips exactly for playhead, removed playhead, one cut, multi-cut, and removed cut (S4)', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const m = await mountPlannerEditor({
      fetchImpl: async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { input: Record<string, unknown> };
        sent.push(parsed.input);
        return jsonResponse({ ok: true, kind: 'cannot', reason: 'not_timeline_edit' });
      },
    });

    // 1. Default playhead chip visible -> sends playheadSec, no selectedClipId
    expect(m.dom.query('[data-editor-chat-chip="playhead"]')).not.toBeNull();
    await m.dom.setValue('[data-editor-chat-input]', '요청 1');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(sent[0]!.playheadSec).toBe(0);
    expect('selectedClipId' in sent[0]!).toBe(false);

    // 2. Playhead chip dismissed -> sends NEITHER playheadSec NOR selectedClipId!
    await m.dom.click('[data-editor-chat-chip-remove="playhead"]');
    expect(m.dom.query('[data-editor-chat-chips]')).toBeNull();
    await m.dom.setValue('[data-editor-chat-input]', '요청 2');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect('playheadSec' in sent[1]!).toBe(false);
    expect('selectedClipId' in sent[1]!).toBe(false);

    // 3. One cut selected (cut 2) -> 1 cut chip, sends selectedClipId: 'cut-2', no playheadSec
    await m.dom.keyDown('Enter', { target: m.dom.query('[data-editor-clip="2"]')! });
    expect(m.dom.queryAll('[data-editor-chat-chip="cut"]')).toHaveLength(1);
    await m.dom.setValue('[data-editor-chat-input]', '요청 3');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(sent[2]!.selectedClipId).toBe('cut-2');
    expect('playheadSec' in sent[2]!).toBe(false);

    // 4. Multiple cuts selected (shift-select cut 1 in addition to cut 2) -> STILL 1 chip for primary ('cut-2')!
    await m.dom.keyDown('Enter', { target: m.dom.query('[data-editor-clip="1"]')!, shiftKey: true });
    expect(m.dom.queryAll('[data-editor-chat-chip="cut"]')).toHaveLength(1);
    expect(m.dom.query('[data-editor-chat-chip="cut"]')?.textContent).toContain('컷 2');
    await m.dom.setValue('[data-editor-chat-input]', '요청 4');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(sent[3]!.selectedClipId).toBe('cut-2');
    expect('playheadSec' in sent[3]!).toBe(false);

    // 5. Cut chip dismissed -> sends NEITHER selectedClipId NOR playheadSec!
    await m.dom.click('[data-editor-chat-chip-remove="cut:cut-2"]');
    expect(m.dom.query('[data-editor-chat-chips]')).toBeNull();
    await m.dom.setValue('[data-editor-chat-input]', '요청 5');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect('selectedClipId' in sent[4]!).toBe(false);
    expect('playheadSec' in sent[4]!).toBe(false);
  });

  it('aborts hung planner request after 30s timeout, shows unavailable note, restores sentence in text box, and re-enables send (W1)', async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const m = await mountPlannerEditor({
        fetchImpl: (_url, init) => {
          capturedSignal = init?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          });
        },
      });

      const input = m.dom.query('[data-editor-chat-input]') as unknown as { value: string };
      await m.dom.setValue('[data-editor-chat-input]', '멈춘 요청 테스트 문장');
      await m.dom.submit('[data-editor-chat="side"] form');
      expect(m.dom.query('[data-editor-chat-pending]')).not.toBeNull();
      expect(m.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(true);

      await m.act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(capturedSignal?.aborted).toBe(true);
      expect(m.dom.query('[data-editor-chat-pending]')).toBeNull();
      expect(m.dom.query('[data-editor-chat-note] p')?.textContent).toBe(studioEditorChatKo.noteUnavailable);
      expect(input.value).toBe('멈춘 요청 테스트 문장');
      expect(m.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(false);

      // SMALL #2: if customer already typed new text while waiting, timeout keeps new text AND quotes old sentence in note!
      await m.dom.setValue('[data-editor-chat-input]', '먼저 보낸 문장');
      await m.dom.submit('[data-editor-chat="side"] form');
      await m.dom.setValue('[data-editor-chat-input]', '새로 적고 있던 문장');
      await m.act(async () => {
        vi.advanceTimersByTime(30_000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(input.value).toBe('새로 적고 있던 문장');
      const notes = m.dom.queryAll('[data-editor-chat-note] p');
      // Round 5 #5: both timeout cases share the exact same base sentence (`noteUnavailable`), appending the quote only here!
      const quotedText = notes[notes.length - 1]?.textContent ?? '';
      expect(quotedText.startsWith(studioEditorChatKo.noteUnavailable)).toBe(true);
      expect(quotedText).toContain('먼저 보낸 문장');
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns noteCouldNotPlan and leaves film untouched when planner returns seconds: null or string where number expected (Round 5 #6)', async () => {
    const responses = [
      jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'cut-1' }, keep: 'start', seconds: null }] }),
      jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'trim', clip: { clipId: 'cut-1' }, keep: 'start', seconds: '2' }] }),
    ];
    let idx = 0;
    const m = await mountPlannerEditor({
      fetchImpl: async () => responses[idx++]!,
    });

    for (const prompt of ['1번 컷 줄여 줘', '1번 컷 2초로']) {
      await m.dom.setValue('[data-editor-chat-input]', prompt);
      await m.dom.submit('[data-editor-chat="side"] form');
      await flushAsync(m.act);
      const notes = m.dom.queryAll('[data-editor-chat-note] p');
      expect(notes[notes.length - 1]?.textContent).toBe(studioEditorChatKo.noteCouldNotPlan);
      expect(m.dom.query('[data-editor-chat-proposal="open"]')).toBeNull();
      expect(m.dom.queryAll('[data-editor-clip]')).toHaveLength(2);
    }
  });

  it('produces the exact same 2-parent frameV2.from chain and toStored equality via commitChatEdit vs manual splitAtPlayhead -> splitAtPlayhead -> removeClips (Round 5 #4)', async () => {
    const { useEditor } = await import('@/components/brand-studio/editor-v2/use-editor');
    const { applyResolvedStepsToSequence } = await import('@/lib/brand-studio/editor-v2/assist-apply');
    const { lineageOf } = await import('@/lib/brand-studio/editor-v2/stored');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');

    const baseFilm = {
      ...makeStoredFilm([
        {
          id: 'cut-1',
          sourceKind: 'asset',
          assetId: ASSET_1,
          label: 'opening.mp4',
          srcUrl: SOURCES[0]!.srcUrl,
          thumbUrl: null,
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
          thumbUrl: null,
          durationSec: 5,
          trimStartSec: 0,
          trimEndSec: 5,
          volume: 1,
          muted: false,
        },
      ]),
      colorGrade: { enabled: true, scope: 'selected_clip' as const, clipId: 'cut-2', presetId: 'kodak-2383-warm' as const },
    };

    const mountHook = async () => {
      const storedMap = new Map<string, string>();
      storedMap.set(composeStorageKey(ORG), JSON.stringify(baseFilm));
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => storedMap.get(k) ?? null,
        setItem: (k: string, v: string) => storedMap.set(k, v),
        removeItem: (k: string) => storedMap.delete(k),
        clear: () => storedMap.clear(),
      });
      vi.stubGlobal('Image', class { onerror: (() => void) | null = null; set src(_v: string) { Promise.resolve().then(() => this.onerror?.()); } });
      let ref!: ReturnType<typeof useEditor>;
      function Harness() {
        ref = useEditor(studioEditorKo, {
          real: { organizationId: ORG, canEdit: true, sources: SOURCES, sampleBase: null },
        });
        return null;
      }
      const mounted = await mountDom(h(Harness));
      await flushAsync(act);
      expect(ref.status).toBe('ready');
      return { mounted, getApi: () => ref };
    };

    // 1. Manual hook path: split cut-2 at 1s (frame 120+30=150) -> split right piece at 3s (frame 120+90=210) -> remove middle piece
    const manual = await mountHook();
    dom = manual.mounted;
    await act(async () => {
      manual.getApi().seek(150);
    });
    await act(async () => {
      manual.getApi().splitAtPlayhead();
    });
    const manualMiddleId = manual.getApi().doc.sequence.clips[2]!.id;
    await act(async () => {
      manual.getApi().seek(210);
    });
    await act(async () => {
      manual.getApi().splitAtPlayhead();
    });
    const manualTailId = manual.getApi().doc.sequence.clips[3]!.id;
    await act(async () => {
      manual.getApi().removeClips([manualMiddleId]);
    });
    const manualFilm = manual.getApi().filmView!.film;
    expect(lineageOf(manualFilm.clips[2]!)).toEqual([manualMiddleId, 'cut-2']);
    await manual.mounted.unmount();
    dom = null;

    // 2. Chat hook path: exact same sequence of splits (split cut-2 at 1s -> split c2b at 2s -> remove c2b) via commitChatEdit
    const chat = await mountHook();
    dom = chat.mounted;
    const nestedPlan = applyResolvedStepsToSequence(chat.getApi().doc.sequence, [
      { do: 'split', clip: { clipId: 'cut-2' }, at: 1 },
      { do: 'split', clip: { splitOf: 'cut-2', part: 'b' }, at: 2 },
      { do: 'remove', clip: { splitOf: 'cut-2', part: 'b' } },
    ]);
    expect(nestedPlan.ok).toBe(true);
    if (!nestedPlan.ok) return;
    expect(nestedPlan.inherit).toEqual([
      ['cut-2-b', 'cut-2'],
      ['cut-2-b-b', 'cut-2-b'],
    ]);
    await act(async () => {
      chat.getApi().commitChatEdit(() => nestedPlan.sequence, nestedPlan.inherit);
    });
    const chatFilm = chat.getApi().filmView!.film;
    expect(lineageOf(chatFilm.clips[2]!)).toEqual(['cut-2-b', 'cut-2']);

    // Normalize only generated split piece ids (newId('cut') vs deterministic '<id>-b' / '<id>-b-b') -> full toStored equality!
    const norm = (film: typeof manualFilm, firstId: string, secondId: string) =>
      JSON.parse(
        JSON.stringify(film)
          .replaceAll(secondId, '<PIECE_2>')
          .replaceAll(firstId, '<PIECE_1>'),
      );
    expect(norm(chatFilm, 'cut-2-b', 'cut-2-b-b')).toEqual(norm(manualFilm, manualMiddleId, manualTailId));
  });

  it('derives draft preview filmView with pending split inherit pairs equal to post-apply without mutating catalogue, and persists inherit through commitChatEdit (S1 + SMALL #1)', async () => {
    const { useEditor } = await import('@/components/brand-studio/editor-v2/use-editor');
    const { applyResolvedStepsToSequence } = await import('@/lib/brand-studio/editor-v2/assist-apply');
    const { activeColorGradeForFrame } = await import('@/lib/brand-studio/compose/timeline');
    const { storedCutFor } = await import('@/lib/brand-studio/editor-v2/export-plan');
    const { lineageOf } = await import('@/lib/brand-studio/editor-v2/stored');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');

    const storedMap = new Map<string, string>();
    const gradedFilm = {
      ...makeStoredFilm([
        {
          id: 'cut-1',
          sourceKind: 'asset',
          assetId: ASSET_1,
          label: 'opening.mp4',
          srcUrl: SOURCES[0]!.srcUrl,
          thumbUrl: null,
          durationSec: 4,
          trimStartSec: 0,
          trimEndSec: 4,
          volume: 1,
          muted: false,
        },
        {
          id: 'cut-2',
          sourceKind: 'asset',
          assetId: ASSET_1,
          label: 'same-footage.mp4',
          srcUrl: SOURCES[0]!.srcUrl,
          thumbUrl: null,
          durationSec: 4,
          trimStartSec: 0,
          trimEndSec: 4,
          volume: 1,
          muted: false,
        },
      ]),
      colorGrade: { enabled: true, scope: 'selected_clip' as const, clipId: 'cut-1', presetId: 'kodak-2383-warm' as const },
    };
    storedMap.set(composeStorageKey(ORG), JSON.stringify(gradedFilm));
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storedMap.get(k) ?? null,
      setItem: (k: string, v: string) => storedMap.set(k, v),
      removeItem: (k: string) => storedMap.delete(k),
      clear: () => storedMap.clear(),
    });
    vi.stubGlobal('Image', class { onerror: (() => void) | null = null; set src(_v: string) { Promise.resolve().then(() => this.onerror?.()); } });

    let apiRef!: ReturnType<typeof useEditor>;
    function Harness() {
      const api = useEditor(studioEditorKo, {
        real: { organizationId: ORG, canEdit: true, sources: SOURCES, sampleBase: null },
      });
      apiRef = api;
      return null;
    }

    dom = await mountDom(h(Harness));
    await flushAsync(act);
    expect(apiRef.status).toBe('ready');

    const splitPlan = applyResolvedStepsToSequence(apiRef.doc.sequence, [
      { do: 'split', clip: { clipId: 'cut-1' }, at: 2 },
    ]);
    expect(splitPlan.ok).toBe(true);
    if (!splitPlan.ok) return;

    // Draft preview view BEFORE Apply: includes inherit lineage & parent-scoped colour grade without mutating catalogue!
    const draftView = apiRef.previewDraftView(splitPlan.sequence, splitPlan.inherit)!;
    expect(lineageOf(draftView.film.clips[1]!)).toEqual(['cut-1']);
    expect(activeColorGradeForFrame(draftView.film, storedCutFor(draftView.film, draftView.sequence.clips[1]!, 1))).not.toBeNull();

    // Calling previewDraftView did NOT pollute catalogue: committing via commitChatEdit produces EQUAL filmView!
    await act(async () => {
      apiRef.commitChatEdit(() => splitPlan.sequence, splitPlan.inherit);
    });
    const appliedView = apiRef.filmView!;
    expect(draftView.film).toEqual(appliedView.film);
    expect(lineageOf(appliedView.film.clips[1]!)).toEqual(['cut-1']);

    // Undo restores exact pre-split clip count & film
    await act(async () => {
      apiRef.undo();
    });
    expect(apiRef.doc.sequence.clips.map((c) => c.id)).toEqual(['cut-1', 'cut-2']);
  });

  it('does not discard a response that resolves right before the 30s timeout timer fires (S3)', async () => {
    vi.useFakeTimers();
    try {
      let resolveResp!: (v: unknown) => void;
      const m = await mountPlannerEditor({
        fetchImpl: () =>
          new Promise((resolve) => {
            resolveResp = resolve;
          }),
      });
      await m.dom.setValue('[data-editor-chat-input]', '세로로 바꿔 줘');
      await m.dom.submit('[data-editor-chat="side"] form');
      resolveResp(jsonResponse({ ok: true, kind: 'plan', steps: [{ do: 'aspect', aspect: '9:16' }] }));
      await m.act(async () => {
        for (let i = 0; i < 6; i += 1) await Promise.resolve();
        vi.advanceTimersByTime(30_000);
        for (let i = 0; i < 4; i += 1) await Promise.resolve();
      });
      expect(m.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();
      expect(m.dom.query('[data-editor-chat-note]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks every public useEditor edit method at change() while draft is open, while commitChatEdit and cancel still work (S5 + B1)', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onerror: (() => void) | null = null;
        set src(_v: string) {
          Promise.resolve().then(() => this.onerror?.());
        }
      },
    );
    const { useEditor } = await import('@/components/brand-studio/editor-v2/use-editor');
    const { mountDom } = await import('@/tests/brands/_dom-harness');
    const { act } = await import('react');
    let apiRef!: ReturnType<typeof useEditor>;

    function Harness() {
      const api = useEditor(studioEditorKo, { real: null });
      apiRef = api;
      return null;
    }

    dom = await mountDom(h(Harness));
    const initialSeq = apiRef.doc.sequence;
    expect(initialSeq.clips.length).toBeGreaterThanOrEqual(2);

    // Activate draft lock via useEditor
    await act(async () => {
      apiRef.setDraftLocked(true);
    });

    // Every public edit method must be a complete no-op while draftLocked is true!
    await act(async () => {
      apiRef.setAspect('1:1');
      apiRef.trimEdge(0, 'end', -10);
      apiRef.moveClip(0, 1);
      apiRef.removeClips([initialSeq.clips[0]!.id]);
      apiRef.splitAtPlayhead();
      apiRef.trimToPlayhead('start');
      apiRef.setSpeed(0, 2, 1);
      apiRef.setConstantSpeed(0, 2);
      apiRef.setSpeedCurve(0, [
        { pos: 0, speed: 0.5 },
        { pos: 1, speed: 2 },
      ]);
      apiRef.resetSpeed(0);
      apiRef.setClipAudio(0, 0.2, true);
      apiRef.cutClips();
      apiRef.pasteClips();
      apiRef.duplicateClips();
      apiRef.edit((s) => ({ ...s, aspect: '4:5' }));
      apiRef.change((d) => ({ ...d, sequence: { ...d.sequence, aspect: '4:5' } }));
      apiRef.undo();
      apiRef.redo();
    });
    expect(apiRef.doc.sequence).toBe(initialSeq);

    // Chat's own commitChatEdit lifts lock and commits as 1 undo step!
    await act(async () => {
      apiRef.commitChatEdit((s) => ({ ...s, aspect: '9:16' }));
    });
    expect(apiRef.doc.sequence.aspect).toBe('9:16');
    expect(apiRef.canUndo).toBe(true);

    // After unlock (commit/cancel), undo works again
    await act(async () => {
      apiRef.undo();
    });
    expect(apiRef.doc.sequence).toBe(initialSeq);
  });

  it('recovers cleanly with noteCouldNotPlan when an unexpected exception is thrown inside the mapper (S1)', async () => {
    const assistApply = await import('@/lib/brand-studio/editor-v2/assist-apply');
    const spy = vi.spyOn(assistApply, 'applyResolvedStepsToSequence').mockImplementationOnce(() => {
      throw new Error('simulated mapper crash');
    });
    try {
      const m = await mountPlannerEditor({
        fetchImpl: async () =>
          jsonResponse({
            ok: true,
            kind: 'plan',
            steps: [{ do: 'aspect', aspect: '9:16' }],
          }),
      });
      await m.dom.setValue('[data-editor-chat-input]', '세로로 바꿔 줘');
      await m.dom.submit('[data-editor-chat="side"] form');
      await flushAsync(m.act);
      expect(m.dom.query('[data-editor-chat-pending]')).toBeNull();
      expect(m.dom.query('[data-editor-chat-note] p')?.textContent).toBe(studioEditorChatKo.noteCouldNotPlan);
      expect(m.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(true); // draft empty
      await m.dom.setValue('[data-editor-chat-input]', '다시 보내기');
      expect(m.dom.query('[data-editor-chat-send]')!.hasAttribute('disabled')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('respects kill switch (assistEnabled: false), viewer seat (canEdit: false), and sample mode with zero fetch', async () => {
    const mFallback = await mountPlannerEditor({ assistEnabled: false });
    expect(mFallback.dom.query('[data-editor-chat-hint="fallback"]')?.textContent).toBe(studioEditorChatKo.fallbackHint);
    await mFallback.dom.setValue('[data-editor-chat-input]', '세로 영상으로 바꿔 줘');
    await mFallback.dom.submit('[data-editor-chat="side"] form');
    expect(mFallback.fetchSpy).not.toHaveBeenCalled();
    expect(mFallback.dom.query('[data-editor-chat-proposal="open"]')).not.toBeNull();
    await mFallback.dom.unmount();
    dom = null;

    const mViewer = await mountPlannerEditor({ canEdit: false });
    expect(mViewer.dom.query('[data-editor-chat-input]')!.hasAttribute('disabled')).toBe(true);
    expect(mViewer.fetchSpy).not.toHaveBeenCalled();
    await mViewer.dom.unmount();
    dom = null;

    const mSample = await mountPlannerEditor({ sample: true });
    expect(mSample.dom.query('[data-editor-chat]')).toBeNull();
    expect(mSample.fetchSpy).not.toHaveBeenCalled();
  });
});
