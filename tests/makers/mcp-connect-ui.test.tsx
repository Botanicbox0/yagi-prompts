import { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mock = vi.hoisted(() => ({
  workspace: vi.fn(),
  access: vi.fn(),
  openMaker: vi.fn(),
  maker: vi.fn(),
}));

vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => ({ tier: 'free', userId: 'f0000000-0000-4000-8000-000000000001', email: null, isAdmin: false, locale: 'ko' }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({ query: async () => ({ rows: [{ ready: true }] }) }) }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/creator-platform/runtime', () => ({ platformAccess: mock.access }));
vi.mock('@/lib/makers/self-activate', () => ({ openMakerEnabled: mock.openMaker }));
vi.mock('@/lib/creator-platform/onboarding', () => ({ loadCreatorWorkspace: mock.workspace }));
vi.mock('@/lib/recipes/repo', () => ({ recipeSchemaReady: async () => true }));
vi.mock('@/components/app/app-header', () => ({ AppHeader: () => null }));
vi.mock('@/lib/makers/profile', async (original) => ({
  ...(await original<typeof import('@/lib/makers/profile')>()),
  loadMakerSettings: mock.maker,
}));
vi.mock('@/lib/makers/works', () => ({ listMakerWorks: async () => [], WorkError: Error }));
vi.mock('@/lib/makers/tokens', () => ({ listMakerTokens: async () => [], MAKER_TOKENS_MAX: 5 }));
vi.mock('@/lib/makers/stats', () => ({ makerStats: async () => [] }));
vi.mock('@/lib/routing/request-surface', () => ({ requestSurface: async () => ({ origin: 'http://localhost:3000' }) }));

import CreatorWorkspacePage from '@/app/(app)/creators/workspace/page';
import { McpConnect } from '@/components/creators/creative-studio';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

describe('McpConnect 3-step studio panel', () => {
  beforeEach(() => {
    mock.access.mockResolvedValue({ ready: true, community: false, creators: false, rewards: false, onboarding: true, applications: false });
    mock.openMaker.mockResolvedValue(true);
    mock.maker.mockResolvedValue({
      handle: 'test_maker',
      bio: null,
      publicProfile: false,
      displayName: null,
      headline: null,
      country: null,
      city: null,
      links: [],
      publicEmail: null,
      tools: [],
      openToBrands: false,
      avatarVersion: null,
      coverVersion: null,
      coverReady: true,
      extended: true,
    });
    mock.workspace.mockResolvedValue({
      onboarding: true,
      application: null,
      creator: { active: true, contractVersion: 'owl-p-v1', registeredAt: '2026-11-26T00:00:00.000Z' },
      formats: [],
      earnings: [],
    });
  });

  it('renders 3 steps, client tabs, and 3 example prompts in ko and en without internal jargon', () => {
    for (const [locale, dict] of [['ko', ko], ['en', en]] as const) {
      const html = renderToStaticMarkup(createElement(McpConnect, {
        initial: [],
        endpoint: 'http://localhost:3000/api/mcp',
        locale,
        copy: dict.creatorProgram.connect,
      }));
      expect(html).toContain('data-mcp-step="1"');
      expect(html).toContain('data-mcp-step="2"');
      expect(html).toContain('data-mcp-step="3"');
      expect(html).toContain('data-mcp-client="claude"');
      expect(html).toContain('data-mcp-client="cursor"');
      expect(html).toContain('data-mcp-client="codex"');
      expect(html).toContain('data-mcp-example="1"');
      expect(html).toContain('data-mcp-example="2"');
      expect(html).toContain('data-mcp-example="3"');
      expect(html).toContain(dict.creatorProgram.connect.examples.draft);
      expect(html).not.toMatch(/RECIPE V2|TWINGS_FORMAT_CREATORS|platform_formats|Higgsfield|①/i);
    }
  });

  it('exposes the MCP connect panel on /creators/workspace for one-check activated creators even when TWINGS_FORMAT_CREATORS is off', async () => {
    const html = renderToString(await CreatorWorkspacePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('data-creator-state="approved"');
    expect(html).toContain('data-creative-connect');
    expect(html).toContain('data-mcp-step="1"');
    expect(html).toContain('data-mcp-step="2"');
    expect(html).toContain('data-mcp-step="3"');
    expect(html).toContain(ko.creatorProgram.connect.step1Title);
    expect(html).toContain(ko.creatorProgram.connect.step2Title);
    expect(html).toContain(ko.creatorProgram.connect.step3Title);
  });
});
