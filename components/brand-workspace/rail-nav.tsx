'use client';
/**
 * The workspace rail (docs/BRAND-STUDIO-V3.md §3, slice A): layout mode `rail`.
 *
 * Shown only to a signed-in brand that is not sandboxed and may generate, while studio v2 is on
 * (navigation.tsx decides; the `sidebar` and `topbar` modes are untouched). Collapsed it is a 72px
 * icon column with tooltips; expanded, 232px with names. The state lives in localStorage
 * (`twings_brand_rail_v1`) and a cookie mirror the layout reads, so the first paint has the right width.
 * The editing studio (`/brand/studio/editor`, `/brand/studio/compose`) opens folded whatever is stored: there
 * the toggle changes that visit only and writes nothing (rail-model.ts `railShownExpanded`).
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
import { usePathname, useRouter } from 'next/navigation';
import { useCampaignOpsTrack } from './campaign-ops/track-context';
import { interpolate } from '@/lib/i18n/format';
import type { StudioShellCopy } from '@/messages/studio-shell';
import type { RoomsShellCopy } from '@/messages/rooms-shell';
import { BRAND_HOME_PATH } from '@/lib/brands/workspace/home';
import { CreditsMeter, RailToasts, useRoomUnread, useStudioActivity } from './rail-activity';
import { RailWorkspaceMenu, type RailWorkspace } from './rail-workspace-menu';
import { bellInboxCount } from './bell/model';
import { RAIL_MODE_CHANGED_EVENT, useBell } from './bell/provider';
import {
  RAIL_MODE_COOKIE,
  parseRailModeCookie,
  railModeGuest,
  railModeItems,
  railModeSwitchEffect,
  RAIL_MODE_FOLLOWS_ATTRIBUTE,
  railModes,
  rememberRailMode,
  rememberedRailMode,
  resolveRailMode,
  type RailMode,
} from './rail-mode';
import {
  NAV_ORDER_STORAGE_KEY,
  RAIL_COOKIE,
  RAIL_HREF,
  RAIL_ICON,
  RAIL_STORAGE_KEY,
  dropInGroup,
  dropInTier,
  groupItems,
  groupedTabIds,
  moveInGroup,
  moveInTier,
  orderItems,
  parseOrder,
  parseRailState,
  railActive,
  railCreateLinks,
  railEditorRoute,
  railGroupOf,
  railItemHref,
  railItems,
  railShownExpanded,
  railShownOrder,
  railTier,
  railTiers,
  type RailCreateKey,
  type RailItemId,
} from './rail-model';

export interface RailNavigationProps {
  /** The selected brand's id, or null (no brand yet / an unavailable one). */
  organizationId: string | null;
  /** Studio v2 is open for this brand: 이미지 · 영상 · 편집 · 워크플로우, the credits meter and background progress. */
  studio: boolean;
  /** Project-only non-subscribed brand: `야기 팀과` sits first, and Studio items open the Showroom without background polling. */
  studioShowroom?: boolean;
  /** The creator pool is open and this role may use it. */
  creators: boolean;
  /** The sound studio is open for this brand (lib/brand-studio/visibility.ts `soundStudioVisible`). */
  sound?: boolean;
  identity: boolean;
  team: boolean;
  billing?: boolean;
  settings: boolean;
  /** Owners and editors: the phone sheet's shortcuts. (The wide rail has no "+" button: its rows are the way in.) */
  canCreate: boolean;
  copy: StudioShellCopy;
  locale: 'ko' | 'en';
  /** From the cookie mirror, so the server renders the width this browser chose. */
  initialExpanded: boolean;
  scope: (path: string) => string;
  /**
   * Project rooms are open for this brand (docs/BRAND-ROOMS.md §2): the rail has two modes, 직접 만들기 and
   * 야기 팀과 (rail-mode.ts), with a switch when the brand has both; 알림함 appears with its unread badge.
   * Needs `roomsCopy`; without both the rail is exactly the ungrouped one.
   */
  rooms?: boolean;
  roomsCopy?: RoomsShellCopy['nav'];
  /**
   * The workspace home's name (docs/BRAND-STUDIO-V3.md §12), given only for a brand that has the home.
   * It sits above both groups, fixed: never dragged, reordered or folded into a group.
   */
  home?: string;
  /** The mode this browser last used per brand (the layout's reading of the `twings_brand_mode` cookie). */
  modeMemory?: Readonly<Record<string, RailMode>>;
  /**
   * The brand block and its menu (rail-workspace-menu.tsx): the brands this account can open, the language
   * and sign-out words. On a wide screen it replaces the layout's own brand block, language control and
   * sign-out row (rail.css hides those three); a phone keeps them in its top bar.
   */
  workspace?: RailWorkspace;
  /** Campaign ops C1: replaces 프로젝트 with 캠페인 · 제작 의뢰 and renames 야기 팀과 to 캠페인 운영. */
  campaignOps?: boolean;
  campaignOpsCopy?: { modeLabel: string; campaigns: string; production: string };
}

