'use client';
/**
 * The workspace rail (docs/BRAND-STUDIO-V3.md §3, slice A): layout mode `rail`.
 *
 * Shown only to a signed-in brand that is not sandboxed and may generate, while studio v2 is on
 * (navigation.tsx decides; the `sidebar` and `topbar` modes are untouched). Collapsed it is a 72px
 * icon column with tooltips; expanded, 232px with names. The state lives in localStorage
 * (`twings_brand_rail_v1`) and a cookie mirror the layout reads, so the first paint has the right width.
 *
 * Everything here is presentation: every page and API authorizes on its own, so a hidden link is never
 * what keeps someone out.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import { CreditsMeter, RailToasts, useRoomUnread, useStudioActivity } from './rail-activity';
import {
  NAV_ORDER_STORAGE_KEY,
  RAIL_COOKIE,
  RAIL_GROUP,
  RAIL_HREF,
  RAIL_ICON,
  RAIL_STORAGE_KEY,
  dropInGroup,
  dropItem,
  groupItems,
  groupedTabIds,
  moveInGroup,
  moveItem,
  orderItems,
  parseOrder,
  parseRailState,
  railActive,
  railCreateLinks,
  railItems,
  type RailCreateKey,
  type RailGroupId,
  type RailItemId,
} from './rail-model';

export interface RailNavigationProps {
  /** The selected brand's id, or null (no brand yet / an unavailable one). */
  organizationId: string | null;
  /** Studio v2 is open for this brand: 이미지 · 영상 · 리뷰, the credits meter and background progress. */
  studio: boolean;
  /** The creator pool is open and this role may use it. */
  creators: boolean;
  identity: boolean;
  team: boolean;
  settings: boolean;
  /** Owners and editors: the "+" create button and its menu. */
  canCreate: boolean;
  copy: StudioShellCopy;
  locale: 'ko' | 'en';
  /** From the cookie mirror, so the server renders the width this browser chose. */
  initialExpanded: boolean;
  scope: (path: string) => string;
  /**
   * Project rooms are open for this brand (docs/BRAND-ROOMS.md §2): the rail splits into 직접 만들기 and
   * 야기 팀과, 메시지 appears with its unread badge, and "+" gains 야기 팀에 의뢰하기. Needs `roomsCopy`;
   * without both the rail is exactly the ungrouped one.
   */
  rooms?: boolean;
  roomsCopy?: RoomsShellCopy['nav'];
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="bw-rail-icon">
      <path d={d} />
    </svg>
  );
}

function writeExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ expanded }));
  } catch {
    // Storage blocked: the cookie below still carries the choice.
  }
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${RAIL_COOKIE}=${expanded ? '1' : '0'}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // ignore
  }
}

type Tip = { text: string; top: number; left: number };

