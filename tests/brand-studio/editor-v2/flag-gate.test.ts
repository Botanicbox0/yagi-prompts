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

  const dir = join(ROOT, 'components/brand-studio/editor-v2');
  const files = readdirSync(dir).filter((name) => /\.(tsx?|ts)$/.test(name));
  const STORE = 'shortcut-store.ts';

  it('components make no request and touch no session storage or database', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(join(dir, name), 'utf8');
      for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'indexedDB', 'sessionStorage']) {
        expect(source.includes(banned), `${name} contains ${banned}`).toBe(false);
      }
    }
  });

  it('only the shortcut store touches localStorage', () => {
    expect(files).toContain(STORE);
    for (const name of files) {
      if (name === STORE) continue;
      const source = readFileSync(join(dir, name), 'utf8');
      expect(source.includes('localStorage'), `${name} contains localStorage`).toBe(false);
    }
  });

  it('the shortcut store reaches localStorage only inside try blocks', () => {
    const source = readFileSync(join(dir, STORE), 'utf8');
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
});
