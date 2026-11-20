import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * The per-organization switch (founder decision 2026-11-21, "우리 조직부터"): an organization listed in
 * `BRAND_STUDIO_EDITOR_V2_ORGS`, while `BRAND_STUDIO_EDITOR_V2=on`, is sent from `/brand/studio/compose`
 * to the editing studio v2 by the server, after the studio guard and before anything of the current
 * editor loads. `?classic=1` keeps the current editor. The ids live in the environment only.
 */
const ROOT = process.cwd();
const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const ASSET = '30000000-0000-4000-8000-000000000001';
const OUTPUT = '30000000-0000-4000-8000-000000000002';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  studioRouteOrShowroom: vi.fn(),
  redirect: vi.fn(),
  assetsOf: vi.fn(),
  jobsOf: vi.fn(),
  viewsOf: vi.fn(),
  loadAllowance: vi.fn(),
  loadLibrary: vi.fn(),
  loadFolderItems: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/brand/studio/compose',
  useSearchParams: () => new URLSearchParams(),
  redirect: mocks.redirect,
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/components/brand-studio/route-context', () => ({ studioRouteOrShowroom: mocks.studioRouteOrShowroom }));
vi.mock('@/components/brand-studio/compose/video-composer', () => ({
  VideoComposer: function VideoComposerStub() {
    return null;
  },
}));
vi.mock('@/components/brand-studio/studio-showroom', () => ({
  StudioShowroom: function StudioShowroomStub() {
    return null;
  },
}));
vi.mock('@/components/brand-workspace/context', () => ({ brandContext: vi.fn() }));
vi.mock('@/components/brand-workspace/scope', () => ({ brandScope: vi.fn() }));
vi.mock('@/lib/brand-studio/media-store', () => ({ createStudioMediaStore: () => ({ url: (key: string) => `/media/${key}` }) }));
vi.mock('@/lib/brand-studio/library', () => ({ loadLibrary: mocks.loadLibrary, loadFolderItems: mocks.loadFolderItems }));
vi.mock('@/lib/brand-studio/usage', () => ({ loadAllowance: mocks.loadAllowance, allowanceView: (allowance: unknown) => allowance }));
vi.mock('@/lib/brand-studio/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/repo')>('@/lib/brand-studio/repo');
  return { ...actual, assetsOf: mocks.assetsOf, jobsOf: mocks.jobsOf, viewsOf: mocks.viewsOf };
});
vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandStudioEditorV2DefaultFor: (id: string | null | undefined, env?: Record<string, string | undefined>) => {
      mocks.calls.push('list');
      return actual.brandStudioEditorV2DefaultFor(id, env);
    },
  };
});

describe('brandStudioEditorV2DefaultFor', () => {
  it('needs the flag on AND the organization on the list', async () => {
    const { brandStudioEditorV2DefaultFor } = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
    expect(brandStudioEditorV2DefaultFor(ORG, { BRAND_STUDIO_EDITOR_V2: 'off', BRAND_STUDIO_EDITOR_V2_ORGS: ORG })).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, { BRAND_STUDIO_EDITOR_V2_ORGS: ORG })).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, { BRAND_STUDIO_EDITOR_V2: 'ON', BRAND_STUDIO_EDITOR_V2_ORGS: ORG })).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, { BRAND_STUDIO_EDITOR_V2: 'on', BRAND_STUDIO_EDITOR_V2_ORGS: OTHER })).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, { BRAND_STUDIO_EDITOR_V2: 'on', BRAND_STUDIO_EDITOR_V2_ORGS: ORG })).toBe(true);
  });

  it('reads a comma-separated list: spaces, empty entries and a trailing comma are ignored, ids compared exactly', async () => {
    const { brandStudioEditorV2DefaultFor, brandStudioEditorV2Orgs } = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
    const on = (list: string) => ({ BRAND_STUDIO_EDITOR_V2: 'on', BRAND_STUDIO_EDITOR_V2_ORGS: list });
    expect(brandStudioEditorV2Orgs(on(` ${OTHER} ,, ${ORG} ,`))).toEqual([OTHER, ORG]);
    expect(brandStudioEditorV2DefaultFor(ORG, on(` ${OTHER} ,, ${ORG} ,`))).toBe(true);
    expect(brandStudioEditorV2DefaultFor(ORG, on(`\t${ORG}\n`))).toBe(true);
    // Case-exact: an upper-cased id is a different string.
    expect(brandStudioEditorV2DefaultFor(ORG, on(ORG.toUpperCase()))).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG.toUpperCase(), on(ORG))).toBe(false);
    // A prefix or an extension of an id is not a match.
    expect(brandStudioEditorV2DefaultFor(ORG, on(ORG.slice(0, 20)))).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG.slice(0, 20), on(ORG))).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, on(`${ORG}0`))).toBe(false);
    expect(brandStudioEditorV2DefaultFor(ORG, on(`${ORG};${OTHER}`))).toBe(false);
  });

  it('an unset or empty list opens it for nobody', async () => {
    const { brandStudioEditorV2DefaultFor } = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
    for (const list of [undefined, '', ' ', ',', ' , ,']) {
      for (const id of [ORG, OTHER, '', null, undefined]) {
        expect(brandStudioEditorV2DefaultFor(id, { BRAND_STUDIO_EDITOR_V2: 'on', BRAND_STUDIO_EDITOR_V2_ORGS: list })).toBe(false);
      }
    }
  });
});

