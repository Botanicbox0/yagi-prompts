import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ExportFilmResult } from '@/components/brand-studio/editor-v2/export-film';
import type { ExportRequest } from '@/components/brand-studio/editor-v2/export-job';
import type { RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import { studioUploadErrorLine } from '@/components/brand-studio/copy';
import { OPEN_SHARE_REVIEW_EVENT, type ShareReviewTarget } from '@/components/brand-studio/share-review-dialog';
import type { FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEditorKo } from '@/messages/studio-editor';
import type { MountedDom } from '@/tests/brands/_dom-harness';

/**
 * Editing studio v2 — "에셋에 저장" and "검수 · 공유" on the finished export (founder: "넣어", review point B-1).
 *
 * The done state of the export sheet gets the current editor's two actions, on the organization's own film and for
 * people who may change it only. They reuse the current editor's code (components/brand-studio/compose/export-asset.ts)
 * and its words (the page hands them over from `studioCompose`):
 * - "에셋에 저장" uploads the finished MP4 through the library's own upload, once per finished export: saved, the
 *   button says so and a second press sends nothing, also after the sheet was closed and opened again; a new export
 *   starts over; a file the next export released is never uploaded;
 * - "검수 · 공유" shares the exported film: saved first when it is not yet, then the review share window for that
 *   asset, titled by the film's name. Unlike the current editor it never shares a clip's own asset instead;
 * - a refusal says the current editor's line for it (`saveQuotaExceeded` for the two storage limits, the library's
 *   own sentence for a file over the size limit, `saveFailed` for anything else), where the done state shows notes;
 * - nothing about credits: no compose request, no reserve of credits, only the library upload.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const SAVED = '30000000-0000-4000-8000-0000000000a1';
const SECOND = '30000000-0000-4000-8000-0000000000a2';
const SRC = `/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=30000000-0000-4000-8000-000000000001`;
const TITLE = 'Sample Brand 영상';

const dict = getDictionary('ko');
const compose = dict.studioCompose;
const KEEP_COPY = {
  actions: {
    saveToAssets: compose.actions.saveToAssets,
    savingToAssets: compose.actions.savingToAssets,
    savedToAssets: compose.actions.savedToAssets,
    shareReview: compose.actions.shareReview,
  },
  status: {
    saveQuotaExceeded: compose.status.saveQuotaExceeded,
    saveFailed: compose.status.saveFailed,
    reviewOpened: compose.status.reviewOpened,
    reviewNeedsSave: compose.status.reviewNeedsSave,
  },
  fileTooLarge: studioUploadErrorLine(dict.brandStudio, 'file_too_large'),
};

const FILM: FrameSequence = {
  fps: 24,
  aspect: '9:16',
  captions: [],
  clips: [{ id: 'c1', label: 'c1', srcUrl: SRC, thumbUrl: null, sourceFps: 24, sourceFrames: 156, inFrame: 0, phase: 0, frames: 156, speedNum: 1, speedDen: 1, volume: 1, muted: false }],
};

function result(bytes = 4096): ExportFilmResult {
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
    mime: 'video/mp4',
    filename: 'twings-edit-20261125.mp4',
    width: 1080,
    height: 1920,
    fps: 24,
    frames: 156,
    durationSec: 6.5,
    elapsedMs: 5,
    notIncluded: [],
    warnings: [],
    paths: [],
    restarts: 0,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  url: string;
  init: RequestInit;
  operation?: string;
  input?: Record<string, unknown>;
}

interface Plan {
  reserve?: unknown;
  reserveStatus?: number;
  drop?: 'reserve' | 'bytes';
  /** The reserve never answers (to look at the saving state). */
  hang?: boolean;
}

function savedAsset(id: string) {
  return { id, kind: 'video', role: null, name: 'twings-edit-20261125.mp4', tags: [], url: `/media/${id}.mp4`, thumbUrl: null, width: 1080, height: 1920, seconds: 6.5, source: 'upload', createdAt: '2026-11-25T01:00:00.000Z' };
}

