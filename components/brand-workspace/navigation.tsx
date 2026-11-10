'use client';
import { useEffect, useState, type DragEvent } from 'react';
import { usePathname } from 'next/navigation';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { poolVisible, scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from './identity';
import type { NavigationVisibility } from './access';

const ALL: NavigationVisibility = { studio: true, identity: true, settings: true, members: true };
const NAV_ORDER_STORAGE_KEY = 'twings_brand_nav_order_v1';

/** `creators`: given only while the creator pool is open (TWINGS_INFLUENCERS); shown to owners and editors. */
type Labels = { home: string; members: string; settings: string; library: string; studio: string; identity?: string; creators?: string };

type NavEntry = readonly [href: string, label: string, iconPath: string, shown: boolean];

function sortEntriesByOrder(entries: ReadonlyArray<NavEntry>, order: ReadonlyArray<string>): NavEntry[] {
  if (!order || order.length === 0) return [...entries];
  return [...entries].sort((a, b) => {
    const idxA = order.indexOf(a[0]);
    const idxB = order.indexOf(b[0]);
    const rankA = idxA === -1 ? 999 : idxA;
    const rankB = idxB === -1 ? 999 : idxB;
    return rankA - rankB;
  });
}

function Links({
  labels,
  visible,
  scope,
  pool,
  layoutMode = 'topbar',
}: {
  labels: Labels;
  visible: NavigationVisibility;
  scope: (path: string) => string;
  pool: boolean;
  layoutMode?: 'topbar' | 'sidebar';
}) {
  const path = usePathname() ?? '/brand';
  const isKo = /[가-힣]/.test(labels.home);

  // Studio-first default order: Studio -> Brand Kit -> Library -> Campaigns -> Creators
  const basePrimaryEntries: ReadonlyArray<NavEntry> = (
    [
      ['/brand/studio', labels.studio, 'M3 4h10v12H3z M13 8l5-3v10l-5-3', visible.studio],
      ['/brand/identity', labels.identity ?? '', 'M4 3h12v14H4z M7 7h6M7 10h6M7 13h4', Boolean(visible.identity && labels.identity)],
      ['/brand/library', labels.library, 'M3 5h14v12H3z M6 2h8M6 13l3-4 3 3 2-2 3 4', true],
      ['/brand', labels.home, 'M3 3h14v14H3z M3 8h14M8 8v9', true],
      [
        '/brand/creators',
        labels.creators ?? '',
        'M7 8a3 3 0 1 0 0-.01M2 17v-1a5 5 0 0 1 10 0v1M14 6a2.5 2.5 0 1 1 0 5M15 13a4 4 0 0 1 3.5 4',
        pool && Boolean(labels.creators),
      ],
    ] as const
  ).filter(([, , , shown]) => shown);

  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedHref, setDraggedHref] = useState<string | null>(null);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_ORDER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          setCustomOrder(parsed);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const primaryEntries = sortEntriesByOrder(basePrimaryEntries, customOrder);

  function saveOrder(nextOrder: string[]) {
    setCustomOrder(nextOrder);
    try {
      window.localStorage.setItem(NAV_ORDER_STORAGE_KEY, JSON.stringify(nextOrder));
      window.dispatchEvent(new CustomEvent('twings:nav-order-changed', { detail: nextOrder }));
    } catch {
      // ignore storage errors
    }
  }

  function moveEntry(href: string, direction: -1 | 1) {
    const currentHrefs = primaryEntries.map(([h]) => h);
    const idx = currentHrefs.indexOf(href);
    const targetIdx = idx + direction;
    if (idx < 0 || targetIdx < 0 || targetIdx >= currentHrefs.length) return;
    const next = [...currentHrefs];
    const [moved] = next.splice(idx, 1);
    if (!moved) return;
    next.splice(targetIdx, 0, moved);
    saveOrder(next);
  }

  function handleNavDragStart(e: DragEvent<HTMLAnchorElement>, href: string) {
    setDraggedHref(href);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', href);
    } catch {
      // ignore
    }
  }

  function handleNavDrop(e: DragEvent<HTMLAnchorElement>, targetHref: string) {
    e.preventDefault();
    setDragOverHref(null);
    const sourceHref = draggedHref || e.dataTransfer?.getData('text/plain');
    setDraggedHref(null);
    if (!sourceHref || sourceHref === targetHref) return;
    const currentHrefs = primaryEntries.map(([h]) => h);
    const fromIdx = currentHrefs.indexOf(sourceHref);
    const toIdx = currentHrefs.indexOf(targetHref);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...currentHrefs];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    saveOrder(next);
  }

  const utilityEntries = (
    [
      ['/brand/members', labels.members, 'M2 17v-2a6 6 0 0 1 12 0v2M5 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 12v5M14 14h5', visible.members],
      ['/brand/settings', labels.settings, 'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M8 13v4', visible.settings],
    ] as const
  ).filter(([, , , shown]) => shown);

  return (
    <nav data-brand-sidebar-nav data-brand-layout-mode={layoutMode} data-nav-reordering={isReordering ? 'true' : undefined}>
      {primaryEntries.map(([href, label, d], index) => (
        <span key={href} className="bw-nav-SortableItem" data-drag-over={dragOverHref === href ? 'true' : undefined}>
          <a
            href={scope(href)}
            data-nav-item={href}
            data-nav-group="primary"
            draggable
            onDragStart={(e) => handleNavDragStart(e, href)}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedHref && draggedHref !== href) setDragOverHref(href);
            }}
            onDragLeave={() => setDragOverHref(null)}
            onDrop={(e) => handleNavDrop(e, href)}
            onDragEnd={() => {
              setDraggedHref(null);
              setDragOverHref(null);
            }}
            aria-current={
              (href === '/brand' ? path === '/brand' || path.startsWith('/brand/projects') : path.startsWith(href))
                ? 'page'
                : undefined
            }
            title={isKo ? '드래그하여 메뉴 순서를 바꿀 수 있습니다' : 'Drag to reorder menu tabs'}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d={d} />
            </svg>
            {label}
          </a>
          {isReordering ? (
            <span className="bw-nav-reorder-arrows" role="group" aria-label={isKo ? `${label} 순서 이동` : `Reorder ${label}`}>
              <button
                type="button"
                className="bw-nav-move-btn"
                disabled={index === 0}
                aria-label={isKo ? `${label} 앞으로 이동` : `Move ${label} left`}
                onClick={() => moveEntry(href, -1)}
              >
                ‹
              </button>
              <button
                type="button"
                className="bw-nav-move-btn"
                disabled={index === primaryEntries.length - 1}
                aria-label={isKo ? `${label} 뒤로 이동` : `Move ${label} right`}
                onClick={() => moveEntry(href, 1)}
              >
                ›
              </button>
            </span>
          ) : null}
        </span>
      ))}
      {layoutMode === 'topbar' && primaryEntries.length > 1 ? (
        <button
          type="button"
          className="bw-nav-order-btn"
          data-nav-order-toggle
          aria-pressed={isReordering}
          onClick={() => setIsReordering((prev) => !prev)}
          title={
            isKo
              ? '탭 순서를 직접 조정하거나 드래그해서 첫 화면 탭을 바꿉니다'
              : 'Customize tab order or drag tabs'
          }
        >
          {isReordering ? (isKo ? '완료' : 'Done') : isKo ? '순서' : 'Order'}
        </button>
      ) : null}
      {isReordering && customOrder.length > 0 ? (
        <button
          type="button"
          className="bw-nav-order-btn"
          onClick={() => {
            setCustomOrder([]);
            try {
              window.localStorage.removeItem(NAV_ORDER_STORAGE_KEY);
            } catch {
              // ignore
            }
          }}
        >
          {isKo ? '초기화' : 'Reset'}
        </button>
      ) : null}
      {layoutMode === 'topbar' && utilityEntries.length > 0 && <span className="bw-nav-divider" aria-hidden="true" />}
      {utilityEntries.map(([href, label, d]) => (
        <a
          key={href}
          href={scope(href)}
          data-nav-item={href}
          data-nav-group="utility"
          aria-current={path.startsWith(href) ? 'page' : undefined}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d={d} />
          </svg>
          {label}
        </a>
      ))}
      {layoutMode === 'topbar' && visible.members && (
        <a href={`${scope('/brand/members')}#invite-composer`} data-nav-invite-cta title={labels.members}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 4v12M4 10h12" />
          </svg>
          {isKo ? '초대' : 'Invite'}
        </a>
      )}
    </nav>
  );
}

function Scoped({ scope, ...labels }: Labels & { scope: BrandWorkspaceScope }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  const isMorphic = Boolean(
    choice && (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, 'generative_media')),
  );
  // Sections follow the role in the SELECTED brand, and every link keeps that brand.
  return (
    <Links
      labels={labels}
      visible={sectionVisibility(choice)}
      pool={poolVisible(choice)}
      layoutMode={isMorphic ? 'sidebar' : 'topbar'}
      scope={(path) => scopedHref(path, choice)}
    />
  );
}

/** Without a scope (signed out, e.g. the invitation landing) every destination is shown; each page authorizes itself. */
export function WorkspaceNavigation({ scope, ...labels }: Labels & { scope?: BrandWorkspaceScope | null }) {
  return scope ? <Scoped scope={scope} {...labels} /> : <Links labels={labels} visible={ALL} pool layoutMode="topbar" scope={(path) => path} />;
}
