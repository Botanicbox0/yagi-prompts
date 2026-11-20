import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * docs/BRAND-STUDIO-V3.md §12 — the rail's Home entry, the logo's destination and the rail's language
 * menu. A sandboxed or generation-closed brand keeps its sidebar, its logo destination and its plain
 * language form exactly as before. Do not weaken this file to make something pass.
 */
const nav = vi.hoisted(() => ({ path: '/brand/home', query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.query),
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { WorkspaceHomeLink } from '@/components/brand-workspace/context-links';
import { LanguageMenu, WorkspaceLanguage, languageMenuKey } from '@/components/brand-workspace/language';

const ko = getDictionary('ko');
const b = ko.brandWorkspace;
const ORG = 'a0000000-0000-4000-8000-00000000000a';
const choice = (over: Partial<BrandWorkspaceChoice> = {}): BrandWorkspaceChoice => ({ id: ORG, name: 'Bright Bottle', role: 'owner', logoUrl: null, ...over });
const scopeOf = (c: BrandWorkspaceChoice): BrandWorkspaceScope => ({ choices: [c], projectOrganizations: {} });
const rail = (c: BrandWorkspaceChoice, homeLabel: string | null = ko.brandHome.nav.home) =>
  renderToStaticMarkup(
    <WorkspaceNavigation
      home={b.home}
      members={b.members}
      settings={b.managed.settings}
      library={b.managed.library}
      studio={b.productionStudio.title}
      scope={scopeOf(c)}
      studioV2
      shell={ko.studioShell}
      locale="ko"
      rooms
      roomsCopy={ko.roomsShell.nav}
      homeLabel={homeLabel ?? undefined}
    />,
  );

afterEach(() => {
  nav.path = '/brand/home';
  nav.query = '';
});

const closed: Array<[string, BrandWorkspaceChoice]> = [
  ...[...SANDBOXED_CLIENT_ORG_IDS].map((id) => [`sandboxed id ${id}`, choice({ id })] as [string, BrandWorkspaceChoice]),
  ['named "Morphic Korea"', choice({ name: 'Morphic Korea' })],
  ['named "모픽"', choice({ name: '모픽' })],
  ['generative media denied', choice({ denied: ['generative_media'] })],
];

describe('the rail Home entry', () => {
  it('sits first under the mode switch, above the items, and is current on /brand/home', () => {
    const html = rail(choice());
    const home = html.indexOf('data-rail-item="home"');
    expect(home).toBeGreaterThan(-1);
    const modeSwitch = html.indexOf('data-rail-mode-switch="rail"');
    expect(modeSwitch).toBeGreaterThan(-1);
    expect(home).toBeGreaterThan(modeSwitch);
    expect(home).toBeLessThan(html.indexOf('data-rail-item="image"'));
    expect(html).toMatch(/href="\/brand\/home\?organizationId=a0000000-0000-4000-8000-00000000000a"[^>]*data-rail-item="home"[^>]*aria-current="page"/);
    // The phone sheet (rendered only once opened) carries it too; the logo is the other way home on a phone.
  });
  it('is not current elsewhere and is absent without its label or for a brand without the home', () => {
    nav.path = '/brand/studio';
    expect(rail(choice())).not.toMatch(/data-rail-item="home"[^>]*aria-current/);
    expect(rail(choice(), null)).not.toContain('data-rail-item="home"');
    expect(rail(choice({ denied: ['self_studio'] }))).not.toContain('data-rail-item="home"');
  });
  it.each(closed)('never appears for %s, whose sidebar is unchanged', (_label, c) => {
    const html = rail(c);
    expect(html).toContain('data-brand-layout-mode="sidebar"');
    expect(html).not.toContain('data-rail-item="home"');
    expect(html).not.toContain('/brand/home');
    expect(html).toBe(rail(c, null));
  });
});

describe('the logo', () => {
  const logo = (c: BrandWorkspaceChoice, home: boolean) =>
    renderToStaticMarkup(
      <WorkspaceHomeLink scope={scopeOf(c)} home={home}>
        <span>TWINGS</span>
      </WorkspaceHomeLink>,
    );
  it('goes home for a brand with the home', () => {
    expect(logo(choice(), true)).toContain(`href="/brand/home?organizationId=${ORG}"`);
  });
  it('keeps its old destination with the flag off, for a project-only brand and for a sandboxed one', () => {
    expect(logo(choice(), false)).toContain(`href="/brand/studio?organizationId=${ORG}"`);
    expect(logo(choice({ denied: ['self_studio'] }), true)).toContain(`href="/brand?organizationId=${ORG}"`);
    for (const [, c] of closed) expect(logo(c, true)).toContain(`href="/brand?organizationId=${c.id}"`);
  });
});

describe('the rail language menu', () => {
  it('renders a menu button beside the no-JS form, which still posts the current path and query', () => {
    nav.path = '/brand/projects/p';
    nav.query = `organizationId=${ORG}`;
    const html = renderToStaticMarkup(<WorkspaceLanguage locale="ko" label="언어" compact applyLabel="언어 변경" />);
    expect(html).toContain('data-language-menu');
    expect(html).toMatch(/<form[^>]*action="\/api\/workspace-locale"[^>]*method="post"/);
    expect(html).toContain(`name="next" value="/brand/projects/p?organizationId=${ORG}"`);
    expect(html).toContain('name="locale"');
    // Before hydration the plain form keeps its submit button; the menu button is hidden by CSS.
    expect(html).toContain('data-ready="false"');
    expect(html).toContain('bw-language-apply');
    expect(html).toMatch(/<button[^>]*data-language-trigger[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(html).toContain('aria-label="언어: 한국어"');
    expect(html).toContain('lang="ko"');
    // Closed: no menu in the markup.
    expect(html).not.toContain('role="menu"');
  });
  it('lists both languages as radio items, the current one checked, each in its own language', () => {
    for (const locale of ['ko', 'en'] as const) {
      const html = renderToStaticMarkup(<LanguageMenu locale={locale} label="Language" onChoose={() => undefined} />);
      expect(html).toContain('role="menu"');
      expect(html).toContain('aria-label="Language"');
      expect(html.match(/role="menuitemradio"/g)).toHaveLength(2);
      expect(html).toMatch(new RegExp(`role="menuitemradio" aria-checked="true" lang="${locale}"`));
      expect(html).toMatch(new RegExp(`role="menuitemradio" aria-checked="false" lang="${locale === 'ko' ? 'en' : 'ko'}"`));
      expect(html.match(/bw-language-check/g)).toHaveLength(1);
      expect(html).toContain('>한국어<');
      expect(html).toContain('>English<');
    }
  });
  it('moves with the arrow keys (wrapping), jumps with Home and End, closes on Escape and Tab', () => {
    expect(languageMenuKey('ArrowDown', 0, 2)).toBe(1);
    expect(languageMenuKey('ArrowDown', 1, 2)).toBe(0);
    expect(languageMenuKey('ArrowUp', 0, 2)).toBe(1);
    expect(languageMenuKey('ArrowUp', -1, 2)).toBe(1);
    expect(languageMenuKey('Home', 1, 2)).toBe(0);
    expect(languageMenuKey('End', 0, 2)).toBe(1);
    expect(languageMenuKey('Escape', 0, 2)).toBe('close');
    expect(languageMenuKey('Tab', 0, 2)).toBe('tab');
    expect(languageMenuKey('a', 0, 2)).toBeNull();
  });
  it('keeps the non-compact switcher (admin chrome) exactly as it was', () => {
    const html = renderToStaticMarkup(<WorkspaceLanguage locale="ko" label="Language" />);
    expect(html).toContain('class="bw-language bw-no-print"');
    expect(html).not.toContain('data-language-menu');
    expect(html).not.toContain('aria-haspopup');
  });
  it('shows the menu only in the rail; every other layout keeps the plain form', () => {
    const railCss = readFileSync('app/(brand)/rail.css', 'utf8');
    const workspaceCss = readFileSync('app/(brand)/workspace.css', 'utf8');
    expect(workspaceCss).toContain('.bw-language-trigger{display:none}');
    expect(workspaceCss).toContain('.bw-language-menu{display:contents}');
    expect(railCss).toMatch(/\.bw-shell:has\(\[data-brand-layout-mode="rail"\]\) \.bw-language-menu\[data-ready="true"\] > \.bw-language-select \{\s*display: none;/);
    expect(railCss).toMatch(/\.bw-shell:has\(\[data-brand-layout-mode="rail"\]\) \.bw-language-menu\[data-ready="true"\] > \.bw-language-trigger \{\s*display: flex;/);
  });
});
