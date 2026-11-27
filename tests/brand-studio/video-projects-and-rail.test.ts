import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { VideoComposer } from '@/components/brand-studio/compose/video-composer';
import { SequenceRail } from '@/components/brand-studio/video/sequence-rail';
import { VideoStudioWorkspace } from '@/components/brand-studio/video/workspace';
import {
  appendClip,
  applyTimelinePatches,
  emptyComposerProject,
  parseStoredProject,
  selectClipTake,
  serializeProjectForStorage,
  stackClipTake,
  type ComposerProject,
} from '@/lib/brand-studio/compose';
import { exportProjectNleBundleZip } from '@/lib/brand-studio/compose/nle-export';
import { createMemoryMediaStore } from '@/lib/brand-studio/media-store';
import {
  deriveVideoProjectTitle,
  loadVideoProjects,
  runVideoProjectOperation,
  type VideoProjectsDeps,
} from '@/lib/brand-studio/video-projects';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { lintPublicBrandSurface } from '@/lib/brands/qa/hardline-lint';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioComposeEn, studioComposeKo } from '@/messages/studio-compose';
import { studioVideoEn, studioVideoKo } from '@/messages/studio-video';
import { seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { allowance, asset, job, ORG, output, studioState } from './ui/fixtures';

const routeMocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () =>
    routeMocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const videoProjectsRoute = await import('@/app/api/brand-studio/video-projects/route');
const ROUTE_BASE = 'http://localhost:3000/api/brand-studio/video-projects';

const koDict = getDictionary('ko');
const enDict = getDictionary('en');

function routeGet(query: string) {
  return videoProjectsRoute.GET(new NextRequest(`${ROUTE_BASE}?${query}`));
}

function routePost(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return videoProjectsRoute.POST(
    new NextRequest(ROUTE_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function seedVideoOutput(
  sql: SqlRunner,
  media: ReturnType<typeof createMemoryMediaStore>,
  orgId: string,
  byUserId: string,
  seconds = 6,
): Promise<{ outputId: string; storageKey: string; thumbKey: string }> {
  const { key: storageKey } = await media.put(
    new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]),
    'video/mp4',
  );
  const { key: thumbKey } = await media.put(new Uint8Array([82, 73, 70, 70]), 'image/webp');
  const jobId = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_jobs
         (organization_id, created_by, request_id, kind, status, model, prompt, finished_at)
       values ($1, $2, $3, 'video', 'succeeded', 'seedance-2.5', 'Runway serum hero', now())
       returning id`,
      [orgId, byUserId, `job_${randomUUID().slice(0, 12)}`],
    )
  ).rows[0]!.id;
  const outputId = randomUUID();
  await sql.query(
    `insert into brand_studio_outputs
       (id, job_id, organization_id, idx, kind, status, mime, width, height, duration_ms, storage_key, thumb_key)
     values ($1, $2, $3, 0, 'video', 'ready', 'video/mp4', 1080, 1920, $4, $5, $6)`,
    [outputId, jobId, orgId, seconds * 1000, storageKey, thumbKey],
  );
  return { outputId, storageKey, thumbKey };
}

async function seedAudioAsset(
  sql: SqlRunner,
  media: ReturnType<typeof createMemoryMediaStore>,
  orgId: string,
  byUserId: string,
): Promise<{ assetId: string; storageKey: string }> {
  const { key: storageKey } = await media.put(new Uint8Array([82, 73, 70, 70, 87, 65, 86, 69]), 'audio/wav');
  const assetId = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_assets
         (organization_id, kind, name, mime, size_bytes, duration_ms, storage_key, source, status, created_by)
       values ($1, 'audio', 'guide-beat.wav', 'audio/wav', 8, 12000, $2, 'upload', 'ready', $3)
       returning id`,
      [orgId, storageKey, byUserId],
    )
  ).rows[0]!.id;
  return { assetId, storageKey };
}

describe('Studio Pro Suite v5 Track B — 1. Naming Mandate (`영상 스튜디오` & `프로젝트`) + Surface Hygiene', () => {
  it('enforces `영상 스튜디오` Korean title and `프로젝트` work-unit nomenclature with zero leaked vendor/infra terms', () => {
    expect(studioVideoKo.title).toBe('영상 스튜디오');
    expect(studioVideoKo.title).not.toBe('비디오 스튜디오');
    expect(studioComposeKo.backToVideo).toBe('영상 스튜디오로');

    expect(studioVideoKo.workspace.projects.myProjects).toBe('내 프로젝트');
    expect(studioVideoKo.workspace.projects.newProject).toContain('새 프로젝트');
    expect(studioVideoKo.workspace.projects.untitled).toBe('새 프로젝트');
    expect(studioVideoKo.workspace.projects.completeProject).toBe('프로젝트 완료');
    expect(studioVideoKo.workspace.projects.sendToProject).toBe('기존 프로젝트로 보내기');
    expect(studioVideoKo.workspace.projects.presetCreate).toBe('클립 생성');
    expect(studioVideoKo.workspace.projects.presetEdit).toBe('컷 편집');
    expect(studioVideoKo.workspace.projects.exportNle).toBe('Premiere · DaVinci (.xml)');
    expect(studioComposeKo.actions.exportNle).toBe('Premiere · DaVinci (.xml)');

    expect(lintPublicBrandSurface(JSON.stringify(studioVideoKo))).toEqual({ clean: true, violations: [] });
    expect(lintPublicBrandSurface(JSON.stringify(studioVideoEn))).toEqual({ clean: true, violations: [] });
    expect(lintPublicBrandSurface(JSON.stringify(studioComposeKo))).toEqual({ clean: true, violations: [] });
    expect(lintPublicBrandSurface(JSON.stringify(studioComposeEn))).toEqual({ clean: true, violations: [] });
  });
});

