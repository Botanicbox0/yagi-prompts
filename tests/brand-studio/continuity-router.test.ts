import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import {
  pickBestContinuationFrameIndex,
  scoreRgbaFrameQuality,
} from '@/lib/brand-studio/continuity/frame-picker';
import { planSceneContinuation } from '@/lib/brand-studio/continuity/planner';
import type { ContinuityKeyframeCandidate } from '@/lib/brand-studio/continuity/contracts';
import { seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () =>
    mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));

const postProdRoute = await import('@/app/api/brand-studio/post-production/route');

const BASE = 'http://localhost:3000/api/brand-studio/post-production';
const postPostProd = (body: unknown, headers?: Record<string, string>) =>
  postProdRoute.POST(
    new NextRequest(BASE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );

function makeSolidRgba(width: number, height: number, value: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = value;
    buf[i + 1] = value;
    buf[i + 2] = value;
    buf[i + 3] = 255;
  }
  return buf;
}

function makeSharpMidKeyCheckerRgba(width: number, height: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const hi = ((x >> 1) + (y >> 1)) % 2 === 0 ? 158 : 88;
      buf[idx] = hi;
      buf[idx + 1] = hi;
      buf[idx + 2] = hi;
      buf[idx + 3] = 255;
    }
  }
  return buf;
}

// Minimal valid 1x1 JPEG base64 payload for multimodal inline frame unit tests
const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

