import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import {
  loadBrandStudioOps,
  runBrandStudioOpsAlertPass,
  studioOpsFilter,
} from '@/lib/admin/brand-studio-ops';
import { loadFirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { setOrganizationStorageQuota, loadOrganizationStorageSummary } from '@/lib/brands/storage-quota';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { brandStudioEditToWallOpenFor, videoPromptShieldOpenFor } from '@/lib/flags';
import { createSelfBrandProject, resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { STUDIO_LIMITS } from '@/lib/brand-studio/contracts';
import {
  editStagingKey,
  LOCAL_EDIT_UPLOAD_ROUTE,
} from '@/lib/brand-studio/edit-save';
import { sweepStudio, expireStaleStudioReservations } from '@/lib/brand-studio/engine';
import { studioEnv } from '@/lib/brand-studio/env';
import { resetJobProjectProbe } from '@/lib/brand-studio/job-projects';
import { claimJobs } from '@/lib/brand-studio/job-store';
import { laneClaim } from '@/lib/brand-studio/lane-api';
import { laneLoad, routeJob } from '@/lib/brand-studio/lanes';
import { memberUsage } from '@/lib/brand-studio/member-usage';
import { EDITED_NO_MODEL } from '@/lib/brand-studio/model-label';
import { studioModelOrLegacy } from '@/lib/brand-studio/models';
import { jobView, openJobCount } from '@/lib/brand-studio/repo';
import { loadStudioState, runStudioOperation } from '@/lib/brand-studio/service';
import { studioMonthWindow, usedKrwIn } from '@/lib/brand-studio/usage';
import { ADMIN_VIEWER } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { requestId, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { seedWorld, WORLD } from './prompt-shield/world';

const mocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as Viewer | null,
  runtimeDeps: null as ReturnType<typeof studioDeps> | null,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null },
}));
vi.mock('@/lib/brand-studio/runtime', async (orig) => {
  const actual = await orig<typeof import('@/lib/brand-studio/runtime')>();
  return {
    ...actual,
    studioRuntimeDeps: async () => mocks.runtimeDeps!,
  };
});

const studioRoute = await import('@/app/api/brand-studio/route');
const editUploadRoute = await import('@/app/api/brand-studio/edit/[requestId]/route');