describe('Studio Pro Suite v5 Track B — 2. Server-Persisted Video Projects, Optimistic Concurrency, Morphic 404 & Shot-Sheet Purge', () => {
  let f: StudioFixture;
  let deps: VideoProjectsDeps;
  let media: ReturnType<typeof createMemoryMediaStore>;

  beforeEach(async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
    f = await studioFixture();
    media = createMemoryMediaStore();
    deps = { sql: f.sql, media };
    routeMocks.sql = f.sql;
    routeMocks.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await f.db.close();
    routeMocks.sql = null;
    routeMocks.viewer = null;
  });

  it('supports idempotent lazy `create`, auto-derived project titles, MediaStore URL hydration on `GET`, and optimistic concurrency `save`', async () => {
    expect(brandRouteAllowed('/api/brand-studio/video-projects', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/video-projects', 'POST')).toBe(true);

    expect(deriveVideoProjectTitle({ firstPrompt: '@image1 세럼 보틀이 @video1 무드로 회전하는 오프닝' })).toBe(
      '세럼 보틀이 무드로 회전하는 오프닝',
    );
    expect(deriveVideoProjectTitle({ locale: 'ko' })).toBe('새 프로젝트');
    expect(deriveVideoProjectTitle({ locale: 'en' })).toBe('New project');

    const studioD = studioDeps(f.sql, { media });
    const videoAssetId = await seedVideoAsset(studioD, f.orgId, f.ids.owner, 8);
    const { outputId, storageKey: outKey, thumbKey: outThumbKey } = await seedVideoOutput(
      f.sql,
      media,
      f.orgId,
      f.ids.owner,
      6,
    );
    const { assetId: bgmAssetId, storageKey: bgmKey } = await seedAudioAsset(f.sql, media, f.orgId, f.ids.owner);

    let timeline = emptyComposerProject('9:16');
    timeline = appendClip(timeline, {
      id: 'clip_a',
      label: '오프닝 컷',
      sourceKind: 'asset',
      assetId: videoAssetId,
      srcUrl: 'https://stale.example/expired-asset.mp4',
      thumbUrl: null,
      durationSec: 8,
      trimStartSec: 0,
      trimEndSec: 8,
      volume: 1,
      muted: false,
    });
    timeline = stackClipTake(timeline, 'clip_a', {
      label: '오프닝 컷 테이크 2',
      sourceKind: 'output',
      outputId,
      srcUrl: 'https://stale.example/expired-output.mp4',
      thumbUrl: null,
      durationSec: 6,
      trimStartSec: 0,
      trimEndSec: 6,
    });
    timeline = {
      ...timeline,
      bgm: {
        label: '프렌치 하우스 가이드',
        sourceKind: 'asset',
        assetId: bgmAssetId,
        srcUrl: 'https://stale.example/expired-bgm.wav',
        durationSec: 12,
        trimStartSec: 0,
        volume: 0.45,
        nonCommercialGuide: true,
      },
    };

    const reqId = `vp_${randomUUID().replace(/-/g, '')}`;
    const firstCreate = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: reqId,
      firstPrompt: '@image1 26FW 세럼 런웨이 캠페인',
      timeline,
    });
    expect(firstCreate.ok).toBe(true);
    if (!firstCreate.ok || !firstCreate.project) throw new Error('expected project created');
    expect(firstCreate.created).toBe(true);
    expect(firstCreate.project.title).toBe('26FW 세럼 런웨이 캠페인');
    expect(firstCreate.project.revision).toBe(1);

    // Idempotent replay with identical (organization_id, request_id)
    const replayCreate = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: reqId,
      title: 'Ignored duplicate title',
    });
    expect(replayCreate.ok).toBe(true);
    if (!replayCreate.ok || !replayCreate.project) throw new Error('expected replay ok');
    expect(replayCreate.created).toBe(false);
    expect(replayCreate.project.id).toBe(firstCreate.project.id);
    expect(replayCreate.project.revision).toBe(1);

    // Hydrated GET resolves fresh MediaStore URLs for clips, takes, and BGM
    const loaded = await loadVideoProjects(deps, viewerOf(f.ids.owner), f.orgId, firstCreate.project.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.project) throw new Error('expected loaded project');
    expect(loaded.projects).toHaveLength(1);
    const hydratedClip = loaded.project.timeline.clips[0]!;
    expect(hydratedClip.srcUrl).toBe(media.url(outKey));
    expect(hydratedClip.thumbUrl).toBe(media.url(outThumbKey));
    expect(hydratedClip.takes).toHaveLength(2);
    expect(hydratedClip.takes?.[0]?.srcUrl).toContain('/api/brand-studio/media/st/');
    expect(hydratedClip.takes?.[1]?.srcUrl).toBe(media.url(outKey));
    expect(loaded.project.timeline.bgm?.srcUrl).toBe(media.url(bgmKey));

    // Optimistic concurrency via HTTP POST /api/brand-studio/video-projects
    const saveRes = await routePost({
      op: 'save',
      organizationId: f.orgId,
      projectId: firstCreate.project.id,
      title: '26FW 세럼 마스터 시퀀스',
      timeline: loaded.project.timeline,
      expectedRevision: 1,
    });
    expect(saveRes.status).toBe(200);
    const savedBody = await saveRes.json();
    expect(savedBody.ok).toBe(true);
    expect(savedBody.project.revision).toBe(2);
    expect(savedBody.project.title).toBe('26FW 세럼 마스터 시퀀스');

    // Stale expectedRevision returns 409 conflict with currentRevision
    const staleRes = await routePost({
      op: 'save',
      organizationId: f.orgId,
      projectId: firstCreate.project.id,
      timeline: loaded.project.timeline,
      expectedRevision: 1,
    });
    expect(staleRes.status).toBe(409);
    expect(await staleRes.json()).toEqual({
      ok: false,
      code: 'conflict',
      currentRevision: 2,
    });
  });

  it('enforces 404 isolation for Morphic org IDs/names, generative_media policy denials, guests & outsiders, and 403 for viewers on POST', async () => {
    // 1. Flag off -> 404
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    expect((await routeGet(`organizationId=${f.orgId}`)).status).toBe(404);
    vi.stubEnv('BRAND_STUDIO_V2', 'on');

    // 2. Unauthenticated -> 401; Cross-site POST -> 403
    routeMocks.viewer = null;
    expect((await routeGet(`organizationId=${f.orgId}`)).status).toBe(401);
    routeMocks.viewer = viewerOf(f.ids.owner);
    expect(
      (
        await routePost(
          { op: 'create', organizationId: f.orgId, requestId: 'req_csrf' },
          { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        )
      ).status,
    ).toBe(403);

    // 3. Viewer can GET (canCreate: false) but gets 403 on POST; guest & outsider get 404
    routeMocks.viewer = viewerOf(f.ids.viewer);
    const viewerGet = await routeGet(`organizationId=${f.orgId}`);
    expect(viewerGet.status).toBe(200);
    expect(await viewerGet.json()).toMatchObject({ ok: true, canCreate: false });
    expect(
      (await routePost({ op: 'create', organizationId: f.orgId, requestId: 'req_viewer_denied' })).status,
    ).toBe(403);

    for (const deniedUser of [f.ids.guest, f.ids.outsider]) {
      routeMocks.viewer = viewerOf(deniedUser);
      expect((await routeGet(`organizationId=${f.orgId}`)).status).toBe(404);
      expect(
        (await routePost({ op: 'create', organizationId: f.orgId, requestId: 'req_out' })).status,
      ).toBe(404);
    }

    // 4. Morphic sandboxed org IDs & Morphic / 모픽 org names -> strict 404
    routeMocks.viewer = viewerOf(f.ids.owner);
    const closedOrgs: Array<{ id: string; name: string }> = [
      ...[...SANDBOXED_CLIENT_ORG_IDS].map((id, idx) => ({ id, name: `Client Sandbox ${idx + 1}` })),
      { id: randomUUID(), name: 'Morphic Studio' },
      { id: randomUUID(), name: '모픽 코리아' },
    ];
    for (const org of closedOrgs) {
      await f.sql.query(
        'insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)',
        [org.id, org.name, f.ids.owner, randomUUID()],
      );
      await f.sql.query(
        "insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
        [org.id, f.ids.owner],
      );
      expect((await routeGet(`organizationId=${org.id}`)).status).toBe(404);
      expect(
        (await routePost({ op: 'create', organizationId: org.id, requestId: `req_${org.id.slice(0, 8)}` })).status,
      ).toBe(404);
    }

    // 5. Organization with `generative_media` denied in `brand_feature_policies` -> strict 404
    const policyDeniedOrgId = randomUUID();
    await f.sql.query(
      'insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)',
      [policyDeniedOrgId, 'Policy Restricted Brand', f.ids.owner, randomUUID()],
    );
    await f.sql.query(
      "insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')",
      [policyDeniedOrgId, f.ids.owner],
    );
    await f.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, updated_by)
       values ($1, array['generative_media']::text[], $2)`,
      [policyDeniedOrgId, f.ids.admin],
    );
    expect((await routeGet(`organizationId=${policyDeniedOrgId}`)).status).toBe(404);
    expect(
      (await routePost({ op: 'create', organizationId: policyDeniedOrgId, requestId: 'req_policy_denied' })).status,
    ).toBe(404);
  });

  it('purges `film_sheets` cache on `completed`, `archived`, and `delete` ONLY when no other active project in the org references that asset', async () => {
    const studioD = studioDeps(f.sql, { media });
    const sharedRefAssetId = await seedVideoAsset(studioD, f.orgId, f.ids.owner, 12);
    const exclusiveRefAssetId = await seedVideoAsset(studioD, f.orgId, f.ids.owner, 10);
    const archivedOnlyAssetId = await seedVideoAsset(studioD, f.orgId, f.ids.owner, 9);

    const sampleSheet = {
      seconds: 12,
      aspect: '9:16',
      shots: [{ start: 0, end: 12, framing: 'medium', camera: 'push-in', action: 'bottle hero' }],
      look: { lighting: 'soft', palette: 'neutral', texture: 'clean' },
      audio: { music: true, speech: false, effects: '' },
      summary: '12초 레퍼런스 샷 시트',
    };

    for (const assetId of [sharedRefAssetId, exclusiveRefAssetId, archivedOnlyAssetId]) {
      await f.sql.query(
        `update brand_studio_assets
            set film_sheets = $2::jsonb,
                film_sheets_updated_at = now(),
                film_sheets_expires_at = now() + interval '7 days'
          where id = $1`,
        [assetId, JSON.stringify({ 'seedance-2.5': sampleSheet })],
      );
    }

    const readFilmSheetState = async (assetId: string) => {
      const row = (
        await f.sql.query<{
          film_sheets: unknown;
          film_sheets_updated_at: Date | string | null;
          film_sheets_expires_at: Date | string | null;
        }>(
          `select film_sheets, film_sheets_updated_at, film_sheets_expires_at
             from brand_studio_assets
            where id = $1`,
          [assetId],
        )
      ).rows[0]!;
      return row;
    };

    // Project A references BOTH `sharedRefAssetId` (in clips) and `exclusiveRefAssetId` (in referenceAssetIds)
    let timelineA = emptyComposerProject('9:16');
    timelineA = appendClip(timelineA, {
      id: 'clip_shared_a',
      label: '공유 레퍼런스 컷',
      sourceKind: 'asset',
      assetId: sharedRefAssetId,
      srcUrl: '/api/brand-studio/media/st/shared.mp4',
      thumbUrl: null,
      durationSec: 12,
      trimStartSec: 0,
      trimEndSec: 12,
      volume: 1,
      muted: false,
    });
    timelineA = { ...timelineA, referenceAssetIds: [exclusiveRefAssetId] };

    // Project B is also `active` and still references `sharedRefAssetId`
    const timelineB: ComposerProject = {
      ...emptyComposerProject('9:16'),
      referenceAssetIds: [sharedRefAssetId],
    };

    // Project C references `archivedOnlyAssetId`
    const timelineC: ComposerProject = {
      ...emptyComposerProject('9:16'),
      referenceAssetIds: [archivedOnlyAssetId],
    };

    const projA = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: 'req_proj_a',
      title: '프로젝트 A',
      timeline: timelineA,
    });
    const projB = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: 'req_proj_b',
      title: '프로젝트 B',
      timeline: timelineB,
    });
    const projC = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'create', {
      organizationId: f.orgId,
      requestId: 'req_proj_c',
      title: '프로젝트 C',
      timeline: timelineC,
    });
    if (!projA.ok || !projB.ok || !projC.ok) throw new Error('expected seed projects ok');

    // Step 1: Complete Project A -> `exclusiveRefAssetId` MUST be purged, while `sharedRefAssetId` MUST stay intact!
    const completedA = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'status', {
      organizationId: f.orgId,
      projectId: projA.project!.id,
      status: 'completed',
    });
    expect(completedA.ok).toBe(true);
    if (!completedA.ok) throw new Error('expected complete ok');
    expect(completedA.project?.status).toBe('completed');
    expect(completedA.project?.completedAt).not.toBeNull();
    expect(completedA.purgedShotSheetAssetIds).toEqual([exclusiveRefAssetId]);

    const exclusiveAfterA = await readFilmSheetState(exclusiveRefAssetId);
    expect(exclusiveAfterA.film_sheets).toBeNull();
    expect(exclusiveAfterA.film_sheets_updated_at).toBeNull();
    expect(exclusiveAfterA.film_sheets_expires_at).toBeNull();

    const sharedAfterA = await readFilmSheetState(sharedRefAssetId);
    expect(sharedAfterA.film_sheets).not.toBeNull();
    expect(sharedAfterA.film_sheets_updated_at).not.toBeNull();
    expect(sharedAfterA.film_sheets_expires_at).not.toBeNull();

    // Step 2: Soft-delete Project B (`op: 'delete'`) -> now zero active projects reference `sharedRefAssetId`, so it MUST be purged!
    const deletedB = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'delete', {
      organizationId: f.orgId,
      projectId: projB.project!.id,
    });
    expect(deletedB.ok).toBe(true);
    if (!deletedB.ok) throw new Error('expected delete ok');
    expect(deletedB.purgedShotSheetAssetIds).toEqual([sharedRefAssetId]);

    const sharedAfterB = await readFilmSheetState(sharedRefAssetId);
    expect(sharedAfterB.film_sheets).toBeNull();
    expect(sharedAfterB.film_sheets_updated_at).toBeNull();
    expect(sharedAfterB.film_sheets_expires_at).toBeNull();

    // Step 3: Archive Project C (`status: 'archived'`) -> `archivedOnlyAssetId` MUST also be purged!
    const archivedC = await runVideoProjectOperation(deps, viewerOf(f.ids.owner), 'status', {
      organizationId: f.orgId,
      projectId: projC.project!.id,
      status: 'archived',
    });
    expect(archivedC.ok).toBe(true);
    if (!archivedC.ok) throw new Error('expected archive ok');
    expect(archivedC.purgedShotSheetAssetIds).toEqual([archivedOnlyAssetId]);

    const archivedAfterC = await readFilmSheetState(archivedOnlyAssetId);
    expect(archivedAfterC.film_sheets).toBeNull();
    expect(archivedAfterC.film_sheets_updated_at).toBeNull();
    expect(archivedAfterC.film_sheets_expires_at).toBeNull();
  });
});

describe('Studio Pro Suite v5 Track B — 3. Take Stacks (`stackClipTake` / `selectClipTake`) & Premiere/DaVinci XML Bundle Integration', () => {
  it('stacks multiple takes (`1/3`, `2/3`, `3/3`), switches active takes non-destructively, round-trips storage, and exports NLE bundle with BGM by default', async () => {
    let project = emptyComposerProject('9:16');
    project = appendClip(project, {
      id: 'hero_cut',
      label: '세럼 클로즈업',
      sourceKind: 'output',
      outputId: '00000000-0000-4000-8000-000000000301',
      srcUrl: '/media/take1.mp4',
      thumbUrl: '/media/take1.webp',
      durationSec: 6,
      trimStartSec: 0.5,
      trimEndSec: 5.5,
      volume: 1,
      muted: false,
    });

    // Stack Take 2
    project = stackClipTake(project, 'hero_cut', {
      label: '세럼 클로즈업 T2',
      sourceKind: 'output',
      outputId: '00000000-0000-4000-8000-000000000302',
      srcUrl: '/media/take2.mp4',
      thumbUrl: '/media/take2.webp',
      durationSec: 8,
      trimStartSec: 1,
      trimEndSec: 7,
    });

    // Stack Take 3
    project = stackClipTake(project, 'hero_cut', {
      label: '세럼 클로즈업 T3 (1080p)',
      sourceKind: 'asset',
      assetId: '00000000-0000-4000-8000-000000000303',
      srcUrl: '/media/take3-master.mp4',
      thumbUrl: '/media/take3-master.webp',
      durationSec: 8,
      trimStartSec: 0,
      trimEndSec: 8,
    });

    const stacked = project.clips[0]!;
    expect(stacked.takes).toHaveLength(3);
    expect(stacked.activeTakeIndex).toBe(2);
    expect(stacked.srcUrl).toBe('/media/take3-master.mp4');
    expect(stacked.assetId).toBe('00000000-0000-4000-8000-000000000303');
    expect(stacked.outputId).toBeUndefined();
    expect([stacked.trimStartSec, stacked.trimEndSec]).toEqual([0, 8]);

    // Trim Take 3, then switch back to Take 1 (`1/3`) and Take 2 (`2/3`)
    project = applyTimelinePatches(project, [
      { op: 'trim_clip', clipIndex: 0, trimStartSec: 0.8, trimEndSec: 6.8 },
    ]).project;

    const switchedTo1 = selectClipTake(project, 'hero_cut', 0);
    expect(switchedTo1.clips[0]?.activeTakeIndex).toBe(0);
    expect(switchedTo1.clips[0]?.srcUrl).toBe('/media/take1.mp4');
    expect(switchedTo1.clips[0]?.outputId).toBe('00000000-0000-4000-8000-000000000301');
    expect([switchedTo1.clips[0]?.trimStartSec, switchedTo1.clips[0]?.trimEndSec]).toEqual([0.5, 5.5]);

    const switchedBackTo3 = selectClipTake(switchedTo1, 'hero_cut', 2);
    expect(switchedBackTo3.clips[0]?.activeTakeIndex).toBe(2);
    expect(switchedBackTo3.clips[0]?.srcUrl).toBe('/media/take3-master.mp4');
    expect([switchedBackTo3.clips[0]?.trimStartSec, switchedBackTo3.clips[0]?.trimEndSec]).toEqual([0.8, 6.8]);

    // Storage round-trip preserves takes & activeTakeIndex
    const restored = parseStoredProject(serializeProjectForStorage(switchedBackTo3));
    expect(restored?.clips[0]?.takes).toHaveLength(3);
    expect(restored?.clips[0]?.activeTakeIndex).toBe(2);

    // NLE bundle export uses the active take & includes BGM by default (`includeBgm` omitted)
    const withBgm: ComposerProject = {
      ...switchedBackTo3,
      bgm: {
        label: 'French House Runway 122',
        sourceKind: 'asset',
        assetId: '00000000-0000-4000-8000-000000000399',
        srcUrl: '/media/guide-bgm.wav',
        durationSec: 12,
        trimStartSec: 0,
        volume: 0.5,
        nonCommercialGuide: true,
      },
    };
    const fetchedUrls: string[] = [];
    const bundle = await exportProjectNleBundleZip(
      withBgm,
      async (url) => {
        fetchedUrls.push(url);
        return new Uint8Array([0, 1, 2, 3]);
      },
      { projectTitle: '26FW 세럼 프로젝트' },
    );
    expect(bundle.filename).toMatch(/\.zip$/);
    expect(bundle.zipBytes.byteLength).toBeGreaterThan(0);
    expect(fetchedUrls).toContain('/media/take3-master.mp4');
    expect(fetchedUrls).toContain('/media/guide-bgm.wav');
    expect(bundle.xml).toContain('bgm_track.wav');
    expect(bundle.xml).toContain('clipitem-bgm-1-a1');
  });
});

describe('Studio Pro Suite v5 Track B — 4. 3-Height Elastic Sequence Rail, Floating Clip Bar, Collapsed Dock & Right Asset Drawer', () => {
  function sampleMultiTakeTimeline(): ComposerProject {
    let p = emptyComposerProject('9:16');
    p = appendClip(p, {
      id: 'seq_clip_1',
      label: '런웨이 오프닝',
      sourceKind: 'output',
      outputId: '00000000-0000-4000-8000-000000000501',
      srcUrl: '/api/brand-studio/media/st/clip1-t1.mp4',
      thumbUrl: '/api/brand-studio/media/st/clip1-t1.webp',
      durationSec: 8,
      trimStartSec: 0,
      trimEndSec: 8,
      volume: 1,
      muted: false,
      cutMarkers: [2.6, 5.4],
    });
    p = stackClipTake(p, 'seq_clip_1', {
      label: '런웨이 오프닝 T2',
      sourceKind: 'output',
      outputId: '00000000-0000-4000-8000-000000000502',
      srcUrl: '/api/brand-studio/media/st/clip1-t2.mp4',
      thumbUrl: '/api/brand-studio/media/st/clip1-t2.webp',
      durationSec: 8,
      trimStartSec: 0,
      trimEndSec: 8,
    });
    p = applyTimelinePatches(p, [{ op: 'set_clip_cuts', clipIndex: 0, cutMarkers: [2.6, 5.4] }]).project;
    p = appendClip(p, {
      id: 'seq_clip_2',
      label: '보틀 클로즈업',
      sourceKind: 'asset',
      assetId: '00000000-0000-4000-8000-000000000503',
      srcUrl: '/api/brand-studio/media/st/clip2.mp4',
      thumbUrl: '/api/brand-studio/media/st/clip2.webp',
      durationSec: 5,
      trimStartSec: 0,
      trimEndSec: 5,
      volume: 1,
      muted: false,
    });
    return p;
  }

  const recentImgJob = job(10, {
    kind: 'image',
    prompt: '프렌치 블루 세럼 스틸컷',
    outputs: [output(101, { kind: 'image', url: '/api/brand-studio/media/st/still.png' })],
  });
  const recentVidJob = job(11, {
    kind: 'video',
    model: 'seedance-2.5',
    prompt: '런웨이 오프닝 시안',
    seconds: 8,
    outputs: [output(102, { kind: 'video', seconds: 8, url: '/api/brand-studio/media/st/vid.mp4' })],
  });

  it('renders Project Bar, Take Stack `2/2` pill, all 7 Floating Clip Bar actions, Recent Creations Drawer, and 3 rail heights (`compact` / `medium` / `full`) with strict single solid CTA', () => {
    const initial = studioState({
      canCreate: true,
      jobs: [recentVidJob, recentImgJob],
      assets: [
        asset(1, { kind: 'image', name: 'serum-packshot.png', role: 'product' }),
        asset(2, { kind: 'audio', name: 'runway-loop.wav', seconds: 14 }),
      ],
    });
    const timeline = sampleMultiTakeTimeline();

    // 1. `compact` (72px default): Dock open + Sequence Rail compact + Floating Clip Bar + Recent Drawer
    // (music generation open, so all 7 actions show; closed is covered below)
    const compactHtml = renderToStaticMarkup(
      h(VideoStudioWorkspace, {
        organizationId: ORG,
        locale: 'ko',
        copy: koDict.brandStudio,
        libraryCopy: koDict.studioLibrary,
        videoCopy: koDict.studioVideo,
        initialState: initial,
        initialRailHeight: 'compact',
        initialTimeline: timeline,
        initialSelectedClipId: 'seq_clip_1',
        musicGeneration: true,
      }),
    );

    expect(compactHtml).toContain('data-video-project-bar');
    expect(compactHtml).toContain('data-video-project-switcher');
    expect(compactHtml).toContain('내 프로젝트');
    expect(compactHtml).toContain('data-video-layout-preset');
    expect(compactHtml).toContain('클립 생성');
    expect(compactHtml).toContain('컷 편집');
    expect(compactHtml).toContain('data-video-share-review');
    expect(compactHtml).toContain('data-video-export-nle');
    expect(compactHtml).toContain('Premiere · DaVinci (.xml)');
    expect(compactHtml).toContain('data-video-export-mp4');
    expect(compactHtml).toContain('MP4 내보내기');

    // Sequence Rail in `compact` + Take Stack `2/2` + Floating Clip Bar 7 actions
    expect(compactHtml).toContain('data-sequence-rail');
    expect(compactHtml).toContain('data-rail-height="compact"');
    expect(compactHtml).toContain('data-clip-take-stack="seq_clip_1"');
    expect(compactHtml).toContain('>2/2<');
    expect(compactHtml).toContain('data-sequence-floating-bar');
    for (const action of [
      'trim',
      'detect-cuts',
      'color-grade',
      'attach-ref',
      'generate-music',
      'upscale',
      'delete',
    ]) {
      expect(compactHtml).toContain(`data-floating-action="${action}"`);
    }
    expect(compactHtml).toContain('자르기');
    expect(compactHtml).toContain('컷 자동 인식');
    expect(compactHtml).toContain('레퍼런스 색보정');
    expect(compactHtml).toContain('레퍼런스에 추가');
    expect(compactHtml).toContain('이 구간 음악 생성');
    expect(compactHtml).toContain('업스케일');
    expect(compactHtml).toContain('삭제');

    // Right-hand drawer surfaces Recent Creations (`전체` / `이미지` / `영상`) + `LibraryRail`
    expect(compactHtml).toContain('data-video-recent-drawer');
    expect(compactHtml).toContain('data-recent-filter="all"');
    expect(compactHtml).toContain('data-recent-filter="image"');
    expect(compactHtml).toContain('data-recent-filter="video"');
    expect(compactHtml).toContain('data-library-rail');
    expect(compactHtml).toContain('data-studio-dock');
    expect(compactHtml).not.toContain('data-video-expand-dock');
    expect(compactHtml.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(compactHtml).not.toMatch(/morphic|모픽|higgsfield|sunra|comfyui|sheetsage|yue2|seedvr2/i);
    expect(compactHtml).not.toMatch(/₩|KRW|\d\s*원|#ebf5ff/i);

    // 2. `medium` (200px quick cut & trim): trim inputs + cut markers + BGM & caption lanes + Dock STILL open!
    const mediumHtml = renderToStaticMarkup(
      h(VideoStudioWorkspace, {
        organizationId: ORG,
        locale: 'ko',
        copy: koDict.brandStudio,
        libraryCopy: koDict.studioLibrary,
        videoCopy: koDict.studioVideo,
        initialState: initial,
        initialRailHeight: 'medium',
        initialTimeline: timeline,
        initialSelectedClipId: 'seq_clip_1',
      }),
    );
    expect(mediumHtml).toContain('data-rail-height="medium"');
    expect(mediumHtml).toContain('data-clip-trim-in="seq_clip_1"');
    expect(mediumHtml).toContain('data-clip-trim-out="seq_clip_1"');
    expect(mediumHtml).toContain('data-clip-cut-markers="seq_clip_1"');
    expect(mediumHtml).toContain('data-sequence-bgm-lane');
    expect(mediumHtml).toContain('data-sequence-caption-lane');
    expect(mediumHtml).toContain('data-studio-dock');
    expect(mediumHtml.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(mediumHtml).not.toMatch(/morphic|모픽|higgsfield|sunra|comfyui|sheetsage|yue2|seedvr2/i);
    expect(mediumHtml).not.toMatch(/₩|KRW|\d\s*원|#ebf5ff/i);

    // 3. `full` (55vh precision editor): monitor + 4-tab inspector + Dock collapsed to 1-line pill `[data-video-expand-dock]`
    const fullHtml = renderToStaticMarkup(
      h(VideoStudioWorkspace, {
        organizationId: ORG,
        locale: 'ko',
        copy: koDict.brandStudio,
        libraryCopy: koDict.studioLibrary,
        videoCopy: koDict.studioVideo,
        initialState: initial,
        initialRailHeight: 'full',
        initialTimeline: timeline,
        initialSelectedClipId: 'seq_clip_1',
      }),
    );
    expect(fullHtml).toContain('data-rail-height="full"');
    expect(fullHtml).toContain('data-sequence-monitor');
    expect(fullHtml).toContain('data-sequence-inspector');
    expect(fullHtml).toContain('data-inspector-tab="color"');
    expect(fullHtml).toContain('data-inspector-tab="music"');
    expect(fullHtml).toContain('data-inspector-tab="captions"');
    expect(fullHtml).toContain('data-inspector-tab="upscale"');
    expect(fullHtml).toContain('data-video-expand-dock');
    expect(fullHtml).toContain('+ 새 클립 만들기…');
    expect(fullHtml).not.toContain('data-studio-dock');
    expect(fullHtml.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(lintPublicBrandSurface(fullHtml)).toEqual({ clean: true, violations: [] });
  });

  it('hides music generation while BRAND_STUDIO_MUSIC_GENERATION is closed, keeping the BGM lane and the sound-effect generator', () => {
    const initial = studioState({
      canCreate: true,
      jobs: [recentVidJob],
      assets: [asset(2, { kind: 'audio', name: 'runway-loop.wav', seconds: 14 })],
    });
    const timeline = sampleMultiTakeTimeline();
    const rail = koDict.studioVideo.workspace.rail;
    const workspace = (height: 'compact' | 'medium' | 'full', musicGeneration?: boolean) =>
      renderToStaticMarkup(
        h(VideoStudioWorkspace, {
          organizationId: ORG,
          locale: 'ko',
          copy: koDict.brandStudio,
          libraryCopy: koDict.studioLibrary,
          videoCopy: koDict.studioVideo,
          initialState: initial,
          initialRailHeight: height,
          initialTimeline: timeline,
          initialSelectedClipId: 'seq_clip_1',
          ...(musicGeneration === undefined ? {} : { musicGeneration }),
        }),
      );

    // Closed is the default: no generate-music action and no generation wording at any height.
    for (const height of ['compact', 'medium', 'full'] as const) {
      const closed = workspace(height);
      expect(closed, height).toContain('data-sequence-floating-bar');
      expect(closed, height).toContain('data-floating-action="upscale"');
      expect(closed, height).not.toContain('data-floating-action="generate-music"');
      expect(closed, height).not.toContain('구간 음악 생성');
      // Export is free: the button carries no price.
      expect(closed, height).toContain('data-video-export-mp4');
      expect(closed, height).not.toContain('MP4 내보내기 ·');
    }
    const medium = workspace('medium');
    expect(medium).toContain('data-sequence-bgm-lane');
    expect(medium).toContain(`<span>${rail.bgmNone}</span>`);
    const full = workspace('full');
    expect(full).toContain('data-inspector-tab="music"');
    expect(full).toContain(rail.inspector.sfxTitle);

    // Open: the action, the lane's generate button and the tab name come back.
    expect(workspace('compact', true)).toContain('data-floating-action="generate-music"');
    expect(workspace('medium', true)).toContain(rail.bgmEmpty);
    expect(workspace('full', true)).toContain(rail.inspector.musicTab);

    // The inspector's music tab itself.
    const inspector = (musicGeneration: boolean, project: ComposerProject = timeline) =>
      renderToStaticMarkup(
        h(SequenceRail, {
          organizationId: ORG,
          locale: 'ko',
          canEdit: true,
          project,
          railHeight: 'full',
          selectedClipId: null,
          inspectorTab: 'music',
          audioAssets: [asset(2, { kind: 'audio', name: 'runway-loop.wav', seconds: 14 })],
          musicGeneration,
          railCopy: rail,
          floatingCopy: koDict.studioVideo.workspace.floatingBar,
          onHeightChange: () => {},
          onSelectClip: () => {},
          onInspectorTabChange: () => {},
          onProjectChange: () => {},
          onAttachClipToDock: () => {},
          onLocalVideoFiles: () => {},
          onNotice: () => {},
        }),
      );
    const closedPanel = inspector(false);
    expect(closedPanel).toContain('data-inspector-panel="music"');
    expect(closedPanel).toContain('data-sfx-generator');
    expect(closedPanel).toContain('data-sfx-generate');
    for (const marker of ['data-inspector-generate-music', 'data-music-style=', 'data-music-license-badge']) {
      expect(closedPanel).not.toContain(marker);
    }
    const openPanel = inspector(true);
    for (const marker of ['data-inspector-generate-music', 'data-music-style=', 'data-music-license-badge', 'data-sfx-generate']) {
      expect(openPanel).toContain(marker);
    }
    // A guide track already on the timeline keeps its non-commercial notice while generation is closed.
    const withGuide: ComposerProject = {
      ...timeline,
      bgm: {
        label: 'Guide',
        sourceKind: 'local',
        srcUrl: '/guide.mp3',
        durationSec: 12,
        trimStartSec: 0,
        volume: 0.6,
        nonCommercialGuide: true,
      },
    };
    const guidePanel = inspector(false, withGuide);
    expect(guidePanel).toContain('data-music-license-badge');
    expect(guidePanel).toContain(rail.inspector.musicLicense);
    expect(guidePanel).not.toContain('data-inspector-generate-music');
  });

  it('counts only the cut points inside a cut\'s trim, the same ones its split button uses (E2)', () => {
    const rail = koDict.studioVideo.workspace.rail;
    const source = {
      sourceKind: 'output' as const,
      outputId: '00000000-0000-4000-8000-000000000601',
      srcUrl: '/api/brand-studio/media/st/source.mp4',
      thumbUrl: '/api/brand-studio/media/st/source.webp',
      durationSec: 8,
      volume: 1,
      muted: false,
    };
    let p = emptyComposerProject('9:16');
    // A piece left after an automatic split still carries the whole source's cut points, none inside it.
    p = appendClip(p, { ...source, id: 'piece_after', label: '뒤 조각', trimStartSec: 6, trimEndSec: 8, cutMarkers: [2.6, 5.4] });
    p = appendClip(p, { ...source, id: 'whole_one', label: '한 군데', trimStartSec: 0, trimEndSec: 8, cutMarkers: [2.6] });
    const html = renderToStaticMarkup(
      h(SequenceRail, {
        organizationId: ORG,
        locale: 'ko',
        canEdit: true,
        project: p,
        railHeight: 'medium',
        selectedClipId: null,
        inspectorTab: 'color',
        audioAssets: [],
        railCopy: rail,
        floatingCopy: koDict.studioVideo.workspace.floatingBar,
        onHeightChange: () => {},
        onSelectClip: () => {},
        onInspectorTabChange: () => {},
        onProjectChange: () => {},
        onAttachClipToDock: () => {},
        onLocalVideoFiles: () => {},
        onNotice: () => {},
      }),
    );
    expect(html).not.toContain('data-clip-cut-markers="piece_after"');
    expect(html).toContain('data-clip-cut-markers="whole_one"');
    // Badge and button name the same number of cut points.
    expect(html).toContain('컷 1개');
    expect(html).toContain('감지 컷 1개 분할');
    expect(html).not.toContain('컷 2개');
  });

  it('exposes Premiere · DaVinci (.xml) NLE bundle export in standalone VideoComposer and keeps 0ms rail transition CSS clean', () => {
    const composerHtml = renderToStaticMarkup(
      h(VideoComposer, {
        organizationId: ORG,
        locale: 'ko',
        canCreate: true,
        copy: koDict.studioCompose,
        videoStudioHref: `/brand/studio/video?organizationId=${ORG}`,
        initialAllowance: allowance(),
        initialAssets: [],
        initialVideoOutputs: [],
        initialProject: sampleMultiTakeTimeline(),
      }),
    );
    expect(composerHtml).toContain('data-compose-export-nle');
    expect(composerHtml).toContain('Premiere · DaVinci (.xml)');
    expect(composerHtml.match(/data-variant="solid"/g)).toHaveLength(1);
    expect(lintPublicBrandSurface(composerHtml)).toEqual({ clean: true, violations: [] });

    const css = readFileSync(
      join(process.cwd(), 'components/brand-studio/video/video-workspace.module.css'),
      'utf8',
    );
    expect(css).toContain('transition: none');
    expect(css).not.toMatch(/#ebf5ff/i);
  });
});
