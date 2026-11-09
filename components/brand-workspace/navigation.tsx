'use client';
import { usePathname } from 'next/navigation';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { poolVisible, scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from './identity';
import type { NavigationVisibility } from './access';
const ALL: NavigationVisibility = { studio: true, identity: true, settings: true, members: true };
/** `creators`: given only while the creator pool is open (TWINGS_INFLUENCERS); shown to owners and editors. */
type Labels = { home: string; members: string; settings: string; library: string; studio: string; identity?: string; creators?: string };
function Links({ labels, visible, scope, pool, layoutMode = 'topbar' }: { labels: Labels; visible: NavigationVisibility; scope: (path: string) => string; pool: boolean; layoutMode?: 'topbar' | 'sidebar' }) {
  const path = usePathname() ?? '/brand';
  const isKo = /[가-힣]/.test(labels.home);
  const primaryEntries = ([
    ['/brand', labels.home, 'M3 3h14v14H3z M3 8h14M8 8v9', true],
    ['/brand/studio', labels.studio, 'M3 4h10v12H3z M13 8l5-3v10l-5-3', visible.studio],
    ['/brand/identity', labels.identity ?? '', 'M4 3h12v14H4z M7 7h6M7 10h6M7 13h4', Boolean(visible.identity && labels.identity)],
    ['/brand/library', labels.library, 'M3 5h14v12H3z M6 2h8M6 13l3-4 3 3 2-2 3 4', true],
    ['/brand/creators', labels.creators ?? '', 'M7 8a3 3 0 1 0 0-.01M2 17v-1a5 5 0 0 1 10 0v1M14 6a2.5 2.5 0 1 1 0 5M15 13a4 4 0 0 1 3.5 4', pool && Boolean(labels.creators)],
  ] as const).filter(([, , , shown]) => shown);
  const utilityEntries = ([
    ['/brand/members', labels.members, 'M2 17v-2a6 6 0 0 1 12 0v2M5 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 12v5M14 14h5', visible.members],
    ['/brand/settings', labels.settings, 'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M8 13v4', visible.settings],
  ] as const).filter(([, , , shown]) => shown);
  return (
    <nav data-brand-sidebar-nav data-brand-layout-mode={layoutMode}>
      {primaryEntries.map(([href, label, d]) => (
        <a
          key={href}
          href={scope(href)}
          data-nav-item={href}
          data-nav-group="primary"
          aria-current={(href === '/brand' ? path === '/brand' || path.startsWith('/brand/projects') : path.startsWith(href)) ? 'page' : undefined}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>
          {label}
        </a>
      ))}
      {layoutMode === 'topbar' && utilityEntries.length > 0 && (
        <span className="bw-nav-divider" aria-hidden="true" />
      )}
      {utilityEntries.map(([href, label, d]) => (
        <a
          key={href}
          href={scope(href)}
          data-nav-item={href}
          data-nav-group="utility"
          aria-current={path.startsWith(href) ? 'page' : undefined}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>
          {label}
        </a>
      ))}
      {layoutMode === 'topbar' && visible.members && (
        <a
          href={`${scope('/brand/members')}#invite-composer`}
          data-nav-invite-cta
          title={labels.members}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          {isKo ? '초대' : 'Invite'}
        </a>
      )}
    </nav>
  );
}
function Scoped({ scope, ...labels }: Labels & { scope: BrandWorkspaceScope }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  const isMorphic = Boolean(choice && (isSandboxedClientOrganization(choice) || featureDenied(choice.denied, 'generative_media')));
  // Sections follow the role in the SELECTED brand, and every link keeps that brand.
  return <Links labels={labels} visible={sectionVisibility(choice)} pool={poolVisible(choice)} layoutMode={isMorphic ? 'sidebar' : 'topbar'} scope={(path) => scopedHref(path, choice)} />;
}
/** Without a scope (signed out, e.g. the invitation landing) every destination is shown; each page authorizes itself. */
export function WorkspaceNavigation({ scope, ...labels }: Labels & { scope?: BrandWorkspaceScope | null }) {
  return scope ? <Scoped scope={scope} {...labels} /> : <Links labels={labels} visible={ALL} pool layoutMode="topbar" scope={(path) => path} />;
}
