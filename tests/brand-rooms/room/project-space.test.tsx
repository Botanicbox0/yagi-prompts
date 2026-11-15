import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';

/**
 * docs/BRAND-CLIENT-WORK.md §4 B — the project space speaks of projects, not campaigns, while rooms are
 * open for the brand; with rooms closed the list is the campaign list it always was. Rendered from the
 * real `/brand` page with the data layer stubbed.
 */
const ONLY = 'b0000000-0000-4000-8000-00000000000b';
const PLAIN = 'a0000000-0000-4000-8000-00000000000a';
const P1 = 'b1000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  scope: null as unknown as BrandWorkspaceScope,
  projects: [] as BrandProjectSummary[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      return { viewer: { userId: USER }, sql: { query: async () => ({ rows: [] }) }, verifiedEmail: undefined, brandHost: true, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});
vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string } = {}): Promise<BrandWorkspace> => {
    const choice = state.scope.choices.find((c) => c.id === options.organizationId);
    return {
      organizations: choice ? [{ id: choice.id, name: choice.name, role: 'owner' }] : [],
      projects: state.projects.filter((p) => p.organizationId === options.organizationId),
    };
  },
}));

import BrandHome from '@/app/(brand)/brand/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import { getDictionary } from '@/lib/i18n/dictionaries';

const ko = getDictionary('ko');
const sp = ko.roomsShell.space;
const b = ko.brandWorkspace;
const choice = (id: string, name: string, denied: string[] = []): BrandWorkspaceChoice => ({ id, name, role: 'owner', logoUrl: null, denied: denied as never });
const summary = (id: string, organizationId: string): BrandProjectSummary => ({
  id, organizationId, organizationName: 'x', title: '봄 신제품 영상', objective: 'Fixture', audience: '', budgetKrw: null, budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: null, endsOn: null, productionMode: 'studio', status: 'requested', revision: 1, createdAt: '2026-11-15', updatedAt: '2026-11-15',
});
const home = async (organizationId: string) => renderToStaticMarkup((await BrandHome({ searchParams: Promise.resolve({ organizationId }) })) as ReactElement);

beforeEach(() => {
  state.scope = { choices: [choice(ONLY, 'Commission client', ['self_studio']), choice(PLAIN, 'Plain brand')], projectOrganizations: { [P1]: ONLY } };
  state.projects = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('the project space for a commission-only brand (rooms open)', () => {
  it('has one empty state with one headline, one sentence and the same "새 프로젝트 의뢰" action, and no campaign guide', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const html = await home(ONLY);
    expect(html).toContain('data-brand-empty="request"');
    expect(html).toContain(sp.empty.title);
    expect(html).toContain(sp.empty.body);
    expect(html).not.toContain(b.empty);
    expect(html).not.toContain(`>${b.newProject}<`);
    expect(html.split(`>${sp.newBrief}<`).length - 1).toBe(2); // the header and the empty card, same words
    expect(html).not.toContain('data-brand-service-disclosure');
    expect(html).not.toContain(b.dashboard.serviceGuideToggle);
  });

  it('lists projects in project words, hides the always-empty recent section, and keeps one short retention line', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    state.projects = [summary(P1, ONLY)];
    const html = await home(ONLY);
    expect(html).toContain(sp.list.all);
    expect(html).toContain(sp.list.resultCount.replace('{count}', '1'));
    expect(html).toContain(`placeholder="${sp.list.searchPlaceholder}"`);
    expect(html).toContain(sp.list.search);
    for (const campaignWord of [b.performance.allCampaigns, b.dashboard.searchPlaceholder, b.dashboard.recentNote]) expect(html).not.toContain(campaignWord);
    expect(html).not.toContain('data-home-recent');
    expect(html).toContain('data-project-only-retention-notice');
    expect(html).toContain(sp.retentionNotice);
    expect(sp.retentionNotice).not.toContain('안내 ·');
    expect(sp.retentionNotice).toContain('90일');
  });
});

describe('the commission form', () => {
  const form = async (organizationId: string) =>
    renderToStaticMarkup((await NewBrandProject({ searchParams: Promise.resolve({ organizationId }) })) as ReactElement);

  it('leads back to 프로젝트 while rooms are open, and to the campaign list otherwise', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    expect(await form(ONLY)).toContain(`← ${ko.roomsShell.room.back}</a>`);
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect(await form(ONLY)).toContain(`← ${b.back}</a>`);
  });
});

describe('outside a commission-only project space', () => {
  it('keeps the campaign guide for a brand whose studio is open, while the list still speaks of projects', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    state.projects = [{ ...summary(P1, PLAIN) }];
    const html = await home(PLAIN);
    expect(html).toContain('data-brand-service-disclosure');
    expect(html).toContain(sp.list.all);
  });

  it('is the campaign list it always was with rooms closed', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    state.projects = [summary(P1, ONLY)];
    const html = await home(ONLY);
    expect(html).toContain(b.performance.allCampaigns);
    expect(html).toContain(`placeholder="${b.dashboard.searchPlaceholder}"`);
    expect(html).toContain('data-home-recent');
    expect(html).toContain('data-brand-service-disclosure');
    expect(html).not.toContain(sp.list.all);
  });
});
