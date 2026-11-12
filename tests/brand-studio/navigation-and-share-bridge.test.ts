import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { createMemoryMediaStore, type StudioMediaStore } from '@/lib/brand-studio/media-store';
import { loadSharePage } from '@/lib/brand-rooms/shares';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { STUDIO_REVIEW_PAGE_OPEN } from '@/app/(brand)/brand/studio/review/page';
import {
  RAIL_GROUP,
  RAIL_HREF,
  RAIL_ICON,
  groupItems,
  railActive,
  railItems,
} from '@/components/brand-workspace/rail-model';
import {
  BLANK_CANVAS_PRESETS,
  StudioApp,
  createBlankCanvasDataUrl,
  imageCanvasHref,
  videoComposeClipHref,
} from '@/components/brand-studio/studio-app';
import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import { ReviewApp } from '@/components/brand-studio/review/review-app';
import {
  OPEN_SHARE_REVIEW_EVENT,
  ShareReviewDialog,
  normalizeShareReviewDetail,
} from '@/components/brand-studio/share-review-dialog';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { ORG, asset as fixtureAsset, job as fixtureJob, output as fixtureOutput, studioState } from './ui/fixtures';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { seedOutput } from './review/fixtures';

const navState = vi.hoisted(() => ({
  path: '/brand',
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'free', email: null, locale: 'ko' } as Viewer,
  media: null as StudioMediaStore | null,
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/brands/concierge-slack', () => ({
  notifySlackBrandConcierge: vi.fn(async () => ({ sent: true })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => unknown) => navState.afterCallbacks.push(callback),
}));

vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => navState.sql,
}));

vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => navState.viewer,
}));

vi.mock('@/lib/brand-studio/media-store', async (original) => {
  const actual = await original<typeof import('@/lib/brand-studio/media-store')>();
  return {
    ...actual,
    createStudioMediaStore: () => navState.media ?? actual.createMemoryMediaStore(),
  };
});

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import {
  DEFAULT_REVIEW_WORKSPACE_TITLE,
  POST as postShareBridge,
} from '@/app/api/brand-studio/share-bridge/route';

const ko = getDictionary('ko');
const en = getDictionary('en');

const mockLibrary: StudioLibrary = {
  ready: true,
  folders: [],
  liked: new Set<string>(),
  likedItems: [],
  folderItems: () => null,
  openFolder: () => {},
  toggleLike: async () => true,
  createFolder: async () => null,
  renameFolder: async () => true,
  deleteFolder: async () => true,
  addToFolder: async () => true,
  removeFromFolder: async () => true,
};

