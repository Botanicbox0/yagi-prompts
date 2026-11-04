'use client';
import { usePathname } from 'next/navigation';
import { poolVisible, scopedHref, sectionVisibility, selectedChoice, type BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { useWorkspaceSelection } from './identity';
import type { NavigationVisibility } from './access';
const ALL: NavigationVisibility = { studio: true, identity: true, settings: true, members: true };
/** `creators`: given only while the creator pool is open (TWINGS_INFLUENCERS); shown to owners and editors. */
type Labels = { home: string; members: string; settings: string; library: string; studio: string; identity?: string; creators?: string };

const SUBTITLES_KO: Record<string, string> = {
  '/brand': '크리에이터 대량 시딩 · 성과 집계',
  '/brand/studio': '화보·영상·사운드 직접 제작',
  '/brand/library': '납품 마스터 · 프레임 검수',
  '/brand/identity': '로고·제품·다중 미감(A/B/C)',
  '/brand/creators': '검증된 인플루언서 풀',
  '/brand/settings': '조직 프로필 · 도메인 · 정책',
  '/brand/members': '멤버 초대 · 역할 권한',
};

const SUBTITLES_EN: Record<string, string> = {
  '/brand': 'Mass creator seeding & ROI',
  '/brand/studio': 'Direct lookbook, film & sound',
  '/brand/library': 'Delivered masters & frame QC',
  '/brand/identity': 'Logos, products & aesthetics',
  '/brand/creators': 'Verified influencer pool',
  '/brand/settings': 'Profile, domain & policies',
  '/brand/members': 'Team invites & role access',
};

function Links({ labels, visible, scope, pool }: { labels: Labels; visible: NavigationVisibility; scope: (path: string) => string; pool: boolean }) {
  const path = usePathname() ?? '/brand';
  const isKo = /[가-힣]/.test(labels.home);
  const subs = isKo ? SUBTITLES_KO : SUBTITLES_EN;
  const entries = ([['/brand', labels.home, 'M3 3h14v14H3z M3 8h14M8 8v9', true], ['/brand/studio', labels.studio, 'M3 4h10v12H3z M13 8l5-3v10l-5-3', visible.studio], ['/brand/library', labels.library, 'M3 5h14v12H3z M6 2h8M6 13l3-4 3 3 2-2 3 4', true], ['/brand/identity', labels.identity ?? '', 'M4 3h12v14H4z M7 7h6M7 10h6M7 13h4', Boolean(visible.identity && labels.identity)], ['/brand/creators', labels.creators ?? '', 'M7 8a3 3 0 1 0 0-.01M2 17v-1a5 5 0 0 1 10 0v1M14 6a2.5 2.5 0 1 1 0 5M15 13a4 4 0 0 1 3.5 4', pool && Boolean(labels.creators)], ['/brand/settings', labels.settings, 'M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M8 13v4', visible.settings], ['/brand/members', labels.members, 'M2 17v-2a6 6 0 0 1 12 0v2M5 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M16 12v5M14 14h5', visible.members]] as const).filter(([, , , shown]) => shown);
  return (
    <nav data-brand-sidebar-nav>
      {entries.map(([href, label, d]) => (
        <a
          key={href}
          href={scope(href)}
          data-nav-item={href}
          aria-current={(href === '/brand' ? path === '/brand' || path.startsWith('/brand/projects') : path.startsWith(href)) ? 'page' : undefined}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} /></svg>
          <span className="bw-nav-item-copy">
            <span className="bw-nav-item-title">{label}</span>
            {subs[href] && <small className="bw-nav-item-sub" data-nav-role-hint>{subs[href]}</small>}
          </span>
        </a>
      ))}
    </nav>
  );
}
function Scoped({ scope, ...labels }: Labels & { scope: BrandWorkspaceScope }) {
  const choice = selectedChoice(useWorkspaceSelection(scope).selection);
  // Sections follow the role in the SELECTED brand, and every link keeps that brand.
  return <Links labels={labels} visible={sectionVisibility(choice)} pool={poolVisible(choice)} scope={(path) => scopedHref(path, choice)} />;
}
/** Without a scope (signed out, e.g. the invitation landing) every destination is shown; each page authorizes itself. */
export function WorkspaceNavigation({ scope, ...labels }: Labels & { scope?: BrandWorkspaceScope | null }) {
  return scope ? <Scoped scope={scope} {...labels} /> : <Links labels={labels} visible={ALL} pool scope={(path) => path} />;
}