interface Harness {
  job: typeof import('@/components/brand-studio/editor-v2/export-job');
  sheet: typeof import('@/components/brand-studio/editor-v2/export-sheet');
  keep: typeof import('@/components/brand-studio/editor-v2/export-keep');
  editor: typeof import('@/components/brand-studio/editor-v2/use-editor');
  mountDom: typeof import('@/tests/brands/_dom-harness').mountDom;
  act: typeof import('react').act;
  sent: Sent[];
  plan: Plan;
  finish: (value?: ExportFilmResult) => Promise<void>;
  /** The editor the mounted sheet uses. */
  seen: { api: ReturnType<typeof import('@/components/brand-studio/editor-v2/use-editor').useEditor> | null };
}

let dom: MountedDom | null = null;
let shared: ShareReviewTarget[] = [];

async function harness(plan: Plan = {}): Promise<Harness> {
  vi.resetModules();
  const state: { resolve: ((value: ExportFilmResult) => void) | null } = { resolve: null };
  vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => ({
    ...(await original<object>()),
    exportFilm: () =>
      new Promise<ExportFilmResult>((resolve) => {
        state.resolve = resolve;
      }),
  }));
  const sent: Sent[] = [];
  let assetIds = [SAVED, SECOND];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const entry: Sent = { url: String(url), init };
      if (typeof init.body === 'string') {
        try {
          const parsed = JSON.parse(init.body) as { operation?: string; input?: Record<string, unknown> };
          entry.operation = parsed.operation;
          entry.input = parsed.input;
        } catch {
          // not JSON
        }
      }
      sent.push(entry);
      if (entry.url === '/api/brand-studio/share-bridge') return json({ ok: true, projects: [], shares: [] });
      if (entry.url === '/api/brand-studio' && entry.operation === 'asset.reserve') {
        if (plan.hang) return new Promise<Response>(() => undefined);
        if (plan.drop === 'reserve') throw new TypeError('Failed to fetch');
        if (plan.reserve) return json(plan.reserve, plan.reserveStatus ?? 200);
        const id = assetIds[0]!;
        assetIds = assetIds.slice(1);
        return json({ ok: true, id, direct: false });
      }
      if (entry.url.startsWith('/api/brand-studio/assets/')) {
        if (plan.drop === 'bytes') throw new TypeError('Failed to fetch');
        return json({ ok: true });
      }
      if (entry.url === '/api/brand-studio' && entry.operation === 'asset.complete') return json({ ok: true, asset: savedAsset(String(entry.input?.assetId)) });
      return json({ ok: false, code: 'not_found' }, 404);
    }),
  );
  // The running export watches the screen's refresh; the fake document has no animation frames.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // The sample film reads its stills' brightness; here no still loads.
  vi.stubGlobal(
    'Image',
    class {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    },
  );
  const job = await import('@/components/brand-studio/editor-v2/export-job');
  const sheet = await import('@/components/brand-studio/editor-v2/export-sheet');
  const keep = await import('@/components/brand-studio/editor-v2/export-keep');
  const editor = await import('@/components/brand-studio/editor-v2/use-editor');
  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { act } = await import('react');
  const h: Harness = {
    job,
    sheet,
    keep,
    editor,
    mountDom,
    act,
    sent,
    plan,
    seen: { api: null },
    finish: async (value = result()) => {
      await act(async () => {
        state.resolve!(value);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
  };
  return h;
}

function request(): ExportRequest {
  return { sequence: FILM, reframe: {}, framing: 'current', extras: null, burnCaptions: false, captionText: null, notify: () => undefined, path: null, download: false, recordFor: null };
}

const real = (canEdit = true): RealFilmOptions => ({ organizationId: ORG, canEdit, sources: [], sampleBase: null });

/** The export sheet as the editor shows it, on a film, with the share window's host beside it. */
async function mountSheet(h: Harness, film: RealFilmOptions | null, keep: { copy: typeof KEEP_COPY; title: string } | null = { copy: KEEP_COPY, title: TITLE }) {
  function Sheet(): ReactNode {
    const api = h.editor.useEditor(studioEditorKo, { real: film, initialWorkspace: 'cut' });
    h.seen.api = api;
    return (
      <>
        <h.sheet.ExportSheet api={api} autoDownload={false} keep={keep} />
        <h.keep.ExportShareHost organizationId={ORG} locale="ko" />
      </>
    );
  }
  dom = await h.mountDom(<Sheet />);
  // The fake document's `<select>` has no `options` (the review share window has one).
  const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
  if (!('options' in select)) {
    Object.defineProperty(select, 'options', {
      get(this: { children: unknown[] }) {
        return this.children;
      },
    });
  }
  shared = [];
  window.addEventListener(OPEN_SHARE_REVIEW_EVENT, (event) => {
    shared.push((event as CustomEvent<ShareReviewTarget>).detail);
  });
  return dom;
}

async function exportOnce(h: Harness, value?: ExportFilmResult) {
  await h.act(async () => {
    h.job.startExport(request());
  });
  await h.finish(value);
}

async function settle(h: Harness) {
  for (let i = 0; i < 8; i += 1) {
    await h.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const saveButton = () => dom!.query('[data-editor-export-save]');
const shareButton = () => dom!.query('[data-editor-export-share]');
const line = () => dom!.query('[data-editor-export-keep-line]');
const reserves = (h: Harness) => h.sent.filter((entry) => entry.operation === 'asset.reserve');
const bytes = (h: Harness) => h.sent.filter((entry) => entry.url.startsWith('/api/brand-studio/assets/'));
const completes = (h: Harness) => h.sent.filter((entry) => entry.operation === 'asset.complete');
/** Every request other than the review share window's own. */
const editorRequests = (h: Harness) => h.sent.filter((entry) => entry.url !== '/api/brand-studio/share-bridge');

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('who sees the two actions', () => {
  it('the organization’s own film, for someone who may change it: both, after the done content, in the current editor’s words', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    expect(saveButton()).toBeNull();
    await exportOnce(h);
    const done = dom!.query('[data-editor-export-done]');
    expect(done).not.toBeNull();
    expect(saveButton()?.textContent).toBe(compose.actions.saveToAssets);
    expect(shareButton()?.textContent).toBe(compose.actions.shareReview);
    // Inside the done state, after its download link.
    expect(done!.contains(saveButton())).toBe(true);
    expect(done!.contains(shareButton())).toBe(true);
    expect(editorRequests(h)).toEqual([]);
  });

  it('someone who may only look (viewer, the studio team): neither, and no request', async () => {
    const h = await harness();
    await mountSheet(h, real(false));
    await exportOnce(h);
    expect(dom!.query('[data-editor-export-done]')).not.toBeNull();
    expect(saveButton()).toBeNull();
    expect(shareButton()).toBeNull();
    // Even asked directly, nothing goes out for a viewer.
    const job = h.job.exportJobSnapshot();
    await h.act(async () => {
      await h.keep.keepExport(job, { organizationId: ORG, canSave: false, title: TITLE, copy: KEEP_COPY }, 'save');
    });
    expect(editorRequests(h)).toEqual([]);
  });

  it('the sample film: neither, even handed the words', async () => {
    const h = await harness();
    await mountSheet(h, null);
    await exportOnce(h);
    expect(dom!.query('[data-editor-export-done]')).not.toBeNull();
    expect(saveButton()).toBeNull();
    expect(shareButton()).toBeNull();
  });

  it('without the words (an older page): neither', async () => {
    const h = await harness();
    await mountSheet(h, real(true), null);
    await exportOnce(h);
    expect(saveButton()).toBeNull();
  });
});

describe('"에셋에 저장"', () => {
  it('uploads the finished file once through the library upload, named and measured by the export, and lists it in the editor', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    const film = result();
    await exportOnce(h, film);
    await dom!.click(saveButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
    expect(reserves(h)[0]!.input).toMatchObject({ organizationId: ORG, name: 'twings-edit-20261125.mp4', mime: 'video/mp4', sizeBytes: 4096 });
    expect(bytes(h)).toHaveLength(1);
    expect(bytes(h)[0]!.init.body).toBe(film.blob);
    expect(completes(h)[0]!.input).toEqual({ organizationId: ORG, assetId: SAVED, width: 1080, height: 1920, seconds: 6.5 });
    expect(saveButton()?.textContent).toBe(compose.actions.savedToAssets);
    expect(saveButton()?.hasAttribute('disabled')).toBe(true);
    expect(line()).toBeNull();
    // The editor's clip list has it first, without a reload.
    expect(h.seen.api!.sources[0]).toMatchObject({ key: `a:${SAVED}`, kind: 'asset', label: 'twings-edit-20261125.mp4' });

    // A second press does nothing.
    await dom!.click(saveButton()!);
    await h.act(async () => {
      await h.keep.keepExport(h.job.exportJobSnapshot(), { organizationId: ORG, canSave: true, title: TITLE, copy: KEEP_COPY }, 'save');
    });
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
    // Only the library upload: no compose request, nothing about credits.
    expect(editorRequests(h).map((entry) => entry.operation ?? 'bytes')).toEqual(['asset.reserve', 'bytes', 'asset.complete']);
    expect(h.sent.some((entry) => entry.url.includes('/compose'))).toBe(false);
  });

  it('while it saves both buttons wait in the saving state, and pressing again sends nothing', async () => {
    const h = await harness({ hang: true });
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(saveButton()!);
    await settle(h);
    expect(saveButton()?.textContent).toBe(compose.actions.savingToAssets);
    expect(saveButton()?.hasAttribute('disabled')).toBe(true);
    expect(shareButton()?.hasAttribute('disabled')).toBe(true);
    await h.act(async () => {
      void h.keep.keepExport(h.job.exportJobSnapshot(), { organizationId: ORG, canSave: true, title: TITLE, copy: KEEP_COPY }, 'share');
    });
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
  });

  it('closing the sheet and opening it again keeps the saved state for that export', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(saveButton()!);
    await settle(h);
    await dom!.unmount();
    await mountSheet(h, real(true));
    expect(saveButton()?.textContent).toBe(compose.actions.savedToAssets);
    expect(saveButton()?.hasAttribute('disabled')).toBe(true);
    await dom!.click(saveButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
  });

  it('a file closed and opened again before saving can still be saved while its export is the last one', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.unmount();
    await mountSheet(h, real(true));
    await dom!.click(saveButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
    expect(saveButton()?.textContent).toBe(compose.actions.savedToAssets);
  });

  it('a new export starts over: the button is pressable again and saves the new file as a new asset', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(saveButton()!);
    await settle(h);
    const second = result(8192);
    await exportOnce(h, second);
    expect(saveButton()?.textContent).toBe(compose.actions.saveToAssets);
    expect(saveButton()?.hasAttribute('disabled')).toBe(false);
    await dom!.click(saveButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(2);
    expect(bytes(h)[1]!.init.body).toBe(second.blob);
    expect(h.seen.api!.sources.map((source) => source.key)).toEqual([`a:${SECOND}`, `a:${SAVED}`]);
  });

  it('never uploads a file the next export released', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    const first = h.job.exportJobSnapshot();
    expect(h.job.exportedFile(first)).not.toBeNull();
    // The next export starts: the first file is let go.
    await h.act(async () => {
      h.job.startExport(request());
    });
    expect(h.job.exportedFile(first)).toBeNull();
    await h.act(async () => {
      await h.keep.keepExport(first, { organizationId: ORG, canSave: true, title: TITLE, copy: KEEP_COPY }, 'save');
      await h.keep.keepExport(first, { organizationId: ORG, canSave: true, title: TITLE, copy: KEEP_COPY }, 'share');
    });
    expect(editorRequests(h)).toEqual([]);
    expect(shared).toEqual([]);
  });
});

describe('"검수 · 공유"', () => {
  it('saves the exported film first, then opens the review share window for that asset, titled by the film', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(shareButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
    expect(shared).toEqual([{ organizationId: ORG, assetId: SAVED, outputId: null, title: TITLE }]);
    expect(dom!.document.querySelector('[data-share-review-dialog]')).not.toBeNull();
    expect(line()?.textContent).toBe(compose.status.reviewOpened);
    expect(line()?.getAttribute('role')).toBe('status');
    expect(saveButton()?.textContent).toBe(compose.actions.savedToAssets);
  });

  it('an export already saved is shared as it is: no second upload', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(saveButton()!);
    await settle(h);
    await dom!.click(shareButton()!);
    await settle(h);
    await dom!.click(shareButton()!);
    await settle(h);
    expect(reserves(h)).toHaveLength(1);
    expect(shared).toEqual([
      { organizationId: ORG, assetId: SAVED, outputId: null, title: TITLE },
      { organizationId: ORG, assetId: SAVED, outputId: null, title: TITLE },
    ]);
  });

  it('when the save is refused nothing is shared and the refusal is said', async () => {
    const h = await harness({ reserve: { ok: false, code: 'storage_quota_exceeded' }, reserveStatus: 413 });
    await mountSheet(h, real(true));
    await exportOnce(h);
    await dom!.click(shareButton()!);
    await settle(h);
    expect(shared).toEqual([]);
    expect(dom!.document.querySelector('[data-share-review-dialog]')).toBeNull();
    expect(line()?.textContent).toBe(compose.status.saveQuotaExceeded);
  });
});

describe('the line for each refusal, where the done state shows its notes', () => {
  const cases: Array<[string, Plan, string]> = [
    ['asset_limit', { reserve: { ok: false, code: 'asset_limit' }, reserveStatus: 409 }, compose.status.saveQuotaExceeded],
    ['storage_quota_exceeded', { reserve: { ok: false, code: 'storage_quota_exceeded' }, reserveStatus: 413 }, compose.status.saveQuotaExceeded],
    ['storage_quota_exceeded before approval (500 MB)', { reserve: { ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' }, reserveStatus: 413 }, compose.status.saveQuotaExceeded],
    ['storage_quota_exceeded before approval (50 files)', { reserve: { ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' }, reserveStatus: 413 }, compose.status.saveQuotaExceeded],
    ['file_too_large from the server', { reserve: { ok: false, code: 'file_too_large' }, reserveStatus: 413 }, KEEP_COPY.fileTooLarge],
    ['forbidden', { reserve: { ok: false, code: 'forbidden' }, reserveStatus: 403 }, compose.status.saveFailed],
    ['a dropped connection at the reserve', { drop: 'reserve' }, compose.status.saveFailed],
    ['a dropped connection while sending the bytes', { drop: 'bytes' }, compose.status.saveFailed],
  ];
  for (const [name, plan, expected] of cases) {
    it(`${name}: "${expected}", and the button can be pressed again`, async () => {
      const h = await harness(plan);
      await mountSheet(h, real(true));
      await exportOnce(h);
      await dom!.click(saveButton()!);
      await settle(h);
      expect(line()?.textContent).toBe(expected);
      expect(line()?.getAttribute('role')).toBe('status');
      expect(dom!.query('[data-editor-export-done]')!.contains(line())).toBe(true);
      expect(saveButton()?.textContent).toBe(compose.actions.saveToAssets);
      expect(saveButton()?.hasAttribute('disabled')).toBe(false);
      expect(h.seen.api!.sources).toEqual([]);
    });
  }

  it('a film over the library’s video limit is refused in the browser with the library’s sentence, and nothing is sent', async () => {
    const h = await harness();
    await mountSheet(h, real(true));
    await exportOnce(h, result(STUDIO_LIMITS.videoBytesMax + 1));
    await dom!.click(saveButton()!);
    await settle(h);
    expect(line()?.textContent).toBe(KEEP_COPY.fileTooLarge);
    expect(KEEP_COPY.fileTooLarge).toContain('50 MB');
    expect(editorRequests(h)).toEqual([]);
  });
});
