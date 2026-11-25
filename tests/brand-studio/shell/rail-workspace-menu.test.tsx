import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * docs/BRAND-STUDIO-V3.md §3.1 — the rail's workspace menu (components/brand-workspace/rail-workspace-menu.tsx).
 *
 * The brand block opens one real menu: 팀 · 플랜 및 청구 · 설정 (only what the role may open), the other
 * brands (two or more), the language and the account group (순서 편집, 로그아웃). Keys move and wrap,
 * Escape gives focus back to the block, Tab and a press outside close it. The forms post exactly where the
 * layout's old controls posted. Invented brands only.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/studio',
  useSearchParams: () => new URLSearchParams(),
}));

import { RailWorkspaceMenu, type RailWorkspace, type RailWorkspaceBrand, type RailWorkspaceLink } from '@/components/brand-workspace/rail-workspace-menu';

type El = NonNullable<ReturnType<MountedDom['query']>>;

const ALPHA = 'a0000000-0000-4000-8000-0000000000a1';
const BRAVO = 'b0000000-0000-4000-8000-0000000000b2';
const STAFF_ONE = 'c0000000-0000-4000-8000-0000000000c3';
const STAFF_TWO = 'c0000000-0000-4000-8000-0000000000c4';

const brand = (id: string, name: string, over: Partial<RailWorkspaceBrand> = {}): RailWorkspaceBrand => ({
  id,
  name,
  logoUrl: null,
  role: '소유자',
  href: `/brand/studio?organizationId=${id}`,
  staff: false,
  ...over,
});
const alpha = brand(ALPHA, 'Alpha fixture');
const bravo = brand(BRAVO, 'Bravo fixture', { role: '편집자' });
const staffOne = brand(STAFF_ONE, 'Staff fixture one', { role: '스튜디오', staff: true });
const staffTwo = brand(STAFF_TWO, 'Staff fixture two', { role: '스튜디오', staff: true });

const COPY = { current: '현재 브랜드', switch: '브랜드 바꾸기', staffGroup: '야기 팀 브랜드', language: '언어', signOut: '로그아웃' };
const EMPTY = '아직 브랜드가 없어요';

const workspaceOf = (over: Partial<RailWorkspace> = {}): RailWorkspace => ({
  currentId: ALPHA,
  emptyLabel: EMPTY,
  brands: [alpha],
  locale: 'ko',
  copy: COPY,
  ...over,
});

const link = (key: string, path: string, label: string, current = false): RailWorkspaceLink => ({
  key,
  path,
  href: `${path}?organizationId=${ALPHA}`,
  label,
  icon: 'M4 4h12v12H4z',
  current,
});
const OWNER_LINKS: RailWorkspaceLink[] = [
  link('team', '/brand/members', '팀'),
  link('billing', '/brand/billing', '플랜 및 청구', true),
  link('settings', '/brand/settings', '설정'),
];

type Props = Parameters<typeof RailWorkspaceMenu>[0];
const props = (over: Partial<Props> = {}): Props => ({
  workspace: workspaceOf(),
  links: OWNER_LINKS,
  expanded: true,
  reorder: { label: '순서 편집', onSelect: vi.fn() },
  ...over,
});

let dom: MountedDom | null = null;
async function mount(p: Props) {
  dom = await mountDom(<RailWorkspaceMenu {...p} />);
  return dom;
}

const trigger = () => dom!.query('[data-rail-workspace-trigger]')!;
const menu = () => dom!.query('[data-rail-workspace-menu]');
const items = () => dom!.queryAll('[role^="menuitem"]');
const active = () => dom!.document.activeElement as unknown as El;
const groups = () => dom!.queryAll('[data-rail-workspace-group]').map((g) => g.getAttribute('data-rail-workspace-group'));

async function open() {
  await dom!.click(trigger());
  expect(menu(), 'menu opened').not.toBeNull();
}

/** A key press on `target` whose event the test keeps, to read whether the menu took it (`defaultPrevented`). */
async function press(target: El, key: string) {
  const event = {
    type: 'keydown',
    key,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    cancelBubble: false,
    target: null as unknown,
    currentTarget: null as unknown,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.cancelBubble = true;
    },
  };
  await act(async () => {
    (target as unknown as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(event);
  });
  return event;
}