type ComposerElement = ReactElement<{ copy: { previewV2: { link: string; tag: string; note: string } }; editorV2Href: string | null; organizationId: string }>;

describe('/brand/studio/compose with the switch', () => {
  const dict = getDictionary('ko');
  const studio = (role = 'owner') => ({
    kind: 'studio' as const,
    choice: { id: ORG, name: 'Sample Brand', role },
    dict,
    locale: 'ko',
    access: { staff: false, canRequest: true },
    deps: { sql: { query: vi.fn() } },
    viewer: { userId: 'u' },
  });
  const showroom = () => ({ ...studio(), kind: 'showroom' as const });

  beforeEach(() => {
    mocks.calls.length = 0;
    for (const mock of [mocks.studioRouteOrShowroom, mocks.redirect, mocks.assetsOf, mocks.jobsOf, mocks.viewsOf, mocks.loadAllowance, mocks.loadLibrary, mocks.loadFolderItems]) mock.mockReset();
    mocks.studioRouteOrShowroom.mockImplementation(async () => {
      mocks.calls.push('guard');
      return studio();
    });
    // Like next/navigation's redirect: it never returns.
    mocks.redirect.mockImplementation((url: string) => {
      mocks.calls.push('redirect');
      throw new Error(`NEXT_REDIRECT ${url}`);
    });
    const loaded = (name: string, value: unknown) => async () => {
      mocks.calls.push(name);
      return value;
    };
    mocks.assetsOf.mockImplementation(loaded('assets', [
      { id: ASSET, kind: 'video', role: null, name: 'runway.mp4', tags: [], storage_key: 'a.mp4', thumb_key: 'a.jpg', width: 720, height: 1280, duration_ms: 5705, source: 'upload', created_at: new Date('2026-11-20T10:00:00Z') },
    ]));
    mocks.jobsOf.mockImplementation(loaded('jobs', []));
    mocks.viewsOf.mockImplementation(loaded('views', []));
    mocks.loadAllowance.mockImplementation(loaded('allowance', { monthlyKrw: 0, usedKrw: 0 }));
    mocks.loadLibrary.mockImplementation(loaded('library', { ok: true, folders: [], liked: [] }));
    mocks.loadFolderItems.mockImplementation(loaded('folder', { ok: true, items: [] }));
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', ORG);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadPage() {
    return (await import('@/app/(brand)/brand/studio/compose/page')).default;
  }
  const params = (query: Record<string, string | string[]>) => ({ searchParams: Promise.resolve(query) });
  const target = () => {
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const url = new URL(mocks.redirect.mock.calls[0]![0] as string, 'https://brand.invalid');
    return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
  };

  it('listed + flag on: the server sends the person to the new editor with the organization', async () => {
    const Page = await loadPage();
    await expect(Page(params({ organizationId: ORG }))).rejects.toThrow('NEXT_REDIRECT');
    expect(target()).toEqual({ path: '/brand/studio/editor', query: { organizationId: ORG } });
  });

  it('keeps the clip= link (asset and output) and drops every other parameter', async () => {
    const Page = await loadPage();
    await expect(Page(params({ organizationId: ORG, clip: `a:${ASSET}`, sample: '1', ws: 'sound', foo: 'bar' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(target()).toEqual({ path: '/brand/studio/editor', query: { organizationId: ORG, clip: `a:${ASSET}` } });
    mocks.redirect.mockClear();
    await expect(Page(params({ organizationId: ORG, clip: [`o:${OUTPUT}`, `a:${ASSET}`] }))).rejects.toThrow('NEXT_REDIRECT');
    expect(target()).toEqual({ path: '/brand/studio/editor', query: { organizationId: ORG, clip: `o:${OUTPUT}` } });
  });

  it('the redirect comes before any of the current editor’s loaders', async () => {
    const Page = await loadPage();
    await expect(Page(params({ organizationId: ORG, clip: `a:${ASSET}` }))).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.calls).toEqual(['guard', 'list', 'redirect']);
    for (const loader of [mocks.assetsOf, mocks.jobsOf, mocks.viewsOf, mocks.loadAllowance, mocks.loadLibrary, mocks.loadFolderItems]) expect(loader).not.toHaveBeenCalled();
  });

  it('classic=1 keeps the current editor, with its link back to the new one (no tag, never classic)', async () => {
    const Page = await loadPage();
    const element = (await Page(params({ organizationId: ORG, classic: '1' }))) as ComposerElement;
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect((element.type as { name?: string }).name).toBe('VideoComposerStub');
    expect(element.props.organizationId).toBe(ORG);
    expect(element.props.editorV2Href).toBe(`/brand/studio/editor?organizationId=${ORG}`);
    expect(element.props.copy.previewV2).toEqual({ ...dict.studioCompose.previewV2, link: dict.studioCompose.previewV2.back, tag: '' });
    expect(mocks.assetsOf).toHaveBeenCalled();
    // Only exactly `1` keeps it: anything else is not the way back.
    for (const value of ['0', 'true', '']) {
      mocks.redirect.mockClear();
      await expect(Page(params({ organizationId: ORG, classic: value }))).rejects.toThrow('NEXT_REDIRECT');
    }
  });

  it('an organization not on the list stays in the current editor, its link reads “try the new one”', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2_ORGS', OTHER);
    const Page = await loadPage();
    const element = (await Page(params({ organizationId: ORG, clip: `a:${ASSET}` }))) as ComposerElement;
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(element.props.copy).toBe(dict.studioCompose);
    expect(element.props.editorV2Href).toBe(`/brand/studio/editor?organizationId=${ORG}`);
    expect(element.props.editorV2Href).not.toContain('classic');
  });

  it('flag off: no redirect even when listed, and no link at all', async () => {
    const Page = await loadPage();
    for (const value of ['', 'off', 'ON']) {
      vi.stubEnv('BRAND_STUDIO_EDITOR_V2', value);
      const element = (await Page(params({ organizationId: ORG }))) as ComposerElement;
      expect(element.props.editorV2Href).toBeNull();
      expect(element.props.copy).toBe(dict.studioCompose);
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('the showroom (no studio seat) never redirects and never consults the list', async () => {
    mocks.studioRouteOrShowroom.mockImplementation(async () => {
      mocks.calls.push('guard');
      return showroom();
    });
    const Page = await loadPage();
    const element = (await Page(params({ organizationId: ORG }))) as ReactElement;
    expect((element.type as { name?: string }).name).toBe('StudioShowroomStub');
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.calls).toEqual(['guard']);
  });

  it('when the guard answers 404 (sandboxed organization) the list is never consulted and nothing redirects', async () => {
    mocks.studioRouteOrShowroom.mockImplementation(async () => {
      mocks.calls.push('guard');
      throw new Error('NEXT_NOT_FOUND');
    });
    const Page = await loadPage();
    await expect(Page(params({ organizationId: ORG }))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(Page(params({ organizationId: ORG, classic: '1' }))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.calls).toEqual(['guard', 'guard']);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('the switch in the source', () => {
  const compose = readFileSync(join(ROOT, 'app/(brand)/brand/studio/compose/page.tsx'), 'utf8');
  const editor = readFileSync(join(ROOT, 'app/(brand)/brand/studio/editor/page.tsx'), 'utf8');
  const body = compose.slice(compose.indexOf('export default async function StudioComposePage'));

  it('guard, then the list, then the redirect, then the showroom, then the current editor’s loaders', () => {
    const at = (needle: string) => {
      const index = body.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at('studioRouteOrShowroom(params.organizationId)'),
      at("ctx.kind === 'studio' && brandStudioEditorV2DefaultFor(choice.id)"),
      at('redirect(editorV2Address('),
      at("ctx.kind === 'showroom'"),
      at('assetsOf(deps.sql, choice.id, 200)'),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(compose).toContain("import { redirect } from 'next/navigation';");
  });

  it('the new editor’s way back always carries classic=1; the current editor’s link never does', () => {
    expect(editor).toContain("scopedHref('/brand/studio/compose?classic=1', choice)");
    expect(editor).not.toMatch(/scopedHref\('\/brand\/studio\/compose'/);
    expect(compose).toContain("editorV2Href={brandStudioEditorV2Open() ? scopedHref('/brand/studio/editor', choice) : null}");
    expect(compose.match(/classic/g)?.length ?? 0).toBeGreaterThan(0);
    expect(compose).not.toMatch(/\/brand\/studio\/editor[^'"`]*classic/);
  });

  it('no organization id is written into the switch: the list comes from the environment only', () => {
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const file of [
      'lib/flags.ts',
      'app/(brand)/brand/studio/compose/page.tsx',
      'app/(brand)/brand/studio/editor/page.tsx',
      'messages/studio-compose.ts',
      'scripts/editor-v2-switch-check.py',
      'scripts/editor-v2-real-export-check.py',
    ]) {
      expect(readFileSync(join(ROOT, file), 'utf8').match(UUID)?.[0], file).toBeUndefined();
    }
    const flags = readFileSync(join(ROOT, 'lib/flags.ts'), 'utf8');
    expect(flags).toContain('env.BRAND_STUDIO_EDITOR_V2_ORGS');
  });
});
