import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

class NotFoundSentinel extends Error {
  constructor() {
    super('NEXT_NOT_FOUND');
  }
}

const state = vi.hoisted(() => ({
  locale: 'ko' as 'ko' | 'en',
  scope: null as unknown as BrandWorkspaceScope,
  projects: [] as BrandProjectSummary[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/campaigns',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: () => {
    throw new NotFoundSentinel();
  },
}));

vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary: loadDict } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = loadDict(state.locale);
      return {
        viewer: { userId: '00000000-0000-4000-8000-000000000001', isAdmin: false },
        sql: { query: async () => ({ rows: [] }) },
        verifiedEmail: undefined,
        brandHost: true,
        locale: state.locale,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});

vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string } = {}): Promise<BrandWorkspace> => {
    const choice = state.scope.choices.find((c) => c.id === options.organizationId);
    return {
      organizations: choice && choice.role !== 'guest' && choice.role !== 'studio' ? [{ id: choice.id, name: choice.name, role: choice.role }] : [],
      projects: state.projects.filter((p) => p.organizationId === options.organizationId),
    };
  },
}));

import BrandCampaignsPage, { generateMetadata as campaignsMetadata } from '@/app/(brand)/brand/campaigns/page';
import BrandProductionPage, { generateMetadata as productionMetadata } from '@/app/(brand)/brand/production/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import { parseAllowedIntakeTrack } from '@/lib/brands/workspace/intake-brief';
import {
  INTAKE_DRAFT_KEY_PREFIX,
  ProjectIntakeWizard,
} from '@/components/brand-workspace/project-intake-wizard';

const ko = getDictionary('ko');
const en = getDictionary('en');

const ORG = 'a0000000-0000-4000-8000-00000000000a';
const OTHER = 'b0000000-0000-4000-8000-00000000000b';

const baseProject = (
  id: string,
  over: Partial<BrandProjectSummary> = {},
): BrandProjectSummary => ({
  id,
  organizationId: ORG,
  organizationName: 'Alpha fixture',
  title: `Project ${id.slice(0, 4)}`,
  objective: 'Fixture brief',
  audience: '',
  budgetKrw: null,
  budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: '2026-11-15',
  endsOn: '2026-11-30',
  productionMode: 'studio',
  status: 'active',
  revision: 1,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
  ...over,
});

const intakeBriefFor = (track: 'creator_campaign' | 'template_build' | 'studio_film' | 'other') => ({
  version: 1 as const,
  track,
  summary: 'Fixture goal summary',
  briefText: '',
  briefFileNames: [],
  briefAttachmentIds: [],
  studioAssetIds: [],
  deliverables: { kind: '', duration: '', aspectRatios: [], quantity: null, channels: [] },
  schedule: { startsOn: null, dueOn: null },
  budgetBand: 'undecided' as const,
  contact: { name: 'Contact', channel: 'email' as const, value: 'brand@example.test', approver: '' },
});

const renderCampaigns = async (organizationId = ORG) =>
  renderToStaticMarkup((await BrandCampaignsPage({ searchParams: Promise.resolve({ organizationId }) })) as ReactElement);

const renderProduction = async (organizationId = ORG) =>
  renderToStaticMarkup((await BrandProductionPage({ searchParams: Promise.resolve({ organizationId }) })) as ReactElement);

const mounted: MountedDom[] = [];

