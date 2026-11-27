import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { REF_DRAG_TYPE, encodeRefDrag, type RefSource } from '@/components/brand-studio/refs';
import { fill, studioUploadErrorLine } from '@/components/brand-studio/copy';
import { formatChatUploadFailure, type ChatUploadClient } from '@/components/brand-studio/editor-v2/chat-upload';
import { editorChatStorageKey } from '@/components/brand-studio/editor-v2/chat-store';
import { composeStorageKey, emptyComposerProject, type ComposeClip } from '@/lib/brand-studio/compose/timeline';
import { STUDIO_LIMITS, type StudioAssetView } from '@/lib/brand-studio/contracts';
import { composeStreamUrl, type EditorSource } from '@/lib/brand-studio/editor-v2/sources';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioEditorChatKo } from '@/messages/studio-editor-chat';
import type { MountedDom } from '@/tests/brands/_dom-harness';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const USER = '11111111-1111-4111-8111-111111111111';
const ASSET_1 = '40000000-0000-4000-8000-000000000001';
const ASSET_2 = '40000000-0000-4000-8000-000000000002';
const UPLOADED_VIDEO_ID = '40000000-0000-4000-8000-000000000091';
const UPLOADED_IMAGE_ID = '40000000-0000-4000-8000-000000000092';
const UPLOADED_AUDIO_ID = '40000000-0000-4000-8000-000000000093';

const koDict = getDictionary('ko');
const UPLOAD_COPY = {
  errors: koDict.brandStudio.errors,
  unapprovedUpload: koDict.brandStudio.unapprovedUpload,
  uploadFailed: koDict.brandStudio.uploadFailed,
};

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

function makeFakeFile(name: string, type: string, size = 2048, lastModified = 1700000000000): File {
  const blob = new Blob([new Uint8Array(Math.min(size, 64))], { type });
  Object.defineProperty(blob, 'name', { value: name });
  Object.defineProperty(blob, 'size', { value: size });
  Object.defineProperty(blob, 'lastModified', { value: lastModified });
  return blob as File;
}

function makeAssetView(overrides: Partial<StudioAssetView> & { id: string; kind: StudioAssetView['kind']; name: string }): StudioAssetView {
  return {
    role: null,
    tags: [],
    url: `/media/${overrides.id}`,
    thumbUrl: null,
    width: overrides.kind === 'audio' ? null : 1080,
    height: overrides.kind === 'audio' ? null : 1920,
    seconds: overrides.kind === 'image' ? null : 3,
    source: 'upload',
    createdAt: '2026-11-28T00:00:00.000Z',
    ...overrides,
  };
}

vi.mock('@/components/brand-studio/editor-v2/measure-fps', () => ({
  measureSource: vi.fn(async (_src: string, durationSec: number | null) => ({
    fps: 30,
    frames: Math.round((durationSec ?? 3) * 30),
  })),
}));