/** A pointer press that lands on `target` (the menu listens on the document). */
async function pointerDownOn(target: El) {
  await act(async () => {
    const event = {
      type: 'pointerdown',
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      cancelBubble: false,
      target,
      currentTarget: null,
      preventDefault() {},
      stopPropagation() {},
    };
    (dom!.document as unknown as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(event);
  });
}

beforeEach(() => {
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('innerWidth', 1440);
});

afterEach(async () => {
  await dom?.unmount();
  dom = null;
  vi.unstubAllGlobals();
});

describe('closed', () => {
  it('is a menu button with no menu in the markup, the brand and its role on it', async () => {
    await mount(props());
    const button = trigger();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.hasAttribute('aria-controls')).toBe(false);
    expect(button.querySelector('strong')!.textContent).toBe('Alpha fixture');
    expect(button.querySelector('small')!.textContent).toBe('소유자');
    // A screen reader hears "현재 브랜드: Alpha fixture 소유자"; the prefix is visually hidden.
    const prefix = button.querySelector('.bw-rail-sr')!;
    expect(prefix.textContent).toBe(`${COPY.current}: `);
    expect(button.textContent).toContain(`${COPY.current}: Alpha fixture`);
    // The collapsed rail's tooltip names the brand while the menu is shut.
    expect(button.getAttribute('data-rail-tip')).toBe('Alpha fixture');
    expect(menu()).toBeNull();
    expect(items()).toEqual([]);
    expect(dom!.query('[data-rail-workspace]')!.getAttribute('data-rail-workspace')).toBe(ALPHA);
  });

  it('renders the same closed block on the server, with the no-script fallback that brings the old controls back', () => {
    const html = renderToStaticMarkup(<RailWorkspaceMenu {...props()} />);
    expect(html).toContain('data-rail-workspace-trigger');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls');
    expect(html).not.toContain('data-rail-workspace-menu');
    expect(html).not.toContain('role="menu"');
    const style = /<noscript><style>([^<]*)<\/style><\/noscript>/.exec(html)?.[1] ?? '';
    // Wide screens only: the layout's brand block, language form, sign-out row and foot come back, the fold
    // button (it needs script) goes, and the block itself hides.
    expect(style).toMatch(/^@media \(min-width:641px\)\{/);
    for (const restored of [
      '.bw-sidebar>.bw-identity{display:block!important}',
      '.bw-sidebar-utilities>.bw-language-menu{display:contents!important}',
      '.bw-sidebar-utilities>.bw-signout{display:block!important}',
      '.bw-sidebar>.bw-rail-toggle{display:none!important}',
    ]) {
      expect(style, restored).toContain(restored);
    }
    expect(style).toMatch(/\.bw-sidebar>\.bw-sidebar-utilities\{display:grid!important;[^}]*\}/);
    expect(style).toMatch(/\}\[data-rail-workspace\]\{display:none!important\}$/);
  });

  it('says the empty label, with no avatar and no role, when there is no current brand', async () => {
    await mount(props({ workspace: workspaceOf({ currentId: null, brands: [alpha, bravo] }) }));
    const button = trigger();
    expect(button.querySelector('strong')!.textContent).toBe(EMPTY);
    expect(button.querySelector('small')).toBeNull();
    expect(button.querySelector('[data-brand-avatar]')).toBeNull();
    // No "현재 브랜드:" prefix when no brand is open.
    expect(button.querySelector('.bw-rail-sr')).toBeNull();
    // The chevron is the folded button's face then (rail.css `[data-rail-workspace="none"]`, rail-css.test.ts).
    expect(button.querySelector('.bw-rail-workspace-chevron')).not.toBeNull();
    expect(button.getAttribute('data-rail-tip')).toBe(EMPTY);
    expect(dom!.query('[data-rail-workspace]')!.getAttribute('data-rail-workspace')).toBe('none');
  });

  it('treats a current id that is not in the list as no brand', async () => {
    await mount(props({ workspace: workspaceOf({ currentId: 'f0000000-0000-4000-8000-0000000000ff', brands: [alpha] }) }));
    expect(trigger().querySelector('strong')!.textContent).toBe(EMPTY);
  });
});

