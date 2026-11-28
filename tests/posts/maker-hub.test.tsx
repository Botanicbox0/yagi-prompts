import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import type { MakerWork } from '@/lib/makers/works';
import type { PublicFeedPost, PublicPostSummary } from '@/lib/posts/public';

const state = vi.hoisted(() => ({
  makers: [] as PublicMaker[],
  video: [] as PromptCard[],
  image: [] as PromptCard[],
  works: [] as MakerWork[],
  feed: [] as PublicFeedPost[],
  postCounts: {} as Record<string, number>,
  postsByHandle: {} as Record<string, PublicPostSummary[]>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
  unstable_cache: <T,>(fn: T) => fn,
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { notFound: true });
  },
  permanentRedirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
  usePathname: () => '/ko/blog',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/app/actions/locale', () => ({
  setLocaleAction: async () => undefined,
}));
vi.mock('@/lib/prompts/public-catalog', () => ({
  getPromptCatalog: async () => ({
    yagi: [],
    community: [],
    video: state.video,
    image: state.image,
    makers: state.makers,
    totals: { yagi: 0, community: 0, published: state.video.length + state.image.length, useCases: [], modelLabel: '' },
  }),
}));
vi.mock('@/lib/makers/cached-public', () => ({
  cachedPublicWorks: async () => state.works,
}));
vi.mock('@/lib/posts/cached-public', () => ({
  cachedPublicBlogFeed: async () => state.feed,
  cachedPublicPostCountsByHandle: async () => state.postCounts,
  cachedPublicPostsByHandle: async (handle: string) => state.postsByHandle[handle] ?? [],
  cachedPublicPostCount: async (handle: string) => (state.postsByHandle[handle] ?? []).length,
}));

import { ko, KO_TERMS } from '@/messages/ko';
import { en } from '@/messages/en';
import { audienceNavigation } from '@/lib/navigation/audience';
import { formatPostDate } from '@/lib/i18n/format';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { CreatorAccountView, type CreatorAccountLabels } from '@/components/nav/creator-account';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels } from '@/components/prompts/labels';
import { bottomTabItems } from '@/components/app/bottom-tabs';
import { blogFeedHref } from '@/lib/posts/links';
import { makersDirectoryHref } from '@/lib/makers/links';
import { sortDirectoryMakers } from '@/lib/makers/directory';
import {
  countPublicPostsByAllHandles,
  listPublicBlogFeed,
  splitFeaturedFeedPost,
} from '@/lib/posts/public';
import { publishChecklistItems } from '@/lib/posts/editor-helpers';
import { adminHidePost, publishMakerPost, saveMakerPost } from '@/lib/posts/service';
import { saveMakerProfile } from '@/lib/makers/profile';
import { activateOpenMaker } from '@/lib/makers/self-activate';
import { storeMakerWork } from '@/lib/makers/works';
import { createLocalRenderStore } from '@/lib/renders/store';
import { buildSitemap } from '@/lib/seo/sitemap';
import { PostEditor } from '@/components/posts/post-editor';
import { MakerBlogEmptyOwnerCta, MakerProfileOwnerActions } from '@/components/makers/owner-actions';
import { publishMakerSession, resetMakerSessionStore } from '@/lib/makers/session-store';
import BlogFeedPage, {
  generateMetadata as blogFeedMetadata,
  revalidate as blogFeedRevalidate,
} from '@/app/(marketing)/[locale]/blog/page';
import MakersDirectoryPage, {
  generateMetadata as makersDirMetadata,
  revalidate as makersDirRevalidate,
} from '@/app/(marketing)/[locale]/makers/page';
import MakerPage from '@/app/(marketing)/[locale]/makers/[handle]/page';
import MakerBlogListPage from '@/app/(marketing)/[locale]/makers/[handle]/blog/page';
import { promptHarness, type PromptHarness } from '@/tests/helpers/prompts';
import { ADMIN_VIEWER, viewerOf } from '@/tests/helpers/admin';
import sharp from 'sharp';

const baseCard: PromptCard = {
  id: '9a000000-0000-4000-8000-000000000010',
  slug: 'rainy-window-loop',
  title: 'Rainy window loop',
  titleKo: '비 오는 창가 루프',
  authorHandle: 'alpha_demo',
  origin: 'maker',
  makerProfile: true,
  source: 'yagi',
  models: [],
  modelLabels: [],
  useCase: [],
  medium: 'video',
  priceCents: 0,
  priceKrw: 0,
  price1080Cents: 0,
  price1080Krw: 0,
  runtimeSeconds: 10,
  engine: null,
  aspectDefault: '9:16',
  poster: null,
  video: null,
  lock: null,
  featured: false,
  publishedAt: '2026-11-01T00:00:00.000Z',
};

