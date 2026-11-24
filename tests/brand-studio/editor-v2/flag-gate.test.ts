import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Editing studio v2 (`/brand/studio/editor`), V1: the flag, the page gate order, what the page loads for
 * the organization's own film, and where the editor may keep anything.
 *
 * The truth since V1: the studio guard runs first, then the flag; with the flag off the route is 404 and
 * the current editor's markup does not change (compose-entry.test.ts). With it on, the page loads the
 * same clips the current editor offers and the editor reads and writes the film the current editor
 * keeps in this browser. `?sample=1` opens the sample film and loads nothing, for a listed organization only
 * while `BRAND_WORKSPACE_PROTOTYPE_LAYER=on` (off, it opens the organization's own film as without it, and
 * the film's locked workspaces offer no sample film).
 *
 * Where the editor may reach anything, in one place: network access only in the frame-exact export
 * (`export-film.ts`; what it may request is pinned in export-film-network.test.ts), the footage reader
 * and the export record (`export-record.ts`, the current editor's 0-credit `render.reserve`; pinned in
 * export-record.test.tsx), browser storage only in the shortcut store and the film store (always inside
 * try/catch), and nothing anywhere keeps session storage, a database or a cache.
 */
const ROOT = process.cwd();
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const ASSET = '30000000-0000-4000-8000-000000000001';
const OUTPUT = '30000000-0000-4000-8000-000000000002';

const mocks = vi.hoisted(() => ({
  studioRouteContext: vi.fn(),
  flagCalls: 0,
  assetsOf: vi.fn(),
  jobsOf: vi.fn(),
  viewsOf: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/studio/editor',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/components/brand-studio/route-context', () => ({
  studioRouteContext: mocks.studioRouteContext,
}));

vi.mock('@/components/brand-studio/editor-v2/editor-v2', () => ({
  EditorV2: function EditorV2Stub() {
    return null;
  },
}));

vi.mock('@/lib/brand-studio/media-store', () => ({
  createStudioMediaStore: () => ({ url: (key: string) => `/media/${key}` }),
}));

vi.mock('@/lib/brand-studio/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/repo')>('@/lib/brand-studio/repo');
  return { ...actual, assetsOf: mocks.assetsOf, jobsOf: mocks.jobsOf, viewsOf: mocks.viewsOf };
});

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandStudioEditorV2Open: (env?: Record<string, string | undefined>) => {
      mocks.flagCalls += 1;
      return actual.brandStudioEditorV2Open(env);
    },
  };
});

describe('brandStudioEditorV2Open', () => {
  it('is on only for exactly "on"', async () => {
    const { brandStudioEditorV2Open } = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
    for (const value of [undefined, '', 'off', 'ON', 'On', 'true', '1', ' on', 'on ']) {
      expect(brandStudioEditorV2Open({ BRAND_STUDIO_EDITOR_V2: value })).toBe(false);
    }
    expect(brandStudioEditorV2Open({})).toBe(false);
    expect(brandStudioEditorV2Open({ BRAND_STUDIO_EDITOR_V2: 'on' })).toBe(true);
  });
});

interface RealProps {
  organizationId: string;
  organizationName: string;
  canEdit: boolean;
  sources: Array<{ key: string; kind: string; srcUrl: string; thumbUrl: string | null; label: string }>;
  sampleBase: string | null;
}
type Element = ReactElement<{ copy: unknown; currentEditorHref: string; initialWorkspace: string; real: RealProps | null; keep?: { copy: Record<string, unknown>; locale: string } | null }>;

