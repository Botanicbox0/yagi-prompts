import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyComposerProject } from '@/lib/brand-studio/compose/timeline';
import { COMPOSE_FINAL_RENDER_MODEL } from '@/lib/brand-studio/compose/credits';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import type { FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import type { ExportFilmResult } from '@/components/brand-studio/editor-v2/export-film';
import type { ExportRequest } from '@/components/brand-studio/editor-v2/export-job';
import type { RealFilmOptions } from '@/components/brand-studio/editor-v2/use-editor';
import { studioEditorKo } from '@/messages/studio-editor';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';

/**
 * docs/BRAND-EDITING-STUDIO.md §8-3 (founder decision): an export is free and still leaves a record, a 0-credit
 * `render.reserve` row (`brand_studio_jobs` `video_final` / `compose-1080p`, `params.source = 'compose'`). The admin
 * organization page, the organization list's last activity and the per-member runs read it.
 *
 * The current editor asks for that record on every press of its export button
 * (components/brand-studio/compose/video-composer.tsx, `handleExport`). The new editor asks for the same record,
 * through the same request helper, once when an export of the organization's own film starts:
 * - never for the sample film (it has no organization film);
 * - never again when the export starts over by itself after the browser took its encoder back (`restarts`);
 * - again for a new press after a cancel or a failure, as the current editor records every press;
 * - never waiting for it: a record that is refused, fails or hangs leaves the export exactly as it was.
 *   (Here the new editor differs on purpose: the current editor stops its export when the record fails.)
 */
const ORG = '00000000-0000-4000-8000-0000000000aa';
const SRC = `/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=a`;
/** The service's request id rule (lib/brand-studio/compose/service.ts, `RenderReserveInputSchema`). */
const SERVICE_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

/** Two seconds at 24 fps. */
const FILM: FrameSequence = {
  fps: 24,
  aspect: '9:16',
  captions: [],
  clips: [{ id: 'c1', label: 'c1', srcUrl: SRC, thumbUrl: null, sourceFps: 24, sourceFrames: 48, inFrame: 0, phase: 0, frames: 48, speedNum: 1, speedDen: 1, volume: 1, muted: false }],
};

const RESULT: ExportFilmResult = {
  blob: new Blob(['mp4'], { type: 'video/mp4' }),
  filename: 'film.mp4',
  frames: 48,
  fps: 24,
  elapsedMs: 5,
  warnings: [],
  paths: [],
  restarts: 0,
} as unknown as ExportFilmResult;

type Progress = { phase: 'video' | 'audio'; done: number; total: number; restarts?: number };

interface Harness {
  job: typeof import('@/components/brand-studio/editor-v2/export-job');
  sheet: typeof import('@/components/brand-studio/editor-v2/export-sheet');
  editor: typeof import('@/components/brand-studio/editor-v2/use-editor');
  record: typeof import('@/components/brand-studio/editor-v2/export-record');
  ExportStop: typeof import('@/components/brand-studio/editor-v2/export-film').ExportStop;
  fetch: ReturnType<typeof vi.fn>;
  /** How many exports the encoder started. */
  started: () => number;
  report: (progress: Progress) => void;
  finish: () => Promise<void>;
  stop: (error: Error) => Promise<void>;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The browser bits the running export touches (the screen-refresh watcher). */
function stubWindow() {
  vi.stubGlobal('window', { setInterval: () => 1, clearInterval: () => undefined, setTimeout: () => 1, clearTimeout: () => undefined, requestAnimationFrame: () => 1, cancelAnimationFrame: () => undefined });
}

async function harness(fetchImpl: () => Promise<Response>): Promise<Harness> {
  vi.resetModules();
  const state: { calls: number; report: ((progress: Progress) => void) | null; resolve: ((result: ExportFilmResult) => void) | null; reject: ((error: Error) => void) | null } = {
    calls: 0,
    report: null,
    resolve: null,
    reject: null,
  };
  vi.doMock('@/components/brand-studio/editor-v2/export-film', async (original) => ({
    ...(await original<object>()),
    exportFilm: (options: { onProgress: (progress: Progress) => void }) => {
      state.calls += 1;
      state.report = options.onProgress;
      return new Promise<ExportFilmResult>((resolve, reject) => {
        state.resolve = resolve;
        state.reject = reject;
      });
    },
  }));
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  // One at a time: the mocked module is built once, before anything that imports it.
  const film = await import('@/components/brand-studio/editor-v2/export-film');
  const job = await import('@/components/brand-studio/editor-v2/export-job');
  const sheet = await import('@/components/brand-studio/editor-v2/export-sheet');
  const editor = await import('@/components/brand-studio/editor-v2/use-editor');
  const record = await import('@/components/brand-studio/editor-v2/export-record');
  return {
    job,
    sheet,
    editor,
    record,
    ExportStop: film.ExportStop,
    fetch: fetchMock,
    started: () => state.calls,
    report: (progress) => state.report!(progress),
    finish: async () => {
      state.resolve!(RESULT);
      await tick();
    },
    stop: async (error) => {
      state.reject!(error);
      await tick();
    },
  };
}

function request(extra: Partial<ExportRequest> = {}): ExportRequest {
  return { sequence: FILM, reframe: {}, framing: 'current', extras: null, burnCaptions: false, captionText: null, notify: () => undefined, path: null, download: false, ...extra };
}

/** The bodies of the requests to the compose route, parsed. */
function recordBodies(h: Harness): Array<{ operation: string; input: Record<string, unknown> }> {
  return h.fetch.mock.calls
    .filter(([url]) => url === '/api/brand-studio/compose')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { operation: string; input: Record<string, unknown> });
}

const never = () => new Promise<Response>(() => undefined);
const okRecord = () => Promise.resolve(new Response(JSON.stringify({ ok: true, jobId: 'job', creditsUsed: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => {
  vi.doUnmock('@/components/brand-studio/editor-v2/export-film');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the export job asks for the record once per export the person starts', () => {
  it('asks once when an export of the organization’s film starts, through the compose route, and does not wait for it', async () => {
    const h = await harness(never);
    stubWindow();
    h.job.startExport(request({ recordFor: ORG }));
    // The record hangs forever: the pictures are already being made.
    expect(h.started()).toBe(1);
    expect(h.job.exportJobSnapshot().status).toBe('running');
    expect(h.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/brand-studio/compose');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
    const [body] = recordBodies(h);
    expect(body!.operation).toBe('render.reserve');
    expect(Object.keys(body!.input).sort()).toEqual(['durationSec', 'organizationId', 'requestId']);
    expect(body!.input.organizationId).toBe(ORG);
    expect(body!.input.durationSec).toBe(2);
    expect(String(body!.input.requestId)).toMatch(SERVICE_REQUEST_ID);
    await h.finish();
    expect(h.job.exportJobSnapshot().status).toBe('done');
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('the sample film (no organization film) records nothing and still exports', async () => {
    const h = await harness(okRecord);
    stubWindow();
    h.job.startExport(request());
    expect(h.started()).toBe(1);
    await h.finish();
    expect(h.job.exportJobSnapshot().status).toBe('done');
    expect(h.fetch).not.toHaveBeenCalled();
    // An empty organization id is no organization either.
    h.job.startExport(request({ recordFor: '' }));
    await h.finish();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('a restart after the browser took the encoder back is the same export: no second record', async () => {
    const h = await harness(okRecord);
    stubWindow();
    h.job.startExport(request({ recordFor: ORG }));
    h.report({ phase: 'video', done: 30, total: 48 });
    h.report({ phase: 'video', done: 0, total: 48, restarts: 1 });
    h.report({ phase: 'audio', done: 0, total: 1, restarts: 2 });
    const now = h.job.exportJobSnapshot();
    expect(now.status === 'running' && now.restarts).toBe(2);
    await h.finish();
    expect(h.started()).toBe(1);
    expect(recordBodies(h)).toHaveLength(1);
  });

  it('a second press while it runs starts nothing and records nothing', async () => {
    const h = await harness(okRecord);
    stubWindow();
    h.job.startExport(request({ recordFor: ORG }));
    h.job.startExport(request({ recordFor: ORG }));
    expect(h.started()).toBe(1);
    expect(recordBodies(h)).toHaveLength(1);
    await h.finish();
  });

  it('a new press after a cancel or a failure is a new export and a new record, as the current editor records every press', async () => {
    const h = await harness(okRecord);
    stubWindow();
    h.job.startExport(request({ recordFor: ORG }));
    h.job.cancelExport();
    await h.stop(new h.ExportStop('cancelled', 'cancelled'));
    expect(h.job.exportJobSnapshot().status).toBe('failed');
    h.job.startExport(request({ recordFor: ORG }));
    await h.stop(new h.ExportStop('encode', 'encoder closed'));
    h.job.startExport(request({ recordFor: ORG }));
    await h.finish();
    const bodies = recordBodies(h);
    expect(h.started()).toBe(3);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies.map((body) => body.input.requestId)).size).toBe(3);
  });

  const failures: Array<[string, () => Promise<Response>]> = [
    ['the network fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server refuses it', () => Promise.resolve(new Response(JSON.stringify({ ok: false, code: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } }))],
    ['the answer is not JSON', () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))],
    ['the record hangs', never],
  ];
  for (const [label, failure] of failures) {
    it(`a record that fails leaves the export as it was: ${label}`, async () => {
      const h = await harness(failure);
      stubWindow();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const notify = vi.fn();
      h.job.startExport(request({ recordFor: ORG, notify }));
      await tick();
      expect(h.job.exportJobSnapshot().status).toBe('running');
      await h.finish();
      const done = h.job.exportJobSnapshot();
      expect(done.status).toBe('done');
      expect(done.status === 'done' && done.filename).toBe('film.mp4');
      expect(notify).toHaveBeenCalledWith('done');
      warn.mockRestore();
    });
  }
});

describe('the export sheet asks for the record only on the organization’s own film', () => {
  const real = (canEdit: boolean): RealFilmOptions => ({ organizationId: ORG, canEdit, sources: [], sampleBase: `/brand/studio/editor?sample=1&organizationId=${ORG}` });

  function find(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = find(child as ReactNode, match);
        if (found) return found;
      }
      return null;
    }
    if (!isValidElement<Record<string, unknown>>(node)) return null;
    if (match(node)) return node;
    return find(node.props.children as ReactNode, match);
  }

  /** Opens the sheet on the editor's real state and presses its one button. */
  function press(h: Harness, film: RealFilmOptions | null) {
    let api: ReturnType<Harness['editor']['useEditor']> | null = null;
    function Probe() {
      api = h.editor.useEditor(studioEditorKo, { real: film, initialWorkspace: 'cut' });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    // A real film is read from the browser after mount: here it has been, and holds the two-second film.
    const ready = film ? { ...api!, sequence: FILM, filmForExport: () => ({ sequence: FILM, film: emptyComposerProject('9:16') }) as never } : api!;
    let tree: ReactNode = null;
    function Sheet() {
      tree = h.sheet.ExportSheet({ api: ready, autoDownload: false });
      return null;
    }
    renderToStaticMarkup(createElement(Sheet));
    const button = find(tree, (element) => 'data-editor-export-start' in element.props);
    expect(button).not.toBeNull();
    stubWindow();
    (button!.props.onClick as () => void)();
    return api!;
  }

  it('the organization’s film: one record for that organization, with the exported film’s length', async () => {
    const h = await harness(okRecord);
    const api = press(h, real(true));
    expect(api.organizationId).toBe(ORG);
    expect(h.started()).toBe(1);
    const bodies = recordBodies(h);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ operation: 'render.reserve', input: { organizationId: ORG, durationSec: 2 } });
    await h.finish();
  });

  it('the sample film exports and records nothing', async () => {
    const h = await harness(okRecord);
    const api = press(h, null);
    expect(api.organizationId).toBeNull();
    expect(h.started()).toBe(1);
    expect(h.fetch).not.toHaveBeenCalled();
    await h.finish();
  });

  it('someone who may only look cannot start an export, so nothing is recorded', async () => {
    const h = await harness(okRecord);
    press(h, real(false));
    expect(h.started()).toBe(0);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('the record is the current editor’s record', () => {
  const root = process.cwd();

  it('same operation, the same three fields, the same rule for the length; the id names the new editor', async () => {
    const { exportRecordInput, EXPORT_RECORD_PREFIX } = await import('@/components/brand-studio/editor-v2/export-record');
    const input = exportRecordInput(ORG, 48, 24);
    expect(Object.keys(input).sort()).toEqual(['durationSec', 'organizationId', 'requestId']);
    expect(input.organizationId).toBe(ORG);
    expect(input.durationSec).toBe(2);
    expect(input.requestId).toMatch(SERVICE_REQUEST_ID);
    expect(input.requestId.startsWith(`${EXPORT_RECORD_PREFIX}_`)).toBe(true);
    // The current editor's ids start with `cmp_` (export), `ups_` (upscale), `mus_` (music).
    expect(['cmp', 'ups', 'mus']).not.toContain(EXPORT_RECORD_PREFIX);
    expect(exportRecordInput(ORG, 1, 24).durationSec).toBe(0.3);
    expect(exportRecordInput(ORG, 0, 24).durationSec).toBe(0.3);
    expect(exportRecordInput(ORG, 1001, 30_000 / 1001).durationSec).toBeCloseTo(1001 / (30_000 / 1001), 9);
    expect(exportRecordInput(ORG, 48, 24).requestId).not.toBe(exportRecordInput(ORG, 48, 24).requestId);
  });

  it('the current editor sends the same fields through the same helper, which both editors import', () => {
    const composer = readFileSync(join(root, 'components/brand-studio/compose/video-composer.tsx'), 'utf8');
    expect(composer).toMatch(/postComposeOperation\('render\.reserve', \{\s*organizationId,\s*requestId: makeComposeRequestId\(\),\s*durationSec: Math\.max\(0\.3, totalSec\),\s*\}\)/);
    expect(composer).toMatch(/import \{ makeComposeRequestId, postComposeOperation \} from '\.\/compose-request';/);
    // Neither editor keeps a copy of its own.
    const record = readFileSync(join(root, 'components/brand-studio/editor-v2/export-record.ts'), 'utf8');
    expect(record).toContain("from '@/components/brand-studio/compose/compose-request'");
    expect(record).toContain("postComposeOperation('render.reserve', exportRecordInput(");
    expect(record).toContain('Math.max(0.3,');
    for (const source of [composer, record]) {
      expect(source).not.toMatch(/function postComposeOperation|function makeComposeRequestId/);
    }
  });
});

describe('the service keeps the new editor’s record exactly as the current editor’s', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  async function row(jobId: string) {
    return (
      await f.sql.query<{ kind: string; status: string; model: string; prompt: string; estimate_krw: number; usage_krw: number; params: unknown; request_id: string; created_by: string }>(
        'select kind, status, model, prompt, estimate_krw, usage_krw, params, request_id, created_by from brand_studio_jobs where id = $1',
        [jobId],
      )
    ).rows[0]!;
  }

  it('owners and editors leave the same 0-credit row; viewers and outsiders are refused and leave none', async () => {
    const { exportRecordInput } = await import('@/components/brand-studio/editor-v2/export-record');
    const deps = studioDeps(f.sql);
    const current = await runComposeOperation(deps, viewerOf(f.ids.owner), 'render.reserve', { organizationId: f.orgId, requestId: 'cmp_current_editor_01', durationSec: 2 });
    expect(current).toMatchObject({ ok: true, creditsUsed: 0 });
    const reference = await row((current as { jobId: string }).jobId);

    for (const member of [f.ids.owner, f.ids.editor]) {
      const input = exportRecordInput(f.orgId, 48, 24);
      const result = await runComposeOperation(deps, viewerOf(member), 'render.reserve', input);
      expect(result).toMatchObject({ ok: true, creditsUsed: 0 });
      const kept = await row((result as { jobId: string }).jobId);
      expect(kept).toMatchObject({ kind: 'video_final', status: 'succeeded', model: COMPOSE_FINAL_RENDER_MODEL, created_by: member, request_id: input.requestId });
      expect(Number(kept.estimate_krw)).toBe(0);
      expect(Number(kept.usage_krw)).toBe(0);
      const params = typeof kept.params === 'string' ? JSON.parse(kept.params) : kept.params;
      expect(params).toEqual({ resolution: '1080p', seconds: 2, source: 'compose' });
      for (const key of ['kind', 'status', 'model', 'prompt'] as const) expect(kept[key]).toBe(reference[key]);
    }

    const before = (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_jobs where organization_id = $1', [f.orgId])).rows[0]!.n;
    expect(await runComposeOperation(deps, viewerOf(f.ids.viewer), 'render.reserve', exportRecordInput(f.orgId, 48, 24))).toEqual({ ok: false, code: 'forbidden' });
    expect(await runComposeOperation(deps, viewerOf(f.ids.outsider), 'render.reserve', exportRecordInput(f.orgId, 48, 24))).toMatchObject({ ok: false });
    const after = (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_jobs where organization_id = $1', [f.orgId])).rows[0]!.n;
    expect(after).toBe(before);
  });
});