function makeMaker(overrides: Partial<PublicMaker> = {}): PublicMaker {
  return {
    handle: 'alpha_demo',
    bio: 'Demo bio',
    bioEn: 'Demo bio EN',
    displayName: 'Demo Artist A',
    headline: 'Short atmospheric visual studies',
    country: 'KR',
    city: 'Seoul',
    links: [],
    publicEmail: null,
    tools: [],
    openToBrands: false,
    avatar: null,
    cover: null,
    templateCount: 2,
    latestPublishedAt: '2026-11-10T00:00:00.000Z',
    ...overrides,
  };
}

function makeFeedPost(overrides: Partial<PublicFeedPost> = {}): PublicFeedPost {
  return {
    slug: 'rain-study',
    title: 'Rainy window notes',
    summary: 'Three camera beats in soft dusk light.',
    publishedAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    readingMinutes: 2,
    cover: {
      id: `wrk_${'a'.repeat(32)}`,
      kind: 'image',
      src: `/creative-media/wrk_${'a'.repeat(32)}.jpg`,
      width: 1280,
      height: 720,
    },
    author: {
      handle: 'alpha_demo',
      displayName: 'Demo Artist A',
      headline: null,
      avatar: null,
    },
    ...overrides,
  };
}

async function catchOutcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    const node = await fn();
    return renderToStaticMarkup(node as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    const e = error as { notFound?: boolean; to?: string };
    if (e.notFound) return '404';
    if (e.to) return `redirect:${e.to}`;
    throw error;
  }
}

describe('Maker Hub Phase 1 — flag-off parity', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetMakerSessionStore();
    state.makers = [makeMaker()];
    state.video = [baseCard];
    state.image = [];
    state.works = [];
    state.feed = [makeFeedPost()];
    state.postCounts = { alpha_demo: 1 };
    state.postsByHandle = { alpha_demo: [makeFeedPost()] };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetMakerSessionStore();
  });

  it('keeps header nav, footer, sitemap, cards, and profile unchanged when TWINGS_MAKER_BLOG is off', async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'off');
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'off');
    vi.stubEnv('TWINGS_CREATOR_APPLICATIONS', 'off');

    const nav = audienceNavigation('ko', ko, '/');
    expect(nav.links.map((item) => item.href)).toEqual([
      '/ko/video',
      '/ko/image',
      '/ko/direct',
      '/ko/campaigns',
      '/ko/pricing',
    ]);
    expect(nav.links.some((item) => item.href.includes('/blog'))).toBe(false);

    const footerHtml = renderToStaticMarkup(<MarketingFooter locale="ko" dict={ko} />);
    expect(footerHtml).not.toContain('href="/ko/direct"');

    const cardHtml = renderToStaticMarkup(
      <PromptCardView card={baseCard} locale="ko" labels={promptLabels(ko)} />,
    );
    expect(cardHtml.match(/<a\s/g)).toHaveLength(1);
    expect(cardHtml).not.toContain('data-maker-profile-link');
    expect(cardHtml).toContain(
      '<h3 class="mt-3 line-clamp-2 text-[0.95rem] leading-snug font-medium tracking-[-0.01em] break-keep"><a href="/ko/t/rainy-window-loop" class="rounded-[18px] outline-none after:absolute after:inset-0 after:rounded-[18px] after:content-[&#x27;&#x27;] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--color-blue)]">비 오는 창가 루프</a></h3><p class="mt-1 flex flex-wrap gap-x-1.5 text-xs text-muted tabular-nums"><span data-card-duration="true">10초</span><span data-card-aspect="true">9:16</span></p><p data-card-author="true" class="mt-0.5 truncate text-xs text-muted">by @alpha_demo</p></article>',
    );

    expect(await catchOutcome(() => BlogFeedPage({ params: Promise.resolve({ locale: 'ko' }) }))).toBe('404');
    expect(await catchOutcome(() => blogFeedMetadata({ params: Promise.resolve({ locale: 'ko' }) }))).toBe('404');
    expect(await catchOutcome(() => MakersDirectoryPage({ params: Promise.resolve({ locale: 'ko' }) }))).toBe('404');
    expect(await catchOutcome(() => makersDirMetadata({ params: Promise.resolve({ locale: 'ko' }) }))).toBe('404');

    const profileHtml = await catchOutcome(() =>
      MakerPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    expect(profileHtml).not.toContain('data-maker-blog-tabs');
    expect(profileHtml).not.toContain('data-maker-profile-blog');
    expect(profileHtml).not.toContain('data-maker-owner-');
    expect(profileHtml).toContain(
      '<div class="flex flex-wrap items-center gap-2.5 sm:justify-end sm:self-start sm:pt-5"><button type="button" data-creative-share="true"',
    );
    expect(profileHtml).toContain(
      '<div class="sm:px-8 lg:px-10"></div><section data-rail="maker"',
    );

    const sitemap = buildSitemap({ origin: 'https://twings.app', cards: [] });
    expect(sitemap.some((item) => item.url.endsWith('/blog') || item.url.endsWith('/makers'))).toBe(false);
  });
});