let dom: MountedDom | null = null;

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function flushAsync(act: (fn: () => Promise<void>) => Promise<void>) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountAttachmentEditor(opts: {
  canEdit?: boolean;
  sample?: boolean;
  storedClips?: ComposeClip[];
  uploadImpl?: ChatUploadClient['upload'];
  uploadMeasure?: (file: Blob, kind: StudioAssetView['kind']) => Promise<{ seconds?: number; width?: number; height?: number }>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<unknown>;
  onParentDrop?: () => void;
} = {}) {
  const fetchSpy = vi.fn(
    opts.fetchImpl ??
      (async () => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        json: async () => ({ ok: true, kind: 'plan', steps: [{ do: 'aspect', aspect: '9:16' }] }),
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

  let uploadCounter = 0;
  const uploadSpy = vi.fn(
    opts.uploadImpl ??
      (async (file) => {
        uploadCounter += 1;
        const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
        const id =
          kind === 'video'
            ? uploadCounter === 1
              ? UPLOADED_VIDEO_ID
              : `40000000-0000-4000-8000-0000000001${String(uploadCounter).padStart(2, '0')}`
            : kind === 'audio'
              ? UPLOADED_AUDIO_ID
              : UPLOADED_IMAGE_ID;
        return { ok: true as const, asset: makeAssetView({ id, kind, name: file.name, seconds: kind === 'image' ? null : 3 }) };
      }),
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

  const editorEl = h(EditorV2, {
    copy: studioEditorKo,
    currentEditorHref: `/brand/studio/compose?classic=1&organizationId=${ORG}`,
    initialWorkspace: 'cut',
    real: opts.sample
      ? null
      : {
          organizationId: ORG,
          organizationName: 'Sample Brand',
          canEdit: opts.canEdit ?? true,
          sources: SOURCES,
          sampleBase: null,
          filmId: 'film-att',
        },
    realChat: opts.sample
      ? null
      : {
          userId: USER,
          filmId: 'film-att',
          assistEnabled: true,
          locale: 'ko',
          uploadCopy: UPLOAD_COPY,
          uploadClient: { upload: uploadSpy },
          uploadMeasure: opts.uploadMeasure ?? (async () => ({ seconds: 3 })),
        },
    chatCopy: opts.sample ? null : studioEditorChatKo,
  });

  await dom.rerender(
    opts.onParentDrop ? h('div', { onDrop: opts.onParentDrop }, editorEl) : editorEl,
  );
  await flushAsync(act);

  return { dom, act, fetchSpy, uploadSpy, storageMap };
}

function makeDropEvent(opts: { files?: File[]; ref?: RefSource }) {
  const types: string[] = [];
  if (opts.ref) types.push(REF_DRAG_TYPE);
  if (opts.files && opts.files.length > 0) types.push('Files');
  const encoded = opts.ref ? encodeRefDrag(opts.ref) : '';
  return {
    type: 'drop',
    bubbles: true,
    cancelable: true,
    dataTransfer: {
      types,
      files: opts.files ?? [],
      dropEffect: 'copy',
      getData: (t: string) => (t === REF_DRAG_TYPE ? encoded : ''),
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('editor-v2 chat attachments (Batch 3)', () => {
  it('uploads video via drop (not bubbling to parent), adds to materials list, inserts at end & playhead with 1 undo step, and never stores or sends attachments to planner', async () => {
    const parentDropSpy = vi.fn();
    const sentPlannerBodies: Array<Record<string, unknown>> = [];
    const m = await mountAttachmentEditor({
      onParentDrop: parentDropSpy,
      fetchImpl: async (_url, init) => {
        sentPlannerBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return {
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({ ok: true, kind: 'plan', steps: [{ do: 'aspect', aspect: '9:16' }] }),
        };
      },
    });

    const panel = m.dom.query('[data-editor-chat="side"]')!;
    const dropEv = makeDropEvent({ files: [makeFakeFile('broll.mp4', 'video/mp4', 4096)] });
    await m.act(async () => {
      panel.dispatchEvent(dropEv as never);
    });
    await flushAsync(m.act);

    // Drop did NOT bubble to parent/page drop handler
    expect(dropEv.preventDefault).toHaveBeenCalled();
    expect(dropEv.stopPropagation).toHaveBeenCalled();
    expect(parentDropSpy).not.toHaveBeenCalled();

    // Uploaded through studio library client AND immediately listed in left materials list!
    expect(m.uploadSpy).toHaveBeenCalledTimes(1);
    expect(m.dom.query(`[data-editor-source="a:${UPLOADED_VIDEO_ID}"]`)).not.toBeNull();

    // Chip is ready with name, kind, editor timecode length, 2 actions, matching remove aria-label, and footnote
    const chip = m.dom.query('[data-editor-chat-attachment="ready"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('broll.mp4');
    expect(chip!.textContent).toContain('영상');
    expect(chip!.textContent).toContain('0:03:00');
    expect(m.dom.query('[data-editor-chat-attach-note]')?.textContent).toBe(studioEditorChatKo.attachNotSentHint);

    // Item 1 & Item 7: button label honestly says '지금 컷 뒤에 넣기' and remove aria-label uses '빼기' (not '제외')
    const chipId = chip!.getAttribute('data-attachment-id')!;
    expect(m.dom.query(`[data-editor-chat-attach-playhead="${chipId}"]`)?.textContent).toBe('지금 컷 뒤에 넣기');
    const removeBtn = m.dom.query(`[data-editor-chat-attach-remove="${chipId}"]`)!;
    expect(removeBtn.getAttribute('aria-label')).toBe('broll.mp4 빼기');
    expect(removeBtn.getAttribute('title')).toBe('빼기');

    // Insert at end -> adds 3rd cut, writes thread line with editor timecode, is 1 undo step, matches RealBin addSource!
    await m.dom.click(`[data-editor-chat-attach-end="${chipId}"]`);
    await flushAsync(m.act);
    expect(m.dom.queryAll('[data-editor-clip]')).toHaveLength(3);
    expect(m.dom.queryAll('[data-editor-chat-note] p').some((p) => p.textContent?.includes('broll.mp4') && p.textContent?.includes('0:03:00'))).toBe(true);

    // Undo reverts in 1 step back to 2 cuts
    const undoBtn = m.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.top.undo)!;
    await m.dom.click(undoBtn);
    expect(m.dom.queryAll('[data-editor-clip]')).toHaveLength(2);

    // Insert at playhead (playhead=0 inside cut 1 -> inserts after cut 1 at index 1, matching pasteClips)
    await m.dom.click(`[data-editor-chat-attach-playhead="${chipId}"]`);
    await flushAsync(m.act);
    const clipsAfterPlayhead = m.dom.queryAll('[data-editor-clip]');
    expect(clipsAfterPlayhead).toHaveLength(3);
    // Cut 2 (index 1) is the newly inserted 90-frame (3s) broll clip!
    expect(clipsAfterPlayhead[1]!.getAttribute('data-frames')).toBe('90');
    expect(m.dom.queryAll('[data-editor-chat-note] p').some((p) => p.textContent?.includes('1번 컷 뒤') && p.textContent?.includes('0:03:00'))).toBe(true);

    // Also attach an un-inserted reference file (image) and verify sending a message NEVER sends attachments to planner
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('uninserted.png', 'image/png', 1024)] }) as never);
    });
    await flushAsync(m.act);
    await m.dom.setValue('[data-editor-chat-input]', '이 영상 리듬대로 세로로 바꿔 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    await flushAsync(m.act);
    expect(sentPlannerBodies).toHaveLength(1);
    const plannerInput = (sentPlannerBodies[0] as { input: Record<string, unknown> }).input;
    expect(Object.keys(plannerInput).sort()).toEqual(['locale', 'message', 'organizationId', 'playheadSec', 'project']);
    expect(JSON.stringify(sentPlannerBodies[0])).not.toContain('uninserted.png');
    expect(JSON.stringify(sentPlannerBodies[0])).not.toContain(UPLOADED_IMAGE_ID);
    expect(m.dom.query(`[data-editor-chat-attach-end="${chipId}"]`)!.hasAttribute('disabled')).toBe(true);
    expect(m.dom.query(`[data-editor-chat-attach-playhead="${chipId}"]`)!.hasAttribute('disabled')).toBe(true);

    // Attachments are NEVER persisted in chat-store
    const storedChat = m.storageMap.get(editorChatStorageKey({ organizationId: ORG, userId: USER, filmId: 'film-att' }));
    expect(storedChat).toBeDefined();
    expect(storedChat).not.toContain('chatAttach');
    expect(storedChat).not.toContain(chipId);
  });

  it('supports dragging a material from RealBin (REF_DRAG_TYPE), lists image/audio with honest note, and blocks viewers / sample mode', async () => {
    const m = await mountAttachmentEditor();
    // RealBin cards carry draggable="true" when chat is open
    const binCard = m.dom.query(`[data-editor-source="a:${ASSET_1}"]`)!;
    expect(binCard.getAttribute('draggable')).toBe('true');

    // Drag material from RealBin onto chat panel -> ready video chip with ZERO upload calls!
    const panel = m.dom.query('[data-editor-chat="side"]')!;
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ ref: { assetId: ASSET_1 } }) as never);
    });
    expect(m.uploadSpy).not.toHaveBeenCalled();
    const draggedChip = m.dom.query('[data-editor-chat-attachment="ready"]');
    expect(draggedChip).not.toBeNull();
    expect(draggedChip!.textContent).toContain('opening.mp4');

    // Drop image + audio -> listed with honest attachNotTimelineYet note and NO insert buttons
    await m.act(async () => {
      panel.dispatchEvent(
        makeDropEvent({
          files: [
            makeFakeFile('palette.png', 'image/png', 1024),
            makeFakeFile('voice.wav', 'audio/wav', 1024),
          ],
        }) as never,
      );
    });
    await flushAsync(m.act);
    expect(m.uploadSpy).toHaveBeenCalledTimes(2);
    const imgChip = m.dom.query('[data-attachment-kind="image"]');
    const audioChip = m.dom.query('[data-attachment-kind="audio"]');
    expect(imgChip?.textContent).toContain(studioEditorChatKo.attachNotTimelineYet);
    expect(audioChip?.textContent).toContain(studioEditorChatKo.attachNotTimelineYet);
    expect(m.dom.query(`[data-editor-chat-attach-end="${imgChip!.getAttribute('data-attachment-id')}"]`)).toBeNull();
    expect(m.dom.query(`[data-editor-chat-attach-end="${audioChip!.getAttribute('data-attachment-id')}"]`)).toBeNull();
    await m.dom.unmount();
    dom = null;

    // Viewer seat: no + attach button and drops ignored
    const viewer = await mountAttachmentEditor({ canEdit: false });
    expect(viewer.dom.query('[data-editor-chat-attach]')).toBeNull();
    await viewer.act(async () => {
      viewer.dom.query('[data-editor-chat="side"]')!.dispatchEvent(makeDropEvent({ files: [makeFakeFile('v.mp4', 'video/mp4')] }) as never);
    });
    expect(viewer.uploadSpy).not.toHaveBeenCalled();
    await viewer.dom.unmount();
    dom = null;

    // Sample mode: no chat panel, no attachments, no draggable materials
    const sample = await mountAttachmentEditor({ sample: true });
    expect(sample.dom.query('[data-editor-chat-attach]')).toBeNull();
    expect(sample.dom.query('[draggable="true"]')).toBeNull();
  });

  it('handles every failure & edge case: refused kind/size/length, mid-upload fail + retry, remove mid-upload, 2 files at once, same file twice, drop while planner in flight, and 24-cut limit', async () => {
    let failFirst = true;
    let resolveDeferred!: (v: { ok: true; asset: StudioAssetView }) => void;
    let deferNext = false;

    const m = await mountAttachmentEditor({
      uploadMeasure: async (file) => {
        if ((file as File).name === 'too-long.mp4') return { seconds: STUDIO_LIMITS.mediaSecondsMax + 10 };
        return { seconds: 3 };
      },
      uploadImpl: async (file) => {
        if (deferNext) {
          deferNext = false;
          return new Promise((resolve) => {
            resolveDeferred = resolve;
          });
        }
        if (failFirst) {
          failFirst = false;
          return { ok: false as const, code: 'failed' as const };
        }
        return { ok: true as const, asset: makeAssetView({ id: UPLOADED_VIDEO_ID, kind: 'video', name: file.name, seconds: 3 }) };
      },
      fetchImpl: () => new Promise(() => undefined), // keep planner request in flight when tested below
    });

    const panel = m.dom.query('[data-editor-chat="side"]')!;

    // 1. Refused kind (PDF) -> studio refusal message in panel, 0 upload calls
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('doc.pdf', 'application/pdf', 1024)] }) as never);
    });
    expect(m.dom.query('[data-editor-chat-attach-notice]')?.textContent).toBe(studioUploadErrorLine(UPLOAD_COPY, 'unsupported_file'));
    expect(m.uploadSpy).not.toHaveBeenCalled();

    // 2. Refused size (> 50 MB video) -> file_too_large refusal
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('huge.mp4', 'video/mp4', STUDIO_LIMITS.videoBytesMax + 1)] }) as never);
    });
    expect(m.dom.query('[data-editor-chat-attach-notice]')?.textContent).toBe(studioUploadErrorLine(UPLOAD_COPY, 'file_too_large'));
    expect(m.uploadSpy).not.toHaveBeenCalled();

    // 3. Refused length (> 600 s) -> attachTooLong filled from STUDIO_LIMITS.mediaSecondsMax (and follows override!)
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('too-long.mp4', 'video/mp4', 2048)] }) as never);
    });
    await flushAsync(m.act);
    expect(m.dom.query('[data-editor-chat-attach-notice]')?.textContent).toBe(
      fill(studioEditorChatKo.attachTooLong, { minutes: Math.round(STUDIO_LIMITS.mediaSecondsMax / 60) }),
    );
    expect(formatChatUploadFailure(UPLOAD_COPY, studioEditorChatKo, { code: 'too_long' }, 900)).toBe(
      '15분이 넘는 파일은 올릴 수 없어요.',
    );
    expect(m.uploadSpy).not.toHaveBeenCalled();

    // 4. Mid-upload failure -> chip shows failed with 다시 시도 and 빼기 -> clicking 다시 시도 succeeds!
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('flaky.mp4', 'video/mp4', 2048)] }) as never);
    });
    await flushAsync(m.act);
    const failedChip = m.dom.query('[data-editor-chat-attachment="failed"]');
    expect(failedChip).not.toBeNull();
    const failedId = failedChip!.getAttribute('data-attachment-id')!;
    expect(m.dom.query(`[data-editor-chat-attach-retry="${failedId}"]`)).not.toBeNull();
    await m.dom.click(`[data-editor-chat-attach-retry="${failedId}"]`);
    await flushAsync(m.act);
    expect(m.dom.query(`[data-attachment-id="${failedId}"]`)!.getAttribute('data-editor-chat-attachment')).toBe('ready');

    // 5. Remove chip BEFORE upload finishes -> chip stays gone, but completed video still lands in materials list!
    deferNext = true;
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [makeFakeFile('mid-remove.mp4', 'video/mp4', 2048)] }) as never);
    });
    const uploadingChip = m.dom.query('[data-editor-chat-attachment="uploading"]')!;
    const removedId = uploadingChip.getAttribute('data-attachment-id')!;
    await m.dom.click(`[data-editor-chat-attach-remove="${removedId}"]`);
    expect(m.dom.query(`[data-attachment-id="${removedId}"]`)).toBeNull();
    const LATE_ID = '40000000-0000-4000-8000-000000000099';
    resolveDeferred({ ok: true, asset: makeAssetView({ id: LATE_ID, kind: 'video', name: 'mid-remove.mp4', seconds: 3 }) });
    await flushAsync(m.act);
    expect(m.dom.query(`[data-attachment-id="${removedId}"]`)).toBeNull();
    expect(m.dom.query(`[data-editor-source="a:${LATE_ID}"]`)).not.toBeNull();

    // 6. Drop SAME file twice (name + size + lastModified match) while planner is in flight -> duplicate skipped with notice!
    await m.dom.setValue('[data-editor-chat-input]', '세로로 바꿔 줘');
    await m.dom.submit('[data-editor-chat="side"] form');
    expect(m.dom.query('[data-editor-chat-pending]')).not.toBeNull();
    const callsBeforeDup = m.uploadSpy.mock.calls.length;
    const sameFile = makeFakeFile('dup.mp4', 'video/mp4', 2048, 1700000123456);
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [sameFile, sameFile] }) as never);
    });
    await flushAsync(m.act);
    const dupChips = m.dom.queryAll('[data-editor-chat-attachment="ready"]').filter((el) => el.textContent?.includes('dup.mp4'));
    expect(dupChips).toHaveLength(1);
    expect(m.uploadSpy).toHaveBeenCalledTimes(callsBeforeDup + 1);
    expect(m.dom.query('[data-editor-chat-attach-notice]')?.textContent).toBe(studioEditorChatKo.attachDuplicate);
    // Dropping the exact same file again while already ready is also skipped!
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: [sameFile] }) as never);
    });
    expect(m.uploadSpy).toHaveBeenCalledTimes(callsBeforeDup + 1);
    expect(m.dom.query('[data-editor-chat-attach-notice]')?.textContent).toBe(studioEditorChatKo.attachDuplicate);
    await m.dom.unmount();
    dom = null;

    // 7. At 24 cuts, both insert buttons are disabled with chat's own 어요 cap sentence as title & aria-description, and no note is posted!
    const full24: ComposeClip[] = Array.from({ length: 24 }, (_, i) => ({
      id: `full-${i + 1}`,
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
    const mFull = await mountAttachmentEditor({ storedClips: full24 });
    await mFull.act(async () => {
      mFull.dom.query('[data-editor-chat="side"]')!.dispatchEvent(makeDropEvent({ ref: { assetId: ASSET_1 } }) as never);
    });
    const fullChipId = mFull.dom.query('[data-editor-chat-attachment="ready"]')!.getAttribute('data-attachment-id')!;
    const endBtn = mFull.dom.query(`[data-editor-chat-attach-end="${fullChipId}"]`)!;
    const afterBtn = mFull.dom.query(`[data-editor-chat-attach-playhead="${fullChipId}"]`)!;
    const expectedCap = '한 영상에는 컷을 24개까지 넣을 수 있어요.';
    expect(endBtn.hasAttribute('disabled')).toBe(true);
    expect(afterBtn.hasAttribute('disabled')).toBe(true);
    expect(endBtn.getAttribute('title')).toBe(expectedCap);
    expect(afterBtn.getAttribute('title')).toBe(expectedCap);
    expect(endBtn.getAttribute('aria-description')).toBe(expectedCap);
    expect(afterBtn.getAttribute('aria-description')).toBe(expectedCap);
    await mFull.dom.click(endBtn);
    await mFull.dom.click(afterBtn);
    await flushAsync(mFull.act);
    expect(mFull.dom.queryAll('[data-editor-clip]')).toHaveLength(24);
    expect(mFull.dom.queryAll('[data-editor-chat-note]')).toHaveLength(0);
  });

  it('caps concurrent uploads at 4 and queues further files as waiting in strict FIFO order (Round 5 #2)', async () => {
    const startedNames: string[] = [];
    const resolvers = new Map<string, () => void>();
    const m = await mountAttachmentEditor({
      uploadImpl: (file) =>
        new Promise((resolve) => {
          startedNames.push(file.name);
          resolvers.set(file.name, () =>
            resolve({
              ok: true as const,
              asset: makeAssetView({
                id: `40000000-0000-4000-8000-00000000020${startedNames.length}`,
                kind: 'video',
                name: file.name,
                seconds: 2,
              }),
            }),
          );
        }),
    });

    const sixFiles = Array.from({ length: 6 }, (_, i) => makeFakeFile(`clip-${i + 1}.mp4`, 'video/mp4', 2048 + i, 1700000000000 + i));
    const panel = m.dom.query('[data-editor-chat="side"]')!;
    await m.act(async () => {
      panel.dispatchEvent(makeDropEvent({ files: sixFiles }) as never);
    });
    await flushAsync(m.act);

    // At most 4 uploads started; clips 5 and 6 show waiting!
    expect(startedNames).toEqual(['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4', 'clip-4.mp4']);
    expect(m.dom.queryAll('[data-editor-chat-attachment="uploading"]')).toHaveLength(4);
    const waiting = m.dom.queryAll('[data-editor-chat-attachment="waiting"]');
    expect(waiting).toHaveLength(2);
    expect(waiting[0]!.textContent).toContain(studioEditorChatKo.attachWaiting);

    // Finishing clip-1 starts clip-5 next (still max 4 active)
    resolvers.get('clip-1.mp4')!();
    await flushAsync(m.act);
    expect(startedNames).toEqual(['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4', 'clip-4.mp4', 'clip-5.mp4']);
    expect(m.dom.queryAll('[data-editor-chat-attachment="uploading"]')).toHaveLength(4);
    expect(m.dom.queryAll('[data-editor-chat-attachment="waiting"]')).toHaveLength(1);

    // Finishing clip-2 starts clip-6 next
    resolvers.get('clip-2.mp4')!();
    await flushAsync(m.act);
    expect(startedNames).toEqual(['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4', 'clip-4.mp4', 'clip-5.mp4', 'clip-6.mp4']);
    expect(m.dom.queryAll('[data-editor-chat-attachment="waiting"]')).toHaveLength(0);

    // Resolve remaining uploads -> all 6 ready
    for (const name of ['clip-3.mp4', 'clip-4.mp4', 'clip-5.mp4', 'clip-6.mp4']) {
      resolvers.get(name)!();
    }
    await flushAsync(m.act);
    expect(m.dom.queryAll('[data-editor-chat-attachment="ready"]')).toHaveLength(6);
  });

  it('produces identical sequence and toStored output to RealBin addSource (plus empty-film fps adoption and + file picker)', async () => {
    // 1. Insert via RealBin click on opening.mp4 -> capture stored clips (minus random clip id)
    const mBin = await mountAttachmentEditor();
    await mBin.dom.click(`[data-editor-source="a:${ASSET_1}"]`);
    await flushAsync(mBin.act);
    const binStored = JSON.parse(mBin.storageMap.get(composeStorageKey(ORG))!) as { clips: Array<Record<string, unknown>>; aspect: string };
    const stripIds = (stored: { clips: Array<Record<string, unknown>>; aspect: string }) => ({
      aspect: stored.aspect,
      clips: stored.clips.map(({ id: _id, ...rest }) => rest),
    });
    const binSnapshot = stripIds(binStored);
    await mBin.dom.unmount();
    dom = null;

    // 2. Drag same opening.mp4 into chat & click 끝에 넣기 -> stored JSON must be equal!
    const mChat = await mountAttachmentEditor();
    await mChat.act(async () => {
      mChat.dom.query('[data-editor-chat="side"]')!.dispatchEvent(makeDropEvent({ ref: { assetId: ASSET_1 } }) as never);
    });
    const chipId = mChat.dom.query('[data-editor-chat-attachment="ready"]')!.getAttribute('data-attachment-id')!;
    await mChat.dom.click(`[data-editor-chat-attach-end="${chipId}"]`);
    await flushAsync(mChat.act);
    const chatStored = JSON.parse(mChat.storageMap.get(composeStorageKey(ORG))!) as { clips: Array<Record<string, unknown>>; aspect: string };
    expect(stripIds(chatStored)).toEqual(binSnapshot);

    // 3. Undo reverts insert-at-playhead in 1 step too
    await mChat.dom.click(`[data-editor-chat-attach-playhead="${chipId}"]`);
    await flushAsync(mChat.act);
    expect(mChat.dom.queryAll('[data-editor-clip]')).toHaveLength(4);
    const undoBtn = mChat.dom.queryAll('button').find((el) => el.getAttribute('aria-label') === studioEditorKo.top.undo)!;
    await mChat.dom.click(undoBtn);
    expect(mChat.dom.queryAll('[data-editor-clip]')).toHaveLength(3);
    await mChat.dom.unmount();
    dom = null;

    // 4. Empty film + `+` file picker upload + insert adopts measured fps (30fps from measureSource)
    const mEmpty = await mountAttachmentEditor({ storedClips: [] });
    const fileInput = mEmpty.dom.query('[data-editor-chat-file-input]') as unknown as {
      files: File[];
      value: string;
      dispatchEvent: (ev: unknown) => void;
    };
    expect(fileInput).not.toBeNull();
    expect(mEmpty.dom.query('[data-editor-chat-attach]')).not.toBeNull();
    const picked = makeFakeFile('first.mp4', 'video/mp4', 2048);
    fileInput.files = [picked];
    await mEmpty.act(async () => {
      fileInput.dispatchEvent({ type: 'change', bubbles: true, target: fileInput });
    });
    await flushAsync(mEmpty.act);
    expect(mEmpty.uploadSpy).toHaveBeenCalledTimes(1);
    const emptyChipId = mEmpty.dom.query('[data-editor-chat-attachment="ready"]')!.getAttribute('data-attachment-id')!;
    await mEmpty.dom.click(`[data-editor-chat-attach-end="${emptyChipId}"]`);
    await flushAsync(mEmpty.act);
    const clips = mEmpty.dom.queryAll('[data-editor-clip]');
    expect(clips).toHaveLength(1);
    expect(clips[0]!.getAttribute('data-frames')).toBe('90');
  });
});