describe('1. Left Rail Promotion (편집 스튜디오 + Clear Client Room Labels + .claude/launch.json)', () => {
  beforeEach(() => {
    navState.path = '/brand/studio/compose';
  });

  it('promotes compose (편집 스튜디오) and workflows (워크플로우) into the make group and orders project_only showroom orgs cleanly', () => {
    expect(RAIL_HREF.compose).toBe('/brand/studio/compose');
    expect(RAIL_HREF.workflows).toBe('/brand/studio/workflows');
    expect(RAIL_GROUP.compose).toBe('make');
    expect(RAIL_GROUP.workflows).toBe('make');
    expect(RAIL_ICON.compose.length).toBeGreaterThan(0);
    expect(RAIL_ICON.workflows.length).toBeGreaterThan(0);

    const activeItems = railItems({ studio: true, creators: true, identity: true, rooms: true });
    expect(activeItems).toEqual(['image', 'video', 'compose', 'workflows', 'assets', 'campaigns', 'messages']);
    expect(groupItems(activeItems, [])).toEqual({
      make: ['image', 'video', 'compose', 'workflows', 'assets'],
      team: ['campaigns', 'messages'],
    });

    const showroomItems = railItems({ studio: false, studioShowroom: true, creators: false, identity: false, rooms: true });
    expect(showroomItems).toEqual(['campaigns', 'messages', 'assets', 'image', 'video', 'compose', 'workflows']);
  });

  it('activates compose on /brand/studio/compose, workflows on /brand/studio/workflows, and does NOT activate video or image', () => {
    expect(railActive('/brand/studio/compose', '/brand/studio/compose')).toBe(true);
    expect(railActive('/brand/studio/compose', '/brand/studio/compose/sub')).toBe(true);
    expect(railActive('/brand/studio/video', '/brand/studio/compose')).toBe(false);
    expect(railActive('/brand/studio', '/brand/studio/compose')).toBe(false);
    expect(railActive('/brand/studio/workflows', '/brand/studio/workflows')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio/workflows')).toBe(false);
  });

  it('renders unmistakable KO/EN rail labels for 영상 스튜디오, 편집 스튜디오, 워크플로우, 프로젝트 · 리뷰, and 대화 · 피드백', () => {
    expect(ko.studioShell.rail.video).toBe('영상 스튜디오');
    expect(en.studioShell.rail.video).toBe('Video Studio');
    expect(ko.studioShell.rail.compose).toBe('편집 스튜디오');
    expect(en.studioShell.rail.compose).toBe('Editing Studio');
    expect(ko.studioShell.rail.workflows).toBe('워크플로우');
    expect(en.studioShell.rail.workflows).toBe('Workflows');
    expect(ko.studioShell.rail.campaigns).toBe('프로젝트 · 리뷰');
    expect(en.studioShell.rail.campaigns).toBe('Projects & Review');
    expect(ko.studioShell.rail.messages).toBe('대화 · 피드백');
    expect(en.studioShell.rail.messages).toBe('Chat & Feedback');

    const choice: BrandWorkspaceChoice = { id: ORG, name: 'Studio Brand', role: 'owner', logoUrl: null, denied: [] };
    const scope: BrandWorkspaceScope = { choices: [choice], projectOrganizations: {} };
    const b = ko.brandWorkspace;
    const html = renderToStaticMarkup(
      createElement(WorkspaceNavigation, {
        home: b.home,
        members: b.members,
        settings: b.managed.settings,
        library: b.managed.library,
        studio: b.productionStudio.title,
        identity: b.identityLayer.nav,
        creators: b.creatorPool.nav,
        scope,
        studioV2: true,
        shell: ko.studioShell,
        locale: 'ko',
        rooms: true,
        roomsCopy: ko.roomsShell.nav,
      }),
    );

    expect(html).toContain(`href="/brand/studio/compose?organizationId=${ORG}"`);
    expect(html).toContain(`href="/brand/studio/workflows?organizationId=${ORG}"`);
    expect(html).toContain('>영상 스튜디오<');
    expect(html).toContain('>편집 스튜디오<');
    expect(html).toContain('>워크플로우<');
    expect(html).toContain('>프로젝트 · 리뷰<');
    expect(html).toContain('>대화 · 피드백<');
    const activeIds = [...html.matchAll(/data-rail-item="(\w+)"[^>]*aria-current="page"/g)].map((m) => m[1]);
    expect(activeIds).toEqual(['compose']);
  });

  it('enables BRAND_ROOMS and BRAND_STUDIO_V2 in .claude/launch.json local dev profiles without secrets', () => {
    const raw = readFileSync('.claude/launch.json', 'utf8');
    const parsed = JSON.parse(raw) as {
      configurations: Array<{ name: string; env?: Record<string, string> }>;
    };
    expect(parsed.configurations.length).toBeGreaterThanOrEqual(3);
    for (const cfg of parsed.configurations) {
      expect(cfg.env?.BRAND_ROOMS, cfg.name).toBe('on');
      expect(cfg.env?.BRAND_STUDIO_V2, cfg.name).toBe('on');
    }
    expect(raw).not.toMatch(/API_KEY|SECRET|SERVICE_ROLE|PASSWORD|SUPABASE_URL|sk_|pk_/i);
  });
});

describe('2. OpenCanva (캔버스 편집) 1-Click Direct Entry (studio-app.tsx + asset-hub.tsx)', () => {
  it('provides blank canvas presets (4:5, 9:16, 16:9, 1:1), white PNG generator, and direct deep-link builders', () => {
    expect(BLANK_CANVAS_PRESETS.map((p) => `${p.id}:${p.width}x${p.height}`)).toEqual([
      '4:5:1080x1350',
      '9:16:1080x1920',
      '16:9:1920x1080',
      '1:1:1080x1080',
    ]);
    const dataUrl = createBlankCanvasDataUrl(1080, 1350);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const sampleId = '11111111-2222-4333-8444-555555555555';
    expect(imageCanvasHref(ORG, { assetId: sampleId })).toBe(`/brand/studio?organizationId=${ORG}&canvas=a%3A${sampleId}`);
    expect(imageCanvasHref(ORG, { outputId: sampleId })).toBe(`/brand/studio?organizationId=${ORG}&canvas=o%3A${sampleId}`);
    expect(videoComposeClipHref(ORG, { assetId: sampleId })).toBe(`/brand/studio/compose?organizationId=${ORG}&clip=a%3A${sampleId}`);
    expect(videoComposeClipHref(ORG, { outputId: sampleId })).toBe(`/brand/studio/compose?organizationId=${ORG}&clip=o%3A${sampleId}`);
  });

  it('renders 1-click 캔버스 편집 header button and empty-state quick action in Image Studio (and hides on Video / read-only)', () => {
    const emptyImageHtml = renderToStaticMarkup(
      createElement(StudioApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: ko.brandStudio,
        mode: 'image',
        libraryCopy: ko.studioLibrary,
        layersCopy: ko.studioLayers,
        initialState: studioState({ canCreate: true }),
      }),
    );
    expect(emptyImageHtml).toContain('data-studio-open-canvas');
    expect(emptyImageHtml).toContain('캔버스 편집');
    expect(emptyImageHtml).toContain('data-studio-empty-open-canvas');

    const videoHtml = renderToStaticMarkup(
      createElement(StudioApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: ko.brandStudio,
        mode: 'video',
        libraryCopy: ko.studioLibrary,
        layersCopy: ko.studioLayers,
        initialState: studioState({ canCreate: true }),
      }),
    );
    expect(videoHtml).not.toContain('data-studio-open-canvas');

    const viewerHtml = renderToStaticMarkup(
      createElement(StudioApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: ko.brandStudio,
        mode: 'image',
        libraryCopy: ko.studioLibrary,
        layersCopy: ko.studioLayers,
        initialState: studioState({ canCreate: false }),
      }),
    );
    expect(viewerHtml).not.toContain('data-studio-open-canvas');
  });

  it('renders 캔버스 편집 on image cards, 편집 스튜디오로 on video cards, and 검수 · 공유 in Asset Hub', () => {
    const imgAsset = fixtureAsset(1, { kind: 'image', name: 'Packshot.png' });
    const vidAsset = fixtureAsset(2, { kind: 'video', name: 'Teaser.mp4', seconds: 8 });
    const genImg = fixtureOutput(3, { kind: 'image' });
    const state = studioState({
      canCreate: true,
      assets: [imgAsset, vidAsset],
      jobs: [fixtureJob(1, { outputs: [genImg] })],
    });

    const html = renderToStaticMarkup(
      createElement(BrandAssetHub, {
        organizationId: ORG,
        studioCopy: ko.brandStudio,
        libraryCopy: ko.studioLibrary,
        initialState: state,
        injectedLibrary: mockLibrary,
      }),
    );

    expect(html).toContain('data-asset-hub-open-canvas');
    expect(html).toContain(`href="/brand/studio?organizationId=${ORG}&amp;canvas=a%3A${imgAsset.id}"`);
    expect(html).toContain(`href="/brand/studio?organizationId=${ORG}&amp;canvas=o%3A${genImg.id}"`);
    expect(html).toContain('data-asset-hub-open-compose');
    expect(html).toContain(`href="/brand/studio/compose?organizationId=${ORG}&amp;clip=a%3A${vidAsset.id}"`);
    expect(html.match(/data-asset-hub-share-review/g)).toHaveLength(3);
  });
});

