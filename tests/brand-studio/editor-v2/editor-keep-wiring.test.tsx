import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExportFilmResult } from '@/components/brand-studio/editor-v2/export-film';
import type { ExportRequest } from '@/components/brand-studio/editor-v2/export-job';
import { fill, studioUploadErrorLine } from '@/components/brand-studio/copy';
import { composeStorageKey } from '@/lib/brand-studio/compose';
import type { FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { mergeFilmText } from '@/lib/brand-studio/editor-v2/stored';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEditorKo } from '@/messages/studio-editor';
import type { MountedDom } from '@/tests/brands/_dom-harness';

/**
 * The editor itself wires "에셋에 저장" and "검수 · 공유" (editor-v2.tsx): it hands the sheet the current editor's
 * words and the film's name, and mounts the review share window's host, on the organization's own film for people
 * who may change it. Rendered whole (the real `EditorV2` on a stored film of two cuts), not the sheet alone:
 * - "검수 · 공유" on a finished export opens the share window in the document, titled by the film's name;
 * - the sample film and a film someone may only look at show no buttons and mount no host (asking for the window
 *   there opens nothing);
 * - while the window is open the editor's keys are the window's: Esc closes only the window (the export sheet
 *   stays), Delete removes nothing; once it is closed the keys edit the film again.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const SAVED = '30000000-0000-4000-8000-0000000000a1';
const SRC = (id: string) => `/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=${id}`;
const NAME = 'Sample Brand';
const TITLE = fill(studioEditorKo.real.filmName, { name: NAME });

const dict = getDictionary('ko');
const compose = dict.studioCompose;
const KEEP = {
  copy: {
    actions: { saveToAssets: compose.actions.saveToAssets, savingToAssets: compose.actions.savingToAssets, savedToAssets: compose.actions.savedToAssets, shareReview: compose.actions.shareReview },
    status: { saveQuotaExceeded: compose.status.saveQuotaExceeded, saveFailed: compose.status.saveFailed, reviewOpened: compose.status.reviewOpened, reviewNeedsSave: compose.status.reviewNeedsSave },
    fileTooLarge: studioUploadErrorLine(dict.brandStudio, 'file_too_large'),
  },
  locale: 'ko' as const,
};

/** Two cuts of 48 frames at 24 fps, stored with their frame data (so opening the film measures nothing). */
const FILM: FrameSequence = {
  fps: 24,
  aspect: '9:16',
  captions: [],
  clips: ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'].map((id, index) => ({
    id: `c${index + 1}`,
    label: `c${index + 1}`,
    srcUrl: SRC(id),
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 48,
    inFrame: 0,
    phase: 0,
    frames: 48,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
  })),
};

const RESULT: ExportFilmResult = {
  blob: new Blob([new Uint8Array(2048)], { type: 'video/mp4' }),
  mime: 'video/mp4',
  filename: 'twings-edit-20261125.mp4',
  width: 1080,
  height: 1920,
  fps: 24,
  frames: 96,
  durationSec: 4,
  elapsedMs: 5,
  notIncluded: [],
  warnings: [],
  paths: [],
  restarts: 0,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let dom: MountedDom | null = null;
let bridge: Array<Record<string, unknown>> = [];

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
  vi.unstubAllGlobals();
  vi.resetModules();
});

interface Mounted {
  act: typeof import('react').act;
  openShareReview: typeof import('@/components/brand-studio/share-review-dialog').openShareReview;
}

/** The real editor on `real` (or the sample film), with one finished export waiting for its sheet. */
async function mountEditor(real: { canEdit: boolean } | null): Promise<Mounted> {
  vi.resetModules();
  vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => ({
    ...(await original<object>()),
    exportFilm: async () => RESULT,
  }));
  bridge = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const href = String(url);
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { operation?: string; input?: Record<string, unknown> }) : null;
      if (href === '/api/brand-studio/share-bridge') {
        bridge.push({ operation: body?.operation, ...body?.input });
        return json({ ok: true, projects: [], shares: [] });
      }
      if (href === '/api/brand-studio' && body?.operation === 'asset.reserve') return json({ ok: true, id: SAVED, direct: false });
      if (href.startsWith('/api/brand-studio/assets/')) return json({ ok: true });
      if (href === '/api/brand-studio' && body?.operation === 'asset.complete') {
        return json({ ok: true, asset: { id: SAVED, kind: 'video', role: null, name: RESULT.filename, tags: [], url: `/media/${SAVED}.mp4`, thumbUrl: null, width: 1080, height: 1920, seconds: 4, source: 'upload', createdAt: '2026-11-25T01:00:00.000Z' } });
      }
      // The footage itself is not served here: the stored frame data stands.
      return new Response('', { status: 404 });
    }),
  );
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    },
  );
  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { act } = await import('react');
  const job = await import('@/components/brand-studio/editor-v2/export-job');
  const { EditorV2 } = await import('@/components/brand-studio/editor-v2/editor-v2');
  const { openShareReview } = await import('@/components/brand-studio/share-review-dialog');
  dom = await mountDom(null);
  // What the fake document lacks and these screens read: `dataset` (the preview) and a `<select>`'s `options`.
  const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
  const element = Object.getPrototypeOf(select) as object;
  if (!('dataset' in element)) {
    Object.defineProperty(element, 'dataset', {
      get(this: { attributes: Record<string, string> }) {
        const attributes = this.attributes;
        const name = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
        return new Proxy({}, { get: (_t, key) => attributes[name(String(key))], set: (_t, key, value) => ((attributes[name(String(key))] = String(value)), true) });
      },
    });
  }
  if (!('options' in select)) {
    Object.defineProperty(select, 'options', {
      get(this: { children: unknown[] }) {
        return this.children;
      },
    });
  }
  window.localStorage.setItem(composeStorageKey(ORG), mergeFilmText(null, FILM));
  await dom.rerender(
    <EditorV2
      copy={studioEditorKo}
      currentEditorHref="/brand/studio/compose?classic=1"
      real={real ? { organizationId: ORG, organizationName: NAME, canEdit: real.canEdit, sources: [], sampleBase: null } : null}
      keep={KEEP}
    />,
  );
  await settle(act);
  if (real) expect(dom.query('[data-studio-editor-v2]')?.getAttribute('data-editor-status')).toBe('ready');
  // One export, finished, before the sheet is opened.
  const request: ExportRequest = { sequence: FILM, reframe: {}, framing: 'current', extras: null, burnCaptions: false, captionText: null, notify: () => undefined, path: null, download: false, recordFor: null };
  await act(async () => {
    job.startExport(request);
  });
  await settle(act);
  expect(job.exportJobSnapshot().status).toBe('done');
  return { act, openShareReview };
}