/** The switch's two sides: a pen for making it yourself, two people for working with the team. */
const MODE_ICON: Readonly<Record<RailMode, string>> = {
  make: 'M4.5 15.5l1-3.6 7.6-7.6 2.6 2.6-7.6 7.6z M11.6 5.8l2.6 2.6',
  team: 'M7 8a3 3 0 1 0 0-.01M2.5 16.5v-.5a4.5 4.5 0 0 1 9 0v.5M13.5 6a2.5 2.5 0 1 1 0 5M14.5 13a4 4 0 0 1 3 3.5',
};

/** sessionStorage: the side a keyboard switch just opened, so the next page puts focus back on the switch. */
const MODE_FOCUS_KEY = 'twings_brand_mode_focus';

function writeMode(organizationId: string, mode: RailMode): void {
  try {
    const current = document.cookie
      .split('; ')
      .find((part) => part.startsWith(`${RAIL_MODE_COOKIE}=`))
      ?.slice(RAIL_MODE_COOKIE.length + 1);
    const value = rememberRailMode(parseRailModeCookie(current), organizationId, mode);
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${RAIL_MODE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    window.dispatchEvent(new CustomEvent(RAIL_MODE_CHANGED_EVENT));
  } catch {
    // Cookies blocked: the rail still follows the page, and the next visit opens on the brand's default.
  }
}

/** 18px stroke house on the rail's 20-unit grid. */
const HOME_ICON = 'M3.5 9.2 10 3.8l6.5 5.4v7.3h-4.3v-4.6H7.8v4.6H3.5z';

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
  const ops = Boolean(props.rooms && props.roomsCopy && props.campaignOps && props.campaignOpsCopy);
  return ops ? <RailNavigationWithOpsTrack {...props} /> : <RailNavigationInner {...props} opsTrack={null} />;
}

function RailNavigationWithOpsTrack(props: RailNavigationProps) {
  const opsTrack = useCampaignOpsTrack();
  return <RailNavigationInner {...props} opsTrack={opsTrack} />;
}

