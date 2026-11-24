import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposeExportResult } from '@/lib/brand-studio/compose/export-client';
import { emptyComposerProject, type ComposeClip, type ComposerProject } from '@/lib/brand-studio/compose';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { OPEN_SHARE_REVIEW_EVENT, type ShareReviewTarget } from '@/components/brand-studio/share-review-dialog';
import type { MountedDom } from '@/tests/brands/_dom-harness';

/**
 * The current editor's "에셋에 저장" and "검수 · 공유" (components/brand-studio/compose/video-composer.tsx), pinned
 * by what they do on the screen and on the wire, so moving them into a file both editors share
 * (components/brand-studio/compose/export-asset.ts) cannot change them:
 * - what is uploaded: the exported file itself, through the library's own upload (reserve, bytes, complete), named
 *   by the export and measured by it (width, height and length from the export, not read again);
 * - which line for which refusal: `saveQuotaExceeded` for `asset_limit` and `storage_quota_exceeded` (whatever the
 *   reason), `saveFailed` for anything else (`file_too_large`, `forbidden`, a dropped connection);
 * - the saved-once guard: saved, the button says so and a second press uploads nothing;
 * - what the review share window is opened with in each branch: the saved export first, else the selected (first)
 *   clip's asset, else its studio result, else the export uploaded there and then; the title is the clip's name or
 *   the editor's own; with nothing to share it still asks and says `reviewNeedsSave`.
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const SAVED = '30000000-0000-4000-8000-0000000000a1';
const CLIP_ASSET = '30000000-0000-4000-8000-0000000000c1';
const CLIP_OUTPUT = '30000000-0000-4000-8000-0000000000d1';

const exportMock = vi.hoisted(() => ({ result: null as ComposeExportResult | null, calls: 0 }));

vi.mock('@/lib/brand-studio/compose/export-client', async (original) => ({
  ...(await original<object>()),
  exportCompositionMp4: async () => {
    exportMock.calls += 1;
    return exportMock.result!;
  },
}));

const dict = getDictionary('ko');
const copy = dict.studioCompose;

function exported(): ComposeExportResult {
  return { blob: new Blob([new Uint8Array(4096)], { type: 'video/mp4' }), mime: 'video/mp4', filename: 'twings-compose-20261125.mp4', width: 1080, height: 1920, durationSec: 6.5, elapsedMs: 900 };
}

function clip(id: string, extra: Partial<ComposeClip>): ComposeClip {
  return { id, label: `${id} label`, sourceKind: 'local', srcUrl: `blob:${id}`, durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false, ...extra };
}

function film(...clips: ComposeClip[]): ComposerProject {
  return { ...emptyComposerProject('9:16'), clips };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  url: string;
  init: RequestInit;
  operation?: string;
  input?: Record<string, unknown>;
}

interface Plan {
  /** What `asset.reserve` answers (default: a reserved row, bytes through the app). */
  reserve?: unknown;
  reserveStatus?: number;
  /** Where the connection drops. */
  drop?: 'reserve' | 'bytes';
}

function savedAsset(id: string) {
  return { id, kind: 'video', role: null, name: 'twings-compose-20261125.mp4', tags: [], url: `/media/${id}.mp4`, thumbUrl: null, width: 1080, height: 1920, seconds: 6.5, source: 'upload', createdAt: '2026-11-25T01:00:00.000Z' };
}