describe('/brand/studio/editor page gate', () => {
  const dict = getDictionary('ko');
  const context = (role: string, staff = false) => ({
    choice: { id: ORG, name: 'Sample Brand', role },
    dict,
    access: { staff },
    deps: { sql: { query: vi.fn() } },
  });

  beforeEach(() => {
    mocks.flagCalls = 0;
    mocks.studioRouteContext.mockReset();
    mocks.studioRouteContext.mockResolvedValue(context('owner'));
    mocks.assetsOf.mockReset();
    mocks.jobsOf.mockReset();
    mocks.viewsOf.mockReset();
    mocks.assetsOf.mockResolvedValue([
      { id: ASSET, kind: 'video', role: null, name: 'runway.mp4', tags: [], storage_key: 'a.mp4', thumb_key: 'a.jpg', width: 720, height: 1280, duration_ms: 5705, source: 'upload', created_at: new Date('2026-11-20T10:00:00Z') },
      { id: '30000000-0000-4000-8000-000000000009', kind: 'image', role: null, name: 'still.png', tags: [], storage_key: 's.png', thumb_key: null, width: 10, height: 10, duration_ms: null, source: 'upload', created_at: new Date('2026-11-21T10:00:00Z') },
    ]);
    mocks.jobsOf.mockResolvedValue([{ id: 'job' }]);
    mocks.viewsOf.mockResolvedValue([
      {
        prompt: 'A slow walk through the morning market',
        outputs: [
          { id: OUTPUT, jobId: 'job', kind: 'video', url: '/media/o.mp4', thumbUrl: '/media/o.jpg', width: 1080, height: 1920, seconds: 4, draft: false, savedAssetId: null, createdAt: '2026-11-21T09:00:00.000Z' },
          { id: '30000000-0000-4000-8000-000000000007', jobId: 'job', kind: 'image', url: '/media/i.png', thumbUrl: null, width: 1, height: 1, seconds: null, draft: false, savedAssetId: null, createdAt: '2026-11-21T09:00:00.000Z' },
        ],
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadPage() {
    return (await import('@/app/(brand)/brand/studio/editor/page')).default;
  }

  it('404s after the guard when the flag is off, and loads nothing', async () => {
    const Page = await loadPage();
    for (const value of ['', 'off', 'ON']) {
      vi.stubEnv('BRAND_STUDIO_EDITOR_V2', value);
      await expect(Page({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.studioRouteContext).toHaveBeenCalledWith(ORG);
    expect(mocks.flagCalls).toBe(3);
    expect(mocks.assetsOf).not.toHaveBeenCalled();
    expect(mocks.jobsOf).not.toHaveBeenCalled();
  });

  it('never consults the flag or loads anything when the guard itself 404s (sandboxed organization)', async () => {
    const Page = await loadPage();
    for (const value of ['on', 'off', '']) {
      vi.stubEnv('BRAND_STUDIO_EDITOR_V2', value);
      mocks.studioRouteContext.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
      await expect(Page({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.flagCalls).toBe(0);
    expect(mocks.assetsOf).not.toHaveBeenCalled();
  });

  it('an organization not on the list gets the sample film whatever the address or the prototype layer says, and nothing of its own is loaded', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    const Page = await loadPage();
    for (const [layer, list] of [undefined, 'on'].flatMap((layer) => [undefined, '', OTHER, `${OTHER},${ORG.slice(0, 20)}`].map((list) => [layer, list] as const))) {
      if (layer === undefined) vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', undefined as unknown as string);
      else vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', layer);
      if (list === undefined) vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', undefined as unknown as string);
      else vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', list);
      for (const query of [
        { organizationId: ORG },
        { organizationId: ORG, clip: `a:${ASSET}` },
        { organizationId: ORG, clip: `o:${OUTPUT}`, sample: '0' },
        { organizationId: ORG, sample: '1' },
        { organizationId: ORG, sample: ['0', '1'], ws: 'color' },
      ]) {
        const element = (await Page({ searchParams: Promise.resolve(query) })) as Element;
        expect((element.type as { name?: string }).name, JSON.stringify(query)).toBe('EditorV2Stub');
        expect(element.props.real, `${list} ${JSON.stringify(query)}`).toBeNull();
        // The sample film has nothing to save or share.
        expect(element.props.keep ?? null).toBeNull();
        expect(element.props.currentEditorHref).toBe(`/brand/studio/compose?classic=1&organizationId=${ORG}`);
      }
    }
    expect(mocks.assetsOf).not.toHaveBeenCalled();
    expect(mocks.jobsOf).not.toHaveBeenCalled();
    expect(mocks.viewsOf).not.toHaveBeenCalled();
  });

  it('a listed organization gets its own film; the list is consulted after the guard and the flag', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ` ${OTHER} , ${ORG} `);
    vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', 'on');
    const Page = await loadPage();
    const element = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, clip: `a:${ASSET}` }) })) as Element;
    expect(element.props.real).not.toBeNull();
    expect(mocks.assetsOf).toHaveBeenCalledTimes(1);
    // With the prototype layer on, `sample=1` still opens the sample film for a listed organization.
    const sample = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: '1' }) })) as Element;
    expect(sample.props.real).toBeNull();
    expect(mocks.assetsOf).toHaveBeenCalledTimes(1);
  });

  it('BRAND_WORKSPACE_PROTOTYPE_LAYER off (the default): a listed organization’s `sample=1` opens its own film, and the film offers no sample film', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    const Page = await loadPage();
    let loads = 0;
    for (const value of [undefined, '', 'off', 'ON', 'true']) {
      if (value === undefined) vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', undefined as unknown as string);
      else vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', value);
      for (const query of [{ organizationId: ORG }, { organizationId: ORG, sample: '1' }, { organizationId: ORG, sample: '1', ws: 'color' }, { organizationId: ORG, sample: ['1', '0'] }]) {
        const element = (await Page({ searchParams: Promise.resolve(query) })) as Element;
        loads += 1;
        const real = element.props.real;
        expect(real, `${value} ${JSON.stringify(query)}`).not.toBeNull();
        expect(real!.organizationId).toBe(ORG);
        expect(real!.sampleBase, `${value} ${JSON.stringify(query)}`).toBeNull();
        expect(element.props.initialWorkspace).toBe('ws' in query ? 'color' : 'cut');
        expect(mocks.assetsOf).toHaveBeenCalledTimes(loads);
      }
    }
  });

  it('BRAND_WORKSPACE_PROTOTYPE_LAYER=on: the own film’s locked workspaces offer the sample film', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', 'on');
    const Page = await loadPage();
    const element = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as Element;
    expect(element.props.real!.sampleBase).toBe(`/brand/studio/editor?sample=1&organizationId=${ORG}`);
  });

  it('opens the organization’s film with the clips the current editor offers: video only, same addresses', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', 'off');
    const Page = await loadPage();
    const element = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as Element;
    expect((element.type as { name?: string }).name).toBe('EditorV2Stub');
    expect(element.props.copy).toBe(dict.studioEditor);
    expect(element.props.currentEditorHref).toBe(`/brand/studio/compose?classic=1&organizationId=${ORG}`);
    expect(element.props.initialWorkspace).toBe('cut');
    expect(mocks.assetsOf).toHaveBeenCalledWith(expect.anything(), ORG, 200);
    expect(mocks.jobsOf).toHaveBeenCalledWith(expect.anything(), ORG, 60);
    const real = element.props.real!;
    expect(real).toMatchObject({ organizationId: ORG, organizationName: 'Sample Brand', canEdit: true });
    // No sample film while the prototype layer is off (stubbed off above; it is the default, see the next tests).
    expect(real.sampleBase).toBeNull();
    expect(real.sources.map((s) => [s.key, s.kind, s.srcUrl, s.thumbUrl, s.label])).toEqual([
      [`o:${OUTPUT}`, 'output', `/api/brand-studio/compose?organizationId=${ORG}&source=output&id=${OUTPUT}`, '/media/o.jpg', 'A slow walk through the morning market'.slice(0, 36)],
      [`a:${ASSET}`, 'asset', `/api/brand-studio/compose?organizationId=${ORG}&source=asset&id=${ASSET}`, '/media/a.jpg', 'runway.mp4'],
    ]);
    // "에셋에 저장" and "검수 · 공유" on the finished export: the current editor's own words and the library's sentence
    // for a file over its limit, from their dictionaries (nothing copied into the new editor's).
    const { actions, status } = dict.studioCompose;
    expect(element.props.keep?.copy).toEqual({
      actions: { saveToAssets: actions.saveToAssets, savingToAssets: actions.savingToAssets, savedToAssets: actions.savedToAssets, shareReview: actions.shareReview },
      status: { saveQuotaExceeded: status.saveQuotaExceeded, saveFailed: status.saveFailed, reviewOpened: status.reviewOpened, reviewNeedsSave: status.reviewNeedsSave },
      fileTooLarge: dict.brandStudio.errors.file_too_large,
    });
  });

  it('lets owners and editors change the film; viewers and the studio team only look', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    const Page = await loadPage();
    const canEdit = async (role: string, staff = false) => {
      mocks.studioRouteContext.mockResolvedValueOnce(context(role, staff));
      return ((await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as Element).props.real!.canEdit;
    };
    expect(await canEdit('owner')).toBe(true);
    expect(await canEdit('editor')).toBe(true);
    expect(await canEdit('viewer')).toBe(false);
    expect(await canEdit('owner', true)).toBe(false);
  });

  it('?sample=1 with the prototype layer on opens the sample film, reads nothing of the organization’s, and keeps the workspace asked for', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
    vi.stubEnv('BRAND_WORKSPACE_PROTOTYPE_LAYER', 'on');
    const Page = await loadPage();
    const element = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: '1', ws: 'sound' }) })) as Element;
    expect(element.props.real).toBeNull();
    expect(element.props.initialWorkspace).toBe('sound');
    expect(element.props.currentEditorHref).toBe(`/brand/studio/compose?classic=1&organizationId=${ORG}`);
    expect(mocks.assetsOf).not.toHaveBeenCalled();
    expect(mocks.jobsOf).not.toHaveBeenCalled();
    expect(mocks.viewsOf).not.toHaveBeenCalled();
    const odd = (await Page({ searchParams: Promise.resolve({ organizationId: ORG, sample: '1', ws: 'titles' }) })) as Element;
    expect(odd.props.initialWorkspace).toBe('cut');
  });
});

