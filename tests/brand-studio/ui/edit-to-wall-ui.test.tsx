import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { EDITED_NO_MODEL, tileModelLabel } from '@/lib/brand-studio/model-label';
import type { StudioFailure, StudioJobView } from '@/lib/brand-studio/contracts';
import { createStudioApi } from '@/components/brand-studio/api';
import { studioUploadErrorLine } from '@/components/brand-studio/copy';
import { buildHubEntries } from '@/components/brand-studio/asset-hub-model';
import { initialDraft } from '@/components/brand-studio/dock-model';
import { tileMenuKeys, Wall } from '@/components/brand-studio/gallery/wall';
import { planReuse } from '@/components/brand-studio/reuse-model';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { mergeJobs } from '@/components/brand-studio/store';
import { canRerun, Viewer, type ViewerActions } from '@/components/brand-studio/viewer';
import { mountDom } from '@/tests/brands/_dom-harness';
import { ORG, asset, copyFor, id, job, output } from './fixtures';

const NOW = new Date('2026-11-27T10:00:00.000Z');
const noop = () => {};

const library: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set(),
  likedItems: [],
  folderItems: () => null,
  openFolder: noop,
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};

const viewerActions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
};

function editedJob(n: number, patch: Partial<StudioJobView> = {}): StudioJobView {
  return job(n, {
    kind: 'image',
    status: 'succeeded',
    model: 'seedream-5.5',
    prompt: '',
    finalPrompt: null,
    estimateKrw: 0,
    edited: true,
    outputs: [output(n)],
    ...patch,
  });
}