describe('>30s Next-Scene Continuity Router (`continuity`)', () => {
  let f: StudioFixture | null = null;

  beforeEach(() => {
    mocks.sql = null;
    mocks.viewer = null;
  });

  afterEach(async () => {
    if (f) {
      await f.db.close();
      f = null;
    }
  });

  it('scores sharp mid-key RGBA frames above blackout or blown flash frames and avoids trailing fade-outs', () => {
    const black = scoreRgbaFrameQuality(makeSolidRgba(16, 16, 4), 16, 16, { recency: 1 });
    const blown = scoreRgbaFrameQuality(makeSolidRgba(16, 16, 252), 16, 16, { recency: 1 });
    const sharp = scoreRgbaFrameQuality(makeSharpMidKeyCheckerRgba(16, 16), 16, 16, { recency: 0.7 });

    expect(black.isBlackoutOrBlown).toBe(true);
    expect(blown.isBlackoutOrBlown).toBe(true);
    expect(sharp.isBlackoutOrBlown).toBe(false);
    expect(sharp.sharpness).toBeGreaterThan(0.5);
    expect(sharp.totalScore).toBeGreaterThan(black.totalScore);
    expect(sharp.totalScore).toBeGreaterThan(blown.totalScore);

    const candidates: ContinuityKeyframeCandidate[] = [
      { timestampSec: 4.2, sharpness: 0.4, exposure: 0.55, motionDelta: 0.45 },
      { timestampSec: 4.9, sharpness: 0.84, exposure: 0.9, motionDelta: 0.08 },
      { timestampSec: 5.8, sharpness: 0.9, exposure: 0.05, motionDelta: 0.02 },
    ];
    expect(pickBestContinuationFrameIndex(candidates)).toBe(1);
  });

  it('routes studio-generated clips via Path A (`studio_lineage`), reuses cached FilmSheet & job refs, calls gemini-4-hydrogen HIGH thinking, and scrubs vendor terms', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    const deps = studioDeps(f.sql);
    const productAssetId = await seedImageAsset(deps, f.orgId, f.ids.owner, { role: 'product' });
    const videoAssetId = await seedVideoAsset(deps, f.orgId, f.ids.owner, 6);

    await deps.sql.query(
      `update brand_studio_assets
          set film_sheets = $2::jsonb
        where organization_id = $1 and id = $3`,
      [
        f.orgId,
        JSON.stringify({
          'blueprint:ko': {
            seconds: 6,
            aspect: '9:16',
            setting: '젖은 블랙 슬레이트 테이블 위 미니멀 스튜디오',
            shots: [
              {
                start: 0,
                end: 6,
                framing: 'close-up',
                camera: 'slow dolly-in',
                action: '세럼 보틀 위로 물방울이 천천히 맺힌다',
              },
            ],
            look: { lighting: '차가운 실버 림 라이트', palette: '딥 차콜과 코발트 하이라이트', texture: '매트 유리' },
            audio: { music: true, speech: false, effects: 'water droplets' },
            summary: '6초 보틀 클로즈업',
          },
        }),
        videoAssetId,
      ],
    );

    const jobId = (
      await deps.sql.query<{ id: string }>(
        `insert into brand_studio_jobs
           (organization_id, created_by, request_id, kind, status, model, prompt, final_prompt, refs, finished_at)
         values
           ($1, $2, $3, 'video', 'succeeded', 'seedance-2.5', 'Bottle on wet slate', 'Macro dolly-in on @Image1 serum bottle', $4::jsonb, now())
         returning id`,
        [
          f.orgId,
          f.ids.owner,
          `cont_${randomUUID().slice(0, 12)}`,
          JSON.stringify([{ assetId: productAssetId, role: 'product', frame: 'start' }]),
        ],
      )
    ).rows[0]!.id;

    const outputId = randomUUID();
    await deps.sql.query(
      `insert into brand_studio_outputs
         (id, job_id, organization_id, idx, kind, status, mime, width, height, duration_ms, storage_key, saved_asset_id)
       values ($1, $2, $3, 0, 'video', 'ready', 'video/mp4', 1080, 1920, 6000, 'mock/shot1.mp4', $4)`,
      [outputId, jobId, f.orgId, videoAssetId],
    );

    const captured: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      captured.push({ url, body });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      recommendedPrompt:
                        '@이미지 1 보틀 표면의 빛 번짐을 이어받아 측면으로 궤도 회전하는 다음 컷 Seedance Gemini',
                      cameraTransition: '클로즈업 정점에서 오른쪽 25도 궤도 팬으로 연결됩니다.',
                      continuityNotes: '직전 장면의 조명과 @이미지 1 제품 실루엣을 그대로 유지해요.',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const plan = await planSceneContinuation(
      deps,
      {
        organizationId: f.orgId,
        locale: 'ko',
        clipLabel: '오프닝 세럼 샷',
        outputId,
        clipDurationSec: 6,
        sequenceDurationSec: 26,
        targetNextSeconds: 6,
      },
      { env: { GEMINI_API_KEY: 'test-gemini-key' }, fetchImpl },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain('/models/gemini-4-hydrogen:generateContent');
    expect(captured[0]!.body).toMatchObject({
      generationConfig: {
        thinkingConfig: { thinkingLevel: 'HIGH' },
      },
    });

    expect(plan.path).toBe('studio_lineage');
    expect(plan.over30sSequence).toBe(true);
    expect(plan.creditsUsed).toBe(0);
    expect(plan.referenceRefs).toEqual([
      {
        kind: 'asset',
        id: productAssetId,
        mediaKind: 'image',
        name: 'seed',
        role: 'start_frame',
      },
    ]);
    expect(plan.filmSheetSummary).toContain('마지막 컷');
    expect(plan.recommendedPrompt).toContain('@이미지 1');
    expect(plan.recommendedPrompt).not.toMatch(/seedance|gemini/i);
  });

  it('routes external uploaded clips via Path B (`external_keyframes`), selects best tail frame, sends inline JPEG data, and handles fake fallback', async () => {
    f = await studioFixture({ capKrw: 1_000_000 });
    const deps = studioDeps(f.sql);
    const externalAssetId = await seedVideoAsset(deps, f.orgId, f.ids.owner, 7);

    const capturedParts: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as { contents?: Array<{ parts?: unknown[] }> }) : {};
      capturedParts.push(...(body.contents?.[0]?.parts ?? []));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      recommendedPrompt: 'Wide twilight street follow shot carrying forward warm neon bounce.',
                      cameraTransition: 'Smooth steadycam push continuing out of the closing 5.4s frame.',
                      continuityNotes: 'Matched color warmth and subject scale from the closing tail frame.',
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const keyframes: ContinuityKeyframeCandidate[] = [
      { timestampSec: 4.5, dataUrl: TINY_JPEG_DATA_URL, sharpness: 0.42, exposure: 0.65, motionDelta: 0.4 },
      { timestampSec: 5.4, dataUrl: TINY_JPEG_DATA_URL, sharpness: 0.88, exposure: 0.82, motionDelta: 0.08 },
      { timestampSec: 6.4, dataUrl: TINY_JPEG_DATA_URL, sharpness: 0.75, exposure: 0.04, motionDelta: 0.05 },
    ];

    const plan = await planSceneContinuation(
      deps,
      {
        organizationId: f.orgId,
        locale: 'en',
        clipLabel: 'External B-roll',
        assetId: externalAssetId,
        clipDurationSec: 7,
        sequenceDurationSec: 12,
        targetNextSeconds: 6,
        keyframes,
      },
      { env: { GEMINI_API_KEY: 'test-gemini-key' }, fetchImpl },
    );

    expect(plan.path).toBe('external_keyframes');
    expect(plan.over30sSequence).toBe(false);
    expect(plan.selectedFrameIndex).toBe(1);
    expect(plan.selectedFrameTimestampSec).toBe(5.4);
    expect(plan.selectedFrameDataUrl).toBe(TINY_JPEG_DATA_URL);
    expect(capturedParts.some((p) => typeof p === 'object' && p !== null && 'inlineData' in p)).toBe(true);

    // Deterministic fake fallback never touches network
    const fallbackPlan = await planSceneContinuation(
      deps,
      {
        organizationId: f.orgId,
        locale: 'ko',
        clipLabel: '외부 촬영본',
        clipDurationSec: 8,
        sequenceDurationSec: 25,
        targetNextSeconds: 6,
        keyframes,
      },
      { env: { BRAND_STUDIO_PROVIDER: 'fake' } },
    );
    expect(fallbackPlan.path).toBe('external_keyframes');
    expect(fallbackPlan.over30sSequence).toBe(true);
    expect(fallbackPlan.selectedFrameIndex).toBe(1);
    expect(fallbackPlan.creditsUsed).toBe(0);
  });

  it('enforces Morphic 404 & guest 404 isolation and allows authorized owner on `continuity.plan` POST', async () => {
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');

    const sandboxOrgId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    f = await studioFixture({ orgId: sandboxOrgId, orgName: 'Morphic' });
    mocks.sql = f.sql;
    mocks.viewer = viewerOf(f.ids.owner);

    const morphicRes = await postPostProd({
      operation: 'continuity.plan',
      input: { organizationId: f.orgId, locale: 'ko', clipLabel: 'Clip 1' },
    });
    expect(morphicRes.status).toBe(404);
    await f.db.close();

    f = await studioFixture({ capKrw: 1_000_000 });
    mocks.sql = f.sql;

    mocks.viewer = viewerOf(f.ids.guest);
    const guestRes = await postPostProd({
      operation: 'continuity.plan',
      input: { organizationId: f.orgId, locale: 'ko', clipLabel: 'Clip 1' },
    });
    expect(guestRes.status).toBe(404);

    mocks.viewer = viewerOf(f.ids.owner);
    const ownerRes = await postPostProd({
      operation: 'continuity.plan',
      input: {
        organizationId: f.orgId,
        locale: 'ko',
        clipLabel: '외부 컷',
        sequenceDurationSec: 26,
        targetNextSeconds: 6,
        keyframes: [{ timestampSec: 4.8, sharpness: 0.78, exposure: 0.72, motionDelta: 0.1 }],
      },
    });
    expect(ownerRes.status).toBe(200);
    const json = (await ownerRes.json()) as { ok: boolean; plan?: { path: string; over30sSequence: boolean } };
    expect(json.ok).toBe(true);
    expect(json.plan).toMatchObject({ path: 'external_keyframes', over30sSequence: true });

    vi.unstubAllEnvs();
  });
});