describe('the page source', () => {
  const pageSource = readFileSync(join(ROOT, 'app/(brand)/brand/studio/editor/page.tsx'), 'utf8');

  it('runs the studio guard, then its own flag, then the list, then reads the organization’s clips', () => {
    const guard = pageSource.indexOf('studioRouteContext(');
    const flag = pageSource.indexOf('brandStudioEditorV2Open(');
    const list = pageSource.indexOf('brandStudioEditorV2DefaultFor(choice.id)');
    const sample = pageSource.indexOf("=== '1'");
    const load = pageSource.indexOf('assetsOf(');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(flag);
    expect(flag).toBeLessThan(list);
    expect(list).toBeLessThan(sample);
    expect(sample).toBeLessThan(load);
    // The same switch as the current editor's link to the sample film (compose/page.tsx, compose-switch.test.ts).
    const layer = pageSource.indexOf('brandWorkspacePrototypeLayerOpen()');
    expect(layer).toBeGreaterThan(flag);
    expect(layer).toBeLessThan(sample);
  });

  it('loads clips with the current editor’s own loaders and limits', () => {
    const compose = readFileSync(join(ROOT, 'app/(brand)/brand/studio/compose/page.tsx'), 'utf8');
    for (const call of ['assetsOf(deps.sql, choice.id, 200)', 'jobsOf(deps.sql, choice.id, 60)', 'viewsOf(deps.sql, rawJobs, media)']) {
      expect(compose).toContain(call);
      expect(pageSource).toContain(call);
    }
    expect(compose).toContain("const canCreate = !access.staff && (choice.role === 'owner' || choice.role === 'editor');");
    expect(pageSource).toContain("const canEdit = !access.staff && (choice.role === 'owner' || choice.role === 'editor');");
  });
});