beforeEach(() => {
  state.locale = 'ko';
  state.scope = {
    choices: [{ id: ORG, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] }],
    projectOrganizations: {},
  };
  state.projects = [];
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!.unmount();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('campaign ops pages: Rule 1 closed switch & Rule 2 excluded seats/orgs', () => {
  it('returns 404 when BRAND_CAMPAIGN_OPS, BRAND_ROOMS, BRAND_STUDIO_V2 is off or org is unlisted', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'off');
    await expect(renderCampaigns()).rejects.toBeInstanceOf(NotFoundSentinel);
    await expect(renderProduction()).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(await campaignsMetadata({ searchParams: Promise.resolve({ organizationId: ORG }) })).toEqual({});

    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', OTHER);
    await expect(renderCampaigns()).rejects.toBeInstanceOf(NotFoundSentinel);
    await expect(renderProduction()).rejects.toBeInstanceOf(NotFoundSentinel);

    vi.stubEnv('BRAND_ROOMS', 'off');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', '*');
    await expect(renderCampaigns()).rejects.toBeInstanceOf(NotFoundSentinel);
    await expect(renderProduction()).rejects.toBeInstanceOf(NotFoundSentinel);

    // Should-fix 4: closed when BRAND_STUDIO_V2 is off (rail has no switch).
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    await expect(renderCampaigns()).rejects.toBeInstanceOf(NotFoundSentinel);
    await expect(renderProduction()).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(await campaignsMetadata({ searchParams: Promise.resolve({ organizationId: ORG }) })).toEqual({});
  });

  const excludedCases: Array<[string, BrandWorkspaceChoice]> = [
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

  it.each(excludedCases)('Rule 2: returns 404 on both routes for %s even when switch is open for *', async (_label, choice) => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', '*');
    state.scope = { choices: [choice], projectOrganizations: {} };
    await expect(renderCampaigns(choice.id)).rejects.toBeInstanceOf(NotFoundSentinel);
    await expect(renderProduction(choice.id)).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(await campaignsMetadata({ searchParams: Promise.resolve({ organizationId: choice.id }) })).toEqual({});
    expect(await productionMetadata({ searchParams: Promise.resolve({ organizationId: choice.id }) })).toEqual({});
  });

  it('allows project_only owner (self_studio denied) when rooms and switch are open', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', ORG);
    state.scope = {
      choices: [{ id: ORG, name: 'Project only brand', role: 'owner', logoUrl: null, denied: ['self_studio'] }],
      projectOrganizations: {},
    };
    const html = await renderCampaigns();
    expect(html).toContain('data-campaign-ops-page="campaigns"');
    expect(html).toContain('data-state="before"');
  });
});

