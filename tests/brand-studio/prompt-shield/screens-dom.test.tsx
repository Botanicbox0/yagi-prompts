import { act, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const extraVideoModels: Array<Record<string, unknown>> = [];
vi.mock('@/lib/brand-studio/models', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-studio/models')>();
  return {
    ...actual,
    selectableModels: (medium?: 'image' | 'video') => {
      const base = actual.selectableModels(medium);
      if (medium === 'video' && extraVideoModels.length > 0) {
        return [...base, ...(extraVideoModels as unknown as typeof base)];
      }
      return base;
    },
  };
});

import { Dock } from '@/components/brand-studio/dock';
import type { DockDraft } from '@/components/brand-studio/dock-model';
import { writeStudioPrefill } from '@/components/brand-studio/prefill';
import type { PromptPictureLoader } from '@/components/brand-studio/prompt-pictures';
import { trayItemFromAsset, trayLabels } from '@/components/brand-studio/refs';
import { planReuse, type ReuseLookup } from '@/components/brand-studio/reuse-model';
import { useDock } from '@/components/brand-studio/use-dock';
import { Viewer, type ViewerActions } from '@/components/brand-studio/viewer';
import type { StudioErrorCode, StudioJobView } from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { selectableModels, type StudioVideoModel } from '@/lib/brand-studio/models';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { allowance, asset, copyFor, id, job, output } from '../ui/fixtures';