function network(plan: Plan = {}) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (url: string | URL, init: RequestInit = {}) => {
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
    if (entry.url === '/api/brand-studio/compose') return json({ ok: true, jobId: 'job-1', creditsUsed: 0 });
    if (entry.url === '/api/brand-studio/share-bridge') return json({ ok: true, projects: [], shares: [] });
    if (entry.url === '/api/brand-studio' && entry.operation === 'asset.reserve') {
      if (plan.drop === 'reserve') throw new TypeError('Failed to fetch');
      return json(plan.reserve ?? { ok: true, id: SAVED, direct: false }, plan.reserveStatus ?? 200);
    }
    if (entry.url.startsWith(`/api/brand-studio/assets/${SAVED}`)) {
      if (plan.drop === 'bytes') throw new TypeError('Failed to fetch');
      return json({ ok: true });
    }
    if (entry.url === '/api/brand-studio' && entry.operation === 'asset.complete') return json({ ok: true, asset: savedAsset(SAVED) });
    return json({ ok: false, code: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    sent,
    uploads: () => sent.filter((entry) => entry.operation === 'asset.reserve'),
    bytes: () => sent.filter((entry) => entry.url.startsWith('/api/brand-studio/assets/')),
    completes: () => sent.filter((entry) => entry.operation === 'asset.complete'),
  };
}

let dom: MountedDom | null = null;
let shared: ShareReviewTarget[] = [];

async function mountComposer(project: ComposerProject, canCreate = true) {
  const { mountDom } = await import('@/tests/brands/_dom-harness');
  const { VideoComposer } = await import('@/components/brand-studio/compose/video-composer');
  dom = await mountDom(
    <VideoComposer
      organizationId={ORG}
      organizationName="Sample Brand"
      locale="ko"
      canCreate={canCreate}
      copy={copy}
      videoStudioHref={`/brand/studio/video?organizationId=${ORG}`}
      initialAllowance={{ capKrw: 300_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00.000Z', window: 'month', refill: 'monthly' } as never}
      initialAssets={[]}
      initialVideoOutputs={[]}
      initialProject={project}
    />,
  );
  // The fake document's elements have no `click`/`remove` (the export's own download link uses both).
  const proto = Object.getPrototypeOf(dom.document.createElement('a')) as Record<string, unknown>;
  proto.click ??= () => undefined;
  proto.remove ??= function (this: { parentNode: { removeChild(node: unknown): void } | null }) {
    this.parentNode?.removeChild(this);
  };
  // …and its `<select>` has no `options` (the review share window has one).
  const select = Object.getPrototypeOf(dom.document.createElement('select')) as object;
  if (!('options' in select)) {
    Object.defineProperty(select, 'options', {
      get(this: { children: unknown[] }) {
        return this.children;
      },
    });
  }
  // What the review share window is asked to open, as the window event carries it.
  shared = [];
  window.addEventListener(OPEN_SHARE_REVIEW_EVENT, (event) => {
    shared.push((event as CustomEvent<ShareReviewTarget>).detail);
  });
  return dom;
}

const status = () => dom!.query('[data-compose-status]')?.textContent ?? '';
const saveButton = () => dom!.query('[data-compose-save-asset]');

async function exportFilm() {
  await dom!.click('[data-compose-export]');
}

async function settle() {
  const { act } = await import('react');
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  exportMock.result = exported();
  exportMock.calls = 0;
  try {
    globalThis.localStorage?.clear();
  } catch {
    // no storage yet
  }
});

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
});