describe('Maker Hub Phase 1 — doors (flag on)', () => {
  beforeEach(() => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    resetMakerSessionStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetMakerSessionStore();
  });

  it('adds 블로그 to header nav right before 요금제 and renders it in MarketingNav', () => {
    expect(blogFeedHref('ko')).toBe('/ko/blog');
    expect(makersDirectoryHref('en')).toBe('/en/makers');

    const koNav = audienceNavigation('ko', ko, '/');
    expect(koNav.links.map((item) => item.href)).toEqual([
      '/ko/video',
      '/ko/image',
      '/ko/direct',
      '/ko/campaigns',
      '/ko/blog',
      '/ko/pricing',
    ]);
    expect(koNav.links[4]?.label).toBe('블로그');

    const navHtml = renderToStaticMarkup(<MarketingNav locale="ko" dict={ko} rest="/" />);
    expect(navHtml).toContain('href="/ko/blog"');
  });

  it('always shows AI 크리에이티브 footer link pointing to /{locale}/direct when flag is on', () => {
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'off');
    vi.stubEnv('TWINGS_CREATOR_APPLICATIONS', 'off');
    const koFooter = renderToStaticMarkup(<MarketingFooter locale="ko" dict={ko} />);
    const enFooter = renderToStaticMarkup(<MarketingFooter locale="en" dict={en} />);
    expect(koFooter).toContain(`href="/ko/direct"`);
    expect(koFooter).toContain(ko.creatorProgram.footerLink);
    expect(enFooter).toContain(`href="/en/direct"`);
  });

  it('adds 크리에이티브 스튜디오 for every signed-in member and 글 쓰기 only for active makers', () => {
    const accountLabels: CreatorAccountLabels = {
      signIn: ko.auth.signIn,
      profile: ko.creatorProfile.profileLink,
      selfie: ko.nav.mySelfie,
      renders: ko.renders.title,
      campaigns: ko.campaigns.myCampaigns,
      signOut: ko.account.signOut,
      menu: ko.creatorProfile.accountMenu,
      fallbackName: ko.creatorProfile.fallbackName,
      makerStudio: ko.creatorProgram.workspaceTitle,
      writePost: ko.makerBlog.navWrite,
    };

    const regularHtml = renderToStaticMarkup(
      <CreatorAccountView session={{ signedIn: true, displayName: 'Member' }} labels={accountLabels} signInHref="/auth/signin" />,
    );
    expect(regularHtml).toContain('href="/creators/workspace"');
    expect(regularHtml).toContain(KO_TERMS.makerStudio);
    expect(regularHtml).not.toContain('href="/creators/workspace/posts/new"');

    const makerHtml = renderToStaticMarkup(
      <CreatorAccountView
        session={{ signedIn: true, displayName: 'Artist', maker: { active: true, handle: 'alpha_demo' } }}
        labels={accountLabels}
        signInHref="/auth/signin"
      />,
    );
    expect(makerHtml).toContain('href="/creators/workspace"');
    expect(makerHtml).toContain('href="/creators/workspace/posts/new"');
    expect(makerHtml).toContain('글 쓰기');
  });

  it('links card byline only when makerProfile is true and keeps stretched template link intact', () => {
    const linked = renderToStaticMarkup(
      <PromptCardView card={baseCard} locale="ko" labels={promptLabels(ko)} />,
    );
    expect(linked).toContain('href="/ko/t/rainy-window-loop"');
    expect(linked).toContain('href="/ko/makers/alpha_demo"');
    expect(linked).toContain('data-maker-profile-link="alpha_demo"');
    expect(linked).toContain('relative z-10');
    expect(linked).toContain('focus-visible:outline-[var(--color-blue)]');
    expect(linked).toContain('min-h-6');
    const bylineTag = /<a[^>]*data-maker-profile-link="alpha_demo"[^>]*>/.exec(linked)?.[0] ?? '';
    expect(bylineTag).not.toContain('outline-none');

    const privateMaker = renderToStaticMarkup(
      <PromptCardView
        card={{ ...baseCard, makerProfile: false }}
        locale="ko"
        labels={promptLabels(ko)}
      />,
    );
    expect(privateMaker.match(/<a\s/g)).toHaveLength(1);
    expect(privateMaker).not.toContain('data-maker-profile-link');

    const studioCard = renderToStaticMarkup(
      <PromptCardView
        card={{ ...baseCard, origin: 'studio', makerProfile: false }}
        locale="ko"
        labels={promptLabels(ko)}
      />,
    );
    expect(studioCard.match(/<a\s/g)).toHaveLength(1);
    expect(studioCard).not.toContain('data-maker-profile-link');
  });

  it('uses dictionary label for the installed app Studio bottom tab', () => {
    const koTabs = bottomTabItems({
      locale: 'ko',
      pathname: '/creators/workspace',
      signedIn: true,
      labels: ko.appShell.tabs,
      includeMaker: true,
    });
    expect(koTabs.find((item) => item.id === 'maker')?.label).toBe('스튜디오');

    const enTabs = bottomTabItems({
      locale: 'en',
      pathname: '/creators/workspace',
      signedIn: true,
      labels: en.appShell.tabs,
      includeMaker: true,
    });
    expect(enTabs.find((item) => item.id === 'maker')?.label).toBe('Studio');
  });
});