const ORG = id(0xa0);
const noop = () => {};
const actions: ViewerActions = {
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setDetailsOpen(dom: MountedDom, open: boolean) {
  const details = dom.query('[data-studio-prompt-details]') as unknown as {
    open: boolean;
    dispatchEvent(ev: unknown): boolean;
  };
  if (!details) throw new Error('Prompt details element not found');
  await act(async () => {
    details.open = open;
    details.dispatchEvent({
      type: 'toggle',
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      cancelBubble: false,
      target: null,
      currentTarget: null,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
  });
  await flush();
}

describe('viewer prompt picture loader DOM lifecycle', () => {
  let dom: MountedDom | null = null;
  let seq = 0;
  let created: string[] = [];
  let revoked: string[] = [];

  beforeEach(() => {
    seq = 0;
    created = [];
    revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const next = `blob:test/${++seq}`;
      created.push(next);
      return next;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.restoreAllMocks();
  });

  const makeViewerTree = (items: Parameters<typeof Viewer>[0]['items'], index: number, fetchPromptPicture: PromptPictureLoader, extra = 0) => (
    <Viewer
      items={items}
      index={index}
      copy={copyFor('ko')}
      locale="ko"
      organizationId={ORG}
      canCreate
      canGenerate
      busy={null}
      notice={extra ? `n${extra}` : null}
      parentOf={() => null}
      onIndex={noop}
      onClose={noop}
      actions={actions}
      fetchPromptPicture={fetchPromptPicture}
    />
  );

  it('fetches page 1 once on open, ignores 3 equal re-renders, paginates once, reuses cache on reopen, and revokes on run switch & unmount', async () => {
    const out1 = output(1, { kind: 'video' });
    const out2 = output(2, { kind: 'video' });
    const run1 = job(1, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 돈다',
      finalPrompt: null,
      sent: { shielded: true, pages: 3, version: 'v1' },
      architect: true,
      outputs: [out1],
    });
    const run2 = job(2, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '다른 컷',
      finalPrompt: null,
      sent: { shielded: true, pages: 2, version: 'v2' },
      architect: true,
      outputs: [out2],
    });
    const items = [
      { type: 'output' as const, output: out1, job: run1 },
      { type: 'output' as const, output: out2, job: run2 },
    ];
    const fetchPicture = vi.fn<PromptPictureLoader>(async (req) => ({
      ok: true,
      blob: new Blob([`${req.kind}:${req.page}`], { type: 'image/png' }),
    }));

    dom = await mountDom(makeViewerTree(items, 0, fetchPicture));
    expect(fetchPicture).toHaveBeenCalledTimes(0);

    // Open <details>: fetches page 1 once
    await setDetailsOpen(dom, true);
    expect(fetchPicture).toHaveBeenCalledTimes(1);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'run', organizationId: ORG, jobId: run1.id, page: 1 }, expect.any(AbortSignal));
    expect(dom.query('[data-prompt-picture-img]')?.getAttribute('src')).toBe('blob:test/1');

    // Three re-renders with equal picture props: zero extra fetches
    await dom.rerender(makeViewerTree(items, 0, fetchPicture, 1));
    await dom.rerender(makeViewerTree(items, 0, fetchPicture, 2));
    await dom.rerender(makeViewerTree(items, 0, fetchPicture, 3));
    expect(fetchPicture).toHaveBeenCalledTimes(1);

    // Next page fetches page 2 once
    await dom.click('[data-prompt-picture-next]');
    await flush();
    expect(fetchPicture).toHaveBeenCalledTimes(2);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'run', organizationId: ORG, jobId: run1.id, page: 2 }, expect.any(AbortSignal));
    expect(dom.query('[data-prompt-picture-page]')?.textContent).toBe('2 / 3');
    expect(dom.query('[data-prompt-picture-img]')?.getAttribute('alt')).toBe('보낸 프롬프트 2/3쪽');
    expect(dom.query('[data-prompt-picture-img]')?.getAttribute('src')).toBe('blob:test/2');

    // Close and reopen <details>: uses cache, zero new fetches
    await setDetailsOpen(dom, false);
    await setDetailsOpen(dom, true);
    expect(fetchPicture).toHaveBeenCalledTimes(2);
    expect(dom.query('[data-prompt-picture-img]')?.getAttribute('src')).toBe('blob:test/2');

    // Move to another run: revokes old object URLs and waits until new run's <details> opens
    await dom.rerender(makeViewerTree(items, 1, fetchPicture));
    await flush();
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);
    expect(fetchPicture).toHaveBeenCalledTimes(2);

    // Open run2's <details> -> fetches run2 page 1, then unmount revokes it
    await setDetailsOpen(dom, true);
    expect(fetchPicture).toHaveBeenCalledTimes(3);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'run', organizationId: ORG, jobId: run2.id, page: 1 }, expect.any(AbortSignal));
    await dom.unmount();
    dom = null;
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2', 'blob:test/3']);
  });

  it('revokes old URLs when sent.version changes on the same open run', async () => {
    const out = output(1, { kind: 'video' });
    const runV1 = job(1, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병이 돈다',
      finalPrompt: null,
      sent: { shielded: true, pages: 1, version: 'v1' },
      architect: true,
      outputs: [out],
    });
    const runV2 = { ...runV1, sent: { shielded: true as const, pages: 1, version: 'v2' } };
    const fetchPicture = vi.fn<PromptPictureLoader>(async () => ({
      ok: true,
      blob: new Blob(['png'], { type: 'image/png' }),
    }));

    dom = await mountDom(makeViewerTree([{ type: 'output', output: out, job: runV1 }], 0, fetchPicture));
    await setDetailsOpen(dom, true);
    expect(fetchPicture).toHaveBeenCalledTimes(1);

    await dom.rerender(makeViewerTree([{ type: 'output', output: out, job: runV2 }], 0, fetchPicture));
    await flush();
    expect(revoked).toEqual(['blob:test/1']);
    expect(fetchPicture).toHaveBeenCalledTimes(2);
  });

  it('shows pictureBusy on 429 without retrying and lets retry recover once after a failure', async () => {
    const copy = copyFor('ko');
    const out = output(1, { kind: 'video' });
    const run = job(1, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '병',
      finalPrompt: null,
      sent: { shielded: true, pages: 1, version: 'v1' },
      architect: true,
      outputs: [out],
    });

    const busyFetch = vi.fn<PromptPictureLoader>(async () => ({ ok: false, code: 'too_many_running' }));
    dom = await mountDom(makeViewerTree([{ type: 'output', output: out, job: run }], 0, busyFetch));
    await setDetailsOpen(dom, true);
    expect(busyFetch).toHaveBeenCalledTimes(1);
    expect(dom.query('[data-prompt-picture-busy]')?.textContent).toBe(copy.viewer.pictureBusy);
    expect(dom.query('[data-prompt-picture-retry]')).toBeNull();
    await dom.unmount();

    const failThenOk = vi
      .fn<PromptPictureLoader>()
      .mockResolvedValueOnce({ ok: false, code: 'not_found' })
      .mockResolvedValueOnce({ ok: true, blob: new Blob(['ok'], { type: 'image/png' }) });
    dom = await mountDom(makeViewerTree([{ type: 'output', output: out, job: run }], 0, failThenOk));
    await setDetailsOpen(dom, true);
    expect(failThenOk).toHaveBeenCalledTimes(1);
    expect(dom.query('[data-prompt-picture-failed]')?.textContent).toContain(copy.viewer.pictureFailed);
    expect(dom.query('[data-prompt-picture-retry]')?.textContent).toBe(copy.viewer.pictureRetry);

    await dom.click('[data-prompt-picture-retry]');
    await flush();
    expect(failThenOk).toHaveBeenCalledTimes(2);
    expect(dom.query('[data-prompt-picture-img]')?.getAttribute('src')).toBe('blob:test/1');
  });
});

