import { readFileSync } from 'node:fs';
import { Profiler } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * Founder request 2026-11-25: "편집 스튜디오의 경우 왼쪽 메뉴가 알아서 default로 접히는 구성이였으면 좋겠다."
 *
 * On the editing studio (`/brand/studio/editor`, `/brand/studio/compose`) the rail opens folded whatever
 * the stored preference says, from the first render (the server's markup) on. Opening or folding it there is
 * this visit's own state and writes neither the cookie nor localStorage; every other page shows the stored
 * preference, exactly as before. Invented brands only.
 */
const state = vi.hoisted(() => ({ path: '/brand/studio/editor' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(''),
}));

type Allowance = { capKrw: number; usedKrw: number; resetsAt: string };
const activity = vi.hoisted(() => ({ summary: null as null | { allowance: Allowance; open: never[]; settled: never[] } }));
vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: activity.summary, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
  };
});

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { RAIL_COOKIE, RAIL_STORAGE_KEY } from '@/components/brand-workspace/rail-model';
import { RailNavigation, type RailNavigationProps } from '@/components/brand-workspace/rail-nav';
import type { RailWorkspace } from '@/components/brand-workspace/rail-workspace-menu';

const ko = getDictionary('ko');
const shell = ko.studioShell;
const b = ko.brandWorkspace;
const ALPHA = 'a0000000-0000-4000-8000-0000000000a1';
const EDITOR = ['/brand/studio/editor', '/brand/studio/compose', '/brand/studio/editor/', '/brand/studio/compose/'];
const ELSEWHERE = ['/brand/studio', '/brand/studio/video', '/brand/studio/sound', '/brand/studio/workflows', '/brand/library', '/brand', '/brand/home'];

const scoped = (path: string) => `${path}?organizationId=${ALPHA}`;
const workspace: RailWorkspace = {
  currentId: ALPHA,
  emptyLabel: b.identity.none,
  brands: [{ id: ALPHA, name: 'Alpha fixture', logoUrl: null, role: b.roles.owner, href: scoped('/brand/studio'), staff: false }],
  locale: 'ko',
  copy: { current: b.identity.current, switch: b.identity.switch, staffGroup: b.identity.staffGroup, language: ko.nav.localeToggle, signOut: b.signOut },
};
const railProps = (over: Partial<RailNavigationProps> = {}): RailNavigationProps => ({
  organizationId: ALPHA,
  studio: true,
  creators: false,
  identity: false,
  team: true,
  billing: true,
  settings: true,
  canCreate: true,
  copy: shell,
  locale: 'ko',
  initialExpanded: true,
  scope: scoped,
  workspace,
  ...over,
});
const rail = (over: Partial<RailNavigationProps> = {}) => renderToStaticMarkup(<RailNavigation {...railProps(over)} />);

const tagWith = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.lastIndexOf('<', at);
  return html.slice(start, html.indexOf('>', at) + 1);
};
const attr = (tag: string | null, name: string) => {
  const match = tag ? new RegExp(`\\s${name}="([^"]*)"`).exec(tag) : null;
  return match ? match[1]! : null;
};

beforeEach(() => {
  state.path = '/brand/studio/editor';
  activity.summary = null;
});