describe('campaign ops pages: before/after states, track split, role CTA, and production labels', () => {
  beforeEach(() => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', ORG);
  });

  it('renders before state when viewer has no matching items, even if items of the other track exist', async () => {
    // Only a studio_film exists: campaigns is still `before`, while production is `after`.
    state.projects = [baseProject('20000000-0000-4000-8000-000000000002', { title: 'Film Only', productionMode: 'studio' })];

    const cHtml = await renderCampaigns();
    expect(cHtml).toContain('data-campaign-ops-page="campaigns"');
    expect(cHtml).toContain('data-state="before"');
    expect(cHtml).toContain(ko.campaignOps.campaigns.lead);
    expect(cHtml).toContain(ko.campaignOps.campaigns.hero.body);
    expect(cHtml).toContain(ko.campaignOps.campaigns.how.title);
    expect(cHtml).toContain('data-process-stage');
    expect(cHtml).toContain(`href="/brand/projects/new?track=creator_campaign&amp;start=ops&amp;organizationId=${ORG}"`);
    expect(cHtml).not.toContain('Film Only');

    const pHtml = await renderProduction();
    expect(pHtml).toContain('data-campaign-ops-page="production"');
    expect(pHtml).toContain('data-state="after"');
    expect(pHtml).toContain('Film Only');
    expect(pHtml).toContain(`href="/brand/projects/new?track=studio_film&amp;start=ops&amp;organizationId=${ORG}"`);
  });

  it('splits items strictly by track and shows track labels on production cards only', async () => {
    state.projects = [
      baseProject('10000000-0000-4000-8000-000000000001', {
        title: 'Creator Launch',
        productionMode: 'creator',
        intakeBrief: intakeBriefFor('creator_campaign'),
      }),
      baseProject('20000000-0000-4000-8000-000000000002', {
        title: 'Template Order',
        productionMode: 'studio',
        intakeBrief: intakeBriefFor('template_build'),
      }),
      baseProject('30000000-0000-4000-8000-000000000003', {
        title: 'Brand Film',
        productionMode: 'studio',
        intakeBrief: intakeBriefFor('studio_film'),
      }),
      baseProject('40000000-0000-4000-8000-000000000004', {
        title: 'Retainer Custom',
        productionMode: 'studio',
        intakeBrief: intakeBriefFor('other'),
        status: 'cancelled',
      }),
    ];

    const cHtml = await renderCampaigns();
    expect(cHtml).toContain('Creator Launch');
    expect(cHtml).not.toContain('Template Order');
    expect(cHtml).not.toContain('Brand Film');
    expect(cHtml).not.toContain('Retainer Custom');
    expect(cHtml).not.toContain('data-project-track-label');
    expect(cHtml).toContain(`href="/brand/rooms/10000000-0000-4000-8000-000000000001?organizationId=${ORG}"`);

    const pHtml = await renderProduction();
    expect(pHtml).not.toContain('Creator Launch');
    expect(pHtml).toContain('Template Order');
    expect(pHtml).toContain('Brand Film');
    expect(pHtml).toContain('Retainer Custom');
    expect(pHtml).toContain(` · ${ko.roomsShell.room.tracks.template_build}`);
    expect(pHtml).toContain(` · ${ko.roomsShell.room.tracks.studio_film}`);
    expect(pHtml).toContain(` · ${ko.roomsShell.room.tracks.other}`);
    expect(pHtml).toContain(`href="/brand/rooms/20000000-0000-4000-8000-000000000002?organizationId=${ORG}"`);
  });

  it('treats completed or cancelled items as after state', async () => {
    state.projects = [
      baseProject('10000000-0000-4000-8000-000000000001', {
        title: 'Past Campaign',
        productionMode: 'creator',
        status: 'completed',
      }),
    ];
    const html = await renderCampaigns();
    expect(html).toContain('data-state="after"');
    expect(html).toContain('Past Campaign');
  });

  it('shows the start CTA for owner and editor, and hides it for viewer in both states', async () => {
    for (const role of ['owner', 'editor'] as const) {
      state.scope = { choices: [{ id: ORG, name: 'Alpha fixture', role, logoUrl: null }], projectOrganizations: {} };
      state.projects = [];
      expect(await renderCampaigns()).toContain('data-campaign-ops-start');
      state.projects = [baseProject('10000000-0000-4000-8000-000000000001', { productionMode: 'creator' })];
      expect(await renderCampaigns()).toContain('data-campaign-ops-start');
    }

    state.scope = { choices: [{ id: ORG, name: 'Alpha fixture', role: 'viewer', logoUrl: null }], projectOrganizations: {} };
    state.projects = [];
    const beforeViewer = await renderCampaigns();
    expect(beforeViewer).toContain('data-state="before"');
    expect(beforeViewer).not.toContain('data-campaign-ops-start');
    expect(beforeViewer).not.toContain(ko.campaignOps.campaigns.hero.cta);

    state.projects = [baseProject('10000000-0000-4000-8000-000000000001', { productionMode: 'creator' })];
    const afterViewer = await renderCampaigns();
    expect(afterViewer).toContain('data-state="after"');
    expect(afterViewer).not.toContain('data-campaign-ops-start');
  });

  it('renders English copy cleanly when request locale is en', async () => {
    state.locale = 'en';
    const cHtml = await renderCampaigns();
    expect(cHtml).toContain(en.campaignOps.rail.campaigns);
    expect(cHtml).toContain(en.campaignOps.campaigns.lead);
    expect(cHtml).toContain(en.campaignOps.campaigns.how.example);
  });
});