describe('dock shielded design and reuse DOM flows', () => {
  let dom: MountedDom | null = null;
  let seq = 0;
  let revoked: string[] = [];

  beforeEach(() => {
    seq = 0;
    revoked = [];
    extraVideoModels.length = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:dock/${++seq}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => {
      revoked.push(u);
    });
  });

  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.restoreAllMocks();
  });

  function createDockHarness(opts: {
    enhanceAnswer?: unknown;
    createResult?: { ok: true; job: StudioJobView } | { ok: false; code: StudioErrorCode };
    createResults?: Array<{ ok: true; job: StudioJobView } | { ok: false; code: StudioErrorCode }>;
    fetchPicture?: PromptPictureLoader;
  }) {
    const dict = getDictionary('ko');
    const copy = dict.brandStudio;
    const queue = [...(opts.createResults ?? [])];
    const createJob = vi.fn(async (input: Record<string, unknown>) => {
      if (queue.length > 0) return queue.shift()!;
      return (
        opts.createResult ?? {
          ok: true as const,
          job: job(99, { kind: 'video', model: 'seedance-2.5', prompt: String(input.prompt ?? ''), finalPrompt: null }),
        }
      );
    });
    const enhancePrompt = vi.fn(async () => opts.enhanceAnswer ?? { ok: true, source: 'model', shielded: true, token: 'tok-vid-1', pages: 2 });
    const studioMock = {
      films: {},
      createJob,
      createGroup: vi.fn(),
      enhancePrompt,
    } as unknown as Parameters<typeof useDock>[0]['studio'];

    const fetchPicture =
      opts.fetchPicture ??
      vi.fn<PromptPictureLoader>(async (req) => ({
        ok: true,
        blob: new Blob([`${req.kind}:${req.page}`], { type: 'image/png' }),
      }));

    const dockRef: { current: ReturnType<typeof useDock> | null } = { current: null };

    function Harness({ tick = 0 }: { tick?: number }) {
      const dock = useDock({
        studio: studioMock,
        copy,
        organizationId: ORG,
        initialMedium: 'video',
        mode: 'video',
      });
      dockRef.current = dock;
      return (
        <Dock
          organizationId={ORG}
          mode="video"
          draft={dock.draft}
          tray={dock.tray}
          labels={trayLabels(dock.tray, copy)}
          copy={copy}
          locale="ko"
          allowance={allowance()}
          credits={15}
          busy={dock.busy}
          message={dock.message}
          errorCode={dock.errorCode}
          notice={dock.notice}
          toast={tick ? `t${tick}` : null}
          film={null}
          uploading={[]}
          enhancing={dock.enhancing}
          enhanced={dock.enhanced}
          onDraft={dock.setDraft}
          onTrayUpdate={dock.update}
          onTrayRemove={dock.remove}
          onSubmit={() => {
            void dock.submit();
          }}
          onDropSource={() => {}}
          onFiles={() => {}}
          onBrowse={() => {}}
          onEnhance={() => void dock.enhanceNow()}
          onUndoEnhance={dock.undoEnhance}
          fetchPromptPicture={fetchPicture}
        />
      );
    }

    return { Harness, dockRef, createJob, enhancePrompt, fetchPicture, copy };
  }

  it('handles shielded 지금 설계하기, keeps typed words, hides enhanceFailed, sends reviewedToken without reviewedPrompt, and drops on edit', async () => {
    const { Harness, dockRef, createJob, fetchPicture, copy } = createDockHarness({});
    dom = await mountDom(<Harness />);

    await dom.setValue('textarea', '병이 천천히 돈다');
    await dom.click('[data-studio-enhance-now]');
    await flush();

    // Textarea keeps typed words; enhanceFailed must NOT appear; panel fetches POST page 1 once.
    expect((dom.query('textarea') as unknown as { value: string }).value).toBe('병이 천천히 돈다');
    expect(dom.query('[data-studio-dock-notice]')).toBeNull();
    expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('token');
    expect(dom.query('[data-studio-designed-hint]')?.textContent).toBe(copy.dock.designedHint);
    expect(dom.query('[data-studio-undo-enhance]')).toBeTruthy();
    expect(fetchPicture).toHaveBeenCalledTimes(1);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'design', organizationId: ORG, token: 'tok-vid-1', page: 1 }, expect.any(AbortSignal));

    // Three re-renders with equal props fetch nothing more.
    await dom.rerender(<Harness tick={1} />);
    await dom.rerender(<Harness tick={2} />);
    await dom.rerender(<Harness tick={3} />);
    expect(fetchPicture).toHaveBeenCalledTimes(1);

    // Next page works via POST.
    await dom.click('[data-prompt-picture-next]');
    await flush();
    expect(fetchPicture).toHaveBeenCalledTimes(2);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'design', organizationId: ORG, token: 'tok-vid-1', page: 2 }, expect.any(AbortSignal));
    expect(dom.query('[data-prompt-picture-page]')?.textContent).toBe('2 / 2');

    // "만들기" sends prompt + reviewedToken + enhance:true, NO reviewedPrompt.
    await dom.submit('form');
    expect(createJob).toHaveBeenCalledTimes(1);
    const sent = createJob.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      kind: 'video',
      prompt: '병이 천천히 돈다',
      reviewedToken: 'tok-vid-1',
      enhance: true,
    });
    expect(sent).not.toHaveProperty('reviewedPrompt');
    expect(sent).not.toHaveProperty('reviewedFrom');

    // Editing typed words drops the token, removes the panel, shows designedStale, and omits token on next submit.
    await dom.setValue('textarea', '병이 빠르게 돈다');
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(dom.query('[data-studio-dock-notice]')?.textContent).toBe(copy.dock.designedStale);

    await dom.submit('form');
    expect(createJob).toHaveBeenCalledTimes(2);
    const afterEdit = createJob.mock.calls[1]![0] as Record<string, unknown>;
    expect(afterEdit).toMatchObject({ kind: 'video', prompt: '병이 빠르게 돈다', enhance: true });
    expect(afterEdit).not.toHaveProperty('reviewedToken');
    expect(afterEdit).not.toHaveProperty('reviewedPrompt');
    expect(dockRef.current?.enhanced).toBe(false);
  });

  it('drops token on 원래 문장으로, conflict response, model change, and kind change', async () => {
    const { Harness, dockRef, createJob, copy } = createDockHarness({
      createResult: { ok: false, code: 'conflict' },
    });
    dom = await mountDom(<Harness />);

    await dom.setValue('textarea', '병이 돈다');
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();

    // "원래 문장으로" drops the token without changing typed words.
    await dom.click('[data-studio-undo-enhance]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect((dom.query('textarea') as unknown as { value: string }).value).toBe('병이 돈다');

    // Re-design, then hit `conflict` on submit -> shows server error message and drops token.
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();
    await dom.submit('form');
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(dom.query('[data-studio-dock-message]')?.textContent).toBe(copy.errors.conflict);
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();

    // Re-design, then change model (genuine 2nd live video model) -> drops token silently.
    const liveSeedance = selectableModels('video')[0] as StudioVideoModel;
    extraVideoModels.push({ ...liveSeedance, id: 'kling-3.0', label: 'Kling 3.0' });
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();
    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, model: 'kling-3.0' }));
    });
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(dom.query('[data-studio-dock-notice]')).toBeNull();
    extraVideoModels.length = 0;

    // Restore live model, re-design, then switch medium (kind_changed) -> drops token silently.
    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, model: 'seedance-2.5' }));
    });
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();
    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, medium: 'image', model: 'seedream-5.5' }));
    });
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(dom.query('[data-studio-dock-notice]')).toBeNull();
  });

  it('drops token when attaching a reference video changes the run kind to video_remix', async () => {
    const dict = getDictionary('ko');
    const copy = dict.brandStudio;
    const enhancePrompt = vi.fn(async () => ({ ok: true, source: 'model', shielded: true, token: 'tok-vid-2', pages: 1 }));
    const studioMock = {
      films: {},
      createJob: vi.fn(),
      createGroup: vi.fn(),
      enhancePrompt,
    } as unknown as Parameters<typeof useDock>[0]['studio'];
    const dockRef: { current: ReturnType<typeof useDock> | null } = { current: null };
    function HookOnlyHarness() {
      const dock = useDock({ studio: studioMock, copy, organizationId: ORG, initialMedium: 'video', mode: 'video' });
      dockRef.current = dock;
      return <div data-hook-only="" />;
    }
    dom = await mountDom(<HookOnlyHarness />);
    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, prompt: '병이 돈다' }));
    });
    await act(async () => {
      await dockRef.current?.enhanceNow();
    });
    expect(dockRef.current?.enhanced).toMatchObject({ kind: 'token', token: 'tok-vid-2' });

    const refFilm = trayItemFromAsset(asset(7, { kind: 'video', seconds: 6, width: 720, height: 1280 }));
    await act(async () => {
      dockRef.current?.attach(refFilm);
    });
    expect(dockRef.current?.enhanced).toBe(false);
    expect(dockRef.current?.notice).toBeNull();
  });

  it('reuses a designed-but-unreviewed shielded video run as typed words + Architect on with no panel', async () => {
    const { Harness, dockRef, createJob, fetchPicture } = createDockHarness({});
    dom = await mountDom(<Harness />);

    const lookup: ReuseLookup = { asset: () => null, output: () => null };
    const designedOnly = job(43, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '설계만 한 영상',
      finalPrompt: null,
      reviewed: false,
      sent: { shielded: true, pages: 1, version: 'ver-d1' },
      architect: true,
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'native',
    });

    const plan = planReuse(designedOnly, { current: dockRef.current!.draft, lookup, outputName: '결과' });
    expect(plan.to).toBe('dock');
    if (plan.to !== 'dock') throw new Error('Expected dock plan');
    expect(plan.shieldedReviewed).toBeUndefined();

    await act(async () => {
      dockRef.current?.reuse(plan);
    });
    await flush();

    expect((dom.query('textarea') as unknown as { value: string }).value).toBe('설계만 한 영상');
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(fetchPicture).toHaveBeenCalledTimes(0);

    await dom.submit('form');
    const sent = createJob.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: 'video', prompt: '설계만 한 영상', enhance: true });
    expect(sent).not.toHaveProperty('reviewedFrom');
    expect(sent).not.toHaveProperty('reviewedToken');
    expect(sent).not.toHaveProperty('reviewedPrompt');
  });

  it('restores reviewed shielded video run via reuse, fetches GET by jobId, sends reviewedFrom, and drops on typed edit', async () => {
    const { Harness, dockRef, createJob, fetchPicture, copy } = createDockHarness({});
    dom = await mountDom(<Harness />);

    const pic = asset(1, { role: 'product' });
    const lookup: ReuseLookup = { asset: (aid) => (aid === pic.id ? pic : null), output: () => null };
    const sourceRun = job(42, {
      kind: 'video',
      model: 'seedance-2.5',
      prompt: '다시 쓸 영상 문장',
      finalPrompt: null,
      reviewed: true,
      sent: { shielded: true, pages: 2, version: 'ver-reuse' },
      architect: true,
      aspect: '9:16',
      resolution: '720p',
      seconds: 5,
      audio: 'native',
      references: [{ assetId: pic.id, frame: 'start' }],
    });

    const plan = planReuse(sourceRun, { current: dockRef.current!.draft, lookup, outputName: '결과' });
    expect(plan.to).toBe('dock');
    if (plan.to !== 'dock') throw new Error('Expected dock plan');

    await act(async () => {
      dockRef.current?.reuse(plan);
    });
    await flush();

    expect((dom.query('textarea') as unknown as { value: string }).value).toBe('다시 쓸 영상 문장');
    expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('fromJob');
    expect(fetchPicture).toHaveBeenCalledTimes(1);
    expect(fetchPicture).toHaveBeenLastCalledWith({ kind: 'run', organizationId: ORG, jobId: sourceRun.id, page: 1 }, expect.any(AbortSignal));

    await dom.submit('form');
    expect(createJob).toHaveBeenCalledTimes(1);
    const sent = createJob.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      kind: 'video',
      prompt: '다시 쓸 영상 문장',
      reviewedFrom: { jobId: sourceRun.id },
      enhance: true,
    });
    expect(sent).not.toHaveProperty('reviewedPrompt');
    expect(sent).not.toHaveProperty('reviewedToken');

    // Editing typed words drops reviewedFrom and shows designedStale.
    await dom.setValue('textarea', '바꾼 문장');
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(dom.query('[data-studio-dock-notice]')?.textContent).toBe(copy.dock.designedStale);

    await dom.unmount();
    dom = null;
    expect(revoked).toEqual(['blob:dock/1']);
  });

  it('keeps typed words when prefill leaves them untouched before an updater setDraft runs without re-render (fix round 1 item 1a)', async () => {
    const dict = getDictionary('ko');
    const copy = dict.brandStudio;
    const studioMock = {
      films: {},
      createJob: vi.fn(),
      createGroup: vi.fn(),
      enhancePrompt: vi.fn(),
    } as unknown as Parameters<typeof useDock>[0]['studio'];
    const store = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };

    const dockRef: { current: ReturnType<typeof useDock> | null } = { current: null };

    function EarlyChildEffect({ trigger, onRun }: { trigger: boolean; onRun(): void }) {
      const done = useRef(false);
      useEffect(() => {
        if (!trigger || done.current) return;
        done.current = true;
        onRun();
      }, [trigger, onRun]);
      return null;
    }

    function PrefillRaceHarness({ ready }: { ready: boolean }) {
      const dock = useDock({
        studio: studioMock,
        copy,
        organizationId: ORG,
        initialMedium: 'video',
        mode: 'video',
        prefill: { ready, canCreate: true },
      });
      dockRef.current = dock;
      const postDone = useRef(false);
      useEffect(() => {
        if (!ready || postDone.current) return;
        postDone.current = true;
        // Same commit, after prefill effect, before re-render: mirror video/workspace.tsx:1373 updater.
        dock.setDraft((cur) => ({ ...cur, method: 'edit' }));
      }, [ready, dock]);
      return (
        <EarlyChildEffect
          trigger={ready}
          onRun={() => dock.setDraft((cur) => ({ ...cur, prompt: '고객이 적은 문장' }))}
        />
      );
    }

    dom = await mountDom(<PrefillRaceHarness ready={false} />);
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fakeStorage });
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: vi.fn(() => 1) });
    writeStudioPrefill(fakeStorage, { organizationId: ORG, medium: 'video', prompt: '템플릿 문장' });
    await dom.rerender(<PrefillRaceHarness ready />);
    await flush();

    expect(dockRef.current?.draft.prompt).toBe('고객이 적은 문장');
    expect(dockRef.current?.draft.method).toBe('edit');
    expect(fakeStorage.getItem('twings_studio_prefill_v1')).toBeNull();
  });

  it('matches React useState semantics across three unshielded setDraft calls in one tick and after queued updates (fix round 1 item 1b)', async () => {
    const dict = getDictionary('ko');
    const copy = dict.brandStudio;
    const enhancePrompt = vi.fn(async () => ({ ok: true, source: 'model', prompt: '설계된 이미지 문장' }));
    const studioMock = {
      films: {},
      createJob: vi.fn(),
      createGroup: vi.fn(),
      enhancePrompt,
    } as unknown as Parameters<typeof useDock>[0]['studio'];

    const dockRef: { current: ReturnType<typeof useDock> | null } = { current: null };
    const twinRef: { current: { draft: DockDraft; setDraft: React.Dispatch<React.SetStateAction<DockDraft>> } | null } = { current: null };

    function TwinHarness() {
      const dock = useDock({
        studio: studioMock,
        copy,
        organizationId: ORG,
        initialMedium: 'image',
        mode: 'image',
      });
      const [twin, setTwin] = useState<DockDraft>(() => dock.draft);
      dockRef.current = dock;
      twinRef.current = { draft: twin, setDraft: setTwin };
      return <div data-twin="" />;
    }

    dom = await mountDom(<TwinHarness />);

    // Three mixed calls (value, updater, updater) in one tick match plain useState identically.
    const base = dockRef.current!.draft;
    const applyValue: DockDraft = { ...base, prompt: '첫 문장', count: 2 };
    const updaterA = (cur: DockDraft): DockDraft => ({ ...cur, aspect: '16:9', prompt: `${cur.prompt}+A` });
    const updaterB = (cur: DockDraft): DockDraft => ({ ...cur, quality: cur.quality, enhance: false, prompt: `${cur.prompt}+B` });
    await act(async () => {
      dockRef.current!.setDraft(applyValue);
      dockRef.current!.setDraft(updaterA);
      dockRef.current!.setDraft(updaterB);
      twinRef.current!.setDraft(applyValue);
      twinRef.current!.setDraft(updaterA);
      twinRef.current!.setDraft(updaterB);
    });
    expect(dockRef.current!.draft).toEqual(twinRef.current!.draft);

    // Three calls starting with two updaters then value, then updater after unrendered undoEnhance.
    const updaterC = (cur: DockDraft): DockDraft => ({ ...cur, prompt: `${cur.prompt}+C` });
    await act(async () => {
      dockRef.current!.setDraft(updaterC);
      dockRef.current!.setDraft((cur) => ({ ...cur, aspect: '1:1' }));
      dockRef.current!.setDraft((cur) => ({ ...cur, count: 3 }));
      twinRef.current!.setDraft(updaterC);
      twinRef.current!.setDraft((cur) => ({ ...cur, aspect: '1:1' }));
      twinRef.current!.setDraft((cur) => ({ ...cur, count: 3 }));
    });
    expect(dockRef.current!.draft).toEqual(twinRef.current!.draft);

    // Real divergence caught when wrapper resolves eagerly against latestDraft.current:
    // enhance -> undoEnhance() (queues React state back to '직접 입력') + updater setDraft before re-render.
    await act(async () => {
      dockRef.current!.setDraft((cur) => ({ ...cur, prompt: '직접 입력' }));
    });
    await act(async () => {
      await dockRef.current!.enhanceNow();
    });
    expect(dockRef.current!.draft.prompt).toBe('설계된 이미지 문장');

    await act(async () => {
      dockRef.current!.undoEnhance();
      dockRef.current!.setDraft((cur) => ({ ...cur, count: 4 }));
    });
    expect(dockRef.current!.draft.prompt).toBe('직접 입력');
    expect(dockRef.current!.draft.count).toBe(4);
  });

  it('drops reused fromJob design and clears press ids on not_found and invalid (fix round 1 item 2)', async () => {
    for (const code of ['not_found', 'invalid'] as const) {
      const { Harness, dockRef, createJob, copy } = createDockHarness({
        createResults: [
          { ok: false, code },
          { ok: true, job: job(101, { kind: 'video', model: 'seedance-2.5', prompt: '다시 쓸 영상 문장', finalPrompt: null }) },
        ],
      });
      dom = await mountDom(<Harness />);

      const sourceRun = job(55, {
        kind: 'video',
        model: 'seedance-2.5',
        prompt: '다시 쓸 영상 문장',
        finalPrompt: null,
        reviewed: true,
        sent: { shielded: true, pages: 1, version: 'ver-gone' },
        architect: true,
        aspect: '9:16',
        resolution: '720p',
        seconds: 5,
        audio: 'native',
      });
      const plan = planReuse(sourceRun, {
        current: dockRef.current!.draft,
        lookup: { asset: () => null, output: () => null },
        outputName: '결과',
      });
      expect(plan.to).toBe('dock');
      if (plan.to !== 'dock') throw new Error('Expected dock plan');

      await act(async () => {
        dockRef.current?.reuse(plan);
      });
      await flush();
      expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('fromJob');

      await dom.submit('form');
      expect(createJob).toHaveBeenCalledTimes(1);
      const firstCall = createJob.mock.calls[0]![0] as Record<string, unknown>;
      expect(firstCall.reviewedFrom).toEqual({ jobId: sourceRun.id });
      expect(dom.query('[data-studio-dock-message]')?.textContent).toBe(copy.errors[code]);
      expect(Boolean(dom.query('[data-studio-designed-panel]'))).toBe(false);
      expect(dockRef.current?.enhanced).toBe(false);

      // Next press succeeds cleanly without reviewedFrom and with a brand-new requestId.
      await dom.submit('form');
      expect(createJob).toHaveBeenCalledTimes(2);
      const secondCall = createJob.mock.calls[1]![0] as Record<string, unknown>;
      expect(secondCall).not.toHaveProperty('reviewedFrom');
      expect(secondCall.requestId).not.toBe(firstCall.requestId);

      await dom.unmount();
      dom = null;
    }
  });

  it('keeps shielded design across aspect change and setModels when raw draft holds a replaced model id (fix round 1 item 3)', async () => {
    const { Harness, dockRef, createJob } = createDockHarness({});
    dom = await mountDom(<Harness />);

    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, model: 'legacy-replaced-video-model', prompt: '치환 모델 문장' }));
    });
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('token');

    // Aspect update via setDraft must compare normalized model ids and keep the shielded design.
    await act(async () => {
      dockRef.current?.setDraft((cur) => ({ ...cur, aspect: '16:9' }));
    });
    await flush();
    expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('token');
    expect(dom.query('[data-studio-dock-notice]')).toBeNull();

    // setModels with the equivalent replaced id also keeps the design.
    await act(async () => {
      dockRef.current?.setModels(['legacy-replaced-video-model']);
    });
    await flush();
    expect(dom.query('[data-studio-designed-panel]')?.getAttribute('data-designed-source')).toBe('token');

    await dom.submit('form');
    const sent = createJob.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.reviewedToken).toBe('tok-vid-1');
    expect(sent.aspect).toBe('16:9');
  });

  it('shows designedStale only when draft.enhance is on after edit drop, and drops silently when off (fix round 1 item 4)', async () => {
    const { Harness, createJob, copy } = createDockHarness({});
    dom = await mountDom(<Harness />);

    // Case A: enhance switch ON -> editing drops design and shows designedStale.
    await dom.setValue('textarea', '초기 문장');
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();

    await dom.setValue('textarea', '바꾼 문장 A');
    expect(dom.query('[data-studio-designed-panel]')).toBeNull();
    expect(dom.query('[data-studio-dock-notice]')?.textContent).toBe(copy.dock.designedStale);

    // Case B: enhance switch toggled OFF -> editing drops design SILENTLY and sends enhance: false.
    await dom.setValue('textarea', '초기 문장 B');
    await dom.click('[data-studio-enhance-now]');
    await flush();
    expect(dom.query('[data-studio-designed-panel]')).toBeTruthy();

    await dom.click('[data-studio-enhance]');
    await flush();
    await dom.setValue('textarea', '직접 보낼 문장 B');
    expect(Boolean(dom.query('[data-studio-designed-panel]'))).toBe(false);
    expect(Boolean(dom.query('[data-studio-dock-notice]'))).toBe(false);

    await dom.submit('form');
    expect(createJob).toHaveBeenCalledTimes(1);
    const sent = createJob.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent).toMatchObject({ kind: 'video', prompt: '직접 보낼 문장 B', enhance: false });
    expect(sent).not.toHaveProperty('reviewedToken');
  });
});