function RailNavigationInner({ opsTrack, ...props }: RailNavigationProps & { opsTrack: string | null }) {
  const { copy, scope, studio, canCreate, locale } = props;
  const path = usePathname() ?? '/brand';
  const router = useRouter();
  // The stored preference (cookie + localStorage), and the editing studio's own state for this visit.
  const [preference, setPreference] = useState(props.initialExpanded);
  const [editorOpen, setEditorOpen] = useState(false);
  const onEditor = railEditorRoute(path);
  // A client-side move into or out of the editing studio keeps this rail mounted (the layout is not rendered
  // again): adjust while rendering, so the first commit of the new page already has its width, and every
  // arrival in the editor starts folded.
  const [wasOnEditor, setWasOnEditor] = useState(onEditor);
  if (wasOnEditor !== onEditor) {
    setWasOnEditor(onEditor);
    setEditorOpen(false);
  }
  const expanded = railShownExpanded({ path, preference, editorOpen });
  /** A person's choice: stored outside the editing studio, this visit's own inside it. */
  const setExpanded = (next: boolean) => {
    if (onEditor) {
      setEditorOpen(next);
      return;
    }
    setPreference(next);
    writeExpanded(next);
  };
  const [order, setOrder] = useState<string[]>([]);
  const [reordering, setReordering] = useState(false);
  const [dragged, setDragged] = useState<RailItemId | null>(null);
  const [dragOver, setDragOver] = useState<RailItemId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const reorderDone = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const sheetId = useId();
  const sheetTitleId = useId();
  const modeButtons = useRef<Partial<Record<RailMode, HTMLButtonElement | null>>>({});

  const nav = props.rooms && props.roomsCopy ? props.roomsCopy : null;
  const ops = Boolean(nav && props.campaignOps && props.campaignOpsCopy);
  const bellCtx = useBell();
  const activeOptions = ops ? { campaignOps: true, track: opsTrack } : undefined;

  /* ---------------------------------------------------------- the two modes (rail-mode.ts) */
  const modeInput = { studio, studioShowroom: props.studioShowroom, rooms: nav !== null, campaignOps: ops };
  const modes = railModes(modeInput);
  const [modeMemory, setModeMemory] = useState<Readonly<Record<string, RailMode>>>(props.modeMemory ?? {});
  const remembered = rememberedRailMode(modeMemory, props.organizationId);
  const resolved = resolveRailMode({ ...modeInput, path, remembered });
  // Set while a switch opens the other side's first page: the rail shows that side at once, and this
  // page's own side is not written back while the next page loads.
  const [leavingTo, setLeavingTo] = useState<RailMode | null>(null);
  const mode = leavingTo ?? resolved;
  const switchable = modes.length > 1 && props.organizationId !== null;
  const hasBell = Boolean(
    bellCtx && props.organizationId && bellCtx.organizationId === props.organizationId && nav !== null && mode === 'make',
  );
  const sendInbox = Boolean(hasBell && bellCtx?.sendConfigured);

  const activity = useStudioActivity({ organizationId: props.organizationId, enabled: studio, path });
  // In 직접 만들기 with the bell active, the bell provider polls once for both the bell and rail 알림함.
  const unread = useRoomUnread({ organizationId: props.organizationId, enabled: nav !== null && !hasBell });

  // What this browser chose last time (the cookie may be missing on a first visit after an update).
  // `initialExpanded` comes from the server once per page, so this runs once. It brings the cookie back in
  // line with storage (no new choice); on the editing studio the folded visit state stays what shows.
  const initialExpanded = props.initialExpanded;
  useEffect(() => {
    try {
      const stored = parseRailState(window.localStorage.getItem(RAIL_STORAGE_KEY));
      if (stored && stored.expanded !== initialExpanded) {
        setPreference(stored.expanded);
        writeExpanded(stored.expanded);
      }
      setOrder(parseOrder(window.localStorage.getItem(NAV_ORDER_STORAGE_KEY)));
    } catch {
      // ignore storage errors
    }
  }, [initialExpanded]);

  const visibleItems = railItems({
    studio,
    studioShowroom: props.studioShowroom,
    creators: props.creators,
    identity: props.identity,
    rooms: nav !== null,
    sound: props.sound,
    campaignOps: ops,
  });
  // With rooms, the saved order applies inside each group and never moves an item across groups.
  const groups = nav ? groupItems(visibleItems, order, { makeInbox: hasBell }) : null;

  // A page of one side (a deep link, a notice, a home card) flips the rail; remember that side for this brand.
  const organizationId = props.organizationId;
  useEffect(() => {
    if (leavingTo || !switchable || !resolved || !organizationId || resolved === remembered) return;
    writeMode(organizationId, resolved);
    setModeMemory((memory) => parseRailModeCookie(rememberRailMode(memory, organizationId, resolved)));
  }, [leavingTo, switchable, resolved, remembered, organizationId]);
  // Back to this page from the browser's cache: show its own side again.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeavingTo(null);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);
  // A keyboard switch that opened the other side's page: focus comes back to the switch, not the page top.
  useEffect(() => {
    if (!switchable || !mode) return;
    let returning = false;
    try {
      returning = window.sessionStorage.getItem(MODE_FOCUS_KEY) === mode;
      window.sessionStorage.removeItem(MODE_FOCUS_KEY);
    } catch {
      // Storage blocked: focus starts at the top of the page, as any page load.
    }
    if (returning) modeButtons.current[mode]?.focus();
    // Once per page: the flag is read on arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = groups && mode ? railModeItems(groups, mode) : orderItems(visibleItems, order);
  const label = (id: RailItemId): string => {
    if (id === 'messages') return copy.rail.messages || nav?.messages || '';
    if (id === 'opsCampaigns') return props.campaignOpsCopy?.campaigns ?? '';
    if (id === 'production') return props.campaignOpsCopy?.production ?? '';
    if (id === 'campaigns' && nav) return copy.rail.campaigns || nav.commissions;
    return copy.rail[id];
  };
  const badge = (id: RailItemId) =>
    id === 'image'
      ? activity.counts.image
      : id === 'video'
        ? activity.counts.video
        : id === 'sound'
          ? activity.counts.sound
          : id === 'messages'
            ? hasBell && bellCtx
              ? bellInboxCount(bellCtx)
              : unread
            : 0;
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

  /** 순서 편집 from the workspace menu: the arrows need the names, so the rail opens first. */
  const startReordering = () => {
    if (!expanded) setExpanded(true);
    setTip(null);
    setReordering(true);
  };
  useEffect(() => {
    if (reordering) reorderDone.current?.focus();
  }, [reordering]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
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

  /* ---------------------------------------------------------- phone sheet shortcuts */
  const createText: Record<RailCreateKey, string> = {
    image: copy.create.image,
    video: copy.create.video,
    reverse: copy.create.fromReference,
    compose: copy.create.compose,
    campaign: copy.create.campaign,
    commission: nav?.commission ?? '',
  };
  const allCreateLinks = railCreateLinks(nav !== null, studio).map((link) => ({ ...link, text: createText[link.key] }));
  // In a mode, the making shortcuts belong to 직접 만들기 and 새 프로젝트 의뢰 to 야기 팀과: neither shows on the other side.
  const createLinks = mode === 'team' ? [] : allCreateLinks.filter((link) => link.key !== 'commission');
  const commissionLink = mode === 'make' ? null : (allCreateLinks.find((link) => link.key === 'commission') ?? null);

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
    if (event.key === 'Escape' && tip) setTip(null);
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
    // A drop on the other group, or across the divider, is no move at all: a row stays where it belongs.
    const next = groups ? dropInGroup(groups, source, target, mode, hasBell) : dropInTier(items, source, target, mode);
    if (next) saveOrder(next);
  };
  const move = (id: RailItemId, direction: -1 | 1) =>
    saveOrder(groups ? moveInGroup(groups, id, direction, mode, hasBell) : moveInTier(items, id, direction, mode));
  const canDropOn = (id: RailItemId) =>
    Boolean(
      dragged &&
        dragged !== id &&
        railTier(dragged, mode) === railTier(id, mode) &&
        (!groups || railGroupOf(dragged, mode, hasBell) === railGroupOf(id, mode, hasBell)),
    );

  const utilities: Array<{ key: 'team' | 'billing' | 'settings'; href: string; shown: boolean }> = [
    { key: 'team', href: '/brand/members', shown: props.team },
    { key: 'billing', href: '/brand/billing', shown: Boolean(props.billing) },
    { key: 'settings', href: '/brand/settings', shown: props.settings },
  ];
  /** The same three, as the workspace menu's first group. */
  const workspaceLinks = utilities
    .filter((u) => u.shown)
    .map((u) => ({ key: u.key, path: u.href, href: scope(u.href), label: copy.rail[u.key], icon: RAIL_ICON[u.key], current: railActive(u.href, path, activeOptions) }));
  /** The meter leads to 플랜 및 청구 for a role that may open it. */
  const creditsHref = props.billing ? scope('/brand/billing') : undefined;

  const itemLink = (id: RailItemId, extra: ReactNode = null) => {
    const href = railItemHref(id, { makeInbox: hasBell, sendInbox });
    const count = badge(id);
    const runningText = badgeText(id, count);
    const tipBase = label(id);
    const tipCount = nav ? badgeText(id, count, true) : runningText;
    return (
      <a
        href={scope(href)}
        className="bw-rail-item"
        data-nav-item={href}
        data-nav-group="primary"
        data-rail-item={id}
        data-rail-inbox={hasBell && id === 'messages' ? '' : undefined}
        data-rail-tip={tipCount ? `${tipBase} · ${tipCount}` : tipBase}
        aria-current={railActive(href, path, activeOptions) ? 'page' : undefined}
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

  // Phone tab bar: 이미지 스튜디오 · 영상 스튜디오 · 캠페인 · 에셋 when they exist, filled up from the rest; the others go in 더보기.
  // With rooms: 이미지 스튜디오 · 영상 스튜디오 · 의뢰 · 메시지 (rail-model `groupedTabIds`).
  const tabIds = nav
    ? groupedTabIds(hasBell ? items.filter((id) => id !== 'messages') : items)
    : [
        ...(['image', 'video', 'campaigns', 'assets'] as RailItemId[]).filter((id) => items.includes(id)),
        ...items.filter((id) => !['image', 'video', 'campaigns', 'assets'].includes(id)),
      ].slice(0, 4);
  const sheetIds = items.filter((id) => !tabIds.includes(id));

  // The wide rail's two bands: the working screens, then (under a thin divider) what is opened now and then.
  // The phone bar and sheet above keep the one list. 야기 팀과 has no lower band.
  const bands = railTiers(items, mode);
  // The arrows move a row among its own group's rows on its own side of the divider; 에셋 listed on 야기 팀과
  // stays where it is there.
  const ownList = (id: RailItemId): readonly RailItemId[] =>
    (groups && mode ? groups[railGroupOf(id, mode, hasBell)] : items).filter((other) => railTier(other, mode) === railTier(id, mode));
  const row = (id: RailItemId) => {
    const list = ownList(id);
    const index = list.indexOf(id);
    const guest = mode !== null && !(hasBell && id === 'messages') && railModeGuest(id, mode);
    return (
    <li key={id} className="bw-rail-row" data-drag-over={dragOver === id ? 'true' : undefined}>
      {itemLink(id)}
      {/* A row alone in its band (워크플로우 under the divider, for now) has nowhere to go: no arrows. */}
      {reordering && expanded && !guest && list.length > 1 ? (
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
  };

  /* ---------------------------------------------------------- the switch */
  const modeName = (m: RailMode) =>
    nav ? (m === 'make' ? nav.groupMake : ops && props.campaignOpsCopy ? props.campaignOpsCopy.modeLabel : nav.groupTeam) : '';
  const running = activity.counts.image + activity.counts.video + activity.counts.sound;
  /** Something waiting on the side the person is not on: unread notices for 야기 팀과, runs in progress for 직접 만들기. */
  const waiting = (m: RailMode): { count: number; text: string; short: string } | null => {
    if (m === mode || !nav) return null;
    if (m === 'team' && unread > 0) {
      return { count: unread, text: interpolate(nav.unread, { count: unread }), short: interpolate(nav.unreadShort, { count: unread }) };
    }
    if (m === 'make' && running > 0) {
      const text = interpolate(copy.rail.running, { count: running });
      return { count: running, text, short: text };
    }
    return null;
  };
  const choose = (next: RailMode, focus = false) => {
    if (!organizationId || !groups) return;
    if (focus) modeButtons.current[next]?.focus();
    if (next === mode) return;
    setTip(null);
    setReordering(false);
    writeMode(organizationId, next);
    setModeMemory((memory) => parseRailModeCookie(rememberRailMode(memory, organizationId, next)));
    // The page's content may depend on the mode too (the home): its root carries the marker.
    let pageFollowsMode = false;
    try {
      pageFollowsMode = document.querySelector(`[${RAIL_MODE_FOLLOWS_ATTRIBUTE}]`) !== null;
    } catch {
      // no document: nothing to refresh
    }
    // The side's first page is its rail's first row: rows above the divider come before the ones under it,
    // whatever an older saved order put first.
    const effect = railModeSwitchEffect({ path, next, items: railShownOrder(railModeItems(groups, next), next), hrefOf: (id) => scope(RAIL_HREF[id]), pageFollowsMode, campaignOps: ops });
    // Same page, new content: the server tree is fetched again with the cookie just written. The rail and
    // the switch stay mounted, so focus stays where it is.
    if (effect.kind === 'refresh') router.refresh();
    if (effect.kind === 'navigate') {
      const target = effect.href;
      setLeavingTo(next);
      if (focus) {
        try {
          window.sessionStorage.setItem(MODE_FOCUS_KEY, next);
        } catch {
          // ignore: the next page simply starts at the top
        }
      }
      window.location.assign(target);
    }
  };
  const modeKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!mode) return;
    const at = modes.indexOf(mode);
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    let next: RailMode | undefined;
    if (step) next = modes[(at + step + modes.length) % modes.length];
    else if (event.key === 'Home') next = modes[0];
    else if (event.key === 'End') next = modes[modes.length - 1];
    if (!next) return;
    event.preventDefault();
    choose(next, true);
  };
  const modeSwitch = (where: 'rail' | 'sheet') =>
    switchable && mode ? (
      <div className="bw-rail-mode" role="radiogroup" aria-label={nav?.mode} data-rail-mode-switch={where} onKeyDown={modeKeys}>
        {modes.map((m) => {
          const wait = waiting(m);
          return (
            <button
              key={m}
              ref={
                where === 'rail'
                  ? (element) => {
                      modeButtons.current[m] = element;
                    }
                  : undefined
              }
              type="button"
              role="radio"
              aria-checked={m === mode}
              tabIndex={m === mode ? 0 : -1}
              className="bw-rail-mode-option"
              data-rail-mode-option={m}
              data-rail-tip={wait ? `${modeName(m)} · ${wait.short}` : modeName(m)}
              // A click from the keyboard (Space or Enter, `detail` 0) keeps focus on the switch across the page load.
              onClick={(event) => choose(m, event.detail === 0)}
            >
              <Icon d={MODE_ICON[m]} />
              <span className="bw-rail-mode-name">{modeName(m)}</span>
              {wait ? (
                <span className="bw-rail-mode-wait" data-rail-mode-waiting={m}>
                  <span aria-hidden="true">{wait.count > 99 ? '99+' : wait.count}</span>
                  <span className="bw-rail-sr">{wait.text}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <nav
        data-brand-sidebar-nav
        data-brand-layout-mode="rail"
        data-rail-mode={mode ?? undefined}
        data-rail-expanded={expanded ? 'true' : 'false'}
        data-nav-reordering={reordering ? 'true' : undefined}
        aria-label={copy.rail.label}
        className="bw-rail"
        onKeyDown={navKeys}
        {...tipHandlers}
      >
        {props.workspace ? (
          <RailWorkspaceMenu
            workspace={props.workspace}
            links={workspaceLinks}
            expanded={expanded}
            reorder={items.length > 1 && !reordering ? { label: copy.rail.reorder, onSelect: startReordering } : null}
          />
        ) : null}
        {modeSwitch('rail')}
        {props.home ? (
          <ul className="bw-rail-list" data-rail-group="home">
            <li className="bw-rail-row">
              <a
                href={scope(BRAND_HOME_PATH)}
                className="bw-rail-item"
                data-nav-item={BRAND_HOME_PATH}
                data-nav-group="home"
                data-rail-item="home"
                data-rail-tip={props.home}
                aria-current={railActive(BRAND_HOME_PATH, path, activeOptions) ? 'page' : undefined}
              >
                <Icon d={HOME_ICON} />
                <span className="bw-rail-label">{props.home}</span>
              </a>
            </li>
          </ul>
        ) : null}
        <ul className="bw-rail-list" data-rail-group="primary">
          {bands.main.map((id) => row(id))}
        </ul>
        {bands.lower.length > 0 ? (
          <>
            {/* A plain rule between two lists: read as a separator, never a stop for Tab. */}
            {bands.main.length > 0 || props.home ? <hr className="bw-rail-divider" data-rail-divider /> : null}
            <ul className="bw-rail-list" data-rail-group="lower">
              {bands.lower.map((id) => row(id))}
            </ul>
          </>
        ) : null}

        {/* 순서 편집 starts in the workspace menu (or, with no menu, from this row); while it is on, this row ends it. */}
        {expanded && items.length > 1 && (reordering || !props.workspace) ? (
          <div className="bw-rail-order" data-rail-order>
            <button
              ref={reorderDone}
              type="button"
              // With the workspace menu this row is 완료 alone (the menu starts the editing): nothing to press on or off.
              aria-pressed={props.workspace ? undefined : reordering}
              onClick={(event) => {
                setReordering((value) => !value);
                // The row leaves with the editing: focus goes back to where the editing was started from.
                if (props.workspace) event.currentTarget.closest('nav')?.querySelector<HTMLElement>('[data-rail-workspace-trigger]')?.focus();
              }}
            >
              {reordering ? copy.rail.reorderDone : copy.rail.reorder}
            </button>
            {reordering && order.length > 0 ? (
              <button type="button" onClick={resetOrder}>
                {copy.rail.reorderReset}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="bw-rail-foot">
          {studio && mode !== 'team' ? (
            <CreditsMeter allowance={activity.summary?.allowance} copy={copy} locale={locale} expanded={expanded} href={creditsHref} hrefLabel={copy.rail.billing} />
          ) : null}
          {/* With the menu, 팀 · 플랜 및 청구 · 설정 live in it; a browser without JavaScript cannot open it and gets them as plain links. */}
          {props.workspace && utilities.some((u) => u.shown) ? (
            <noscript>
              <ul className="bw-rail-list" data-rail-noscript>
                {utilities
                  .filter((u) => u.shown)
                  .map((u) => (
                    <li key={u.key} className="bw-rail-row">
                      <a href={scope(u.href)} className="bw-rail-item">
                        <Icon d={RAIL_ICON[u.key]} />
                        <span className="bw-rail-label">{copy.rail[u.key]}</span>
                      </a>
                    </li>
                  ))}
              </ul>
            </noscript>
          ) : null}
          {/* Without the workspace menu (no brand block given) the three keep their rows here. */}
          {!props.workspace && utilities.some((u) => u.shown) ? (
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
                      aria-current={railActive(u.href, path, activeOptions) ? 'page' : undefined}
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
        // Folded, the rail's own tooltip names it; open, it is an icon with the browser's.
        title={expanded && props.workspace ? copy.rail.collapse : undefined}
        data-rail-tip={expanded ? copy.rail.collapse : copy.rail.expand}
        onClick={toggle}
        {...tipHandlers}
      >
        <Icon d={RAIL_ICON.toggle} />
        <span className="bw-rail-label" aria-hidden="true">
          {copy.rail.collapse}
        </span>
      </button>

      <div className="bw-rail-tabs" data-rail-tabs>
        <ul>
          {tabIds.map((id) => {
            const count = badge(id);
            return (
              <li key={id}>
                <a href={scope(RAIL_HREF[id])} data-rail-tab={id} aria-current={railActive(RAIL_HREF[id], path, activeOptions) ? 'page' : undefined}>
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
            {modeSwitch('sheet')}
            {studio && mode !== 'team' ? <CreditsMeter allowance={activity.summary?.allowance} copy={copy} locale={locale} expanded /> : null}
            {canCreate && (createLinks.length > 0 || commissionLink) ? (
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
            {props.home ? (
              <ul className="bw-rail-sheet-list" data-rail-sheet-home>
                <li>
                  <a href={scope(BRAND_HOME_PATH)} aria-current={railActive(BRAND_HOME_PATH, path, activeOptions) ? 'page' : undefined}>
                    <Icon d={HOME_ICON} />
                    <span>{props.home}</span>
                  </a>
                </li>
              </ul>
            ) : null}
            <ul className="bw-rail-sheet-list">
              {sheetIds.map((id) => {
                const sheetHref = railItemHref(id, { makeInbox: hasBell, sendInbox });
                return (
                  <li key={id}>
                    <a href={scope(sheetHref)} aria-current={railActive(sheetHref, path, activeOptions) ? 'page' : undefined}>
                      <Icon d={RAIL_ICON[id]} />
                      <span>{label(id)}</span>
                    </a>
                  </li>
                );
              })}
              {utilities
                .filter((u) => u.shown)
                .map((u) => (
                  <li key={u.key}>
                    <a href={scope(u.href)} aria-current={railActive(u.href, path, activeOptions) ? 'page' : undefined}>
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