async function settle(act: typeof import('react').act) {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** A key as the browser delivers it to the window's listeners (the editor's and the share window's). */
function press(code: string, key: string) {
  const event = { type: 'keydown', code, key, target: dom!.document.body, keyCode: 0, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  (window as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(event);
}

const cuts = () => dom!.queryAll('[data-editor-clip]').length;
const shareWindow = () => dom!.document.querySelector('[data-share-review-dialog]');

describe('the editor wires the two actions on the organization’s own film', () => {
  it('"검수 · 공유" opens the share window in the document, titled by the film’s name, for the saved film', async () => {
    const { act } = await mountEditor({ canEdit: true });
    await dom!.click('[data-editor-export]');
    expect(dom!.query('[data-editor-export-done]')).not.toBeNull();
    expect(dom!.query('[data-editor-export-save]')?.textContent).toBe(compose.actions.saveToAssets);
    await dom!.click('[data-editor-export-share]');
    await settle(act);
    expect(shareWindow()).not.toBeNull();
    const title = dom!.document.querySelector('[data-share-bridge-title]') as unknown as { value: string } | null;
    expect(title?.value).toBe(TITLE);
    expect(TITLE).toBe('Sample Brand 영상');
    // The window asks about the asset the press saved.
    expect(bridge[0]).toMatchObject({ operation: 'bridge.context', organizationId: ORG, assetId: SAVED });
    expect(dom!.query('[data-editor-export-keep-line]')?.textContent).toBe(compose.status.reviewOpened);
  });

  it('with the window open Esc closes only the window and Delete removes nothing; closed, the keys edit the film again', async () => {
    const { act } = await mountEditor({ canEdit: true });
    expect(cuts()).toBe(2);
    // Select the first cut the keyboard way (Enter on the cut).
    await dom!.keyDown('Enter', { target: dom!.query('[data-editor-clip="1"]') });
    expect(dom!.query('[data-editor-clip="1"]')?.hasAttribute('data-selected')).toBe(true);
    await dom!.click('[data-editor-export]');
    await dom!.click('[data-editor-export-share]');
    await settle(act);
    expect(shareWindow()).not.toBeNull();

    await act(async () => press('Delete', 'Delete'));
    await act(async () => press('Backspace', 'Backspace'));
    expect(cuts()).toBe(2);

    await act(async () => press('Escape', 'Escape'));
    await settle(act);
    expect(shareWindow()).toBeNull();
    expect(dom!.query('[data-editor-export-sheet]')).not.toBeNull();

    // The window is gone: the editor's keys work again.
    await act(async () => press('Delete', 'Delete'));
    await settle(act);
    expect(cuts()).toBe(1);
    await act(async () => press('Escape', 'Escape'));
    await settle(act);
    expect(dom!.query('[data-editor-export-sheet]')).toBeNull();
  });
});

describe('no buttons and no share window host', () => {
  for (const [name, real] of [
    ['the sample film', null],
    ['a film someone may only look at', { canEdit: false }],
  ] as const) {
    it(`${name}`, async () => {
      const { act, openShareReview } = await mountEditor(real);
      await dom!.click('[data-editor-export]');
      expect(dom!.query('[data-editor-export-done]')).not.toBeNull();
      expect(dom!.query('[data-editor-export-save]')).toBeNull();
      expect(dom!.query('[data-editor-export-share]')).toBeNull();
      // Asking for the window opens nothing: no host is mounted.
      await act(async () => openShareReview({ organizationId: ORG, assetId: SAVED, outputId: null, title: TITLE }));
      await settle(act);
      expect(shareWindow()).toBeNull();
      expect(bridge).toEqual([]);
    });
  }
});