export function RailNavigation(props: RailNavigationProps) {
  const { copy, scope, studio, canCreate, locale } = props;
  const path = usePathname() ?? '/brand';
  const [expanded, setExpanded] = useState(props.initialExpanded);
  const [order, setOrder] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [dragged, setDragged] = useState<RailItemId | null>(null);
  const [dragOver, setDragOver] = useState<RailItemId | null>(null);
  const [createAt, setCreateAt] = useState<{ top: number; left: number } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const createMenu = useRef<HTMLDivElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const sheetId = useId();
  const sheetTitleId = useId();
  const groupTitleId = useId();

  const nav = props.rooms && props.roomsCopy ? props.roomsCopy : null;
  const activity = useStudioActivity({ organizationId: props.organizationId, enabled: studio, path });
  const unread = useRoomUnread({ organizationId: props.organizationId, enabled: nav !== null });

  // What this browser chose last time (the cookie may be missing on a first visit after an update).
  // `initialExpanded` comes from the server once per page, so this runs once.
  const initialExpanded = props.initialExpanded;
  useEffect(() => {
    try {
      const stored = parseRailState(window.localStorage.getItem(RAIL_STORAGE_KEY));
      if (stored && stored.expanded !== initialExpanded) {
        setExpanded(stored.expanded);
        writeExpanded(stored.expanded);
      }
      setOrder(parseOrder(window.localStorage.getItem(NAV_ORDER_STORAGE_KEY)));
    } catch {
      // ignore storage errors
    }
  }, [initialExpanded]);

  const visibleItems = railItems({ studio, creators: props.creators, identity: props.identity, rooms: nav !== null });
  // With rooms, the saved order applies inside each group and never moves an item across groups.
  const groups = nav ? groupItems(visibleItems, order) : null;
  const items = groups ? [...groups.make, ...groups.team] : orderItems(visibleItems, order);
  const label = (id: RailItemId): string => {
    if (id === 'messages') return nav?.messages ?? '';
    if (id === 'campaigns' && nav) return nav.commissions;
    return copy.rail[id];
  };
  const groupTitle = (group: RailGroupId) => (nav ? (group === 'make' ? nav.groupMake : nav.groupTeam) : '');
  const badge = (id: RailItemId) =>
    id === 'image' ? activity.counts.image : id === 'video' ? activity.counts.video : id === 'messages' ? unread : 0;
  /** What the badge says to a screen reader and in the collapsed tooltip. */
  const badgeText = (id: RailItemId, count: number, short = false) =>
    count <= 0 ? '' : id === 'messages' && nav ? interpolate(short ? nav.unreadShort : nav.unread, { count }) : interpolate(copy.rail.running, { count });

  const saveOrder = useCallback((next: RailItemId[]) => {
    const hrefs = next.map((id) => RAIL_HREF[id]);
    setOrder(hrefs);
    try {
      window.localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(hrefs));
      window.dispatchEvent(new CustomEvent('twings:nav-order-changed', { detail: hrefs }));
    } catch {
      // ignore storage errors
    }
  }, []);
  const resetOrder = () => {
    setOrder([]);
    try {
      window.localStorage.removeItem(NAV_ORDER_STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(next);
    setTip(null);
    if (!next) setReordering(false);
  };

  /* ---------------------------------------------------------- tooltips (collapsed only) */
  const showTip = (target: EventTarget | null) => {
    if (expanded) return;
    const element = (target as Element | null)?.closest?.('[data-rail-tip]') as HTMLElement | null;
    const text = element?.getAttribute('data-rail-tip');
    if (!element || !text) {
      setTip(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 12 });
  };
  const tipHandlers = {
    onPointerOver: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') showTip(event.target);
    },
    onPointerLeave: () => setTip(null),
    onFocus: (event: ReactFocusEvent) => showTip(event.target),
    onBlur: () => setTip(null),
  };
  useEffect(() => {
    if (expanded) setTip(null);
  }, [expanded]);

  /* ---------------------------------------------------------- create menu */
  const openCreate = () => {
    const rect = createButton.current?.getBoundingClientRect();
    if (!rect) return;
    setTip(null);
    setCreateAt({ top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 280)), left: rect.right + 12 });
  };
  const closeCreate = useCallback((returnFocus: boolean) => {
    setCreateAt(null);
    if (returnFocus) createButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!createAt) return;
    createMenu.current?.querySelector<HTMLElement>('a')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (createMenu.current?.contains(target) || createButton.current?.contains(target))) return;
      closeCreate(false);
    };
    const resize = () => closeCreate(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', resize);
    };
  }, [createAt, closeCreate]);

  const createText: Record<RailCreateKey, string> = {
    image: copy.create.image,
    video: copy.create.video,
    reverse: copy.create.fromReference,
    campaign: copy.create.campaign,
    commission: nav?.commission ?? '',
  };
  const allCreateLinks = railCreateLinks(nav !== null).map((link) => ({ ...link, text: createText[link.key] }));
  // With rooms the request sits below a divider as 야기 팀에 의뢰하기.
  const createLinks = allCreateLinks.filter((link) => link.key !== 'commission');
  const commissionLink = allCreateLinks.find((link) => link.key === 'commission') ?? null;

  /* ---------------------------------------------------------- phone sheet */
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    moreButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!sheetOpen) return;
    sheet.current?.querySelector<HTMLElement>('button, a')?.focus();
  }, [sheetOpen]);
  const sheetKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab' || !sheet.current) return;
    const focusable = [...sheet.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const navKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    if (tip) setTip(null);
    if (createAt) {
      event.stopPropagation();
      closeCreate(true);
    }
  };

  /* ---------------------------------------------------------- drag (exists in every mode) */
  const onDragStart = (event: DragEvent<HTMLAnchorElement>, id: RailItemId) => {
    setDragged(id);
    setTip(null);
    try {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', RAIL_HREF[id]);
    } catch {
      // ignore
    }
  };
  const onDrop = (event: DragEvent<HTMLAnchorElement>, target: RailItemId) => {
    event.preventDefault();
    setDragOver(null);
    const href = event.dataTransfer?.getData('text/plain');
    const source = dragged ?? (Object.keys(RAIL_HREF) as RailItemId[]).find((id) => RAIL_HREF[id] === href) ?? null;
    setDragged(null);
    if (!source || source === target) return;
    if (groups) {
      // A drop on the other group is no move at all: items stay in their own group.
      const next = dropInGroup(groups, source, target);
      if (next) saveOrder(next);
      return;
    }
    saveOrder(dropItem(items, source, target));
  };
  const move = (id: RailItemId, direction: -1 | 1) => saveOrder(groups ? moveInGroup(groups, id, direction) : moveItem(items, id, direction));
  const canDropOn = (id: RailItemId) => Boolean(dragged && dragged !== id && (!groups || RAIL_GROUP[dragged] === RAIL_GROUP[id]));

  const utilities: Array<{ key: 'team' | 'settings'; href: string; shown: boolean }> = [
    { key: 'team', href: '/brand/members', shown: props.team },
    { key: 'settings', href: '/brand/settings', shown: props.settings },
  ];

  const itemLink = (id: RailItemId, extra: ReactNode = null) => {
    const href = RAIL_HREF[id];
    const count = badge(id);
    const runningText = badgeText(id, count);
    // Grouped, the tooltip names the group too ("야기 팀과 · 메시지") so the split reads without labels.
    const tipBase = nav ? `${groupTitle(RAIL_GROUP[id])} · ${label(id)}` : label(id);
    const tipCount = nav ? badgeText(id, count, true) : runningText;
    return (
      <a
        href={scope(href)}
        className="bw-rail-item"
        data-nav-item={href}
        data-nav-group="primary"
        data-rail-item={id}
        data-rail-tip={tipCount ? `${tipBase} · ${tipCount}` : tipBase}
        aria-current={railActive(href, path) ? 'page' : undefined}
        draggable
        onDragStart={(event) => onDragStart(event, id)}
        onDragOver={(event) => {
          event.preventDefault();
          if (canDropOn(id)) setDragOver(id);
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(event) => onDrop(event, id)}
        onDragEnd={() => {
          setDragged(null);
          setDragOver(null);
        }}
      >
        <Icon d={RAIL_ICON[id]} />
        <span className="bw-rail-label">{label(id)}</span>
        {count > 0 ? (
          <span className="bw-rail-badge" data-rail-badge={id}>
            <span aria-hidden="true">{count}</span>
            <span className="bw-rail-sr">{runningText}</span>
          </span>
        ) : null}
        {extra}
      </a>
    );
  };

  // Phone tab bar: 이미지 스튜디오 · 비디오 스튜디오 · 캠페인 · 에셋 when they exist, filled up from the rest; the others go in 더보기.
  // With rooms: 이미지 스튜디오 · 비디오 스튜디오 · 의뢰 · 메시지 (rail-model `groupedTabIds`).
  const tabIds = nav
    ? groupedTabIds(items)
    : [
        ...(['image', 'video', 'campaigns', 'assets'] as RailItemId[]).filter((id) => items.includes(id)),
        ...items.filter((id) => !['image', 'video', 'campaigns', 'assets'].includes(id)),
      ].slice(0, 4);
  const sheetIds = items.filter((id) => !tabIds.includes(id));

  const row = (id: RailItemId, index: number, list: readonly RailItemId[]) => (
    <li key={id} className="bw-rail-row" data-drag-over={dragOver === id ? 'true' : undefined}>
      {itemLink(id)}
      {reordering && expanded ? (
        <span className="bw-rail-move" role="group" aria-label={label(id)}>
          <button
            type="button"
            disabled={index === 0}
            aria-label={interpolate(copy.rail.moveUp, { label: label(id) })}
            onClick={() => move(id, -1)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 15V5M5.5 9.5 10 5l4.5 4.5" />
            </svg>
          </button>
          <button
            type="button"
            disabled={index === list.length - 1}
            aria-label={interpolate(copy.rail.moveDown, { label: label(id) })}
            onClick={() => move(id, 1)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M10 5v10M5.5 10.5 10 15l4.5-4.5" />
            </svg>
          </button>
        </span>
      ) : null}
    </li>
  );

  return (
    <>
      <nav
        data-brand-sidebar-nav
        data-brand-layout-mode="rail"
        data-rail-expanded={expanded ? 'true' : 'false'}
        data-nav-reordering={reordering ? 'true' : undefined}
        aria-label={copy.rail.label}
        className="bw-rail"
        onKeyDown={navKeys}
        {...tipHandlers}
      >
        {groups ? (
          (['make', 'team'] as const).map((group) =>
            groups[group].length > 0 ? (
              <div
                key={group}
                className="bw-rail-group"
                data-rail-section={group}
                role="group"
                aria-labelledby={`${groupTitleId}-${group}`}
              >
                <p id={`${groupTitleId}-${group}`} className="bw-rail-group-title">
                  {groupTitle(group)}
                </p>
                <ul className="bw-rail-list" data-rail-group="primary">
                  {groups[group].map((id, index) => row(id, index, groups[group]))}
                </ul>
              </div>
            ) : null,
          )
        ) : (
          <ul className="bw-rail-list" data-rail-group="primary">
            {items.map((id, index) => row(id, index, items))}
          </ul>
        )}

        {expanded && items.length > 1 ? (
          <div className="bw-rail-order" data-rail-order>
            <button type="button" aria-pressed={reordering} onClick={() => setReordering((value) => !value)}>
              {reordering ? copy.rail.reorderDone : copy.rail.reorder}
            </button>
            {reordering && order.length > 0 ? (
              <button type="button" onClick={resetOrder}>
                {copy.rail.reorderReset}
              </button>
            ) : null}
          </div>
        ) : null}

        {canCreate ? (
          <div className="bw-rail-create" data-rail-create>
            <button
              ref={createButton}
              type="button"
              className="bw-rail-create-button"
              aria-expanded={createAt !== null}
              aria-controls={createAt ? menuId : undefined}
              data-rail-tip={copy.create.button}
              onClick={() => (createAt ? closeCreate(false) : openCreate())}
            >
              <span className="bw-rail-create-disc" aria-hidden="true">
                <Icon d={RAIL_ICON.create} />
              </span>
              <span className="bw-rail-label">{copy.create.button}</span>
            </button>
          </div>
        ) : null}

        <div className="bw-rail-foot">
          {studio ? <CreditsMeter allowance={activity.summary?.allowance} copy={copy} locale={locale} expanded={expanded} /> : null}
          {utilities.some((u) => u.shown) ? (
            <ul className="bw-rail-list" data-rail-group="utility">
              {utilities
                .filter((u) => u.shown)
                .map((u) => (
                  <li key={u.key} className="bw-rail-row">
                    <a
                      href={scope(u.href)}
                      className="bw-rail-item"
                      data-nav-item={u.href}
                      data-nav-group="utility"
                      data-rail-tip={copy.rail[u.key]}
                      aria-current={railActive(u.href, path) ? 'page' : undefined}
                    >
                      <Icon d={RAIL_ICON[u.key]} />
                      <span className="bw-rail-label">{copy.rail[u.key]}</span>
                    </a>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      </nav>

      <button
        type="button"
        className="bw-rail-toggle"
        data-rail-toggle
        aria-pressed={expanded}
        aria-label={expanded ? copy.rail.collapse : copy.rail.expand}
        data-rail-tip={expanded ? copy.rail.collapse : copy.rail.expand}
        onClick={toggle}
        {...tipHandlers}
      >
        <Icon d={RAIL_ICON.toggle} />
        <span className="bw-rail-label" aria-hidden="true">
          {copy.rail.collapse}
        </span>
      </button>

      {createAt ? (
        <div
          ref={createMenu}
          id={menuId}
          className="bw-rail-create-menu"
          data-rail-create-menu
          role="group"
          aria-label={copy.create.menu}
          style={{ top: createAt.top, left: createAt.left }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              closeCreate(true);
            }
          }}
          onBlur={(event) => {
            // Keyboard focus left the menu (Tab past the last link): fold it.
            const next = event.relatedTarget as Node | null;
            if (next && !event.currentTarget.contains(next) && next !== createButton.current) closeCreate(false);
          }}
        >
          <p className="bw-rail-create-title" aria-hidden="true">
            {copy.create.menu}
          </p>
          {createLinks.map((link) => (
            <a key={link.key} href={scope(link.href)} data-rail-create-link={link.key}>
              <Icon d={link.icon} />
              <span>{link.text}</span>
            </a>
          ))}
          {commissionLink ? (
            <>
              <hr className="bw-rail-create-divider" />
              <a href={scope(commissionLink.href)} data-rail-create-link={commissionLink.key}>
                <Icon d={commissionLink.icon} />
                <span>{commissionLink.text}</span>
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="bw-rail-tabs" data-rail-tabs>
        <ul>
          {tabIds.map((id) => {
            const count = badge(id);
            return (
              <li key={id}>
                <a href={scope(RAIL_HREF[id])} data-rail-tab={id} aria-current={railActive(RAIL_HREF[id], path) ? 'page' : undefined}>
                  <Icon d={RAIL_ICON[id]} />
                  <span>{label(id)}</span>
                  {count > 0 ? (
                    <span className="bw-rail-badge">
                      <span aria-hidden="true">{count}</span>
                      <span className="bw-rail-sr">{badgeText(id, count)}</span>
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
          <li>
            <button
              ref={moreButton}
              type="button"
              data-rail-tab="more"
              aria-expanded={sheetOpen}
              aria-controls={sheetOpen ? sheetId : undefined}
              aria-haspopup="dialog"
              onClick={() => setSheetOpen(true)}
            >
              <Icon d={RAIL_ICON.more} />
              <span>{copy.rail.more}</span>
            </button>
          </li>
        </ul>
      </div>

      {sheetOpen ? (
        <div className="bw-rail-sheet-bg" data-rail-sheet onClick={closeSheet}>
          <div
            ref={sheet}
            id={sheetId}
            className="bw-rail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={sheetKeys}
          >
            <div className="bw-rail-sheet-head">
              <h2 id={sheetTitleId}>{copy.sheet.title}</h2>
              <button type="button" className="bw-rail-sheet-close" aria-label={copy.sheet.close} onClick={closeSheet}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" />
                </svg>
              </button>
            </div>
            {studio ? <CreditsMeter allowance={activity.summary?.allowance} copy={copy} locale={locale} expanded /> : null}
            {canCreate ? (
              <div className="bw-rail-sheet-create" role="group" aria-label={copy.create.menu}>
                {createLinks.map((link) => (
                  <a key={link.key} href={scope(link.href)} data-rail-create-link={link.key}>
                    <Icon d={link.icon} />
                    <span>{link.text}</span>
                  </a>
                ))}
                {commissionLink ? (
                  <a href={scope(commissionLink.href)} data-rail-create-link={commissionLink.key} data-rail-create-commission>
                    <Icon d={commissionLink.icon} />
                    <span>{commissionLink.text}</span>
                  </a>
                ) : null}
              </div>
            ) : null}
            {groups
              ? (['make', 'team'] as const).map((group) => {
                  const ids = sheetIds.filter((id) => RAIL_GROUP[id] === group);
                  return ids.length > 0 ? (
                    <div key={group} className="bw-rail-sheet-group" data-rail-section={group}>
                      <p className="bw-rail-sheet-group-title">{groupTitle(group)}</p>
                      <ul className="bw-rail-sheet-list">
                        {ids.map((id) => (
                          <li key={id}>
                            <a href={scope(RAIL_HREF[id])} aria-current={railActive(RAIL_HREF[id], path) ? 'page' : undefined}>
                              <Icon d={RAIL_ICON[id]} />
                              <span>{label(id)}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })
              : null}
            <ul className="bw-rail-sheet-list">
              {(groups ? [] : sheetIds).map((id) => (
                <li key={id}>
                  <a href={scope(RAIL_HREF[id])} aria-current={railActive(RAIL_HREF[id], path) ? 'page' : undefined}>
                    <Icon d={RAIL_ICON[id]} />
                    <span>{label(id)}</span>
                  </a>
                </li>
              ))}
              {utilities
                .filter((u) => u.shown)
                .map((u) => (
                  <li key={u.key}>
                    <a href={scope(u.href)} aria-current={railActive(u.href, path) ? 'page' : undefined}>
                      <Icon d={RAIL_ICON[u.key]} />
                      <span>{copy.rail[u.key]}</span>
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : null}

      {studio ? <RailToasts toasts={activity.toasts} copy={copy} scope={scope} onDismiss={activity.dismiss} /> : null}

      {tip ? (
        <div className="bw-rail-tip" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>
          {tip.text}
        </div>
      ) : null}
    </>
  );
}
