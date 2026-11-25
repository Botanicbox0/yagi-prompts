'use client';
/**
 * The rail's workspace menu (docs/BRAND-STUDIO-V3.md §3.1): the brand block at the top of the rail opens
 * one menu that holds what used to be seven loose rows under the list: 팀 · 플랜 및 청구 · 설정 first
 * (the three a person comes for), then the other brands, the language, 순서 편집 and 로그아웃.
 *
 * A real menu: the button says it has one, the first item takes focus on open, arrows move and wrap,
 * Home and End jump, Escape closes and gives focus back to the button, Tab closes and moves on, a press
 * outside closes. Every word in it is a string the rail or the workspace already had.
 *
 * Presentation only, like the rail: each page and API authorizes on its own. The forms post exactly where
 * the old rows posted (`/api/workspace-locale`, `/auth/signout`).
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { BrandAvatar } from './brand-avatar';
import { languageMenuKey } from './language';

const LANGUAGES = [
  { value: 'ko', name: '한국어' },
  { value: 'en', name: 'English' },
] as const;

export interface RailWorkspaceBrand {
  id: string;
  name: string;
  logoUrl: string | null;
  /** The viewer's role there, already in words. */
  role: string;
  /** Where choosing it lands: the same section when that brand's role can open it (`switchHref`). */
  href: string;
  /** One of the TWINGS team's own brands: the first of these gets the group's heading. */
  staff: boolean;
}

export interface RailWorkspace {
  /** The selected brand's id, or null (no brand yet, or one this account cannot open). */
  currentId: string | null;
  /** What the block says when there is no selected brand. */
  emptyLabel: string;
  /** Every brand this account can open, in the scope's order. The menu lists them when there are two or more. */
  brands: readonly RailWorkspaceBrand[];
  locale: 'ko' | 'en';
  copy: { current: string; switch: string; staffGroup: string; language: string; signOut: string };
}

export interface RailWorkspaceLink {
  key: string;
  /** The section's own path (`/brand/members`), the marker other code looks a rail link up by. */
  path: string;
  href: string;
  label: string;
  /** A 20-unit stroke path, the rail's own icons. */
  icon: string;
  current: boolean;
}

const SIGN_OUT_ICON = 'M8.5 3.5h-5v13h5M12 6.5l3.5 3.5-3.5 3.5M7 10h8.5';
const ORDER_ICON = 'M4 6h12M4 10h12M4 14h12';
const CHECK_ICON = 'M4.5 10.5 8.5 14.5 15.5 6';

/**
 * Without JavaScript the block opens nothing, so on a wide screen the layout's own brand list, language form
 * and sign-out row come back as they were (their displays are workspace.css's), the foot goes back to a
 * column for them, and the fold button (which needs script) goes. rail-nav.tsx adds 팀 · 플랜 및 청구 · 설정 as
 * plain links in its own `noscript`.
 */
const NO_SCRIPT_CSS =
  '@media (min-width:641px){' +
  '.bw-sidebar>.bw-identity{display:block!important}' +
  '.bw-sidebar>.bw-sidebar-utilities{display:grid!important;min-height:0!important;padding:6px 0 0!important}' +
  '.bw-sidebar-utilities>.bw-language-menu{display:contents!important}' +
  '.bw-sidebar-utilities>.bw-signout{display:block!important}' +
  '.bw-sidebar>.bw-rail-toggle{display:none!important}' +
  '}[data-rail-workspace]{display:none!important}';
const GLOBE_ICON = 'M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM2.5 10h15M10 2.5c2.2 2 3.3 4.5 3.3 7.5s-1.1 5.5-3.3 7.5c-2.2-2-3.3-4.5-3.3-7.5s1.1-5.5 3.3-7.5z';

type Place = { top: number; left: number; maxHeight: number };