describe('intake wizard preselected track validation', () => {
  it('validates allowed tracks and ignores unknown or disallowed tracks', () => {
    expect(parseAllowedIntakeTrack('creator_campaign', true)).toBe('creator_campaign');
    expect(parseAllowedIntakeTrack('studio_film', false)).toBe('studio_film');
    expect(parseAllowedIntakeTrack('other', false)).toBe('other');
    expect(parseAllowedIntakeTrack('template_build', true)).toBe('template_build');
    expect(parseAllowedIntakeTrack('template_build', false)).toBeNull();
    expect(parseAllowedIntakeTrack('made_up_track', true)).toBeNull();
    expect(parseAllowedIntakeTrack(['creator_campaign'], true)).toBeNull();
    expect(parseAllowedIntakeTrack(undefined, true)).toBeNull();
  });

  it('B3 guard: server page app/(brand)/brand/projects/new/page.tsx imports from use-client modules only what it renders as JSX, and renders cleanly', async () => {
    const filePath = 'app/(brand)/brand/projects/new/page.tsx';
    const pageSrc = readFileSync(filePath, 'utf8');
    const sf = ts.createSourceFile(filePath, pageSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const clientIdentifiers = new Map<string, string>();

    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      const mod = stmt.moduleSpecifier.text;
      if (!mod.startsWith('@/')) continue;
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const rel = mod.slice(2);
      const candidates = [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`, `${rel}/index.tsx`];
      const target = candidates.find((p) => {
        try {
          readFileSync(p, 'utf8');
          return true;
        } catch {
          return false;
        }
      });
      expect(target, mod).toBeTruthy();
      const targetSf = ts.createSourceFile(target!, readFileSync(target!, 'utf8'), ts.ScriptTarget.Latest, true);
      const firstStmt = targetSf.statements[0];
      const isClientModule =
        firstStmt !== undefined &&
        ts.isExpressionStatement(firstStmt) &&
        ts.isStringLiteral(firstStmt.expression) &&
        firstStmt.expression.text === 'use client';
      if (!isClientModule) continue;

      if (clause.name) clientIdentifiers.set(clause.name.text, mod);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          clientIdentifiers.set(clause.namedBindings.name.text, mod);
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            if (!el.isTypeOnly) clientIdentifiers.set(el.name.text, mod);
          }
        }
      }
    }

    // Every non-type reference to a use-client binding must ONLY be a JSX opening/self-closing tagName.
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isIdentifier(node) && clientIdentifiers.has(node.text)) {
        const parent = node.parent;
        const isJsxTag =
          (ts.isJsxOpeningElement(parent) && parent.tagName === node) ||
          (ts.isJsxClosingElement(parent) && parent.tagName === node) ||
          (ts.isJsxSelfClosingElement(parent) && parent.tagName === node);
        expect(isJsxTag, `${node.text} from ${clientIdentifiers.get(node.text)} used outside JSX tag`).toBe(true);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    vi.stubEnv('BRAND_ROOMS', 'on');
    const html = renderToStaticMarkup(
      (await NewBrandProject({
        searchParams: Promise.resolve({ organizationId: ORG, track: 'studio_film' }),
      })) as ReactElement,
    );
    expect(html).toContain('data-intake-track="studio_film"');
  });

  it('B2 + Note A: keeps saved draft winning without start=ops, isolates :ops:<track> draft without dead ends, and cleans up ops entries', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');

    const baseKey = `${INTAKE_DRAFT_KEY_PREFIX}${ORG}`;
    const opsCampaignKey = `${baseKey}:ops:creator_campaign`;
    const stored = new Map<string, string>([
      [baseKey, JSON.stringify({ track: 'studio_film', title: 'Saved Film Draft' })],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
      clear: () => stored.clear(),
    });

    // Without start=ops (including existing ?track= links from studio/marketing), saved draft wins.
    for (const incomingTrack of ['creator_campaign', 'template_build', 'studio_film'] as const) {
      const domMain = await mountDom(
        <ProjectIntakeWizard
          copy={ko.intakeBrief}
          organizations={[{ id: ORG, name: 'Alpha fixture' }]}
          initialTrack={incomingTrack}
          initialAssets={[]}
        />,
      );
      mounted.push(domMain);
      expect(domMain.query('[data-intake-track="studio_film"]')?.getAttribute('aria-checked')).toBe('true');
      expect((domMain.query('[data-intake-title]') as { value?: string } | null)?.value).toBe('Saved Film Draft');
      await mounted.pop()!.unmount();
    }

    // With start=ops + switch closed: server page does NOT pass opsStart and keeps raw track parity.
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'off');
    const closedEl = (await NewBrandProject({
      searchParams: Promise.resolve({ organizationId: ORG, track: 'not_real', start: 'ops' }),
    })) as ReactElement<{ children?: ReactElement[] }>;
    expect(JSON.stringify(closedEl)).not.toContain('track-context');
    expect(JSON.stringify(closedEl)).not.toContain('"opsStart"');

    // With start=ops + switch open: starts a fresh campaign draft under :ops: without touching main draft.
    const beforeOpsRaw = stored.get(baseKey)!;
    const domOps = await mountDom(
      <ProjectIntakeWizard
        copy={ko.intakeBrief}
        organizations={[{ id: ORG, name: 'Alpha fixture' }]}
        initialTrack="creator_campaign"
        opsStart
        initialAssets={[]}
      />,
    );
    mounted.push(domOps);
    expect(domOps.query('[data-intake-track="creator_campaign"]')?.getAttribute('aria-checked')).toBe('true');
    expect(domOps.query('[data-intake-track="studio_film"]')?.getAttribute('aria-checked')).toBe('false');
    expect((domOps.query('[data-intake-title]') as { value?: string } | null)?.value).toBe('');
    await domOps.setValue('[data-intake-title]', 'Fresh Ops Campaign');
    expect(stored.get(baseKey)).toBe(beforeOpsRaw);
    expect(JSON.parse(stored.get(opsCampaignKey)!)).toMatchObject({
      track: 'creator_campaign',
      title: 'Fresh Ops Campaign',
    });

    // Note A: even if the main draft later disappears, start=ops still reads :ops:creator_campaign (no dead end).
    await mounted.pop()!.unmount();
    stored.delete(baseKey);
    const domOpsAfterGone = await mountDom(
      <ProjectIntakeWizard
        copy={ko.intakeBrief}
        organizations={[{ id: ORG, name: 'Alpha fixture' }]}
        initialTrack="creator_campaign"
        opsStart
        initialAssets={[]}
      />,
    );
    mounted.push(domOpsAfterGone);
    expect((domOpsAfterGone.query('[data-intake-title]') as { value?: string } | null)?.value).toBe('Fresh Ops Campaign');
    await mounted.pop()!.unmount();

    // Note A: if the main draft later matches creator_campaign, start=ops uses main and removes the :ops: entry.
    stored.set(baseKey, JSON.stringify({ track: 'creator_campaign', title: 'Main Campaign Draft' }));
    const domMatched = await mountDom(
      <ProjectIntakeWizard
        copy={ko.intakeBrief}
        organizations={[{ id: ORG, name: 'Alpha fixture' }]}
        initialTrack="creator_campaign"
        opsStart
        initialAssets={[]}
      />,
    );
    mounted.push(domMatched);
    expect((domMatched.query('[data-intake-title]') as { value?: string } | null)?.value).toBe('Main Campaign Draft');
    expect(stored.has(opsCampaignKey)).toBe(false);
    await mounted.pop()!.unmount();

    // Note A: clearing the main draft on a normal visit also sweeps any leftover :ops: entries.
    stored.set(baseKey, beforeOpsRaw);
    stored.set(opsCampaignKey, JSON.stringify({ track: 'creator_campaign', title: 'Leftover Ops' }));
    const domClearMain = await mountDom(
      <ProjectIntakeWizard
        copy={ko.intakeBrief}
        organizations={[{ id: ORG, name: 'Alpha fixture' }]}
        initialTrack="creator_campaign"
        initialAssets={[]}
      />,
    );
    mounted.push(domClearMain);
    expect((domClearMain.query('[data-intake-title]') as { value?: string } | null)?.value).toBe('Saved Film Draft');
    await domClearMain.click('[data-intake-clear-draft]');
    expect(stored.has(baseKey)).toBe(false);
    expect(stored.has(opsCampaignKey)).toBe(false);
  });
});
