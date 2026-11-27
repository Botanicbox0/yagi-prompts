import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { campaignOpsOpenForViewer } from '@/lib/brands/workspace/campaign-ops';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  RAIL_GROUP,
  RAIL_HREF,
  groupItems,
  railActive,
  railItems,
} from '@/components/brand-workspace/rail-model';
import {
  pathRailMode,
  railModeItems,
  railModeSwitchTarget,
} from '@/components/brand-workspace/rail-mode';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const state = vi.hoisted(() => ({ path: '/brand/campaigns', search: '' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.search),
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import {
  CampaignOpsTrackMarker,
  CampaignOpsTrackProvider,
} from '@/components/brand-workspace/campaign-ops/track-context';

const ko = getDictionary('ko');
const en = getDictionary('en');

const ALPHA = 'a0000000-0000-4000-8000-00000000000a';
const OTHER = 'b0000000-0000-4000-8000-00000000000b';

const labelsFor = (dict: typeof ko) => ({
  home: dict.brandWorkspace.home,
  members: dict.brandWorkspace.members,
  settings: dict.brandWorkspace.managed.settings,
  library: dict.brandWorkspace.managed.library,
  studio: dict.brandWorkspace.productionStudio.title,
  identity: dict.brandWorkspace.identityLayer.nav,
  creators: dict.brandWorkspace.creatorPool.nav,
});

const menuFor = (dict: typeof ko) => ({
  identity: dict.brandWorkspace.identity,
  roles: dict.brandWorkspace.roles,
  language: dict.nav.localeToggle,
  signOut: dict.brandWorkspace.signOut,
});

const opsCopyFor = (dict: typeof ko) => ({
  modeLabel: dict.campaignOps.mode.label,
  campaigns: dict.campaignOps.rail.campaigns,
  production: dict.campaignOps.rail.production,
});

const scopeOf = (choice: BrandWorkspaceChoice): BrandWorkspaceScope => ({
  choices: [choice],
  projectOrganizations: {},
});

const renderNav = (
  choice: BrandWorkspaceChoice,
  options: {
    locale?: 'ko' | 'en';
    campaignOpsOrgs?: readonly string[];
    withOpsCopy?: boolean;
  } = {},
) => {
  const dict = options.locale === 'en' ? en : ko;
  return renderToStaticMarkup(
    <WorkspaceNavigation
      {...labelsFor(dict)}
      scope={scopeOf(choice)}
      studioV2
      shell={dict.studioShell}
      locale={options.locale ?? 'ko'}
      rooms
      roomsCopy={dict.roomsShell.nav}
      homeLabel={dict.brandHome.nav.home}
      workspaceMenu={menuFor(dict)}
      campaignOpsOrgs={options.campaignOpsOrgs}
      campaignOpsCopy={options.withOpsCopy === false ? undefined : opsCopyFor(dict)}
    />,
  );
};

const idsOf = (html: string) => [...html.matchAll(/data-rail-item="(\w+)"/g)].map((m) => m[1]);

const owner: BrandWorkspaceChoice = { id: ALPHA, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };
const mounted: MountedDom[] = [];

beforeEach(() => {
  state.path = '/brand/campaigns';
  state.search = '';
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
});

describe('campaign ops rail model, pathRailMode, and railActive', () => {
  it('replaces 프로젝트 with 캠페인 and 제작 의뢰 when rooms and campaignOps are open', () => {
    const items = railItems({ studio: true, creators: true, identity: true, rooms: true, campaignOps: true });
    expect(items).toEqual(['image', 'video', 'compose', 'workflows', 'assets', 'opsCampaigns', 'production', 'messages']);
    expect(items).not.toContain('campaigns');
    expect(RAIL_GROUP.opsCampaigns).toBe('team');
    expect(RAIL_GROUP.production).toBe('team');
    expect(RAIL_HREF.opsCampaigns).toBe('/brand/campaigns');
    expect(RAIL_HREF.production).toBe('/brand/production');

    const groups = groupItems(items, []);
    expect(railModeItems(groups, 'team')).toEqual(['opsCampaigns', 'production', 'messages', 'assets']);
    expect(railModeItems(groups, 'make')).toEqual(['image', 'video', 'compose', 'workflows', 'assets']);
  });

  it('keeps 프로젝트 unchanged when campaignOps is false or omitted', () => {
    expect(railItems({ studio: true, creators: true, identity: true, rooms: true })).toEqual([
      'image',
      'video',
      'compose',
      'workflows',
      'assets',
      'campaigns',
      'messages',
    ]);
  });

  it('gates /brand/campaigns and /brand/production in pathRailMode on campaignOps flag', () => {
    expect(pathRailMode('/brand/campaigns')).toBeNull();
    expect(pathRailMode('/brand/production')).toBeNull();
    expect(pathRailMode('/brand/campaigns', { campaignOps: false })).toBeNull();
    expect(pathRailMode('/brand/campaigns', { campaignOps: true })).toBe('team');
    expect(pathRailMode('/brand/campaigns?organizationId=a', { campaignOps: true })).toBe('team');
    expect(pathRailMode('/brand/production', { campaignOps: true })).toBe('team');
    expect(pathRailMode('/brand/production/sub', { campaignOps: true })).toBe('team');

    const groups = groupItems(
      railItems({ studio: true, creators: false, identity: false, rooms: true, campaignOps: true }),
      [],
    );
    expect(
      railModeSwitchTarget('/brand/studio/video', 'team', railModeItems(groups, 'team'), (id) => RAIL_HREF[id], {
        campaignOps: true,
      }),
    ).toBe('/brand/campaigns');
  });

  it('SF1 & SF2: marks nothing until track is known, marks the exact track via CampaignOpsTrackMarker (including /brand/projects/new), and keeps useSearchParams out of rail-nav.tsx', async () => {
    const railSrc = readFileSync('components/brand-workspace/rail-nav.tsx', 'utf8');
    expect(railSrc).not.toContain('useSearchParams');

    const opts = { campaignOps: true };
    // /brand itself is not in the rail when ops open -> marks nothing.
    expect(railActive('/brand/campaigns', '/brand', opts)).toBe(false);
    expect(railActive('/brand/production', '/brand', opts)).toBe(false);
    expect(railActive('/brand', '/brand', opts)).toBe(false);

    // Campaigns and production list routes.
    expect(railActive('/brand/campaigns', '/brand/campaigns', opts)).toBe(true);
    expect(railActive('/brand/production', '/brand/campaigns', opts)).toBe(false);
    expect(railActive('/brand/production', '/brand/production', opts)).toBe(true);
    expect(railActive('/brand/campaigns', '/brand/production', opts)).toBe(false);

    // SF1: when track is null (unknown yet), rooms/projects mark NOTHING so 제작 의뢰 never flickers from 캠페인.
    for (const p of ['/brand/projects/new', '/brand/rooms/p1', '/brand/projects/p1', '/brand/projects/p1/reports/r1']) {
      expect(railActive('/brand/campaigns', p, { campaignOps: true, track: null }), p).toBe(false);
      expect(railActive('/brand/production', p, { campaignOps: true, track: null }), p).toBe(false);
      expect(railActive('/brand/campaigns', p, { campaignOps: true, track: 'creator_campaign' }), p).toBe(true);
      expect(railActive('/brand/production', p, { campaignOps: true, track: 'creator_campaign' }), p).toBe(false);
      for (const prodTrack of ['studio_film', 'template_build', 'other'] as const) {
        expect(railActive('/brand/production', p, { campaignOps: true, track: prodTrack }), p).toBe(true);
        expect(railActive('/brand/campaigns', p, { campaignOps: true, track: prodTrack }), p).toBe(false);
      }
    }

    // Rendered rail updates when CampaignOpsTrackMarker mounts on /brand/projects/new and /brand/rooms/[id].
    for (const routePath of ['/brand/projects/new', '/brand/rooms/p-studio']) {
      state.path = routePath;
      const dom = await mountDom(
        <CampaignOpsTrackProvider>
          <CampaignOpsTrackMarker track="studio_film" />
          <WorkspaceNavigation
            {...labelsFor(ko)}
            scope={scopeOf(owner)}
            studioV2
            shell={ko.studioShell}
            locale="ko"
            rooms
            roomsCopy={ko.roomsShell.nav}
            homeLabel={ko.brandHome.nav.home}
            workspaceMenu={menuFor(ko)}
            campaignOpsOrgs={[ALPHA]}
            campaignOpsCopy={opsCopyFor(ko)}
          />
        </CampaignOpsTrackProvider>,
      );
      mounted.push(dom);
      expect(dom.query('[data-rail-item="production"]')?.getAttribute('aria-current'), routePath).toBe('page');
      expect(dom.query('[data-rail-item="opsCampaigns"]')?.getAttribute('aria-current'), routePath).toBeNull();
      await mounted.pop()!.unmount();
    }
  });
});

describe('WorkspaceNavigation with campaign ops switch open', () => {
  it.each(['ko', 'en'] as const)('renames the team mode and shows 홈 · 캠페인 · 제작 의뢰 · 알림함 · 에셋 in %s', (locale) => {
    const dict = locale === 'en' ? en : ko;
    state.path = '/brand/campaigns';
    const html = renderNav(owner, { locale, campaignOpsOrgs: [ALPHA] });
    expect(html).toContain('data-rail-mode="team"');
    expect(idsOf(html)).toEqual(['home', 'opsCampaigns', 'production', 'messages', 'assets']);
    expect(html).toContain(`>${dict.campaignOps.mode.label}<`);
    expect(html).toContain(`data-rail-tip="${dict.campaignOps.mode.label}"`);
    expect(html).not.toContain(`>${dict.roomsShell.nav.groupTeam}<`);
    expect(html).toContain(`href="/brand/campaigns?organizationId=${ALPHA}"`);
    expect(html).toContain(`href="/brand/production?organizationId=${ALPHA}"`);
    expect(html).not.toContain(`data-nav-item="/brand"`);
    expect(html).toContain(`>${dict.campaignOps.rail.campaigns}<`);
    expect(html).toContain(`>${dict.campaignOps.rail.production}<`);
  });

  it('gives a project_only brand (self_studio denied) the campaign ops rail when open', () => {
    state.path = '/brand/production';
    const html = renderNav({ ...owner, denied: ['self_studio'] }, { campaignOpsOrgs: [ALPHA] });
    expect(html).toContain('data-rail-mode="team"');
    expect(idsOf(html)).toEqual(['opsCampaigns', 'production', 'messages', 'assets']);
    expect(html).toContain(`>${ko.campaignOps.mode.label}<`);
    expect(html).toContain('data-rail-mode-switch="rail"');
  });

  it('keeps the original rail when the organization is not in campaignOpsOrgs', () => {
    state.path = '/brand';
    const html = renderNav(owner, { campaignOpsOrgs: [OTHER] });
    expect(idsOf(html)).toEqual(['home', 'campaigns', 'messages', 'assets']);
    expect(html).toContain(`>${ko.roomsShell.nav.groupTeam}<`);
    expect(html).not.toContain(ko.campaignOps.mode.label);
    expect(html).not.toContain('/brand/campaigns');
    expect(html).not.toContain('/brand/production');
  });

  const excludedChoices: Array<[string, BrandWorkspaceChoice]> = [
    ...[...SANDBOXED_CLIENT_ORG_IDS].map((id): [string, BrandWorkspaceChoice] => [
      `sandboxed id ${id}`,
      { id, name: 'Client brand', role: 'owner', logoUrl: null },
    ]),
    ['named Morphic Korea', { id: 'e0000000-0000-4000-8000-00000000000e', name: 'Morphic Korea', role: 'owner', logoUrl: null }],
    ['named 모픽', { id: 'e0000000-0000-4000-8000-0000000000e2', name: '모픽', role: 'editor', logoUrl: null }],
    ['generative_media denied', { id: 'd0000000-0000-4000-8000-00000000000d', name: 'Policy brand', role: 'owner', logoUrl: null, denied: ['generative_media'] }],
    ['project guest', { id: 'c0000000-0000-4000-8000-00000000000c', name: 'Guest brand', role: 'guest', logoUrl: null }],
    ['staff viewer (studio)', { id: 'f0000000-0000-4000-8000-00000000000f', name: 'Staff brand', role: 'studio', logoUrl: null }],
  ];

  it.each(excludedChoices)('Rule 2: never changes rail or leaks copy for %s even when listed', (_label, choice) => {
    for (const path of ['/brand', '/brand/library', '/brand/campaigns', '/brand/production']) {
      state.path = path;
      const off = renderNav(choice, { campaignOpsOrgs: undefined, withOpsCopy: false });
      const on = renderNav(choice, { campaignOpsOrgs: [choice.id], withOpsCopy: true });
      expect(on, path).toBe(off);
      expect(on).not.toContain(ko.campaignOps.mode.label);
      expect(on).not.toContain('/brand/campaigns');
      expect(on).not.toContain('/brand/production');
    }
  });

  it('Should-fix 4 & 6: computes campaignOpsOpenForViewer consistently across flags, roles, and exclusions', () => {
    const baseEnv = { BRAND_STUDIO_V2: 'on', BRAND_ROOMS: 'on', BRAND_CAMPAIGN_OPS: 'on', BRAND_CAMPAIGN_OPS_ORGS: ALPHA };
    expect(campaignOpsOpenForViewer(owner, baseEnv)).toBe(true);
    expect(campaignOpsOpenForViewer({ ...owner, role: 'editor' }, baseEnv)).toBe(true);
    expect(campaignOpsOpenForViewer({ ...owner, role: 'viewer' }, baseEnv)).toBe(true);
    expect(campaignOpsOpenForViewer({ ...owner, denied: ['self_studio'] }, baseEnv)).toBe(true);

    // Flags off
    expect(campaignOpsOpenForViewer(owner, { ...baseEnv, BRAND_STUDIO_V2: 'off' })).toBe(false);
    expect(campaignOpsOpenForViewer(owner, { ...baseEnv, BRAND_ROOMS: 'off' })).toBe(false);
    expect(campaignOpsOpenForViewer(owner, { ...baseEnv, BRAND_CAMPAIGN_OPS: 'off' })).toBe(false);
    expect(campaignOpsOpenForViewer(owner, { ...baseEnv, BRAND_CAMPAIGN_OPS_ORGS: OTHER })).toBe(false);

    // Excluded seats/orgs even with *
    const starEnv = { ...baseEnv, BRAND_CAMPAIGN_OPS_ORGS: '*' };
    for (const [, choice] of excludedChoices) {
      expect(campaignOpsOpenForViewer(choice, starEnv)).toBe(false);
    }
  });
});