const ENV = { BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' };
const NOW = new Date('2026-11-27T10:00:00.000Z');
const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';

async function imageBytes(
  format: 'png' | 'jpeg' | 'webp',
  width = 32,
  height = 48,
): Promise<Uint8Array> {
  const img = sharp({
    create: { width, height, channels: 4, background: { r: 22, g: 120, b: 200, alpha: 1 } },
  });
  const buf =
    format === 'png'
      ? await img.png().toBuffer()
      : format === 'jpeg'
        ? await img.jpeg({ quality: 85 }).toBuffer()
        : await img.webp({ quality: 85 }).toBuffer();
  return new Uint8Array(buf);
}

async function seedGeneratedSource(
  sql: SqlRunner,
  orgId: string,
  userId: string,
  opts?: { id?: string; outputId?: string; kind?: string; model?: string; deletedAt?: string | null; brandProjectId?: string | null; projectId?: string | null; outputStatus?: string },
) {
  const jobId = opts?.id ?? randomUUID();
  const outputId = opts?.outputId ?? randomUUID();
  const kind = opts?.kind ?? 'image';
  const model = opts?.model ?? 'seedream-5.5';
  await sql.query(
    `insert into brand_studio_jobs
       (id, organization_id, created_by, request_id, kind, status, model, prompt, enhance, params, estimate_krw, usage_krw, finished_at, deleted_at, brand_project_id, project_id)
     values ($1, $2, $3, $4, $5, 'succeeded', $6, 'a test', false, '{}'::jsonb, 150, 150, $7, $8, $9, $10)`,
    [
      jobId,
      orgId,
      userId,
      `req_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      kind,
      model,
      NOW.toISOString(),
      opts?.deletedAt ?? null,
      opts?.brandProjectId ?? null,
      opts?.projectId ?? null,
    ],
  );
  const keyHex = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const thumbHex = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await sql.query(
    `insert into brand_studio_outputs
       (id, job_id, organization_id, idx, kind, status, storage_key, thumb_key, mime, bytes, width, height)
     values ($1, $2, $3, 0, $4, $5, $6, $7, $8, 512, 800, 1000)`,
    [
      outputId,
      jobId,
      orgId,
      kind === 'video' || kind === 'video_final' ? 'video' : kind === 'music' ? 'audio' : 'image',
      opts?.outputStatus ?? 'ready',
      `st/${keyHex}.${kind === 'video' ? 'mp4' : 'png'}`,
      `st/${thumbHex}.webp`,
      kind === 'video' ? 'video/mp4' : 'image/png',
    ],
  );
  return { jobId, outputId };
}

function sameOriginReq(url: string, init: { method: string; headers?: HeadersInit; body?: Uint8Array | string }): NextRequest {
  const headers = new Headers(init.headers);
  headers.set('origin', 'http://localhost:3000');
  headers.set('host', 'localhost:3000');
  const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : init.body;
  return new NextRequest(url, { method: init.method, headers, body });
}

let f: StudioFixture;
let deps: ReturnType<typeof studioDeps>;

beforeEach(async () => {
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'on');
  vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL_ORGS', '');
  resetSpineProbe();
  resetJobProjectProbe();
  f = await studioFixture({ orgId: ORG, capKrw: 5_000_000 });
  deps = studioDeps(f.sql, { env: studioEnv(ENV), now: () => NOW });
  mocks.sql = f.sql;
  mocks.viewer = viewerOf(f.ids.owner);
  mocks.runtimeDeps = deps;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  mocks.sql = null;
  mocks.viewer = null;
  mocks.runtimeDeps = null;
  await f.db.close();
});

describe('B.11 feature switch & precedence', () => {
  it('matches videoPromptShieldOpenFor org-list rules across off/empty/*/all/CSV case-insensitivity', () => {
    const up = ORG.toUpperCase();
    for (const [val, orgs, org, want] of [
      [undefined, '', ORG, false],
      ['off', '', ORG, false],
      ['true', '', ORG, false],
      ['on', '', '', false],
      ['on', '', null, false],
      ['on', '', ORG, true],
      ['on', '*', ORG, true],
      ['on', ' all ', ORG, true],
      ['on', `${OTHER_ORG}, ${up}`, ORG, true],
      ['on', OTHER_ORG, ORG, false],
    ] as const) {
      expect(
        brandStudioEditToWallOpenFor(org, {
          BRAND_STUDIO_EDIT_TO_WALL: val,
          BRAND_STUDIO_EDIT_TO_WALL_ORGS: orgs,
        }),
      ).toBe(want);
      expect(
        videoPromptShieldOpenFor(org, {
          BRAND_STUDIO_VIDEO_PROMPT_SHIELD: val,
          BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS: orgs,
        }),
      ).toBe(want);
    }
  });

  it('exposes editToWall in loadStudioState only for creators when open and hides it otherwise', async () => {
    expect((await loadStudioState(deps, viewerOf(f.ids.owner), ORG))).toMatchObject({ ok: true, editToWall: true });
    expect((await loadStudioState(deps, viewerOf(f.ids.editor), ORG))).toMatchObject({ ok: true, editToWall: true });
    const viewerState = await loadStudioState(deps, viewerOf(f.ids.viewer), ORG);
    expect(viewerState.ok && 'editToWall' in viewerState).toBe(false);
    const guestState = await loadStudioState(deps, viewerOf(f.ids.guest), ORG);
    expect(guestState.ok && 'editToWall' in guestState).toBe(false);

    vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'off');
    const closedState = await loadStudioState(deps, viewerOf(f.ids.owner), ORG);
    expect(closedState.ok && 'editToWall' in closedState).toBe(false);
  });

  it('enforces Morphic/sandbox 404 precedence even when switch is closed, and invalid 400 when ordinary org is closed', async () => {
    const req = requestId();
    // Closed ordinary org -> invalid (HTTP 400)
    vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'off');
    const closedReserve = await studioRoute.POST(
      sameOriginReq('http://localhost:3000/api/brand-studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'output.edit.reserve',
          input: { organizationId: ORG, requestId: req, mime: 'image/png', sizeBytes: 512 },
        }),
      }),
    );
    expect(closedReserve.status).toBe(400);
    expect(await closedReserve.json()).toEqual({ ok: false, code: 'invalid' });

    const closedComplete = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
    });
    expect(closedComplete).toEqual({ ok: false, code: 'invalid' });

    // Sandboxed and Morphic orgs -> feature_unavailable (HTTP 404) regardless of closed/open switch
    const sb = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]!, capKrw: 5_000_000 });
    const morphic = await studioFixture({ orgName: 'Morphic Seoul', capKrw: 5_000_000 });
    try {
      for (const flag of ['off', 'on'] as const) {
        vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', flag);
        for (const blocked of [sb, morphic]) {
          mocks.sql = blocked.sql;
          mocks.viewer = viewerOf(blocked.ids.owner);
          mocks.runtimeDeps = studioDeps(blocked.sql, { env: studioEnv(ENV), now: () => NOW });
          for (const op of ['output.edit.reserve', 'output.edit.complete'] as const) {
            const res = await studioRoute.POST(
              sameOriginReq('http://localhost:3000/api/brand-studio', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  operation: op,
                  input: {
                    organizationId: blocked.orgId,
                    requestId: req,
                    mime: 'image/png',
                    ...(op === 'output.edit.reserve' ? { sizeBytes: 512 } : {}),
                  },
                }),
              }),
            );
            expect(res.status, `${blocked.orgId} ${flag} ${op}`).toBe(404);
            expect(await res.json()).toEqual({ ok: false, code: 'feature_unavailable' });
          }
        }
      }
    } finally {
      mocks.sql = f.sql;
      mocks.viewer = viewerOf(f.ids.owner);
      mocks.runtimeDeps = deps;
      await sb.db.close();
      await morphic.db.close();
    }
  });
});

describe('B.1 EDITED_NO_MODEL sentinel & B.4–B.7 staging/upload/complete validation', () => {
  it('pins EDITED_NO_MODEL === detail-edit and studioModelOrLegacy(EDITED_NO_MODEL) === null', () => {
    expect(EDITED_NO_MODEL).toBe('detail-edit');
    expect(studioModelOrLegacy(EDITED_NO_MODEL)).toBeNull();
  });

  it('derives scoped editStagingKey and allows POST local upload gateway on brandRouteAllowed', () => {
    const rid = 'edit_req_12345678';
    expect(editStagingKey(ORG, f.ids.owner, rid)).toBe(`brand-studio/edit/${ORG}/${f.ids.owner}/${rid}`);
    expect(brandRouteAllowed(`${LOCAL_EDIT_UPLOAD_ROUTE}/${rid}`, 'POST')).toBe(true);
    expect(brandRouteAllowed(`${LOCAL_EDIT_UPLOAD_ROUTE}/${rid}`, 'GET')).toBe(false);
  });

  it('reserves without writing DB rows, supports local POST and signed PUT, and saves PNG/JPEG/WebP with real sharp dimensions', async () => {
    const { outputId: parentOutputId } = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { model: 'seedream-5.5' });

    for (const [idx, fmt, mime, w, h] of [
      [0, 'png', 'image/png', 32, 48],
      [1, 'jpeg', 'image/jpeg', 64, 40],
      [2, 'webp', 'image/webp', 50, 75],
    ] as const) {
      const bytes = await imageBytes(fmt, w, h);
      const req = requestId();
      const jobsBefore = Number((await f.sql.query<{ c: number }>('select count(*)::int as c from brand_studio_jobs')).rows[0]!.c);

      const reserved = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.reserve', {
        organizationId: ORG,
        requestId: req,
        mime,
        sizeBytes: bytes.byteLength,
        ...(idx === 0 ? { parentOutputId } : {}),
      });
      expect(reserved).toEqual({
        ok: true,
        direct: false,
        url: `${LOCAL_EDIT_UPLOAD_ROUTE}/${encodeURIComponent(req)}?organizationId=${encodeURIComponent(ORG)}`,
      });
      // Reserve writes NO DB row.
      const jobsAfterReserve = Number((await f.sql.query<{ c: number }>('select count(*)::int as c from brand_studio_jobs')).rows[0]!.c);
      expect(jobsAfterReserve).toBe(jobsBefore);

      // Local upload gateway stores staging under user-scoped key.
      const postRes = await editUploadRoute.POST(
        sameOriginReq(`http://localhost:3000${LOCAL_EDIT_UPLOAD_ROUTE}/${req}?organizationId=${ORG}`, {
          method: 'POST',
          headers: { 'content-type': mime },
          body: bytes,
        }),
        { params: Promise.resolve({ requestId: req }) },
      );
      expect(postRes.status).toBe(200);
      expect(await postRes.json()).toEqual({ ok: true });

      const completed = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: req,
        mime,
        ...(idx === 0 ? { parentOutputId } : {}),
      });
      expect(completed.ok).toBe(true);
      if (!completed.ok || !('job' in completed)) throw new Error('expected saved job');

      expect(completed.job).toMatchObject({
        kind: 'image',
        status: 'succeeded',
        model: idx === 0 ? 'seedream-5.5' : EDITED_NO_MODEL,
        prompt: '',
        parentOutputId: idx === 0 ? parentOutputId : null,
        edited: true,
        estimateKrw: 0,
      });
      expect(completed.job.outputs[0]).toMatchObject({
        kind: 'image',
        width: w,
        height: h,
      });

      // Exact DB row checks (B.1, B.2, B.3, B.12)
      const dbJob = (
        await f.sql.query<{
          kind: string;
          status: string;
          lane: string | null;
          model: string;
          prompt: string;
          final_prompt: string | null;
          enhance: boolean;
          refs: unknown;
          parent_output_id: string | null;
          params: Record<string, unknown>;
          estimate_krw: number;
          usage_krw: number | null;
          estimate_usd: string | number;
          cost_usd: string | number | null;
          claimed_at: Date | null;
          attempts: number;
          work: Record<string, unknown>;
          error_code: string | null;
          created_at: Date;
          started_at: Date | null;
          finished_at: Date | null;
        }>(
          'select kind, status, lane, model, prompt, final_prompt, enhance, refs, parent_output_id, params, estimate_krw, usage_krw, estimate_usd, cost_usd, claimed_at, attempts, work, error_code, created_at, started_at, finished_at from brand_studio_jobs where id = $1',
          [completed.job.id],
        )
      ).rows[0]!;
      expect(dbJob.kind).toBe('image');
      expect(dbJob.status).toBe('succeeded');
      expect(dbJob.lane).toBeNull();
      expect(dbJob.model).toBe(idx === 0 ? 'seedream-5.5' : EDITED_NO_MODEL);
      expect(dbJob.prompt).toBe('');
      expect(dbJob.final_prompt).toBeNull();
      expect(dbJob.enhance).toBe(false);
      expect(dbJob.refs).toEqual([]);
      expect(dbJob.parent_output_id).toBe(idx === 0 ? parentOutputId : null);
      expect(dbJob.params).toEqual({
        aspect: null,
        resolution: null,
        seconds: null,
        audio: null,
        count: 1,
        locale: 'ko',
        edited: true,
      });
      expect('parentOutputId' in dbJob.params).toBe(false);
      expect(dbJob.estimate_krw).toBe(0);
      expect(dbJob.usage_krw).toBe(0);
      expect(Number(dbJob.estimate_usd)).toBe(0);
      expect(dbJob.cost_usd).toBeNull();
      expect(dbJob.claimed_at).toBeNull();
      expect(dbJob.attempts).toBe(0);
      expect(dbJob.work).toEqual({});
      expect(dbJob.error_code).toBeNull();
      expect(new Date(dbJob.created_at).toISOString()).toBe(NOW.toISOString());
      expect(new Date(dbJob.started_at!).toISOString()).toBe(NOW.toISOString());
      expect(new Date(dbJob.finished_at!).toISOString()).toBe(NOW.toISOString());

      const dbOut = (
        await f.sql.query<{
          idx: number;
          status: string;
          organization_id: string;
          storage_key: string;
          thumb_key: string | null;
          sha256: string | null;
          is_draft: boolean;
          mime: string;
          bytes: number;
          width: number;
          height: number;
        }>(
          'select idx, status, organization_id, storage_key, thumb_key, sha256, is_draft, mime, bytes, width, height from brand_studio_outputs where job_id = $1',
          [completed.job.id],
        )
      ).rows;
      expect(dbOut).toHaveLength(1);
      expect(dbOut[0]).toMatchObject({
        idx: 0,
        status: 'ready',
        organization_id: ORG,
        mime,
        bytes: bytes.byteLength,
        width: w,
        height: h,
        is_draft: false,
      });
      expect(dbOut[0]!.storage_key).toMatch(/^st\//);
      expect(dbOut[0]!.thumb_key).toMatch(/^st\/.*\.webp$/);
      expect(dbOut[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // Zero asset rows written.
    expect((await f.sql.query<{ c: number }>('select count(*)::int as c from brand_studio_assets')).rows[0]!.c).toBe(0);

    // Ordinary jobView does NOT emit edited field.
    const ordinaryRow = (await f.sql.query('select * from brand_studio_jobs where parent_output_id is null and coalesce(params->>\'edited\', \'\') <> \'true\' limit 1')).rows[0] as never;
    const ordView = jobView(ordinaryRow, [], deps.media);
    expect('edited' in ordView).toBe(false);
  });

  it('local gateway enforces 405 when staging.servesSignedUrls, 401 anon, 403 viewer/CSRF, 400 closed', async () => {
    const bytes = await imageBytes('png');
    const req = requestId();

    // Viewer denied
    mocks.viewer = viewerOf(f.ids.viewer);
    expect(
      (
        await editUploadRoute.POST(
          sameOriginReq(`http://localhost:3000${LOCAL_EDIT_UPLOAD_ROUTE}/${req}?organizationId=${ORG}`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: bytes,
          }),
          { params: Promise.resolve({ requestId: req }) },
        )
      ).status,
    ).toBe(403);

    // Anon denied
    mocks.viewer = null;
    expect(
      (
        await editUploadRoute.POST(
          sameOriginReq(`http://localhost:3000${LOCAL_EDIT_UPLOAD_ROUTE}/${req}?organizationId=${ORG}`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: bytes,
          }),
          { params: Promise.resolve({ requestId: req }) },
        )
      ).status,
    ).toBe(401);

    // Closed switch -> 400 invalid
    mocks.viewer = viewerOf(f.ids.owner);
    vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'off');
    const closed = await editUploadRoute.POST(
      sameOriginReq(`http://localhost:3000${LOCAL_EDIT_UPLOAD_ROUTE}/${req}?organizationId=${ORG}`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: bytes,
      }),
      { params: Promise.resolve({ requestId: req }) },
    );
    expect(closed.status).toBe(400);
    expect(await closed.json()).toEqual({ ok: false, code: 'invalid' });
    vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'on');

    // Reserve with direct signed URLs -> local gateway refuses 405
    const signedDeps = {
      ...deps,
      staging: {
        ...deps.staging,
        servesSignedUrls: true,
        signedUploadUrl: vi.fn(async (key: string) => `https://r2.example/put/${key}`),
      },
    };
    mocks.runtimeDeps = signedDeps;
    expect(
      (
        await editUploadRoute.POST(
          sameOriginReq(`http://localhost:3000${LOCAL_EDIT_UPLOAD_ROUTE}/${req}?organizationId=${ORG}`, {
            method: 'POST',
            headers: { 'content-type': 'image/png' },
            body: bytes,
          }),
          { params: Promise.resolve({ requestId: req }) },
        )
      ).status,
    ).toBe(405);
    mocks.runtimeDeps = deps;

    const signed = await runStudioOperation(signedDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
      sizeBytes: bytes.byteLength,
    });
    expect(signed).toEqual({
      ok: true,
      direct: true,
      url: `https://r2.example/put/${editStagingKey(ORG, f.ids.owner, req)}`,
    });

    // Item 6: servesSignedUrls true with null signedUploadUrl must fail instead of falling back to local gateway.
    const brokenSignedDeps = {
      ...deps,
      staging: {
        ...deps.staging,
        servesSignedUrls: true,
        signedUploadUrl: vi.fn(async () => null),
      },
    };
    expect(
      await runStudioOperation(brokenSignedDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
        organizationId: ORG,
        requestId: requestId(),
        mime: 'image/png',
        sizeBytes: bytes.byteLength,
      }),
    ).toEqual({ ok: false, code: 'failed' });

    // Item 7: Viewer cannot invoke output.edit.reserve or output.edit.complete via /api/brand-studio (HTTP 403).
    mocks.runtimeDeps = deps;
    mocks.viewer = viewerOf(f.ids.viewer);
    for (const op of ['output.edit.reserve', 'output.edit.complete'] as const) {
      const vRes = await studioRoute.POST(
        sameOriginReq('http://localhost:3000/api/brand-studio', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation: op,
            input: {
              organizationId: ORG,
              requestId: requestId(),
              mime: 'image/png',
              ...(op === 'output.edit.reserve' ? { sizeBytes: bytes.byteLength } : {}),
            },
          }),
        }),
      );
      expect(vRes.status).toBe(403);
      expect(await vRes.json()).toEqual({ ok: false, code: 'forbidden' });
    }
  });

  it('rejects missing staging, magic-byte mismatch, oversize staged upload, and ALWAYS calls releaseStaging', async () => {
    const released: string[] = [];
    const spyingDeps = {
      ...deps,
      staging: {
        ...deps.staging,
        releaseStaging: vi.fn(async (key: string) => {
          released.push(key);
          await deps.staging.releaseStaging?.(key);
        }),
      },
    };

    // 1. Missing staging object
    const rMissing = requestId();
    expect(
      await runStudioOperation(spyingDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: rMissing,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'not_found' });

    // 2. Non-image magic bytes (WAV audio claimed as JPEG) -> unsupported_file + releaseStaging
    const rMismatch = requestId();
    const wavHeader = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
    await spyingDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, rMismatch), wavHeader, 'image/jpeg');
    expect(
      await runStudioOperation(spyingDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: rMismatch,
        mime: 'image/jpeg',
      }),
    ).toEqual({ ok: false, code: 'unsupported_file' });
    expect(released).toContain(editStagingKey(ORG, f.ids.owner, rMismatch));

    // 3. Corrupt PNG magic header -> imageInfo returns null -> unsupported_file + releaseStaging
    const rGarbage = requestId();
    await spyingDeps.staging.putStaging(
      editStagingKey(ORG, f.ids.owner, rGarbage),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
      'image/png',
    );
    expect(
      await runStudioOperation(spyingDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: rGarbage,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'unsupported_file' });
    expect(released).toContain(editStagingKey(ORG, f.ids.owner, rGarbage));

    // 4. Staged bytes over STUDIO_LIMITS.imageBytesMax -> file_too_large + releaseStaging
    const rOversize = requestId();
    await spyingDeps.staging.putStaging(
      editStagingKey(ORG, f.ids.owner, rOversize),
      new Uint8Array(STUDIO_LIMITS.imageBytesMax + 1),
      'image/png',
    );
    expect(
      await runStudioOperation(spyingDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: rOversize,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'file_too_large' });
    expect(released).toContain(editStagingKey(ORG, f.ids.owner, rOversize));

    // 5. Client width/height is rejected by schema or ignored; schema forbids extra keys? At least no width/height in result comes from caller.
    const rBadMime = await runStudioOperation(spyingDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: requestId(),
      mime: 'image/gif',
      sizeBytes: 100,
    });
    expect(rBadMime).toEqual({ ok: false, code: 'invalid' });
  });

  it('enforces idempotency, conflict on existing non-edited job, quota inside lock (bytes.byteLength only), and staff bypass', async () => {
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    await f.sql.query(
      "insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing",
      [ORG, f.ids.admin],
    );
    const init = await loadOrganizationStorageSummary(f.sql, ORG, NOW);
    const png = await imageBytes('png', 40, 40);

    // Reserve quota tight enough that 1 save fits and 2nd save exceeds quota.
    const quotaSet = await setOrganizationStorageQuota({ sql: f.sql }, admin, {
      organizationId: ORG,
      quotaBytes: png.byteLength + 10,
      note: 'tight quota',
      expectedRevision: init.revision,
    });
    expect(quotaSet.ok).toBe(true);

    const req1 = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req1), png, 'image/png');
    const first = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/png',
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !('job' in first)) throw new Error('expected first');

    const usedAfterFirst = (
      await f.sql.query<{ used_bytes: number }>('select used_bytes::int from brand_storage_quotas where organization_id = $1', [ORG])
    ).rows[0]!.used_bytes;
    // Thumbnail bytes are NOT counted toward used_bytes.
    expect(usedAfterFirst).toBe(png.byteLength);

    // Duplicate complete with SAME requestId -> idempotent return (no second row, no quota failure!)
    const dup = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/png',
    });
    expect(dup).toEqual(first);

    // Second request exceeding quota -> storage_quota_exceeded inside lock
    const req2 = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req2), png, 'image/png');
    expect(
      await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: req2,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded' });

    // Staff bypass succeeds even over quota
    await deps.staging.putStaging(editStagingKey(ORG, admin.userId!, req2), png, 'image/png');
    const staffSave = await runStudioOperation(deps, admin, 'output.edit.complete', {
      organizationId: ORG,
      requestId: req2,
      mime: 'image/png',
    });
    expect(staffSave.ok).toBe(true);

    // Existing non-edited job with same requestId -> conflict
    const nonEditReq = 'req_non_edited_0001';
    await f.sql.query(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, enhance, params, finished_at)
       values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'x', false, '{}'::jsonb, now())`,
      [ORG, f.ids.owner, nonEditReq],
    );
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, nonEditReq), png, 'image/png');
    expect(
      await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: nonEditReq,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'conflict' });
  });

  it('Item 1 & Item 2 & Item 7: prepares staging/media outside lock, cleans up all media/staging on prior hit / quota / SQL failure, and handles full retry & mismatched payload', async () => {
    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const init = await loadOrganizationStorageSummary(f.sql, ORG, NOW);
    const png = await imageBytes('png', 40, 40);
    const jpeg = await imageBytes('jpeg', 48, 32);

    // Track media puts/deletes and whether sql.transaction is open during staging.read / media.put.
    let inTx = false;
    const putKeys: string[] = [];
    const deletedKeys: string[] = [];
    const releasedKeys: string[] = [];
    let readDuringTx = false;
    let putDuringTx = false;
    let failInsert = false;

    const wrapRunner = (inner: SqlRunner): SqlRunner => ({
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) => {
        if (failInsert && /insert into brand_studio_jobs/i.test(text)) {
          throw new Error('synthetic db insert failure');
        }
        return inner.query<T>(text, params);
      },
      transaction: <T>(fn: (tx: SqlRunner) => Promise<T>) =>
        inner.transaction(async (tx) => {
          inTx = true;
          try {
            return await fn(wrapRunner(tx));
          } finally {
            inTx = false;
          }
        }),
    });

    const obsDeps = studioDeps(wrapRunner(f.sql), {
      env: studioEnv(ENV),
      now: () => NOW,
      media: {
        ...deps.media,
        put: async (bytes, mime) => {
          if (inTx) putDuringTx = true;
          const res = await deps.media.put(bytes, mime);
          putKeys.push(res.key);
          return res;
        },
        delete: async (key) => {
          deletedKeys.push(key);
          await deps.media.delete(key);
        },
      },
      staging: {
        ...deps.staging,
        read: async (bucket, key) => {
          if (inTx) readDuringTx = true;
          return deps.staging.read(bucket, key);
        },
        releaseStaging: async (key) => {
          releasedKeys.push(key);
          await deps.staging.releaseStaging?.(key);
        },
      },
    });

    const quotaSet = await setOrganizationStorageQuota({ sql: f.sql }, admin, {
      organizationId: ORG,
      quotaBytes: png.byteLength + 10,
      note: 'tight lock cleanup quota',
      expectedRevision: init.revision,
    });
    expect(quotaSet.ok).toBe(true);

    // 1. Reserve -> upload -> complete runs staging.read & media.put OUTSIDE tx, and releases staging.
    const req1 = requestId();
    const res1 = await runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/png',
      sizeBytes: png.byteLength,
    });
    expect(res1.ok).toBe(true);
    await obsDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req1), png, 'image/png');
    const done1 = await runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/png',
    });
    expect(done1.ok).toBe(true);
    if (!done1.ok || !('job' in done1)) throw new Error('expected done1');
    expect(readDuringTx).toBe(false);
    expect(putDuringTx).toBe(false);
    expect(putKeys).toHaveLength(2);
    expect(deletedKeys).toHaveLength(0);
    expect(releasedKeys).toContain(editStagingKey(ORG, f.ids.owner, req1));

    // 2. Full client retry (reserve -> re-upload staging -> complete) with SAME requestId (and even different mime/payload):
    // returns prior job, cleans up duplicate media written before lock, releases staging, and keeps prior media intact.
    const otherParent = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { model: 'nano-banana-pro' });
    const putCountBeforeRetry = putKeys.length;
    const retryReserve = await runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/jpeg',
      sizeBytes: jpeg.byteLength,
      parentOutputId: otherParent.outputId,
    });
    expect(retryReserve.ok).toBe(true);
    await obsDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req1), jpeg, 'image/jpeg');
    releasedKeys.length = 0;
    const retryDone = await runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req1,
      mime: 'image/jpeg',
      parentOutputId: otherParent.outputId,
    });
    expect(retryDone).toEqual(done1);
    const retryWritten = putKeys.slice(putCountBeforeRetry);
    expect(retryWritten).toHaveLength(2);
    for (const k of retryWritten) expect(deletedKeys).toContain(k);
    expect(releasedKeys).toContain(editStagingKey(ORG, f.ids.owner, req1));
    // Original stored media remains readable.
    for (const origKey of putKeys.slice(0, 2)) {
      expect(deps.media.objects.has(origKey)).toBe(true);
    }

    // 3. Quota denied INSIDE lock after media.put -> deletes both writtenMediaKeys & releases staging.
    const reqQuota = requestId();
    const putBeforeQuota = putKeys.length;
    await obsDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, reqQuota), png, 'image/png');
    releasedKeys.length = 0;
    expect(
      await runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: reqQuota,
        mime: 'image/png',
      }),
    ).toEqual({ ok: false, code: 'storage_quota_exceeded' });
    for (const k of putKeys.slice(putBeforeQuota)) expect(deletedKeys).toContain(k);
    expect(releasedKeys).toContain(editStagingKey(ORG, f.ids.owner, reqQuota));

    // 4. DB insert failure after quota check -> cleans up writtenMediaKeys & releases staging.
    const quotaOpen = await loadOrganizationStorageSummary(f.sql, ORG, NOW);
    await setOrganizationStorageQuota({ sql: f.sql }, admin, {
      organizationId: ORG,
      quotaBytes: 5_000_000,
      note: 'open quota',
      expectedRevision: quotaOpen.revision,
    });
    const reqDbErr = requestId();
    const putBeforeDbErr = putKeys.length;
    await obsDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, reqDbErr), png, 'image/png');
    releasedKeys.length = 0;
    failInsert = true;
    await expect(
      runStudioOperation(obsDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
        organizationId: ORG,
        requestId: reqDbErr,
        mime: 'image/png',
      }),
    ).rejects.toThrow('synthetic db insert failure');
    failInsert = false;
    for (const k of putKeys.slice(putBeforeDbErr)) expect(deletedKeys).toContain(k);
    expect(releasedKeys).toContain(editStagingKey(ORG, f.ids.owner, reqDbErr));
  });
});

describe('B.9, B.10 source validation & project spine / legacy filing', () => {
  it('rejects non-image, deleted, foreign, and compose-1080p sources; refuses outsider', async () => {
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      OTHER_ORG,
      'Other',
      f.ids.outsider,
      randomUUID(),
    ]);
    await f.sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      OTHER_ORG,
      f.ids.outsider,
      'owner',
    ]);

    const videoSrc = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { kind: 'video', model: 'seedance-2.5' });
    const deletedSrc = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { deletedAt: NOW.toISOString() });
    const composeSrc = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { kind: 'image', model: 'compose-1080p' });
    const fillStripSrc = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { kind: 'region_edit', model: 'nano-banana-pro' });
    await f.sql.query(`update brand_studio_jobs set params = '{"purpose":"fill"}'::jsonb where id = $1`, [fillStripSrc.jobId]);
    const foreignSrc = await seedGeneratedSource(f.sql, OTHER_ORG, f.ids.outsider);
    const png = await imageBytes('png');

    for (const badId of [randomUUID(), videoSrc.outputId, deletedSrc.outputId, composeSrc.outputId, fillStripSrc.outputId, foreignSrc.outputId]) {
      const req = requestId();
      expect(
        await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.reserve', {
          organizationId: ORG,
          requestId: req,
          mime: 'image/png',
          sizeBytes: png.byteLength,
          parentOutputId: badId,
        }),
      ).toEqual({ ok: false, code: 'not_found' });

      await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req), png, 'image/png');
      expect(
        await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
          organizationId: ORG,
          requestId: req,
          mime: 'image/png',
          parentOutputId: badId,
        }),
      ).toEqual({ ok: false, code: 'not_found' });
    }

    // Outsider cannot reserve or complete in ORG
    expect(
      await runStudioOperation(deps, viewerOf(f.ids.outsider), 'output.edit.reserve', {
        organizationId: ORG,
        requestId: requestId(),
        mime: 'image/png',
        sizeBytes: png.byteLength,
      }),
    ).toEqual({ ok: false, code: 'not_found' });
  });

  it('inherits finished/hidden brand_project from parentOutputId, ignores caller projectId, and validates unparented projectId', async () => {
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', '*');
    resetSpineProbe();
    const createdActive = await createSelfBrandProject(deps, viewerOf(f.ids.owner), {
      organizationId: ORG,
      title: 'Active',
      requestId: requestId(),
    });
    expect(createdActive.ok).toBe(true);
    if (!createdActive.ok) throw new Error('expected active project');
    const activeProj = createdActive.project;

    const createdFinished = await createSelfBrandProject(deps, viewerOf(f.ids.owner), {
      organizationId: ORG,
      title: 'Team Done Visible',
      requestId: requestId(),
    });
    expect(createdFinished.ok).toBe(true);
    if (!createdFinished.ok) throw new Error('expected finished project');
    await f.sql.query(
      "update brand_projects set origin = 'team', objective = 'Campaign objective', status = 'completed', client_visible = true where id = $1",
      [createdFinished.project.id],
    );
    const visibleFinished = createdFinished.project;

    const createdHidden = await createSelfBrandProject(deps, viewerOf(f.ids.owner), {
      organizationId: ORG,
      title: 'Team Done Hidden',
      requestId: requestId(),
    });
    expect(createdHidden.ok).toBe(true);
    if (!createdHidden.ok) throw new Error('expected hidden project');
    await f.sql.query(
      "update brand_projects set origin = 'team', objective = 'Hidden objective', status = 'completed', client_visible = false where id = $1",
      [createdHidden.project.id],
    );
    const hiddenFinished = createdHidden.project;

    const srcInVisibleFinished = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { brandProjectId: visibleFinished.id });
    const srcInHidden = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { brandProjectId: hiddenFinished.id });
    const srcUnfiled = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { brandProjectId: null });
    const png = await imageBytes('png');

    // 1a. With parent in visible completed project, DB row inherits visibleFinished.id even if caller passes activeProj.id!
    // (`withBrandProjects` studio rule hides completed project ids as null while DB/assets keep visibleFinished.id.)
    const r1 = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, r1), png, 'image/png');
    const s1 = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: r1,
      mime: 'image/png',
      parentOutputId: srcInVisibleFinished.outputId,
      brandProjectId: activeProj.id,
    });
    expect(s1.ok && 'job' in s1 && s1.job.brandProjectId).toBeNull();
    if (!s1.ok || !('job' in s1)) throw new Error('expected saved');
    const storedVisibleBp = (
      await f.sql.query<{ brand_project_id: string | null }>('select brand_project_id from brand_studio_jobs where id = $1', [
        s1.job.id,
      ])
    ).rows[0]!.brand_project_id;
    expect(storedVisibleBp).toBe(visibleFinished.id);

    // 1b. With parent in hidden project, DB row inherits hiddenFinished.id even if caller passes activeProj.id!
    const rHidden = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, rHidden), png, 'image/png');
    const sHidden = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: rHidden,
      mime: 'image/png',
      parentOutputId: srcInHidden.outputId,
      brandProjectId: activeProj.id,
    });
    expect(sHidden.ok && 'job' in sHidden && sHidden.job.brandProjectId).toBeNull();
    if (!sHidden.ok || !('job' in sHidden)) throw new Error('expected hidden saved');
    const storedHiddenBp = (
      await f.sql.query<{ brand_project_id: string | null }>('select brand_project_id from brand_studio_jobs where id = $1', [
        sHidden.job.id,
      ])
    ).rows[0]!.brand_project_id;
    expect(storedHiddenBp).toBe(hiddenFinished.id);

    // 2. With unfiled parent, even passing activeProj.id stays null!
    const r2 = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, r2), png, 'image/png');
    const s2 = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: r2,
      mime: 'image/png',
      parentOutputId: srcUnfiled.outputId,
      brandProjectId: activeProj.id,
    });
    expect(s2.ok && 'job' in s2 && s2.job.brandProjectId).toBeNull();

    // 3. Without parentOutputId: selectable project works; non-selectable rejects with not_found
    const r3 = requestId();
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, r3), png, 'image/png');
    const s3 = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: r3,
      mime: 'image/png',
      brandProjectId: activeProj.id,
    });
    expect(s3.ok && 'job' in s3 && s3.job.brandProjectId).toBe(activeProj.id);

    expect(
      await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.reserve', {
        organizationId: ORG,
        requestId: requestId(),
        mime: 'image/png',
        sizeBytes: png.byteLength,
        brandProjectId: hiddenFinished.id,
      }),
    ).toEqual({ ok: false, code: 'not_found' });

    // W2: project.overview image covers carry model & edited when edit-to-wall is open, and omit them when closed.
    if (!s3.ok || !('job' in s3)) throw new Error('expected saved s3');
    const savedOutId = s3.job.outputs[0]!.id;
    const openOv = await runStudioOperation(deps, viewerOf(f.ids.owner), 'project.overview', { organizationId: ORG });
    expect(openOv.ok).toBe(true);
    if (!openOv.ok || !('brandMaterials' in openOv)) throw new Error('expected overview');
    const activeCovers = openOv.projects.find((p) => p.project.id === activeProj.id)?.covers ?? [];
    const editedCover = activeCovers.find((c) => c.outputId === savedOutId);
    expect(editedCover).toMatchObject({ kind: 'image', model: EDITED_NO_MODEL, edited: true });

    vi.stubEnv('BRAND_STUDIO_EDIT_TO_WALL', 'off');
    const closedOv = await runStudioOperation(deps, viewerOf(f.ids.owner), 'project.overview', { organizationId: ORG });
    expect(closedOv.ok).toBe(true);
    if (!closedOv.ok || !('brandMaterials' in closedOv)) throw new Error('expected closed overview');
    // Fix Round 3 Item 8: cover model is present for all orgs; edited remains switch-gated when closed.
    const closedCover = closedOv.projects.find((p) => p.project.id === activeProj.id)?.covers.find((c) => c.outputId === savedOutId);
    expect(closedCover).toBeDefined();
    expect(closedCover!.model).toBe(EDITED_NO_MODEL);
    expect('edited' in closedCover!).toBe(false);
  });

  it('follows legacy studio_projects (project_id) filing and parent inheritance when BRAND_STUDIO_PROJECTS=on', async () => {
    vi.stubEnv('BRAND_STUDIO_PROJECTS', 'on');
    const legacyDeps = studioDeps(f.sql, { env: studioEnv({ ...ENV, BRAND_STUDIO_PROJECTS: 'on' }), now: () => NOW });
    const liveProjId = randomUUID();
    const deadProjId = randomUUID();
    await f.sql.query(
      `insert into brand_studio_video_projects (id, organization_id, created_by, request_id, title, status)
       values ($1, $2, $3, $4, 'Live Legacy', 'active'), ($5, $2, $3, $6, 'Archived Legacy', 'archived')`,
      [liveProjId, ORG, f.ids.owner, requestId(), deadProjId, requestId()],
    );
    const parentInDead = await seedGeneratedSource(f.sql, ORG, f.ids.owner, { projectId: deadProjId });
    const png = await imageBytes('png');

    // With parentOutputId: keeps parent's legacy project_id even if another requested
    const r1 = requestId();
    await legacyDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, r1), png, 'image/png');
    const savedFromParent = await runStudioOperation(legacyDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: r1,
      mime: 'image/png',
      parentOutputId: parentInDead.outputId,
      projectId: liveProjId,
    });
    expect(savedFromParent.ok).toBe(true);
    if (!savedFromParent.ok || !('job' in savedFromParent)) throw new Error('expected saved');
    const dbProj = (
      await f.sql.query<{ project_id: string | null }>('select project_id from brand_studio_jobs where id = $1', [savedFromParent.job.id])
    ).rows[0]!.project_id;
    expect(dbProj).toBe(deadProjId);

    // Without parentOutputId: live project files cleanly; archived project refuses with not_found
    const r2 = requestId();
    await legacyDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, r2), png, 'image/png');
    const savedDirect = await runStudioOperation(legacyDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: r2,
      mime: 'image/png',
      projectId: liveProjId,
    });
    expect(savedDirect.ok && 'job' in savedDirect && savedDirect.job.projectId).toBe(liveProjId);

    expect(
      await runStudioOperation(legacyDeps, viewerOf(f.ids.owner), 'output.edit.reserve', {
        organizationId: ORG,
        requestId: requestId(),
        mime: 'image/png',
        sizeBytes: png.byteLength,
        projectId: deadProjId,
      }),
    ).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('B.14, B.15, B.18 Rule 3 SQL metrics & worker/sweeper isolation', () => {
  it('excludes edited rows from usedKrwIn, memberUsage, loadBrandStudioOps, runBrandStudioOpsAlertPass, and homeChecklist', async () => {
    await seedProfile(f.sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'studio-ops-admin@yagiworkshop.xyz' });
    const admin = { ...viewerOf(ADMIN_VIEWER.userId!), isAdmin: true };
    const tenMinAgo = new Date(NOW.getTime() - 10 * 60_000);
    const tenMinDeps = studioDeps(f.sql, { env: studioEnv(ENV), now: () => tenMinAgo });
    const win = studioMonthWindow(NOW);

    // Seed baseline non-edited rows (1 failed, 1 succeeded non-image or video so hasFirstImage stays false initially)
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, model, estimate_krw, usage_krw, created_at, finished_at)
       values ($1, $2, $3, 'req_norm_vid_001', 'video', 'succeeded', 'seedance-2.5', 400, 400, $4, $4),
              ($5, $2, $3, 'req_norm_fail_001', 'image', 'failed', 'seedream-5.5', 150, 0, $4, $4)`,
      [randomUUID(), ORG, f.ids.owner, tenMinAgo.toISOString(), randomUUID()],
    );

    const beforeUsed = await usedKrwIn(f.sql, ORG, win);
    const beforeMembers = await memberUsage(f.sql, ORG, NOW);
    const beforeOps = await loadBrandStudioOps(f.sql, admin, studioOpsFilter({}), NOW);
    const beforeAlerts = await runBrandStudioOpsAlertPass(f.sql, NOW);
    const beforeChecklist = await loadFirstRunChecklistState(f.sql, ORG, { capKrw: 5_000_000, logoUrl: null, now: NOW });
    expect(beforeChecklist.hasFirstImage).toBe(false);

    // Now save an edited image 10 minutes ago!
    const png = await imageBytes('png');
    const reqEdit = requestId();
    await tenMinDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, reqEdit), png, 'image/png');
    const saved = await runStudioOperation(tenMinDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: reqEdit,
      mime: 'image/png',
    });
    expect(saved.ok).toBe(true);

    expect(await usedKrwIn(f.sql, ORG, win)).toBe(beforeUsed);
    expect(await memberUsage(f.sql, ORG, NOW)).toEqual(beforeMembers);
    expect((await loadBrandStudioOps(f.sql, admin, studioOpsFilter({}), NOW))?.hourlyStats).toEqual(beforeOps?.hourlyStats);
    expect((await runBrandStudioOpsAlertPass(f.sql, NOW)).massFailure).toEqual(beforeAlerts.massFailure);
    const afterChecklist = await loadFirstRunChecklistState(f.sql, ORG, { capKrw: 5_000_000, logoUrl: null, now: NOW });
    expect(afterChecklist.hasFirstImage).toBe(false);

    // Confirm a real generated succeeded image DOES satisfy hasFirstImage
    await seedGeneratedSource(f.sql, ORG, f.ids.owner);
    const realChecklist = await loadFirstRunChecklistState(f.sql, ORG, { capKrw: 5_000_000, logoUrl: null, now: NOW });
    expect(realChecklist.hasFirstImage).toBe(true);
  });

  it('never selects or mutates edited rows in claimJobs, openJobCount, expireStaleStudioReservations, or sweepStudio', async () => {
    const oldTime = new Date(NOW.getTime() - 2 * 3_600_000);
    const oldDeps = studioDeps(f.sql, { env: studioEnv(ENV), now: () => oldTime });
    const png = await imageBytes('png');
    const req = requestId();
    await oldDeps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req), png, 'image/png');
    const saved = await runStudioOperation(oldDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok || !('job' in saved)) throw new Error('expected saved');

    expect(await openJobCount(f.sql, ORG)).toBe(0);
    expect(await claimJobs(f.sql, null, 20)).toEqual([]);
    expect(await laneLoad(f.sql)).toEqual({ sunra_api: 0, sunra_mcp: 0 });
    expect(await laneClaim(deps, { limit: 10 })).toEqual({ ok: true, jobs: [] });
    expect(
      await routeJob(f.sql, {
        organizationId: ORG,
        model: studioModelOrLegacy('seedream-5.5')!,
        defaultLane: 'sunra_api',
        caps: { sunra_api: 1, sunra_mcp: 1 },
        apiUp: true,
        now: NOW,
        stick: null,
        place: null,
      }),
    ).toBe('sunra_api');
    expect(await expireStaleStudioReservations(f.sql, NOW)).toEqual({ released: 0, expired: 0 });
    expect(await sweepStudio(deps)).toEqual({ released: 0, rerouted: 0, expired: 0, advanced: 0 });

    const rowAfter = (
      await f.sql.query<{ status: string; lane: string | null; error_code: string | null }>(
        'select status, lane, error_code from brand_studio_jobs where id = $1',
        [saved.job.id],
      )
    ).rows[0]!;
    expect(rowAfter).toEqual({ status: 'succeeded', lane: null, error_code: null });
  });

  it('Fix Round 3 Item 5 & 6: reserveEditedOutput returns saved job on retry after success, and completeEditedOutput runs studioSeat inside transaction', async () => {
    const png = await imageBytes('png', 40, 40);
    const req = requestId();
    const reserved1 = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
      sizeBytes: png.byteLength,
    });
    expect(reserved1.ok).toBe(true);
    await deps.staging.putStaging(editStagingKey(ORG, f.ids.owner, req), png, 'image/png');

    // Track whether any SQL query in completeEditedOutput runs outside deps.sql.transaction.
    let inTx = false;
    let queryOutsideTx = false;
    const trackRunner = (inner: SqlRunner): SqlRunner => ({
      query: (text, params) => {
        if (!inTx) queryOutsideTx = true;
        return inner.query(text, params);
      },
      transaction: <T>(fn: (tx: SqlRunner) => Promise<T>) =>
        inner.transaction(async (tx) => {
          inTx = true;
          try {
            return await fn(trackRunner(tx));
          } finally {
            inTx = false;
          }
        }),
    });
    const trackedDeps = { ...deps, sql: trackRunner(f.sql) };
    const completed = await runStudioOperation(trackedDeps, viewerOf(f.ids.owner), 'output.edit.complete', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok || !('job' in completed)) throw new Error('expected saved job');
    expect(queryOutsideTx).toBe(false);

    // Retry reserve after success returns saved job directly and performs no writes or upload URL minting.
    const jobsBefore = Number((await f.sql.query<{ c: number }>('select count(*)::int as c from brand_studio_jobs')).rows[0]!.c);
    const reserved2 = await runStudioOperation(deps, viewerOf(f.ids.owner), 'output.edit.reserve', {
      organizationId: ORG,
      requestId: req,
      mime: 'image/png',
      sizeBytes: png.byteLength,
    });
    expect(reserved2).toEqual({
      ok: true,
      direct: false,
      url: '',
      job: completed.job,
    });
    const jobsAfter = Number((await f.sql.query<{ c: number }>('select count(*)::int as c from brand_studio_jobs')).rows[0]!.c);
    expect(jobsAfter).toBe(jobsBefore);
  });
});