describe('the first render (the server markup)', () => {
  it('folds the rail on the editing studio for a browser whose stored preference is "expanded"', () => {
    activity.summary = { allowance: { capKrw: 300_000, usedKrw: 100_000, resetsAt: '2026-12-01T00:00:00+09:00' }, open: [], settled: [] };
    for (const path of EDITOR) {
      state.path = path;
      const html = rail({ initialExpanded: true });
      expect(attr(tagWith(html, 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('false');
      // The fold button tells the truth: not pressed, and its name offers to open the rail.
      const toggle = tagWith(html, 'data-rail-toggle');
      expect(attr(toggle, 'aria-pressed'), path).toBe('false');
      expect(attr(toggle, 'aria-label'), path).toBe(shell.rail.expand);
      expect(attr(toggle, 'data-rail-tip'), path).toBe(shell.rail.expand);
      // The folded credits line carries its tooltip, as on any folded rail.
      expect(attr(tagWith(html, 'data-rail-credits'), 'data-rail-tip'), path).not.toBeNull();
      // Nothing else of the rail changes: the same items, the same order.
      expect([...html.matchAll(/data-rail-item="([^"]+)"/g)].map((m) => m[1])).toEqual(['image', 'video', 'compose', 'workflows', 'campaigns', 'assets']);
    }
  });

  it('keeps the stored preference on every other page', () => {
    for (const path of ELSEWHERE) {
      state.path = path;
      expect(attr(tagWith(rail({ initialExpanded: true }), 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('true');
      expect(attr(tagWith(rail({ initialExpanded: true }), 'data-rail-toggle'), 'aria-pressed'), path).toBe('true');
      expect(attr(tagWith(rail({ initialExpanded: false }), 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('false');
    }
  });

  it('stays folded on the editing studio when the stored preference is folded too', () => {
    for (const path of EDITOR) {
      state.path = path;
      expect(attr(tagWith(rail({ initialExpanded: false }), 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('false');
    }
  });

  it('is what the layout renders: the navigation given the cookie\'s "expanded" is folded on the editor only', () => {
    const owner: BrandWorkspaceChoice = { id: ALPHA, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };
    const scope: BrandWorkspaceScope = { choices: [owner], projectOrganizations: {} };
    const labels = {
      home: b.home,
      members: b.members,
      settings: b.managed.settings,
      billing: ko.brandBilling.customer.pageTitle,
      library: b.managed.library,
      studio: b.productionStudio.title,
      identity: undefined,
      creators: undefined,
    };
    const navigation = () =>
      renderToStaticMarkup(
        <WorkspaceNavigation
          {...labels}
          scope={scope}
          studioV2
          shell={shell}
          locale="ko"
          railExpanded
          workspaceMenu={{ identity: b.identity, roles: b.roles, language: ko.nav.localeToggle, signOut: b.signOut }}
        />,
      );
    for (const path of EDITOR) {
      state.path = path;
      expect(attr(tagWith(navigation(), 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('false');
    }
    for (const path of ELSEWHERE) {
      state.path = path;
      expect(attr(tagWith(navigation(), 'data-brand-layout-mode="rail"'), 'data-rail-expanded'), path).toBe('true');
    }
  });
});

/**
 * The column's width is the only thing outside the rail that follows its state, and it reads the rail's own
 * attribute: every rule that sizes the column keys on `[data-brand-layout-mode="rail"]` alone or with
 * `[data-rail-expanded]`, nothing the layout sets. So the server markup above is the width of the first paint.
 * (No CSS engine here; the real screen check measures it.)
 */
describe('app/(brand)/rail.css: the column width', () => {
  it('reads the rail element\'s own state and nothing else', () => {
    const css = readFileSync('app/(brand)/rail.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Rules on the shell element itself (no descendant or child part) that set the column or its width.
    const sizing = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[;\s])(--ys-sidebar-w|grid-template-columns)\s*:/.test(m[2]!))
      .flatMap((m) => m[1]!.split(',').map((part) => part.trim()))
      .filter((selector) => /^\.bw-shell/.test(selector) && !/[\s>+~]/.test(selector));
    expect(sizing).toContain('.bw-shell:has([data-brand-layout-mode="rail"])');
    expect(sizing).toContain('.bw-shell:has([data-brand-layout-mode="rail"][data-rail-expanded="true"])');
    for (const selector of sizing) {
      expect([
        '.bw-shell:has([data-brand-layout-mode="rail"])',
        '.bw-shell:has([data-brand-layout-mode="rail"][data-rail-expanded="true"])',
        '.bw-shell:has([data-brand-layout-mode="rail"][data-rail-expanded="false"])',
      ]).toContain(selector);
    }
  });
});

/* ------------------------------------------------------------------ in the browser */

describe('toggling and moving between pages (DOM)', () => {
  let dom: MountedDom | null = null;
  let writes: string[] = [];
  /** `data-rail-expanded` as each commit left it: a commit that showed the other width is a flash. */
  let commits: string[] = [];

  const nav = () => dom!.query('[data-brand-layout-mode="rail"]')!;
  const shown = () => nav().getAttribute('data-rail-expanded');
  const toggle = () => dom!.query('[data-rail-toggle]')!;
  const stored = () => (globalThis as { localStorage: Storage }).localStorage.getItem(RAIL_STORAGE_KEY);

  const tree = (props: RailNavigationProps) => (
    <Profiler
      id="rail"
      onRender={() => {
        const element = (globalThis as { document?: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document?.querySelector(
          '[data-brand-layout-mode="rail"]',
        );
        commits.push(element?.getAttribute('data-rail-expanded') ?? 'none');
      }}
    >
      <RailNavigation {...props} />
    </Profiler>
  );

  /** Mount on `path` with the cookie and localStorage both saying `expanded`, then record every cookie write. */
  const open = async (path: string, expanded: boolean, over: Partial<RailNavigationProps> = {}) => {
    state.path = path;
    (globalThis as { localStorage: Storage }).localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ expanded }));
    const props = railProps({ initialExpanded: expanded, ...over });
    dom = await mountDom(tree(props));
    // Nothing was written while the page came up (a write would have left an own `cookie` value).
    expect((dom.document as unknown as { cookie?: string }).cookie).toBeUndefined();
    Object.defineProperty(dom.document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => {
        writes.push(value);
      },
    });
    return props;
  };
  /** A client-side move: the layout (and so the rail) stays mounted, only the pathname changes. */
  const go = async (path: string, props: RailNavigationProps) => {
    commits = [];
    state.path = path;
    await dom!.rerender(tree(props));
  };

  beforeEach(() => {
    vi.stubGlobal('innerHeight', 900);
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('location', { protocol: 'http:' });
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      removeItem: (key: string) => void items.delete(key),
      clear: () => items.clear(),
    });
    writes = [];
    commits = [];
  });
  afterEach(async () => {
    await dom?.unmount();
    dom = null;
    vi.unstubAllGlobals();
  });

  it('opens and folds on the editor without writing the cookie or localStorage', async () => {
    await open('/brand/studio/editor', true);
    expect(shown()).toBe('false');
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe(shell.rail.expand);

    await dom!.click(toggle());
    expect(shown()).toBe('true');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe(shell.rail.collapse);

    await dom!.click(toggle());
    expect(shown()).toBe('false');
    expect(writes).toEqual([]);
    expect(stored()).toBe('{"expanded":true}');
  });

  it('opens for 순서 편집 on the editor without writing the preference', async () => {
    await open('/brand/studio/compose', true);
    expect(shown()).toBe('false');
    await dom!.click('[data-rail-workspace-trigger]');
    await dom!.click('[data-rail-workspace-reorder]');
    expect(shown()).toBe('true');
    expect(nav().getAttribute('data-nav-reordering')).toBe('true');
    expect(writes).toEqual([]);
    expect(stored()).toBe('{"expanded":true}');
  });

  it('writes the preference, as today, for a toggle on any other page', async () => {
    await open('/brand/library', true);
    expect(shown()).toBe('true');
    await dom!.click(toggle());
    expect(shown()).toBe('false');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(new RegExp(`^${RAIL_COOKIE}=0; Path=/; Max-Age=31536000; SameSite=Lax$`));
    expect(stored()).toBe('{"expanded":false}');
    await dom!.click(toggle());
    expect(shown()).toBe('true');
    expect(writes[1]).toMatch(new RegExp(`^${RAIL_COOKIE}=1;`));
    expect(stored()).toBe('{"expanded":true}');
  });

  it('folds on the way into the editor from the first commit, and shows the stored state on the way out', async () => {
    const props = await open('/brand/library', true);
    expect(shown()).toBe('true');

    await go('/brand/studio/editor', props);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((value) => value === 'false'), commits.join()).toBe(true);

    await dom!.click(toggle());
    expect(shown()).toBe('true');

    await go('/brand/studio/video', props);
    expect(commits.every((value) => value === 'true'), commits.join()).toBe(true);

    // Opened on the last visit, folded again on the next one.
    await go('/brand/studio/editor', props);
    expect(commits.every((value) => value === 'false'), commits.join()).toBe(true);
    await dom!.click(toggle());
    expect(shown()).toBe('true');

    await go('/brand/library', props);
    expect(commits.every((value) => value === 'true'), commits.join()).toBe(true);
    expect(writes).toEqual([]);
    expect(stored()).toBe('{"expanded":true}');
  });

  it('goes back to a folded preference after opening the rail in the editor', async () => {
    const props = await open('/brand/studio/editor', false);
    expect(shown()).toBe('false');
    await dom!.click(toggle());
    expect(shown()).toBe('true');

    await go('/brand/library', props);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((value) => value === 'false'), commits.join()).toBe(true);

    await go('/brand/studio/compose', props);
    expect(shown()).toBe('false');
    expect(writes).toEqual([]);
    expect(stored()).toBe('{"expanded":false}');
  });
});