describe('open', () => {
  it('opens on click with focus on the first item, labelled by the block and controlled by it', async () => {
    await mount(props());
    await open();
    const button = trigger();
    const m = menu()!;
    expect(m.getAttribute('role')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(m.id);
    expect(m.id).not.toBe('');
    expect(m.getAttribute('aria-labelledby')).toBe(button.id);
    expect(button.id).not.toBe('');
    // No tooltip over an open menu.
    expect(button.hasAttribute('data-rail-tip')).toBe(false);
    expect(active()).toBe(items()[0]);
    expect(items()[0]!.getAttribute('data-rail-workspace-link')).toBe('team');
    // On the expanded rail it drops from the block.
    expect(m.getAttribute('data-rail-workspace-menu')).toBe('below');
  });

  it('opens beside the avatar on the folded rail', async () => {
    await mount(props({ expanded: false }));
    await open();
    expect(menu()!.getAttribute('data-rail-workspace-menu')).toBe('beside');
    expect(active()).toBe(items()[0]);
  });

  it('closes on a second click without moving focus into the page', async () => {
    await mount(props());
    await open();
    await dom!.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('holds the groups in order: workspace, brands, language, account', async () => {
    await mount(props({ workspace: workspaceOf({ brands: [alpha, bravo] }) }));
    await open();
    expect(groups()).toEqual(['workspace', 'brands', 'language', 'account']);
    // A group that has a name says it (brands, language); the two without one are layout only, so a screen
    // reader does not announce an unnamed group.
    for (const group of dom!.queryAll('[data-rail-workspace-group]')) {
      const named = group.getAttribute('aria-label') !== null;
      expect(group.getAttribute('role')).toBe(named ? 'group' : 'none');
    }
    expect(dom!.queryAll('[data-rail-workspace-group]').map((group) => group.getAttribute('aria-label') !== null)).toEqual([false, true, true, false]);
    // Every focusable entry is a menu item; nothing else in the menu takes focus from the arrows.
    const roles = items().map((item) => item.getAttribute('role'));
    expect(roles).toEqual(['menuitem', 'menuitem', 'menuitem', 'menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitemradio', 'menuitem', 'menuitem']);
    for (const item of items()) expect(item.getAttribute('tabindex')).toBe('-1');
  });

  it('lists the workspace links it was given, with their section path, the utility group and the current page', async () => {
    await mount(props());
    await open();
    const links = dom!.queryAll('[data-rail-workspace-link]');
    expect(links.map((a) => a.getAttribute('data-rail-workspace-link'))).toEqual(['team', 'billing', 'settings']);
    for (const a of links) {
      expect(a.tagName).toBe('A');
      expect(a.getAttribute('role')).toBe('menuitem');
      expect(a.getAttribute('data-nav-group')).toBe('utility');
    }
    expect(links.map((a) => a.getAttribute('data-nav-item'))).toEqual(['/brand/members', '/brand/billing', '/brand/settings']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/brand/members?organizationId=${ALPHA}`,
      `/brand/billing?organizationId=${ALPHA}`,
      `/brand/settings?organizationId=${ALPHA}`,
    ]);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(links.map((a) => a.textContent)).toEqual(['팀', '플랜 및 청구', '설정']);
  });

  it('gives a role with no links (a viewer) no workspace group, and still the language and sign-out', async () => {
    await mount(props({ links: [], reorder: null }));
    await open();
    expect(groups()).toEqual(['language', 'account']);
    expect(dom!.query('[data-rail-workspace-link]')).toBeNull();
    expect(dom!.queryAll('[data-language-option]')).toHaveLength(2);
    expect(dom!.query('[data-rail-workspace-signout]')).not.toBeNull();
    // Focus still lands on the first item there is.
    expect(active()).toBe(dom!.query('[data-language-option="ko"]'));
  });

  it('lists only the links it was given (a member who may open 팀 alone)', async () => {
    await mount(props({ links: [OWNER_LINKS[0]!] }));
    await open();
    expect(dom!.queryAll('[data-rail-workspace-link]').map((a) => a.getAttribute('data-rail-workspace-link'))).toEqual(['team']);
  });
});

describe('brands', () => {
  it('has no brands group with one brand', async () => {
    await mount(props());
    await open();
    expect(dom!.query('[data-rail-workspace-group="brands"]')).toBeNull();
    expect(dom!.query('[data-brand-choice]')).toBeNull();
  });

  it('lists two or more as radio items, the open one checked, each landing where its href says', async () => {
    await mount(props({ workspace: workspaceOf({ currentId: BRAVO, brands: [alpha, bravo] }) }));
    await open();
    const group = dom!.query('[data-rail-workspace-group="brands"]')!;
    expect(group.getAttribute('aria-label')).toBe(COPY.switch);
    expect(group.getAttribute('data-brand-choices')).toBe('2');
    const choices = dom!.queryAll('[data-brand-choice]');
    expect(choices.map((c) => c.getAttribute('data-brand-choice'))).toEqual([ALPHA, BRAVO]);
    expect(choices.map((c) => c.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio']);
    expect(choices.map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(choices.map((c) => c.getAttribute('href'))).toEqual([alpha.href, bravo.href]);
    expect(choices[1]!.textContent).toContain('편집자');
    expect(choices[1]!.querySelector('.bw-rail-workspace-check')).not.toBeNull();
    expect(choices[0]!.querySelector('.bw-rail-workspace-check')).toBeNull();
    expect(dom!.query('[data-brand-staff-group]')).toBeNull();
  });

  it('lists the own brands first, then the staff brands in their own labelled group under one heading', async () => {
    // Scope order mixes them; the menu does not.
    await mount(props({ workspace: workspaceOf({ brands: [staffOne, alpha, staffTwo, bravo] }) }));
    await open();
    expect(dom!.queryAll('[data-brand-choice]').map((c) => c.getAttribute('data-brand-choice'))).toEqual([ALPHA, BRAVO, STAFF_ONE, STAFF_TWO]);
    const staffGroups = dom!.queryAll('[data-brand-staff-group]');
    expect(staffGroups).toHaveLength(1);
    const staff = staffGroups[0]!;
    expect(staff.getAttribute('role')).toBe('group');
    expect(staff.getAttribute('aria-label')).toBe(COPY.staffGroup);
    expect(dom!.query('[data-rail-workspace-group="brands"]')!.contains(staff)).toBe(true);
    const heading = staff.querySelector('.bw-rail-workspace-title')!;
    expect(heading.textContent).toBe(COPY.staffGroup);
    expect(heading.getAttribute('aria-hidden')).toBe('true');
    expect(staff.children[0]).toBe(heading);
    expect(staff.querySelectorAll('[data-brand-choice]').map((c) => c.getAttribute('data-brand-choice'))).toEqual([STAFF_ONE, STAFF_TWO]);
    // Staff brands say so on the link; own brands carry no role marker.
    for (const c of staff.querySelectorAll('[data-brand-choice]')) expect(c.getAttribute('data-brand-role')).toBe('studio');
    for (const id of [ALPHA, BRAVO]) expect(dom!.query(`[data-brand-choice="${id}"]`)!.hasAttribute('data-brand-role')).toBe(false);
    // The arrows follow the order on screen.
    const radios = items().filter((item) => item.hasAttribute('data-brand-choice'));
    expect(radios.map((r) => r.getAttribute('data-brand-choice'))).toEqual([ALPHA, BRAVO, STAFF_ONE, STAFF_TWO]);
  });

  it('keeps the staff heading and group when every brand is a staff brand', async () => {
    await mount(props({ workspace: workspaceOf({ currentId: STAFF_ONE, brands: [staffOne, staffTwo] }) }));
    await open();
    const staff = dom!.query('[data-brand-staff-group]')!;
    expect(staff).not.toBeNull();
    expect(staff.querySelectorAll('[data-brand-choice]')).toHaveLength(2);
    expect(staff.querySelector('.bw-rail-workspace-title')!.textContent).toBe(COPY.staffGroup);
    expect(dom!.query(`[data-brand-choice="${STAFF_ONE}"]`)!.getAttribute('aria-checked')).toBe('true');
  });

  it('has no staff group when no brand is a staff brand', async () => {
    await mount(props({ workspace: workspaceOf({ brands: [alpha, bravo] }) }));
    await open();
    expect(dom!.query('[data-brand-staff-group]')).toBeNull();
  });
});

describe('keys', () => {
  it('moves with the arrows and wraps at both ends; Home and End jump', async () => {
    await mount(props({ workspace: workspaceOf({ brands: [alpha, bravo] }) }));
    await open();
    const list = items();
    expect(list.length).toBe(9);
    expect(active()).toBe(list[0]);
    await dom!.keyDown('ArrowDown');
    expect(active()).toBe(list[1]);
    await dom!.keyDown('ArrowUp');
    await dom!.keyDown('ArrowUp');
    expect(active(), 'ArrowUp on the first wraps to the last').toBe(list[list.length - 1]);
    await dom!.keyDown('ArrowDown');
    expect(active(), 'ArrowDown on the last wraps to the first').toBe(list[0]);
    await dom!.keyDown('End');
    expect(active()).toBe(list[list.length - 1]);
    await dom!.keyDown('Home');
    expect(active()).toBe(list[0]);
    expect(menu()).not.toBeNull();
  });

  it('presses a focused link item with Space (and keeps the page from scrolling)', async () => {
    await mount(props({ workspace: workspaceOf({ brands: [alpha, bravo] }) }));
    await open();
    for (const selector of ['[data-rail-workspace-link="billing"]', `[data-brand-choice="${BRAVO}"]`]) {
      const item = dom!.query(selector)!;
      const click = vi.fn();
      Object.assign(item, { click });
      item.focus();
      const event = await press(item, ' ');
      expect(click, selector).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented, selector).toBe(true);
    }
  });

  it('leaves Space on a button item to the button itself', async () => {
    await mount(props());
    await open();
    const option = dom!.query('[data-language-option="en"]')!;
    const click = vi.fn();
    Object.assign(option, { click });
    option.focus();
    const event = await press(option, ' ');
    expect(click).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('moves between the two languages with ArrowRight and ArrowLeft, and nowhere else', async () => {
    await mount(props());
    await open();
    const ko = dom!.query('[data-language-option="ko"]')!;
    const en = dom!.query('[data-language-option="en"]')!;
    ko.focus();
    await dom!.keyDown('ArrowRight');
    expect(active()).toBe(en);
    await dom!.keyDown('ArrowLeft');
    expect(active()).toBe(ko);
    // On a link item the side arrows do nothing.
    const team = dom!.query('[data-rail-workspace-link="team"]')!;
    team.focus();
    await dom!.keyDown('ArrowRight');
    expect(active()).toBe(team);
    await dom!.keyDown('ArrowLeft');
    expect(active()).toBe(team);
    expect(menu()).not.toBeNull();
  });

  it('closes on Escape and gives focus back to the block', async () => {
    await mount(props());
    await open();
    await dom!.keyDown('ArrowDown');
    await dom!.keyDown('Escape');
    expect(menu()).toBeNull();
    expect(active()).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Tab without pulling focus back', async () => {
    await mount(props());
    await open();
    await dom!.keyDown('Tab');
    expect(menu()).toBeNull();
    // The browser moves focus on with the Tab; the menu does not send it back to the block.
    expect(active()).not.toBe(trigger());
  });

  it('opens from the block with ArrowDown on the first item and ArrowUp on the last', async () => {
    await mount(props());
    trigger().focus();
    await dom!.keyDown('ArrowDown');
    expect(menu()).not.toBeNull();
    expect(active()).toBe(items()[0]);
    await dom!.keyDown('Escape');
    expect(menu()).toBeNull();
    await dom!.keyDown('ArrowUp');
    expect(menu()).not.toBeNull();
    const list = items();
    expect(active()).toBe(list[list.length - 1]);
    expect(active().hasAttribute('data-rail-workspace-signout')).toBe(true);
  });
});

describe('a press outside', () => {
  it('closes the menu; a press inside it or on the block does not', async () => {
    await mount(props());
    await open();
    await pointerDownOn(items()[1]!);
    expect(menu(), 'inside the menu').not.toBeNull();
    await pointerDownOn(trigger());
    expect(menu(), 'on the block').not.toBeNull();
    const outside = dom!.document.createElement('main');
    dom!.document.body.appendChild(outside);
    await pointerDownOn(outside);
    expect(menu()).toBeNull();
  });
});

describe('순서 편집', () => {
  it('calls onSelect once and closes the menu', async () => {
    const onSelect = vi.fn();
    await mount(props({ reorder: { label: '순서 편집', onSelect } }));
    await open();
    const item = dom!.query('[data-rail-workspace-reorder]')!;
    expect(item.getAttribute('role')).toBe('menuitem');
    expect(item.getAttribute('type')).toBe('button');
    expect(item.textContent).toBe('순서 편집');
    await dom!.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });

  it('is absent when there is no order to edit', async () => {
    await mount(props({ reorder: null }));
    await open();
    expect(dom!.query('[data-rail-workspace-reorder]')).toBeNull();
    expect(dom!.queryAll('[data-rail-workspace-group="account"] [role^="menuitem"]')).toHaveLength(1);
  });
});

describe('language', () => {
  const OTHER_PATH = '/brand/studio/video';
  const OTHER_QUERY = `?organizationId=${ALPHA}&tab=recent`;

  function shimLocaleForm() {
    const form = dom!.query('form[action="/api/workspace-locale"]')!;
    const requestSubmit = vi.fn();
    Object.assign(form, {
      requestSubmit,
      elements: { namedItem: (name: string) => form.querySelector(`input[name="${name}"]`) },
    });
    return { form, requestSubmit };
  }

  it('is two radio items, the current language checked, and a hidden POST form to /api/workspace-locale', async () => {
    await mount(props());
    await open();
    const options = dom!.queryAll('[data-language-option]');
    expect(options.map((o) => o.getAttribute('data-language-option'))).toEqual(['ko', 'en']);
    expect(options.map((o) => o.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio']);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(options.map((o) => o.getAttribute('lang'))).toEqual(['ko', 'en']);
    const group = dom!.query('[data-rail-workspace-group="language"]')!;
    expect(group.getAttribute('aria-label')).toBe(COPY.language);
    // The title carries a globe and the word; both are hidden from the menu's reading order.
    const title = group.querySelector('.bw-rail-workspace-title')!;
    expect(title.getAttribute('aria-hidden')).toBe('true');
    expect(title.querySelector('svg')).not.toBeNull();
    expect(title.textContent).toBe(COPY.language);
    const form = dom!.query('form[action="/api/workspace-locale"]')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.hasAttribute('hidden')).toBe(true);
    expect(form.querySelector('input[name="locale"]')!.getAttribute('type')).toBe('hidden');
    expect(form.querySelector('input[name="next"]')!.getAttribute('type')).toBe('hidden');
  });

  it('posts the other language with the page it came from (path and query)', async () => {
    vi.stubGlobal('location', { pathname: OTHER_PATH, search: OTHER_QUERY, protocol: 'https:' });
    await mount(props());
    await open();
    const { form, requestSubmit } = shimLocaleForm();
    await dom!.click('[data-language-option="en"]');
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(form.querySelector('input[name="locale"]')!.value).toBe('en');
    expect(form.querySelector('input[name="next"]')!.value).toBe(OTHER_PATH + OTHER_QUERY);
  });

  it('posts Korean from an English page', async () => {
    vi.stubGlobal('location', { pathname: '/brand', search: '', protocol: 'https:' });
    await mount(props({ workspace: workspaceOf({ locale: 'en' }) }));
    await open();
    expect(dom!.queryAll('[data-language-option]').map((o) => o.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    const { form, requestSubmit } = shimLocaleForm();
    await dom!.click('[data-language-option="ko"]');
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(form.querySelector('input[name="locale"]')!.value).toBe('ko');
    expect(form.querySelector('input[name="next"]')!.value).toBe('/brand');
  });

  it('only closes (focus back on the block) when the current language is chosen', async () => {
    vi.stubGlobal('location', { pathname: OTHER_PATH, search: OTHER_QUERY, protocol: 'https:' });
    await mount(props());
    await open();
    const { requestSubmit } = shimLocaleForm();
    await dom!.click('[data-language-option="ko"]');
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
    expect(active()).toBe(trigger());
  });
});

describe('sign-out', () => {
  it('is a submit button inside a POST form to /auth/signout, the last item of the account group', async () => {
    await mount(props());
    await open();
    const button = dom!.query('[data-rail-workspace-signout]')!;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('submit');
    expect(button.getAttribute('role')).toBe('menuitem');
    expect(button.textContent).toBe(COPY.signOut);
    const form = button.parentElement!;
    expect(form.tagName).toBe('FORM');
    expect(form.getAttribute('action')).toBe('/auth/signout');
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('role')).toBe('none');
    const account = dom!.query('[data-rail-workspace-group="account"]')!;
    expect(account.contains(form)).toBe(true);
    const list = items();
    expect(list[list.length - 1]).toBe(button);
  });
});

describe('the rail width', () => {
  it('closes an open menu when the rail folds or unfolds under it', async () => {
    await mount(props());
    await open();
    await dom!.rerender(<RailWorkspaceMenu {...props({ expanded: false })} />);
    expect(menu()).toBeNull();
  });
});