describe('where the editor keeps anything', () => {
  const dir = join(ROOT, 'components/brand-studio/editor-v2');
  const files = readdirSync(dir).filter((name) => /\.(tsx?|ts)$/.test(name));
  const STORES = ['shortcut-store.ts', 'film-store.ts'];
  /**
   * The files that may make a request, and the one way each may make it. The export and the footage reader
   * read the film's own media: the export to decode its sound; footage-facts a clip's timing boxes with
   * Range requests (spec E addendum, C1; pinned in footage-facts.test.ts). The export record asks the
   * compose route for the current editor's 0-credit export record, through the current editor's own
   * request helper and nothing else (pinned in export-record.test.tsx). "에셋에 저장" and "검수 · 공유" on the
   * finished export upload it through the library's own upload and open the review share window (which asks the
   * share bridge), through the current editor's own helpers and nothing else (pinned in export-keep.test.tsx).
   */
  const NETWORK_FILES: Record<string, string[]> = {
    'export-film.ts': ['fetch('],
    'footage-facts.ts': ['fetch('],
    'export-record.ts': ['postComposeOperation', 'compose-request'],
    'export-keep.tsx': ['createStudioApi', 'export-asset', 'share-review-dialog'],
  };
  const NETWORK = [
    'fetch(',
    'XMLHttpRequest',
    'sendBeacon',
    'WebSocket',
    'EventSource',
    'postComposeOperation',
    'compose-request',
    '/api/',
    'createStudioApi',
    'export-asset',
    'share-review-dialog',
  ];

  it('only the export, the footage reader, the export record and the export’s save and share make a request, each its own way', () => {
    for (const name of Object.keys(NETWORK_FILES)) expect(files).toContain(name);
    for (const name of files) {
      const allowed = NETWORK_FILES[name] ?? [];
      const source = readFileSync(join(dir, name), 'utf8');
      for (const banned of NETWORK) {
        if (allowed.includes(banned)) continue;
        expect(source.includes(banned), `${name} contains ${banned}`).toBe(false);
      }
    }
    const record = readFileSync(join(dir, 'export-record.ts'), 'utf8');
    expect(record.match(/postComposeOperation\(/g), 'export-record.ts makes one request').toHaveLength(1);
    // The save makes one library client, for its one upload.
    const keep = readFileSync(join(dir, 'export-keep.tsx'), 'utf8');
    expect(keep.match(/createStudioApi\(/g), 'export-keep.tsx makes one upload client').toHaveLength(1);
  });

  it('no component keeps session storage, a database or a cache', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      for (const banned of ['indexedDB', 'sessionStorage', 'caches.open']) {
        expect(source.includes(banned), `${name} contains ${banned}`).toBe(false);
      }
    }
  });

  it('only the shortcut store and the film store touch browser storage', () => {
    for (const store of STORES) expect(files).toContain(store);
    for (const name of files) {
      if (STORES.includes(name)) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      expect(source.includes('localStorage'), `${name} contains localStorage`).toBe(false);
    }
  });

  for (const store of STORES) {
    it(`${store} reaches browser storage only inside try blocks`, () => {
      const source = readFileSync(join(dir, store), 'utf8');
      // Each `try {` block, from its brace to the matching closing brace.
      const blocks: Array<[number, number]> = [];
      for (const match of source.matchAll(/\btry\s*\{/g)) {
        const open = match.index! + match[0].length - 1;
        let depth = 0;
        let close = -1;
        for (let i = open; i < source.length; i += 1) {
          if (source[i] === '{') depth += 1;
          else if (source[i] === '}') {
            depth -= 1;
            if (depth === 0) {
              close = i;
              break;
            }
          }
        }
        expect(close, 'unclosed try block').toBeGreaterThan(open);
        // Every try is followed by a catch that swallows the failure.
        expect(source.slice(close + 1).trimStart().startsWith('catch')).toBe(true);
        blocks.push([open, close]);
      }
      const uses = [...source.matchAll(/localStorage/g)].map((m) => m.index!);
      expect(uses.length).toBeGreaterThan(0);
      expect(blocks.length).toBeGreaterThan(0);
      for (const at of uses) {
        const line = source.slice(0, at).split('\n').length;
        expect(blocks.some(([open, close]) => at > open && at < close), `localStorage on line ${line} is outside a try block`).toBe(true);
      }
    });
  }

  it('the film store uses the current editor’s own key', () => {
    const source = readFileSync(join(dir, 'film-store.ts'), 'utf8');
    expect(source).toContain('composeStorageKey(organizationId)');
    expect(source).not.toMatch(/twings_studio_compose/);
  });
});
