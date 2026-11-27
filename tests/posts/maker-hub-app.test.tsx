import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  renderStatus: 'succeeded' as string,
  renderMedium: 'video' as 'video' | 'image',
  approvedCreator: true,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => undefined,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { notFound: true });
  },
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
}));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => ({
    tier: 'free',
    userId: 'f0000000-0000-4000-8000-000000000001',
    email: null,
    isAdmin: false,
    locale: 'ko',
  }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({
  getLocaleFromHeaders: async () => 'ko',
  getRequestLocale: async () => 'ko',
}));
vi.mock('@/components/app/app-header', () => ({ AppHeader: () => null }));
vi.mock('@/components/renders/auto-refresh', () => ({ AutoRefresh: () => null }));
vi.mock('@/components/notify/notify-choice', () => ({ NotifyChoice: () => null }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: vi.fn() }));
vi.mock('@/lib/renders/feedback', () => ({
  FEEDBACK_REASONS: ['face', 'playback', 'mismatch', 'other'],
  loadRenderFeedback: async () => null,
}));
vi.mock('@/lib/renders/extras', () => ({
  loadRenderExtras: async () => ({ ready: true, finishingAt: null, posterKey: 'p' }),
}));
vi.mock('@/lib/renders/frames', () => ({ loadRenderFrames: async () => [] }));
vi.mock('@/lib/renders/service', () => ({
  failureReason: () => 'reason',
  loadOwnRender: async () => ({
    templateTitle: 'Demo film',
    templateTitleKo: '데모 영상',
    job: {
      id: '22222222-2222-4222-8222-222222222222',
      status: state.renderStatus,
      medium: state.renderMedium,
      aspect: '9:16',
      templateSlug: 'demo-film',
      createdAt: '2026-11-20T00:00:00.000Z',
      finishedAt: '2026-11-20T00:02:00.000Z',
      providerTaskId: null,
      resultMime: state.renderMedium === 'video' ? 'video/mp4' : 'image/jpeg',
      shareToken: null,
      shareExpiresAt: null,
      errorCode: null,
    },
  }),
}));
vi.mock('@/lib/creator-platform/runtime', () => ({
  platformAccess: async () => ({ ready: true, community: false, creators: true, rewards: false, onboarding: true, applications: false }),
}));
vi.mock('@/lib/creator-platform/service', async (orig) => ({
  ...(await orig<typeof import('@/lib/creator-platform/service')>()),
  approvedCreator: async () => state.approvedCreator,
}));
vi.mock('@/lib/makers/self-activate', () => ({ openMakerEnabled: async () => true }));
vi.mock('@/lib/creator-platform/onboarding', () => ({
  loadCreatorWorkspace: async () => ({
    onboarding: true,
    application: null,
    creator: { active: true, contractVersion: 'open-maker', registeredAt: '2026-11-01T00:00:00.000Z' },
    formats: [],
    earnings: [],
  }),
}));
vi.mock('@/lib/recipes/repo', () => ({ recipeSchemaReady: async () => true }));
vi.mock('@/lib/makers/profile', async (orig) => ({
  ...(await orig<typeof import('@/lib/makers/profile')>()),
  loadMakerSettings: async () => ({
    handle: 'alpha_demo',
    bio: null,
    publicProfile: false,
    displayName: 'Demo Artist A',
    headline: null,
    country: null,
    city: null,
    links: [],
    publicEmail: null,
    tools: [],
    openToBrands: false,
    avatarVersion: null,
    coverVersion: null,
    coverReady: false,
    extended: true,
  }),
}));
vi.mock('@/lib/makers/works', () => ({ listMakerWorks: async () => [] }));
vi.mock('@/lib/makers/tokens', () => ({ listMakerTokens: async () => [] }));
vi.mock('@/lib/makers/stats', () => ({ makerStats: async () => [] }));
vi.mock('@/lib/posts/service', () => ({
  listMakerPostsForWorkspace: async () => [],
}));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ origin: 'https://twings.app' }),
}));

import RenderPage from '@/app/(app)/renders/[id]/page';
import CreatorWorkspacePage from '@/app/(app)/creators/workspace/page';

describe('Maker Hub Phase 1 — app routes (render result & workspace)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    state.renderStatus = 'succeeded';
    state.renderMedium = 'video';
    state.approvedCreator = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds a quiet write-post link on render results only for active AI creatives when TWINGS_MAKER_BLOG is on', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'off');
    const offHtml = renderToStaticMarkup(
      await RenderPage({ params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }) }),
    );
    expect(offHtml).not.toContain('data-result-write-post');
    expect(offHtml).not.toContain('/creators/workspace/posts/new');

    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    state.approvedCreator = false;
    const customerHtml = renderToStaticMarkup(
      await RenderPage({ params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }) }),
    );
    expect(customerHtml).not.toContain('data-result-write-post');
    expect(customerHtml).not.toContain('/creators/workspace/posts/new');

    state.approvedCreator = true;
    const makerHtml = renderToStaticMarkup(
      await RenderPage({ params: Promise.resolve({ id: '22222222-2222-4222-8222-222222222222' }) }),
    );
    expect(makerHtml).toContain('data-result-write-post');
    expect(makerHtml).toContain('href="/creators/workspace/posts/new"');
    expect(makerHtml).toContain('글 쓰기');
    expect(makerHtml).not.toContain('이 영상으로');
  });

  it('places the blog section and write action near the top of the workspace right after template actions', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    const html = renderToStaticMarkup(
      await CreatorWorkspacePage({ searchParams: Promise.resolve({}) }),
    );
    const submitIdx = html.indexOf('id="submit"');
    const blogIdx = html.indexOf('data-creative-blog');
    const profileIdx = html.indexOf('data-maker-profile-settings');
    expect(submitIdx).toBeGreaterThan(-1);
    expect(blogIdx).toBeGreaterThan(submitIdx);
    expect(profileIdx).toBeGreaterThan(blogIdx);
    expect(html).toContain('data-creative-blog-new');
    expect(html).toContain('href="/creators/workspace/posts/new"');
  });
});