describe('the current editor saves its export to the assets', () => {
  it('uploads the exported file once, through the library upload, named and measured by the export', async () => {
    const net = network();
    await mountComposer(film(clip('c1', {})));
    expect(saveButton()).toBeNull();
    await exportFilm();
    await settle();
    expect(exportMock.calls).toBe(1);
    expect(saveButton()?.textContent).toBe(copy.actions.saveToAssets);

    await dom!.click(saveButton()!);
    await settle();
    expect(net.uploads()).toHaveLength(1);
    expect(net.uploads()[0]!.input).toMatchObject({ organizationId: ORG, name: 'twings-compose-20261125.mp4', mime: 'video/mp4', sizeBytes: 4096 });
    expect(net.bytes()).toHaveLength(1);
    // The bytes sent are the exported file itself.
    expect(net.bytes()[0]!.init.body).toBe(exportMock.result!.blob);
    expect(net.completes()).toHaveLength(1);
    expect(net.completes()[0]!.input).toEqual({ organizationId: ORG, assetId: SAVED, width: 1080, height: 1920, seconds: 6.5 });
    expect(saveButton()?.textContent).toBe(copy.actions.savedToAssets);
    expect(saveButton()?.hasAttribute('disabled')).toBe(true);

    // Saved once: pressing again sends nothing.
    await dom!.click(saveButton()!);
    await settle();
    expect(net.uploads()).toHaveLength(1);
    // Only the export record went to the compose route; nothing else asks for credits.
    expect(net.sent.filter((entry) => entry.url === '/api/brand-studio/compose').map((entry) => entry.operation)).toEqual(['render.reserve']);
  });

  it('a new export makes the button pressable again, and that press is a second asset', async () => {
    const net = network();
    await mountComposer(film(clip('c1', {})));
    await exportFilm();
    await settle();
    await dom!.click(saveButton()!);
    await settle();
    expect(saveButton()?.textContent).toBe(copy.actions.savedToAssets);
    await exportFilm();
    await settle();
    expect(saveButton()?.textContent).toBe(copy.actions.saveToAssets);
    await dom!.click(saveButton()!);
    await settle();
    expect(net.uploads()).toHaveLength(2);
  });

  const refusals: Array<[string, Plan, string]> = [
    ['asset_limit', { reserve: { ok: false, code: 'asset_limit' }, reserveStatus: 409 }, copy.status.saveQuotaExceeded],
    ['storage_quota_exceeded', { reserve: { ok: false, code: 'storage_quota_exceeded' }, reserveStatus: 413 }, copy.status.saveQuotaExceeded],
    ['storage_quota_exceeded before approval (500 MB)', { reserve: { ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_quota' }, reserveStatus: 413 }, copy.status.saveQuotaExceeded],
    ['storage_quota_exceeded before approval (50 files)', { reserve: { ok: false, code: 'storage_quota_exceeded', reason: 'unapproved_file_limit' }, reserveStatus: 413 }, copy.status.saveQuotaExceeded],
    ['file_too_large', { reserve: { ok: false, code: 'file_too_large' }, reserveStatus: 413 }, copy.status.saveFailed],
    ['forbidden', { reserve: { ok: false, code: 'forbidden' }, reserveStatus: 403 }, copy.status.saveFailed],
    ['a dropped connection at the reserve', { drop: 'reserve' }, copy.status.saveFailed],
    ['a dropped connection while sending the bytes', { drop: 'bytes' }, copy.status.saveFailed],
  ];
  for (const [name, plan, line] of refusals) {
    it(`${name}: says "${line}" and the button can be pressed again`, async () => {
      network(plan);
      await mountComposer(film(clip('c1', {})));
      await exportFilm();
      await settle();
      await dom!.click(saveButton()!);
      await settle();
      expect(status()).toContain(line);
      expect(saveButton()?.textContent).toBe(copy.actions.saveToAssets);
      expect(saveButton()?.hasAttribute('disabled')).toBe(false);
    });
  }

  it('without create rights there is no save button (and no export to save)', async () => {
    network();
    await mountComposer(film(clip('c1', {})), false);
    expect(saveButton()).toBeNull();
    expect(dom!.query('[data-compose-export]')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('the current editor opens the review share window', () => {
  it('for the saved export first, titled by the selected (first) clip', async () => {
    const net = network();
    await mountComposer(film(clip('c1', { sourceKind: 'asset', assetId: CLIP_ASSET })));
    await exportFilm();
    await settle();
    await dom!.click(saveButton()!);
    await settle();
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(shared).toEqual([{ organizationId: ORG, assetId: SAVED, outputId: null, title: 'c1 label' }]);
    expect(status()).toContain(copy.status.reviewOpened);
    expect(net.uploads()).toHaveLength(1);
    expect(dom!.document.querySelector('[data-share-review-dialog]')).not.toBeNull();
  });

  it('else for the selected clip’s own asset, without uploading the export', async () => {
    const net = network();
    await mountComposer(film(clip('c1', { sourceKind: 'asset', assetId: CLIP_ASSET })));
    await exportFilm();
    await settle();
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(shared).toEqual([{ organizationId: ORG, assetId: CLIP_ASSET, outputId: null, title: 'c1 label' }]);
    expect(net.uploads()).toHaveLength(0);
    expect(status()).toContain(copy.status.reviewOpened);
  });

  it('else for the selected clip’s studio result', async () => {
    const net = network();
    await mountComposer(film(clip('c1', { sourceKind: 'output', outputId: CLIP_OUTPUT })));
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(shared).toEqual([{ organizationId: ORG, assetId: null, outputId: CLIP_OUTPUT, title: 'c1 label' }]);
    expect(net.uploads()).toHaveLength(0);
    expect(status()).toContain(copy.status.reviewOpened);
  });

  it('else uploads the export there and then and opens it for that asset', async () => {
    const net = network();
    await mountComposer(film(clip('c1', {})));
    await exportFilm();
    await settle();
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(net.uploads()).toHaveLength(1);
    expect(shared).toEqual([{ organizationId: ORG, assetId: SAVED, outputId: null, title: 'c1 label' }]);
    expect(status()).toContain(copy.status.reviewOpened);
    expect(saveButton()?.textContent).toBe(copy.actions.savedToAssets);
  });

  it('with nothing to share (no asset, no result, the upload refused) it still asks with nothing and says reviewNeedsSave', async () => {
    const net = network({ reserve: { ok: false, code: 'storage_quota_exceeded' }, reserveStatus: 413 });
    await mountComposer(film(clip('c1', {})));
    await exportFilm();
    await settle();
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(net.uploads()).toHaveLength(1);
    expect(shared).toEqual([{ organizationId: ORG, assetId: null, outputId: null, title: 'c1 label' }]);
    expect(status()).toContain(copy.status.reviewNeedsSave);
    expect(dom!.document.querySelector('[data-share-review-dialog]')).toBeNull();
  });

  it('with an empty film and no export: the editor’s own name, nothing to share, reviewNeedsSave, nothing uploaded', async () => {
    const net = network();
    await mountComposer(film());
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(shared).toEqual([{ organizationId: ORG, assetId: null, outputId: null, title: copy.title }]);
    expect(net.uploads()).toHaveLength(0);
    expect(status()).toContain(copy.status.reviewNeedsSave);
  });

  it('without create rights: the clip’s asset is shared, the export is never uploaded', async () => {
    const net = network();
    await mountComposer(film(clip('c1', { sourceKind: 'asset', assetId: CLIP_ASSET })), false);
    await dom!.click('[data-compose-share-review]');
    await settle();
    expect(shared).toEqual([{ organizationId: ORG, assetId: CLIP_ASSET, outputId: null, title: 'c1 label' }]);
    expect(net.uploads()).toHaveLength(0);
  });
});