describe('edit-to-wall UI & client store/API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('ships finalized dictionary strings gallery.editSaved in ko and en', () => {
    expect(getDictionary('ko').brandStudio.gallery.editSaved).toBe('편집한 이미지를 새 이미지로 저장했어요.');
    expect(getDictionary('en').brandStudio.gallery.editSaved).toBe('Saved the edited image as a new image.');
  });

  it('prepends saved edited job once in mergeJobs and updates idempotently across polls', () => {
    const first = editedJob(10, { createdAt: '2026-11-27T10:00:00.000Z' });
    const existing = job(1);
    const once = mergeJobs([existing], [first]);
    expect(once.map((j) => j.id)).toEqual([first.id, existing.id]);
    // Poll returning the same job must update without duplicating
    const polled = mergeJobs(once, [first, existing]);
    expect(polled.map((j) => j.id)).toEqual([first.id, existing.id]);
  });

  it('renders <model> · edited or edited-only labels across tileModelLabel, Wall, Viewer, and AssetHub', () => {
    const copy = copyFor('ko');
    expect(tileModelLabel({ model: 'seedream-5.5', edited: true, editedMark: copy.gallery.editedMark })).toBe(
      `Seedream 5.5 · ${copy.gallery.editedMark}`,
    );
    expect(tileModelLabel({ model: EDITED_NO_MODEL, edited: true, editedMark: copy.gallery.editedMark })).toBe(
      copy.gallery.editedMark,
    );

    const parent = output(1);
    const withSource = editedJob(2, { model: 'seedream-5.5', parentOutputId: parent.id });
    const withoutSource = editedJob(3, { model: EDITED_NO_MODEL, parentOutputId: null });

    const wallHtml = renderToStaticMarkup(
      <Wall
        mode="image"
        jobs={[withSource, withoutSource]}
        copy={copy}
        locale="ko"
        canGenerate
        canEdit
        library={library}
        parentOf={(oid) => (oid === parent.id ? parent : null)}
        onAction={noop}
        onRetry={noop}
        onNotice={noop}
        now={NOW}
      />,
    );
    expect(wallHtml).toContain(`Seedream 5.5 · ${copy.gallery.editedMark}`);
    expect(wallHtml).toContain(`>${copy.gallery.editedMark}<`);

    // AssetHub entries propagate edited flag from StudioJobView
    const hubEntries = buildHubEntries([], [withSource, withoutSource], 'AI');
    expect(hubEntries[0]?.edited).toBe(true);
    expect(hubEntries[1]?.edited).toBe(true);

    // Edited rows disable rerun/reuse and hide empty prompt block while showing CompareSlider when parent resolves
    expect(canRerun(withSource)).toBe(false);
    expect(
      planReuse(withSource, {
        current: initialDraft(),
        lookup: { asset: () => null, output: () => null },
        outputName: copy.viewer.label,
      }),
    ).toEqual({ to: 'none' });
    const menuKeys = tileMenuKeys({
      canGenerate: true,
      canEdit: true,
      kind: 'image',
      image: true,
      sized: true,
      saved: false,
      copyable: true,
      edited: true,
      canMoveProject: true,
      inMenu: { select: true, like: true, reference: true },
    });
    expect(menuKeys).not.toContain('rerun');
    expect(menuKeys).not.toContain('reuse');
    for (const kept of ['open', 'select', 'copy-prompt', 'region', 'decorate', 'to-video', 'reference', 'folder', 'project-move', 'like', 'review', 'campaign', 'save', 'download', 'delete'] as const) {
      expect(menuKeys).toContain(kept);
    }

    const viewerWithParent = renderToStaticMarkup(
      <Viewer
        items={[{ type: 'output', output: withSource.outputs[0]!, job: withSource }]}
        index={0}
        copy={copy}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={(oid) => (oid === parent.id ? parent : null)}
        parentAssetOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={viewerActions}
      />,
    );
    expect(viewerWithParent).toContain(`Seedream 5.5 · ${copy.gallery.editedMark}`);
    expect(viewerWithParent).toContain('data-studio-compare="true"');
    expect(viewerWithParent).toContain(copy.viewer.before);
    expect(viewerWithParent).toContain(copy.viewer.after);
    expect(viewerWithParent).not.toContain('data-action="rerun"');
    expect(viewerWithParent).not.toContain('data-studio-reuse');
    expect(viewerWithParent).not.toContain('data-studio-prompt-block');
    // Kept actions remain present:
    for (const kept of ['to-video', 'reference', 'save', 'campaign', 'download', 'delete']) {
      expect(viewerWithParent).toContain(`data-action="${kept}"`);
    }

    const viewerNoSource = renderToStaticMarkup(
      <Viewer
        items={[{ type: 'output', output: withoutSource.outputs[0]!, job: withoutSource }]}
        index={0}
        copy={copy}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        parentAssetOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={viewerActions}
      />,
    );
    expect(viewerNoSource).toContain(`>${copy.gallery.editedMark}<`);
    expect(viewerNoSource).not.toContain('data-studio-compare="true"');
  });

  it('saveEditedImage calls output.edit.reserve -> PUT/POST -> output.edit.complete without width/height', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const saved = editedJob(21, { model: 'seedream-5.5', parentOutputId: output(1).id });
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body: parsed });
      if (parsed?.operation === 'output.edit.reserve') {
        return new Response(
          JSON.stringify({ ok: true, direct: false, url: `/api/brand-studio/edit/${parsed.input.requestId}?organizationId=${ORG}` }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (parsed?.operation === 'output.edit.complete') {
        return new Response(JSON.stringify({ ok: true, job: saved }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const api = createStudioApi({ organizationId: ORG, fetch: mockFetch as unknown as typeof globalThis.fetch });
    const file = new File([new Uint8Array(24)], 'edited.png', { type: 'image/png' });
    const res = await api.saveEditedImage(file, { requestId: 'edit_ui_req_01', parentOutputId: output(1).id });
    expect(res).toEqual({ ok: true, job: saved });
    expect(calls[0]!.body).toMatchObject({
      operation: 'output.edit.reserve',
      input: { organizationId: ORG, requestId: 'edit_ui_req_01', mime: 'image/png', sizeBytes: 24, parentOutputId: output(1).id },
    });
    expect(calls[1]).toMatchObject({
      url: `/api/brand-studio/edit/edit_ui_req_01?organizationId=${ORG}`,
      method: 'POST',
    });
    expect(calls[2]!.body).toMatchObject({
      operation: 'output.edit.complete',
      input: { organizationId: ORG, requestId: 'edit_ui_req_01', mime: 'image/png', parentOutputId: output(1).id },
    });
    const completeInput = (calls[2]!.body as { input: Record<string, unknown> }).input;
    expect('width' in completeInput).toBe(false);
    expect('height' in completeInput).toBe(false);
  });

  it('Fix Round 3 Item 5: saveEditedImage returns saved job from reserve without uploading or calling complete on retry after success', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const saved = editedJob(22, { model: 'seedream-5.5', parentOutputId: output(1).id });
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body: parsed });
      return new Response(JSON.stringify({ ok: true, direct: false, url: '', job: saved }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const api = createStudioApi({ organizationId: ORG, fetch: mockFetch as unknown as typeof globalThis.fetch });
    const file = new File([new Uint8Array(24)], 'edited.png', { type: 'image/png' });
    const res = await api.saveEditedImage(file, { requestId: 'edit_ui_req_retry_01', parentOutputId: output(1).id });
    expect(res).toEqual({ ok: true, job: saved });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ operation: 'output.edit.reserve' });
  });

  it('LayerEditor save invokes saveEdited -> onSavedToWall -> onClose when open, or upload -> onSaved when closed', async () => {
    const fakeBlob = new Blob([new Uint8Array(16)], { type: 'image/png' });
    vi.doMock('@/components/brand-studio/layers/export', async (orig) => {
      const actual = await orig<typeof import('@/components/brand-studio/layers/export')>();
      return {
        ...actual,
        renderPlan: async () => ({ ok: true as const, blob: fakeBlob, mime: 'image/png' as const }),
      };
    });
    const { default: LayerEditor } = await import('@/components/brand-studio/layers');
    const layersCopy = getDictionary('ko').studioLayers;

    const baseProps = {
      organizationId: ORG,
      locale: 'ko' as const,
      base: { ref: { outputId: output(1).id }, url: '/m/base.png', width: 1000, height: 1200, name: null },
      assets: [],
      library: null,
      copy: layersCopy,
    };

    // 1. Open switch: calls saveEdited & onSavedToWall, never calls upload
    const uploadOpen = vi.fn(async (_file: File) => ({ ok: true as const, asset: asset(99) }));
    const onSavedOpen = vi.fn();
    const savedJob = editedJob(30, { parentOutputId: output(1).id });
    const saveEdited = vi.fn(async (_file: File) => ({ ok: true as const, job: savedJob }));
    const onSavedToWall = vi.fn();
    const onCloseOpen = vi.fn();

    const dom1 = await mountDom(
      <LayerEditor
        {...baseProps}
        upload={uploadOpen}
        onSaved={onSavedOpen}
        saveEdited={saveEdited}
        onSavedToWall={onSavedToWall}
        onClose={onCloseOpen}
      />,
    );
    await dom1.click('[data-action="save"]');
    await act(async () => Promise.resolve());
    expect(saveEdited).toHaveBeenCalledTimes(1);
    const savedArg = saveEdited.mock.calls[0]?.[0] as unknown as File;
    expect(savedArg).toBeInstanceOf(File);
    expect(savedArg.type).toBe('image/png');
    expect(savedArg.size).toBe(fakeBlob.size);
    expect(uploadOpen).not.toHaveBeenCalled();
    expect(onSavedOpen).not.toHaveBeenCalled();
    expect(onSavedToWall).toHaveBeenCalledWith(savedJob);
    expect(onCloseOpen).toHaveBeenCalled();
    await dom1.unmount();

    // 2. Open switch failure: stays open, surfaces failUpload
    const failClose = vi.fn();
    const failWall = vi.fn();
    const dom2 = await mountDom(
      <LayerEditor
        {...baseProps}
        upload={uploadOpen}
        onSaved={onSavedOpen}
        saveEdited={async () => ({ ok: false as const, code: 'storage_quota_exceeded' as const })}
        onSavedToWall={failWall}
        onClose={failClose}
      />,
    );
    await dom2.click('[data-action="save"]');
    await act(async () => Promise.resolve());
    expect(failWall).not.toHaveBeenCalled();
    expect(failClose).not.toHaveBeenCalled();
    expect(dom2.container.textContent).toContain(layersCopy.export.failUpload);
    await dom2.unmount();

    // 3. Closed switch (saveEdited omitted): calls upload -> onSaved -> onClose
    const uploadClosed = vi.fn(async (_file: File) => ({ ok: true as const, asset: asset(88) }));
    const onSavedClosed = vi.fn();
    const onCloseClosed = vi.fn();
    const dom3 = await mountDom(
      <LayerEditor
        {...baseProps}
        upload={uploadClosed}
        onSaved={onSavedClosed}
        onClose={onCloseClosed}
      />,
    );
    await dom3.click('[data-action="save"]');
    await act(async () => Promise.resolve());
    expect(uploadClosed).toHaveBeenCalledTimes(1);
    const uploadedArg = uploadClosed.mock.calls[0]?.[0] as unknown as File;
    expect(uploadedArg).toBeInstanceOf(File);
    expect(uploadedArg.size).toBe(fakeBlob.size);
    expect(onSavedClosed).toHaveBeenCalledWith(asset(88));
    expect(onCloseClosed).toHaveBeenCalled();
    await dom3.unmount();
  });

  it('Item 4 & Item 5: ignores double-click during save, reuses requestId on retry, and surfaces quota/unapproved/projectGone errors while staying open', async () => {
    const fakeBlob = new Blob([new Uint8Array(16)], { type: 'image/png' });
    vi.doMock('@/components/brand-studio/layers/export', async (orig) => {
      const actual = await orig<typeof import('@/components/brand-studio/layers/export')>();
      return {
        ...actual,
        renderPlan: async () => ({ ok: true as const, blob: fakeBlob, mime: 'image/png' as const }),
      };
    });
    const { default: LayerEditor } = await import('@/components/brand-studio/layers');
    const dict = getDictionary('ko');
    const copy = dict.brandStudio;
    const layersCopy = dict.studioLayers;

    const baseProps = {
      organizationId: ORG,
      locale: 'ko' as const,
      base: { ref: { outputId: output(1).id }, url: '/m/base.png', width: 1000, height: 1200, name: null },
      assets: [],
      library: null,
      copy: layersCopy,
    };

    const errorText = (failure: StudioFailure & { projectGone?: boolean }) =>
      failure.projectGone ? dict.projectSpine.goneNotice : studioUploadErrorLine(copy, failure.code, failure.reason);

    // 1. In-flight double click calls saveEdited only once; failed retry reuses the exact same requestId; second attempt succeeds.
    let resolveFirst!: (val: { ok: false; code: 'failed' }) => void;
    const reqIds: Array<string | undefined> = [];
    const savedJob = editedJob(40, { parentOutputId: output(1).id });
    const saveEditedRetry = vi.fn((_file: File, opts?: { requestId?: string }) => {
      reqIds.push(opts?.requestId);
      if (reqIds.length === 1) {
        return new Promise<{ ok: false; code: 'failed' }>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ ok: true as const, job: savedJob });
    });
    const onSavedToWall = vi.fn();
    const onClose = vi.fn();
    const dom = await mountDom(
      <LayerEditor
        {...baseProps}
        upload={async () => ({ ok: true as const, asset: asset(99) })}
        onSaved={noop}
        saveEdited={saveEditedRetry}
        onSavedToWall={onSavedToWall}
        errorText={errorText}
        onClose={onClose}
      />,
    );

    // First save enters saving stage and holds in-flight; second click during save must be ignored.
    await dom.click('[data-action="save"]');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    await dom.click('[data-action="save"]');
    expect(saveEditedRetry).toHaveBeenCalledTimes(1);
    expect(reqIds[0]).toBeTruthy();

    await act(async () => {
      resolveFirst({ ok: false, code: 'failed' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(dom.container.textContent).toContain(studioUploadErrorLine(copy, 'failed'));

    // Retry click after failure reuses same requestId and closes on success.
    await dom.click('[data-action="save"]');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
    expect(saveEditedRetry).toHaveBeenCalledTimes(2);
    expect(reqIds[1]).toBe(reqIds[0]);
    expect(onSavedToWall).toHaveBeenCalledWith(savedJob);
    expect(onClose).toHaveBeenCalledTimes(1);
    await dom.unmount();

    // 2. Specific failure messages (storage_quota_exceeded, unapproved_quota, projectGone) stay open and display exact strings.
    for (const [failure, expectedText] of [
      [{ ok: false as const, code: 'storage_quota_exceeded' as const }, copy.errors.storage_quota_exceeded],
      [
        { ok: false as const, code: 'forbidden' as const, reason: 'unapproved_quota' as const },
        studioUploadErrorLine(copy, 'forbidden', 'unapproved_quota'),
      ],
      [{ ok: false as const, code: 'not_found' as const, projectGone: true }, dict.projectSpine.goneNotice],
    ] as const) {
      const closeSpy = vi.fn();
      const d = await mountDom(
        <LayerEditor
          {...baseProps}
          upload={async () => ({ ok: true as const, asset: asset(99) })}
          onSaved={noop}
          saveEdited={async () => failure}
          errorText={errorText}
          onClose={closeSpy}
        />,
      );
      await d.click('[data-action="save"]');
      await act(async () => new Promise((r) => setTimeout(r, 15)));
      expect(closeSpy).not.toHaveBeenCalled();
      expect(d.container.textContent).toContain(expectedText);
      await d.unmount();
    }
  });
});