describe('3. Studio Review v4 + ShareReviewDialog + twings:open-share-review event contract', () => {
  it('re-opens STUDIO_REVIEW_PAGE_OPEN = true and conforms to strict Studio UI v4 tokens in review.css', () => {
    expect(STUDIO_REVIEW_PAGE_OPEN).toBe(true);
    const css = readFileSync('components/brand-studio/review/review.css', 'utf8');
    expect(css).not.toMatch(/#ebf5ff/i);
    expect(css).not.toMatch(/#a3392f/i);
    expect(css).toMatch(/#0033ff/i);
    expect(css).toMatch(/#f4f4f5/i);
    expect(css).toMatch(/#e4e4e7/i);
    expect(css).toMatch(/#09090b/i);
    expect(css).toContain('Geist Mono');
    expect(css).toContain('tabular-nums');

    const reviewHtml = renderToStaticMarkup(
      createElement(ReviewApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: ko.studioReview,
        initialList: { ok: true, canWrite: true, reviews: [] },
        initialDetail: null,
        initialMs: null,
      }),
    );
    expect(reviewHtml).toContain('data-studio-review');
  });

  it('normalizes twings:open-share-review payloads and renders all 3 actions in ShareReviewDialog without internal words or KRW', () => {
    expect(OPEN_SHARE_REVIEW_EVENT).toBe('twings:open-share-review');
    const sampleAssetId = '22222222-3333-4444-8555-666666666666';
    const sampleOutId = '33333333-4444-4555-8666-777777777777';

    expect(normalizeShareReviewDetail({ assetId: sampleAssetId, title: 'Hero' }, ORG)).toEqual({
      organizationId: ORG,
      reviewId: null,
      assetId: sampleAssetId,
      outputId: null,
      title: 'Hero',
    });
    expect(normalizeShareReviewDetail({ key: `o:${sampleOutId}`, label: 'Cut 01' }, ORG)).toEqual({
      organizationId: ORG,
      reviewId: null,
      assetId: null,
      outputId: sampleOutId,
      title: 'Cut 01',
    });
    expect(normalizeShareReviewDetail({ source: { assetId: sampleAssetId }, name: 'Clip' }, ORG)).toEqual({
      organizationId: ORG,
      reviewId: null,
      assetId: sampleAssetId,
      outputId: null,
      title: 'Clip',
    });
    expect(normalizeShareReviewDetail({}, ORG)).toBeNull();

    for (const locale of ['ko', 'en'] as const) {
      const dialogHtml = renderToStaticMarkup(
        createElement(ShareReviewDialog, {
          target: { organizationId: ORG, outputId: sampleOutId, title: 'Spring Campaign Cut' },
          locale,
          onClose: () => {},
        }),
      );
      expect(dialogHtml).toContain('data-share-review-dialog');
      expect(dialogHtml).toContain('data-share-bridge-link-section');
      expect(dialogHtml).toContain('data-share-bridge-review-section');
      expect(dialogHtml).toContain('data-share-bridge-chat-section');
      expect(dialogHtml).toContain('data-share-bridge-allow-comments');
      expect(dialogHtml).toContain('data-share-bridge-allow-download');
      expect(dialogHtml).toContain('data-share-bridge-expiry="7"');
      expect(dialogHtml).toContain('data-share-bridge-expiry="14"');
      expect(dialogHtml).toContain('data-share-bridge-expiry="30"');
      expect(dialogHtml).toContain('data-share-bridge-password');
      expect(dialogHtml).not.toMatch(/₩|KRW|\d[\d,]*\s*원(?!래)/);
      expect(dialogHtml).not.toMatch(/slack|슬랙|webhook|웹훅|supabase|comfyui|yue2|stage\s*\d|recipe/i);
      expect(dialogHtml).not.toMatch(/#ebf5ff/i);
    }
  });
});

describe('4. /api/brand-studio/share-bridge (PGlite end-to-end security, /s/[token] minting & room chat jump)', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;

  beforeEach(async () => {
    f = await studioFixture();
    deps = studioDeps(f.sql);
    navState.sql = f.sql;
    navState.media = deps.media;
    navState.viewer = viewerOf(f.ids.owner);
    navState.afterCallbacks.length = 0;
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
  });

  const callBridge = (body: unknown, originHeader = 'https://twings.app') =>
    postShareBridge(
      new NextRequest('https://twings.app/api/brand-studio/share-bridge', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(originHeader ? { origin: originHeader } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  it('enforces sameOriginMutation (403), brandStudioV2Open (404), getViewer (401), and Morphic/policy/guest gates (404)', async () => {
    // 1. Cross-origin -> 403
    const cross = await callBridge(
      { operation: 'bridge.context', input: { organizationId: f.orgId } },
      'https://evil.example',
    );
    expect(cross.status).toBe(403);

    // 2. Flag off -> 404
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    const closed = await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } });
    expect(closed.status).toBe(404);
    vi.stubEnv('BRAND_STUDIO_V2', 'on');

    // 3. Signed out -> 401
    navState.viewer = { userId: null, isAdmin: false, tier: 'free', email: null, locale: 'ko' };
    const anon = await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } });
    expect(anon.status).toBe(401);

    // 4. Outsider & campaign-only guest -> 404
    navState.viewer = viewerOf(f.ids.outsider);
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } })).status).toBe(404);
    navState.viewer = viewerOf(f.ids.guest);
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } })).status).toBe(404);

    // 5. Morphic ID, Morphic name, 모픽 name, and generative_media denied -> 404
    navState.viewer = viewerOf(f.ids.owner);
    const morphicId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      morphicId,
      'Sandboxed Client',
      f.ids.owner,
      randomUUID(),
    ]);
    await f.sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      morphicId,
      f.ids.owner,
      'owner',
    ]);
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: morphicId } })).status).toBe(404);

    await f.sql.query("update brand_organizations set name = '모픽 코리아' where id = $1", [f.orgId]);
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } })).status).toBe(404);

    await f.sql.query("update brand_organizations set name = 'Studio fixture brand' where id = $1", [f.orgId]);
    await f.sql.query(
      "insert into brand_feature_policies (organization_id, denied_features) values ($1, array['generative_media']::text[])",
      [f.orgId],
    );
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId } })).status).toBe(404);

    // Re-enable generative_media and verify viewer role gets 403 on write operations
    await f.sql.query("delete from brand_feature_policies where organization_id = $1", [f.orgId]);
    const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    navState.viewer = viewerOf(f.ids.viewer);
    expect((await callBridge({ operation: 'bridge.context', input: { organizationId: f.orgId, assetId } })).status).toBe(200);
    expect((await callBridge({ operation: 'bridge.create_share', input: { organizationId: f.orgId, assetId } })).status).toBe(403);
  });

  it('auto-creates 스튜디오 공유 · 검수함 workspace room, links review (stack_id), mints /s/[token], and posts chat jump card', async () => {
    const outputId = await seedOutput(deps, f.orgId, f.ids.owner, 'video');

    // Mint /s/[token] without choosing a projectId -> auto-creates DEFAULT_REVIEW_WORKSPACE_TITLE
    const mintRes = await callBridge({
      operation: 'bridge.create_share',
      input: {
        organizationId: f.orgId,
        outputId,
        title: '런칭 필름 v1',
        allowComments: true,
        allowDownload: true,
        expiresInDays: 14,
      },
    });
    expect(mintRes.status).toBe(201);
    const minted = (await mintRes.json()) as {
      ok: boolean;
      reviewId: string;
      reviewHref: string;
      projectId: string;
      projectTitle: string;
      roomChatHref: string;
      shareUrl: string;
    };
    expect(minted.ok).toBe(true);
    expect(minted.projectTitle).toBe(DEFAULT_REVIEW_WORKSPACE_TITLE);
    expect(minted.shareUrl).toMatch(/^\/s\/[A-Za-z0-9_-]{20,}$/);
    expect(minted.reviewHref).toBe(`/brand/studio/review?organizationId=${f.orgId}&review=${minted.reviewId}`);

    // Verify DB review row has stack_id and project_id populated
    const reviewRow = (
      await f.sql.query<{ project_id: string; stack_id: string }>(
        'select project_id, stack_id from brand_studio_reviews where id = $1',
        [minted.reviewId],
      )
    ).rows[0]!;
    expect(reviewRow.project_id).toBe(minted.projectId);
    expect(reviewRow.stack_id).toBe(minted.reviewId);

    // Verify the minted /s/[token] resolves publicly via loadSharePage!
    const rawToken = minted.shareUrl.slice('/s/'.length);
    const sharedPage = await loadSharePage({ sql: f.sql, media: deps.media }, rawToken, { get: () => undefined });
    expect(sharedPage).not.toBeNull();
    expect(sharedPage?.state).toBe('open');
    if (sharedPage?.state === 'open' && 'review' in sharedPage) {
      expect(sharedPage.review.review.title).toBe('런칭 필름 v1');
      expect(sharedPage.share.allowComments).toBe(true);
      expect(sharedPage.share.allowDownload).toBe(true);
    }

    // Verify bridge.context lists both projects and the active share without leaking raw token
    const ctxRes = await callBridge({
      operation: 'bridge.context',
      input: { organizationId: f.orgId, outputId },
    });
    expect(ctxRes.status).toBe(200);
    const ctxJson = (await ctxRes.json()) as {
      ok: boolean;
      review: { id: string; projectId: string };
      projects: Array<{ id: string; title: string; isDefaultWorkspace: boolean }>;
      shares: Array<{ id: string; allowComments: boolean }>;
    };
    expect(ctxJson.ok).toBe(true);
    expect(ctxJson.review.id).toBe(minted.reviewId);
    expect(ctxJson.projects.some((p) => p.title === DEFAULT_REVIEW_WORKSPACE_TITLE && p.isDefaultWorkspace)).toBe(true);
    expect(ctxJson.projects.some((p) => p.id === f.projectId)).toBe(true);
    expect(ctxJson.shares).toHaveLength(1);
    expect(JSON.stringify(ctxJson)).not.toContain(rawToken);

    // Send work card to client project conversation (`f.projectId`) via bridge.post_chat
    const chatRes = await callBridge({
      operation: 'bridge.post_chat',
      input: {
        organizationId: f.orgId,
        reviewId: minted.reviewId,
        projectId: f.projectId,
        chatNote: '00:02 로고 타이밍 확인 부탁드립니다.',
      },
    });
    expect(chatRes.status).toBe(200);
    const chatJson = (await chatRes.json()) as {
      ok: boolean;
      projectId: string;
      roomChatHref: string;
      postedMessageId: string | null;
      shareUrl: string | null;
    };
    expect(chatJson.ok).toBe(true);
    expect(chatJson.projectId).toBe(f.projectId);
    expect(chatJson.shareUrl).toBeNull();
    expect(chatJson.postedMessageId).toBeTruthy();
    expect(chatJson.roomChatHref).toBe(`/brand/rooms/${f.projectId}?organizationId=${f.orgId}&tab=chat`);

    const msgRows = (
      await f.sql.query<{ body: string; ref: { kind: string; reviewId: string } | null }>(
        'select body, ref from brand_room_messages where id = $1',
        [chatJson.postedMessageId],
      )
    ).rows;
    expect(msgRows).toEqual([
      {
        body: '00:02 로고 타이밍 확인 부탁드립니다.',
        ref: { kind: 'review', reviewId: minted.reviewId },
      },
    ]);
  });
});