describe('Maker Hub Phase 1 — public feed, directory, and PGlite queries', () => {
  let h: PromptHarness;
  let root: string;

  beforeEach(async () => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    vi.stubEnv('TWINGS_FORMAT_CREATORS', 'on');
    h = await promptHarness();
    root = await mkdtemp(join(tmpdir(), 'twings-hub-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await h.close();
    await rm(root, { recursive: true, force: true });
  });

  it('lists published posts of active public makers newest-first, hiding drafts, hidden posts, and private profiles', async () => {
    const makerA = viewerOf('free');
    const makerB = viewerOf('pro');
    await activateOpenMaker(h.sql, makerA, { rightsAgreed: true });
    await saveMakerProfile(h.sql, makerA.userId!, {
      handle: 'alpha_demo',
      displayName: 'Demo Artist A',
      publicProfile: true,
    });
    await activateOpenMaker(h.sql, makerB, { rightsAgreed: true });
    await saveMakerProfile(h.sql, makerB.userId!, {
      handle: 'beta_demo',
      displayName: 'Demo Artist B',
      publicProfile: false,
    });

    const imgBytes = new Uint8Array(
      await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 24, g: 24, b: 28 } } })
        .jpeg()
        .toBuffer(),
    );
    const { work } = await storeMakerWork(h.sql, createLocalRenderStore(root), {
      userId: makerA.userId!,
      bytes: imgBytes,
      title: 'Cover frame',
      caption: null,
      link: null,
    });

    const p1 = await saveMakerPost(h.sql, makerA.userId!, {
      title: 'Visible post one',
      summary: 'First summary',
      coverWorkId: work.id,
      blocks: [{ type: 'text', text: 'Visible body.' }],
    });
    await publishMakerPost(h.sql, makerA.userId!, p1.post.id, { rightsConfirmed: true });

    const pDraft = await saveMakerPost(h.sql, makerA.userId!, {
      title: 'Unpublished draft',
      blocks: [{ type: 'text', text: 'Draft body.' }],
    });
    expect(pDraft.post.status).toBe('draft');

    const pHidden = await saveMakerPost(h.sql, makerA.userId!, {
      title: 'Moderated post',
      blocks: [{ type: 'text', text: 'Hidden body.' }],
    });
    await publishMakerPost(h.sql, makerA.userId!, pHidden.post.id, { rightsConfirmed: true });
    await adminHidePost(h.sql, ADMIN_VIEWER, { id: pHidden.post.id, reason: 'Test moderation' });

    const pPrivate = await saveMakerPost(h.sql, makerB.userId!, {
      title: 'Private profile post',
      blocks: [{ type: 'text', text: 'Should stay hidden.' }],
    });
    await publishMakerPost(h.sql, makerB.userId!, pPrivate.post.id, { rightsConfirmed: true });

    const feed = await listPublicBlogFeed(h.sql);
    expect(feed.map((item) => item.title)).toEqual(['Visible post one']);
    expect(feed[0]?.cover?.id).toBe(work.id);

    const counts = await countPublicPostsByAllHandles(h.sql);
    expect(counts).toEqual({ alpha_demo: 1 });
  });

  it('renders site-wide blog feed with featured card, 3-col non-autoplay grid, makers row, empty state, and Blog JSON-LD', async () => {
    expect(blogFeedRevalidate).toBe(3600);
    const noCoverPost = makeFeedPost({ slug: 'no-cover-note', title: 'Text only note', cover: null, publishedAt: null, updatedAt: '2026-11-25T00:00:00.000Z' });
    const videoCoverPost = makeFeedPost({
      slug: 'video-cover-note',
      title: 'Video breakdown',
      publishedAt: '2026-11-24T00:00:00.000Z',
      cover: { id: `wrk_${'b'.repeat(32)}`, kind: 'video', src: `/creative-media/wrk_${'b'.repeat(32)}.mp4`, width: 1280, height: 720 },
    });
    const olderPost = makeFeedPost({ slug: 'older-note', title: 'Older note', publishedAt: '2026-11-21T00:00:00.000Z' });

    const split = splitFeaturedFeedPost([noCoverPost, videoCoverPost, olderPost]);
    expect(split.featured?.slug).toBe('video-cover-note');
    expect(split.grid.map((p) => p.slug)).toEqual(['no-cover-note', 'older-note']);

    state.feed = [noCoverPost, videoCoverPost, olderPost];
    state.makers = Array.from({ length: 10 }, (_, idx) =>
      makeMaker({ handle: `demo_maker_${idx}`, displayName: `Artist ${idx}`, templateCount: 10 - idx }),
    );

    const html = await catchOutcome(() => BlogFeedPage({ params: Promise.resolve({ locale: 'ko' }) }));
    expect(html).toContain('data-blog-feed');
    expect(html).toContain('class="audience-shell pt-24 pb-20 lg:pt-28"');
    expect(html).toContain('<h1 class="audience-title');
    expect(html).not.toContain('sm:px-8 lg:px-10');
    expect(html).toContain('data-blog-feed-featured="video-cover-note"');
    expect(html).toContain('data-blog-feed-card="no-cover-note"');
    expect(html).toContain('data-blog-feed-card="older-note"');
    expect(html).toContain('line-clamp-2');
    expect(html).toContain('2026년 11월 25일');
    expect(html).toContain('text-[#CC1573]');
    expect(html).not.toMatch(/data-blog-feed-writer[^>]*bg-\[#09090B\]/);
    // Featured and grid cards show @handle next to avatar, never displayName.
    const featuredSlice = html.slice(html.indexOf('data-blog-feed-featured="video-cover-note"'), html.indexOf('data-blog-feed-card="no-cover-note"'));
    const cardSlice = html.slice(html.indexOf('data-blog-feed-card="no-cover-note"'), html.indexOf('data-blog-feed-card="older-note"'));
    expect(featuredSlice).toContain('@alpha_demo');
    expect(featuredSlice).not.toContain('Demo Artist A');
    expect(cardSlice).toContain('@alpha_demo');
    expect(cardSlice).not.toContain('Demo Artist A');
    // Post dates near midnight KST format in Asia/Seoul (never previous UTC calendar day).
    expect(formatPostDate('2026-11-27T15:05:00.000Z', 'ko')).toBe('2026년 11월 28일');
    expect(formatPostDate('2026-11-27T15:05:00.000Z', 'en')).toBe('Nov 28, 2026');
    expect(html).not.toMatch(/<video[^>]*autoPlay/i);
    expect(html).toContain('data-blog-feed-makers');
    expect(html.match(/data-blog-feed-maker="/g)).toHaveLength(8);
    expect(html).toContain('href="/ko/makers"');
    expect(html).toContain('href="/ko/direct"');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const ldMatch = /<script id="blog-feed-structured-data" type="application\/ld\+json">(.*?)<\/script>/.exec(html);
    expect(ldMatch).toBeTruthy();
    const ld = JSON.parse(ldMatch![1]!);
    expect(ld['@type']).toBe('Blog');
    expect(ld.blogPost).toHaveLength(3);

    const meta = await blogFeedMetadata({ params: Promise.resolve({ locale: 'ko' }) });
    expect(meta.alternates?.canonical).toBe('/ko/blog');
    expect(meta.alternates?.languages).toEqual({ en: '/en/blog', ko: '/ko/blog', 'x-default': '/en/blog' });

    state.feed = [];
    const emptyHtml = await catchOutcome(() => BlogFeedPage({ params: Promise.resolve({ locale: 'ko' }) }));
    expect(emptyHtml).toContain('data-blog-feed-empty');
    expect(emptyHtml).toContain('href="/ko/direct"');
    expect(emptyHtml).not.toContain('data-blog-feed-card');

    const sitemap = buildSitemap({ origin: 'https://twings.app', cards: [], includeBlogHub: true });
    expect(sitemap.map((entry) => entry.url)).toEqual(
      expect.arrayContaining([
        'https://twings.app/ko/blog',
        'https://twings.app/en/blog',
        'https://twings.app/ko/makers',
        'https://twings.app/en/makers',
      ]),
    );
  });

  it('renders makers directory sorted by most templates then newest, hiding 0 counts, with ItemList JSON-LD', async () => {
    expect(makersDirRevalidate).toBe(3600);
    const makerMostOld = makeMaker({ handle: 'alpha_demo', displayName: 'Alpha', templateCount: 5, latestPublishedAt: '2026-10-01T00:00:00.000Z' });
    const makerFewNew = makeMaker({ handle: 'beta_demo', displayName: 'Beta', templateCount: 2, latestPublishedAt: '2026-11-25T00:00:00.000Z' });
    const makerFewOld = makeMaker({ handle: 'gamma_demo', displayName: 'Gamma', templateCount: 2, latestPublishedAt: '2026-10-15T00:00:00.000Z' });
    const makerBlogOnly = makeMaker({ handle: 'delta_demo', displayName: 'Delta', templateCount: 0, latestPublishedAt: null });

    const ordered = sortDirectoryMakers([makerBlogOnly, makerFewOld, makerMostOld, makerFewNew], {
      delta_demo: 3,
      alpha_demo: 0,
    });
    expect(ordered.map((m) => m.handle)).toEqual(['alpha_demo', 'beta_demo', 'gamma_demo', 'delta_demo']);

    state.makers = [makerBlogOnly, makerFewOld, makerMostOld, makerFewNew];
    state.postCounts = { delta_demo: 3, alpha_demo: 0, beta_demo: 1 };

    const html = await catchOutcome(() => MakersDirectoryPage({ params: Promise.resolve({ locale: 'ko' }) }));
    expect(html).toContain('data-makers-directory');
    expect(html).toContain('class="audience-shell pt-24 pb-20 lg:pt-28"');
    expect(html).toContain('<h1 class="audience-title');
    expect(html).not.toContain('sm:px-8 lg:px-10');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    const cardOrder = [...html.matchAll(/data-maker-card="([^"]+)"/g)].map((m) => m[1]);
    expect(cardOrder).toEqual(['alpha_demo', 'beta_demo', 'gamma_demo', 'delta_demo']);

    // Alpha has 5 templates and 0 posts (hides post count). Delta has 0 templates and 3 posts (hides template count).
    const alphaSlice = html.slice(html.indexOf('data-maker-card="alpha_demo"'), html.indexOf('data-maker-card="beta_demo"'));
    expect(alphaSlice).toContain('템플릿 5편');
    expect(alphaSlice).not.toContain('글 0편');

    const deltaSlice = html.slice(html.indexOf('data-maker-card="delta_demo"'));
    expect(deltaSlice).toContain('글 3편');
    expect(deltaSlice).not.toContain('템플릿 0편');
    expect(deltaSlice).toContain('radial-gradient(');

    const enHtml = await catchOutcome(() => MakersDirectoryPage({ params: Promise.resolve({ locale: 'en' }) }));
    expect(enHtml).toContain('Posts: 1');
    expect(enHtml).not.toContain('1 posts');

    const ld = JSON.parse(/<script id="makers-directory-structured-data" type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!);
    expect(ld['@type']).toBe('ItemList');
    expect(ld.numberOfItems).toBe(4);

    const meta = await makersDirMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(meta.alternates?.canonical).toBe('/en/makers');
    expect(meta.alternates?.languages).toEqual({ en: '/en/makers', ko: '/ko/makers', 'x-default': '/en/makers' });
  });
});

describe('Maker Hub Phase 1 — profile & editor checklist', () => {
  beforeEach(() => {
    vi.stubEnv('TWINGS_MAKER_BLOG', 'on');
    resetMakerSessionStore();
    state.makers = [makeMaker()];
    state.video = [baseCard];
    state.image = [];
    state.works = [];
    state.postsByHandle = {};
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetMakerSessionStore();
  });

  it('always renders profile tabs when blog flag is on (even with 0 posts) and keeps static HTML free of owner controls', async () => {
    state.postsByHandle = { alpha_demo: [] };
    const profileHtml = await catchOutcome(() =>
      MakerPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    expect(profileHtml).toContain('data-maker-blog-tabs');
    expect(profileHtml).not.toContain('data-maker-profile-blog');
    expect(profileHtml).not.toContain('data-maker-owner-');
    // Own-profile template cards never link "by @handle" back to the same profile page.
    expect(profileHtml).toContain('by @alpha_demo');
    expect(profileHtml).not.toContain('data-maker-profile-link="alpha_demo"');

    // Every hash link inside profile tabs resolves to an existing id in the page markup (cards>0 & cards===0 + works>0).
    state.works = [{ id: `wrk_${'c'.repeat(32)}`, kind: 'image', mime: 'image/jpeg', width: 100, height: 100, title: 'Work', caption: null, linkUrl: null, position: 0 }];
    const withWorksHtml = await catchOutcome(() =>
      MakerPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    const tabsNavWithCards = /<nav[^>]*data-maker-blog-tabs[^>]*>[\s\S]*?<\/nav>/.exec(withWorksHtml)?.[0] ?? '';
    expect(tabsNavWithCards).toContain('href="#rail-maker"');
    expect(tabsNavWithCards).toContain('href="#works"');
    for (const [, targetId] of tabsNavWithCards.matchAll(/href="#([^"]+)"/g)) {
      expect(withWorksHtml).toContain(`id="${targetId}"`);
    }

    state.video = [];
    const emptyCardsWithWorksHtml = await catchOutcome(() =>
      MakerPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    const tabsNavEmptyCards = /<nav[^>]*data-maker-blog-tabs[^>]*>[\s\S]*?<\/nav>/.exec(emptyCardsWithWorksHtml)?.[0] ?? '';
    for (const [, targetId] of tabsNavEmptyCards.matchAll(/href="#([^"]+)"/g)) {
      expect(emptyCardsWithWorksHtml).toContain(`id="${targetId}"`);
    }
    state.video = [baseCard];
    state.works = [];

    // Per-maker blog list also formats timestamps just after midnight KST in Asia/Seoul.
    state.postsByHandle = {
      alpha_demo: [makeFeedPost({ slug: 'kst-midnight', title: 'Midnight note', publishedAt: '2026-11-27T15:05:00.000Z' })],
    };
    const kstBlogListHtml = await catchOutcome(() =>
      MakerBlogListPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    expect(kstBlogListHtml).toContain('2026년 11월 28일');
    expect(kstBlogListHtml).not.toContain('2026년 11월 27일');
    state.postsByHandle = { alpha_demo: [] };

    const blogTabHtml = await catchOutcome(() =>
      MakerBlogListPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    expect(blogTabHtml).toContain('data-maker-blog-tabs');
    expect(blogTabHtml).toContain('아직 글이 없습니다.');
    expect(blogTabHtml).not.toContain('data-maker-owner-first-post');

    // With posts, profile main page shows latest 3 + 모두 보기 link
    state.postsByHandle = {
      alpha_demo: [1, 2, 3, 4].map((n) =>
        makeFeedPost({ slug: `post-${n}`, title: `Post ${n}` }),
      ),
    };
    const withPostsHtml = await catchOutcome(() =>
      MakerPage({ params: Promise.resolve({ locale: 'ko', handle: 'alpha_demo' }) }),
    );
    expect(withPostsHtml).toContain('data-maker-profile-blog');
    expect(withPostsHtml.match(/data-maker-blog-card="/g)).toHaveLength(3);
    expect(withPostsHtml).toContain('href="/ko/makers/alpha_demo/blog"');
    expect(withPostsHtml).toContain('모두 보기');

    // Static SSR markup of owner islands renders empty when no client session is present on server
    publishMakerSession({ signedIn: true, displayName: 'Artist', maker: { active: true, handle: 'alpha_demo' } });
    expect(
      renderToStaticMarkup(
        <MakerProfileOwnerActions
          handle="alpha_demo"
          writeHref="/creators/workspace/posts/new"
          editHref="/creators/workspace#profile"
          labels={{ writePost: '글 쓰기', editProfile: '프로필 수정' }}
        />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <MakerBlogEmptyOwnerCta
          handle="alpha_demo"
          writeHref="/creators/workspace/posts/new"
          label="첫 글 쓰기"
        />,
      ),
    ).toBe('');

    const profileSource = readFileSync(
      join(process.cwd(), 'app', '(marketing)', '[locale]', 'makers', '[handle]', 'page.tsx'),
      'utf8',
    );
    expect(profileSource).not.toContain('one blue');
  });

  it('shows publish checklist items only when missing, and warns when published under a private profile', () => {
    const allMissing = publishChecklistItems({
      publicProfile: false,
      handle: null,
      coverWorkId: '',
      hasWorks: false,
      profileHref: '/creators/workspace#profile',
      worksHref: '/creators/workspace#works',
    });
    expect(allMissing).toEqual([
      { id: 'publicProfile', href: '/creators/workspace#profile' },
      { id: 'handle', href: '/creators/workspace#profile' },
      { id: 'cover', href: '/creators/workspace#works' },
    ]);

    expect(
      publishChecklistItems({
        publicProfile: true,
        handle: 'alpha_demo',
        coverWorkId: `wrk_${'a'.repeat(32)}`,
        hasWorks: true,
        profileHref: '/creators/workspace#profile',
        worksHref: '/creators/workspace#works',
      }),
    ).toEqual([]);

    const editorHtmlMissing = renderToStaticMarkup(
      <PostEditor
        locale="ko"
        handle={null}
        publicProfile={false}
        initialPost={{
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'draft-post',
          title: 'My post',
          summary: null,
          coverWorkId: null,
          status: 'published',
          hiddenReason: null,
          blockCount: 1,
          publishedAt: '2026-11-26T00:00:00.000Z',
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
          blocks: [{ type: 'text', text: 'Body' }],
        }}
        works={[]}
        importableTemplates={[]}
        publishedTemplates={[]}
        promptLabels={promptLabels(ko)}
        blogCopy={ko.makerBlog}
        recipeCopy={ko.makerRecipe}
        backHref="/creators/workspace#blog"
      />,
    );
    expect(editorHtmlMissing).toContain('data-post-publish-checklist');
    expect(editorHtmlMissing).toContain('공개 프로필 켜기');
    expect(editorHtmlMissing).toContain('핸들 정하기');
    expect(editorHtmlMissing).toContain('표지 고르기');
    expect(editorHtmlMissing).toContain('data-post-private-profile-notice');
    expect(editorHtmlMissing).not.toContain('data-post-view-live');
    // Without works panel (`worksAvailable=false`), 표지 고르기 falls back to `#profile` and all external editor links open in a new tab.
    expect(editorHtmlMissing).not.toContain('href="/creators/workspace#works"');
    expect(editorHtmlMissing).toContain('target="_blank"');
    expect(editorHtmlMissing).toContain('rel="noopener"');

    const editorHtmlWorksOpen = renderToStaticMarkup(
      <PostEditor
        locale="ko"
        handle="alpha_demo"
        publicProfile
        worksAvailable
        initialPost={null}
        works={[]}
        importableTemplates={[]}
        publishedTemplates={[]}
        promptLabels={promptLabels(ko)}
        blogCopy={ko.makerBlog}
        recipeCopy={ko.makerRecipe}
        backHref="/creators/workspace#blog"
      />,
    );
    expect(editorHtmlWorksOpen).toContain('href="/creators/workspace#works"');
    expect(editorHtmlWorksOpen).toContain('target="_blank"');

    const editorHtmlReady = renderToStaticMarkup(
      <PostEditor
        locale="ko"
        handle="alpha_demo"
        publicProfile
        initialPost={{
          id: '11111111-1111-4111-8111-111111111111',
          slug: 'live-post',
          title: 'Live post',
          summary: null,
          coverWorkId: `wrk_${'a'.repeat(32)}`,
          status: 'published',
          hiddenReason: null,
          blockCount: 1,
          publishedAt: '2026-11-26T00:00:00.000Z',
          createdAt: '2026-11-26T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
          blocks: [{ type: 'text', text: 'Body' }],
        }}
        works={[
          {
            id: `wrk_${'a'.repeat(32)}`,
            kind: 'image',
            mime: 'image/jpeg',
            width: 1200,
            height: 800,
            title: 'Cover',
            caption: null,
            linkUrl: null,
            position: 0,
          },
        ]}
        importableTemplates={[]}
        publishedTemplates={[]}
        promptLabels={promptLabels(ko)}
        blogCopy={ko.makerBlog}
        recipeCopy={ko.makerRecipe}
        backHref="/creators/workspace#blog"
      />,
    );
    expect(editorHtmlReady).not.toContain('data-post-publish-checklist');
    expect(editorHtmlReady).not.toContain('data-post-private-profile-notice');
    expect(editorHtmlReady).toContain('data-post-view-live');
  });
});
