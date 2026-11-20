import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Editing studio v2 prototype (`/brand/studio/editor`): the flag, the page gate order, and the promise
 * that the prototype reads nothing of the organization's and sends or stores nothing.
 */
const ROOT = process.cwd();
const ORG = '00000000-0000-4000-8000-0000000000aa';

const mocks = vi.hoisted(() => ({
  studioRouteContext: vi.fn(),
  flagCalls: 0,
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

describe('/brand/studio/editor page gate', () => {
  const dict = getDictionary('ko');

  beforeEach(() => {
    mocks.flagCalls = 0;
    mocks.studioRouteContext.mockReset();
    mocks.studioRouteContext.mockResolvedValue({ choice: { id: ORG }, dict });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadPage() {
    return (await import('@/app/(brand)/brand/studio/editor/page')).default;
  }

  it('404s after the guard when the flag is off', async () => {
    const Page = await loadPage();
    for (const value of ['', 'off', 'ON']) {
      vi.stubEnv('BRAND_STUDIO_EDITOR_V2', value);
      await expect(Page({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.studioRouteContext).toHaveBeenCalledWith(ORG);
    expect(mocks.flagCalls).toBe(3);
  });

  it('renders the editor with the editing-studio copy and a scoped compose href when the flag is on', async () => {
    vi.stubEnv('BRAND_STUDIO_EDITOR_V2', 'on');
    const Page = await loadPage();
    const element = (await Page({ searchParams: Promise.resolve({ organizationId: ORG }) })) as ReactElement<{
      copy: unknown;
      currentEditorHref: string;
    }>;
    expect((element.type as { name?: string }).name).toBe('EditorV2Stub');
    expect(element.props.copy).toBe(dict.studioEditor);
    expect(element.props.currentEditorHref.startsWith('/brand/studio/compose')).toBe(true);
    expect(element.props.currentEditorHref).toContain(ORG);
  });

  it('never consults the flag when the guard itself 404s (sandboxed organization), whatever the flag says', async () => {
    const Page = await loadPage();
    for (const value of ['on', 'off', '']) {
      vi.stubEnv('BRAND_STUDIO_EDITOR_V2', value);
      mocks.studioRouteContext.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'));
      await expect(Page({ searchParams: Promise.resolve({ organizationId: ORG }) })).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(mocks.flagCalls).toBe(0);
  });
});

describe('the prototype reads, sends and stores nothing', () => {
  const pageSource = readFileSync(join(ROOT, 'app/(brand)/brand/studio/editor/page.tsx'), 'utf8');

  it('runs the studio guard before its own flag', () => {
    const guard = pageSource.indexOf('studioRouteContext(');
    const flag = pageSource.indexOf('brandStudioEditorV2Open(');
    expect(guard).toBeGreaterThan(-1);
    expect(flag).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(flag);
  });

  it('imports nothing that reads organization data', () => {
    const imports = [...pageSource.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const banned of ['@/lib/brand-studio/repo', 'media-store', 'usage', 'library']) {
      expect(imports.filter((path) => path.includes(banned))).toEqual([]);
    }
  });

  it('components make no request and touch no browser storage', () => {
    const dir = join(ROOT, 'components/brand-studio/editor-v2');
    const files = readdirSync(dir).filter((name) => /\.(tsx?|ts)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      for (const banned of ['fetch(', 'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest', 'navigator.sendBeacon']) {
        expect(source.includes(banned), `${name} contains ${banned}`).toBe(false);
      }
    }
  });
});