export function RailWorkspaceMenu({
  workspace,
  links,
  expanded,
  reorder,
}: {
  workspace: RailWorkspace;
  /** 팀 · 플랜 및 청구 · 설정, the ones this role may open. */
  links: readonly RailWorkspaceLink[];
  expanded: boolean;
  /** 순서 편집, when the list has an order to edit. */
  reorder: { label: string; onSelect: () => void } | null;
}) {
  const [at, setAt] = useState<Place | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const localeForm = useRef<HTMLFormElement>(null);
  const triggerId = useId();
  const menuId = useId();
  const pendingFocus = useRef<'first' | 'last' | null>(null);
  const open = at !== null;
  const current = workspace.brands.find((brand) => brand.id === workspace.currentId) ?? null;
  const name = current?.name ?? workspace.emptyLabel;
  const ownBrands = workspace.brands.filter((brand) => !brand.staff);
  const staffBrands = workspace.brands.filter((brand) => brand.staff);
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  const show = useCallback(
    (focus: 'first' | 'last' = 'first') => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      // Expanded: the menu drops from the block. Collapsed: it opens beside the avatar, like the rail's other menus.
      const top = expanded ? rect.bottom + 6 : rect.top;
      const left = expanded ? rect.left : rect.right + 12;
      setAt({ top, left, maxHeight: Math.max(200, window.innerHeight - top - 12) });
      pendingFocus.current = focus;
    },
    [expanded],
  );
  const close = useCallback((returnFocus: boolean) => {
    setAt(null);
    if (returnFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const want = pendingFocus.current;
    pendingFocus.current = null;
    const list = items();
    (want === 'last' ? list[list.length - 1] : list[0])?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menu.current?.contains(target) || button.current?.contains(target))) return;
      close(false);
    };
    const resize = () => close(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', resize);
    };
  }, [open, close]);
  // The rail changed width under an open menu: its place is stale.
  useEffect(() => {
    setAt(null);
  }, [expanded]);

  const buttonKeys = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      show('first');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      show('last');
    }
  };
  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const active = document.activeElement as HTMLElement | null;
    // Space presses a link the way it presses a button (a link alone would scroll the page).
    if (event.key === ' ' && active?.tagName === 'A' && list.includes(active)) {
      event.preventDefault();
      active.click();
      return;
    }
    // The two languages sit side by side: left and right move between them as up and down do.
    const key = active?.hasAttribute('data-language-option') ? (event.key === 'ArrowRight' ? 'ArrowDown' : event.key === 'ArrowLeft' ? 'ArrowUp' : event.key) : event.key;
    const move = languageMenuKey(key, active ? list.indexOf(active) : -1, list.length);
    if (move === null) return;
    if (move === 'tab') {
      close(false);
      return;
    }
    event.preventDefault();
    if (move === 'close') {
      event.stopPropagation();
      close(true);
      return;
    }
    list[move]?.focus();
  };
  const chooseLanguage = (value: 'ko' | 'en') => {
    if (value === workspace.locale) {
      close(true);
      return;
    }
    const form = localeForm.current;
    if (!form) return;
    (form.elements.namedItem('locale') as HTMLInputElement).value = value;
    // The same POST the old control sent: the page it returns to keeps its query (?organizationId= keeps the brand).
    (form.elements.namedItem('next') as HTMLInputElement).value = window.location.pathname + window.location.search;
    form.requestSubmit();
  };

  /** A brand: its mark, its name over the viewer's role there, a tick on the one that is open. */
  const brandItem = (brand: RailWorkspaceBrand) => (
    <a
      key={brand.id}
      role="menuitemradio"
      aria-checked={brand.id === workspace.currentId}
      tabIndex={-1}
      href={brand.href}
      data-brand-choice={brand.id}
      data-brand-role={brand.staff ? 'studio' : undefined}
    >
      <BrandAvatar name={brand.name} logoUrl={brand.logoUrl} size="sm" />
      <span className="bw-rail-workspace-brand">
        <strong>{brand.name}</strong>
        <small>{brand.role}</small>
      </span>
      {brand.id === workspace.currentId ? (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-workspace-check">
          <path d={CHECK_ICON} />
        </svg>
      ) : null}
    </a>
  );

  return (
    <div className="bw-rail-workspace" data-rail-workspace={workspace.currentId ?? 'none'}>
      {/* Without JavaScript this button opens nothing: the layout's own brand list, language form and sign-out row come back. */}
      <noscript>
        <style dangerouslySetInnerHTML={{ __html: NO_SCRIPT_CSS }} />
      </noscript>
      <button
        ref={button}
        id={triggerId}
        type="button"
        className="bw-rail-workspace-trigger"
        data-rail-workspace-trigger
        data-rail-tip={open ? undefined : name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={buttonKeys}
      >
        {current ? <BrandAvatar name={current.name} logoUrl={current.logoUrl} size="sm" /> : null}
        <span className="bw-rail-workspace-text">
          {current ? <span className="bw-rail-sr">{workspace.copy.current}: </span> : null}
          <strong>{name}</strong>
          {current ? <small>{current.role}</small> : null}
        </span>
        <svg className="bw-rail-workspace-chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {at ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="bw-rail-workspace-menu"
          data-rail-workspace-menu={expanded ? 'below' : 'beside'}
          style={{ top: at.top, left: at.left, maxHeight: at.maxHeight }}
          onKeyDown={menuKeys}
        >
          {links.length > 0 ? (
            <div role="group" className="bw-rail-workspace-group" data-rail-workspace-group="workspace">
              {links.map((link) => (
                <a
                  key={link.key}
                  role="menuitem"
                  tabIndex={-1}
                  href={link.href}
                  data-rail-workspace-link={link.key}
                  data-nav-item={link.path}
                  data-nav-group="utility"
                  aria-current={link.current ? 'page' : undefined}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-icon">
                    <path d={link.icon} />
                  </svg>
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          ) : null}

          {workspace.brands.length > 1 ? (
            <div role="group" aria-label={workspace.copy.switch} className="bw-rail-workspace-group" data-rail-workspace-group="brands" data-brand-choices={workspace.brands.length}>
              <p className="bw-rail-workspace-title" aria-hidden="true">
                {workspace.copy.switch}
              </p>
              {ownBrands.map(brandItem)}
              {staffBrands.length > 0 ? (
                <div role="group" aria-label={workspace.copy.staffGroup} className="bw-rail-workspace-subgroup" data-brand-staff-group>
                  <p className="bw-rail-workspace-title" aria-hidden="true">
                    {workspace.copy.staffGroup}
                  </p>
                  {staffBrands.map(brandItem)}
                </div>
              ) : null}
            </div>
          ) : null}

          <div role="group" aria-label={workspace.copy.language} className="bw-rail-workspace-group bw-rail-workspace-language" data-rail-workspace-group="language">
            <p className="bw-rail-workspace-title" aria-hidden="true">
              <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-icon">
                <path d={GLOBE_ICON} />
              </svg>
              {workspace.copy.language}
            </p>
            <div className="bw-rail-workspace-segments" role="none">
              {LANGUAGES.map((language) => (
                <button
                  key={language.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={language.value === workspace.locale}
                  tabIndex={-1}
                  lang={language.value}
                  data-language-option={language.value}
                  onClick={() => chooseLanguage(language.value)}
                >
                  {language.name}
                </button>
              ))}
            </div>
            <form ref={localeForm} action="/api/workspace-locale" method="post" hidden>
              <input type="hidden" name="locale" defaultValue={workspace.locale} />
              <input type="hidden" name="next" defaultValue="/brand" />
            </form>
          </div>

          <div role="group" className="bw-rail-workspace-group" data-rail-workspace-group="account">
            {reorder ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-rail-workspace-reorder
                onClick={() => {
                  close(false);
                  reorder.onSelect();
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-icon">
                  <path d={ORDER_ICON} />
                </svg>
                <span>{reorder.label}</span>
              </button>
            ) : null}
            <form action="/auth/signout" method="post" role="none">
              <button type="submit" role="menuitem" tabIndex={-1} data-rail-workspace-signout>
                <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-icon">
                  <path d={SIGN_OUT_ICON} />
                </svg>
                <span>{workspace.copy.signOut}</span>
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
