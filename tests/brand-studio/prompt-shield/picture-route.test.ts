import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { StudioShieldedPromptPreview } from '@/lib/brand-studio/contracts';
import { studioEnv } from '@/lib/brand-studio/env';
import { resetFreeIntelRateLimits } from '@/lib/brand-studio/jobs';
import { PROMPT_PAGE, promptPageCount } from '@/lib/brand-studio/prompt-shield/layout';
import { runStudioOperation } from '@/lib/brand-studio/service';
import { brandRouteAllowed } from '@/lib/routing/surfaces';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '../server/helpers';
import { SENT, WORLD, seedWorld } from './world';

/**
 * `GET|POST /api/brand-studio/prompt-image` (the video prompt shield): the seats that see a run's view get its
 * sent text as a PNG; everything else gets the same 404, whatever the reason.
 */
const mocks = vi.hoisted(() => ({ sql: null as SqlRunner | null, viewer: null as Viewer | null }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => mocks.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => mocks.viewer ?? { userId: null, isAdmin: false, tier: 'anon', email: null, locale: null } }));

const route = await import('@/app/api/brand-studio/prompt-image/route');
const ORG = '00000000-0000-4000-8000-00000000a001';
const OTHER_ORG = '00000000-0000-4000-8000-00000000a002';
const BASE = 'http://localhost:3000/api/brand-studio/prompt-image';

const get = (jobId: string, page: string | number = 1, organizationId = ORG) =>
  route.GET(new NextRequest(`${BASE}?organizationId=${organizationId}&jobId=${jobId}&page=${page}`));
const post = (body: unknown, headers: Record<string, string> = { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }) =>
  route.POST(new NextRequest(BASE, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }));

let f: StudioFixture;
beforeEach(async () => {
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'on');
  vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', ORG);
  resetFreeIntelRateLimits();
  f = await studioFixture({ orgId: ORG });
  await seedWorld(f.sql, ORG, f.ids.owner);
  mocks.sql = f.sql;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await f.db.close();
  mocks.sql = null;
  mocks.viewer = null;
});

const as = (role: keyof StudioFixture['ids']) => {
  mocks.viewer = { ...viewerOf(f.ids[role]), isAdmin: role === 'admin' };
};

async function expectPng(response: Response, pages = 1) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(response.headers.get('content-disposition')).toBeNull();
  const headers = JSON.stringify([...response.headers.entries()]);
  expect(headers).not.toContain('Quillwort');
  const png = Buffer.from(await response.arrayBuffer());
  expect(png.includes(Buffer.from('Quillwort'))).toBe(false);
  const meta = await sharp(png).metadata();
  expect(meta.width).toBe(PROMPT_PAGE.width);
  expect(pages).toBeGreaterThanOrEqual(1);
  return png;
}

async function expectNotFound(response: Response): Promise<string> {
  expect(response.status).toBe(404);
  const body = await response.text();
  expect(body).toBe(JSON.stringify({ ok: false, code: 'not_found' }));
  return body;
}

describe('GET a stored run', () => {
  it('every seat that sees the view gets the picture of each video kind with sent text', async () => {
    for (const role of ['owner', 'editor', 'viewer', 'guest'] as const) {
      as(role);
      await expectPng(await get(WORLD.job.videoDesigned));
    }
    as('owner');
    for (const id of [WORLD.job.videoReviewed, WORLD.job.remixBasic, WORLD.job.remixBlueprint, WORLD.job.videoRevision, WORLD.job.videoBlockRetry]) {
      await expectPng(await get(id));
    }
    expect(promptPageCount(SENT.videoDesigned)).toBe(1);
  });

  it('one and the same 404 for every refusal', async () => {
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [OTHER_ORG, 'Other brand', f.ids.outsider, randomUUID()]);
    await f.sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [OTHER_ORG, f.ids.outsider, 'owner']);
    const foreign = randomUUID();
    await f.sql.query(
      `insert into brand_studio_jobs (id, organization_id, created_by, request_id, kind, status, model, prompt, final_prompt, enhance, params, finished_at)
        values ($1, $2, $3, 'req_foreign_job_0002', 'video', 'succeeded', 'seedance-2.5', 'x', $4, true, '{}'::jsonb, now())`,
      [foreign, OTHER_ORG, f.ids.outsider, SENT.videoDesigned],
    );
    const bodies = new Set<string>();
    const refuse = async (response: Response) => bodies.add(await expectNotFound(response));
    as('owner');
    // Not a video run, nothing designed, a preset, missing, another organization's, a page out of range.
    for (const id of [WORLD.job.image, WORLD.job.region, WORLD.job.preset, WORLD.job.music, WORLD.job.videoTyped, WORLD.job.videoFinal, WORLD.job.videoQueued, randomUUID(), foreign]) await refuse(await get(id));
    await refuse(await get(foreign, 1, OTHER_ORG));
    for (const page of [0, 2, 999, 'x', '1.0', '-1', '']) await refuse(await get(WORLD.job.videoDesigned, page));
    await refuse(await route.GET(new NextRequest(`${BASE}?organizationId=${ORG}&jobId=${WORLD.job.videoDesigned}`)));
    await refuse(await get('not-a-uuid'));
    // Not signed in, not a member, staff who is not a member.
    mocks.viewer = null;
    await refuse(await get(WORLD.job.videoDesigned));
    as('outsider');
    await refuse(await get(WORLD.job.videoDesigned));
    as('admin');
    await refuse(await get(WORLD.job.videoDesigned));
    // The shield closed, open for another organization only, the studio closed.
    as('owner');
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'off');
    await refuse(await get(WORLD.job.videoDesigned));
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'on');
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', OTHER_ORG);
    await refuse(await get(WORLD.job.videoDesigned));
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', ORG);
    vi.stubEnv('BRAND_STUDIO_V2', 'off');
    await refuse(await get(WORLD.job.videoDesigned));
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    // A removed run, and the editor's export, are not in any list a seat reads.
    await f.sql.query('update brand_studio_jobs set deleted_at = now() where id = $1', [WORLD.job.videoBlockRetry]);
    await refuse(await get(WORLD.job.videoBlockRetry));
    await f.sql.query("update brand_studio_jobs set model = 'compose-1080p' where id = $1", [WORLD.job.remixBasic]);
    await refuse(await get(WORLD.job.remixBasic));
    expect(bodies.size).toBe(1);
  });

  it('a sandboxed organization gets the same 404', async () => {
    const sandbox = await studioFixture({ orgId: [...SANDBOXED_CLIENT_ORG_IDS][0]! });
    try {
      await seedWorld(sandbox.sql, sandbox.orgId, sandbox.ids.owner);
      vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD_ORGS', 'all');
      mocks.sql = sandbox.sql;
      mocks.viewer = viewerOf(sandbox.ids.owner);
      await expectNotFound(await get(WORLD.job.videoDesigned, 1, sandbox.orgId));
    } finally {
      await sandbox.db.close();
      mocks.sql = f.sql;
    }
  });
});

describe('POST a designed sentence', () => {
  async function token(): Promise<string> {
    const deps = studioDeps(f.sql, { env: studioEnv({ BRAND_STUDIO_PROVIDER: 'fake', BRAND_STUDIO_DEFAULT_LANE: 'sunra_api' }) });
    const answer = await runStudioOperation(deps, viewerOf(f.ids.owner), 'prompt.enhance', {
      kind: 'video', organizationId: ORG, model: 'seedance-2.5', prompt: '병이 천천히 돈다', aspect: '9:16', resolution: '720p', seconds: 5,
    });
    return (answer as StudioShieldedPromptPreview).token;
  }

  it('the member who designed it gets its pages; anyone or anything else the same 404', async () => {
    const t = await token();
    as('owner');
    await expectPng(await post({ organizationId: ORG, token: t, page: 1 }));
    await expectNotFound(await post({ organizationId: ORG, token: t, page: 2 }));
    await expectNotFound(await post({ organizationId: OTHER_ORG, token: t, page: 1 }));
    await expectNotFound(await post({ organizationId: ORG, token: `${t.slice(0, 40)}${t[40] === 'A' ? 'B' : 'A'}${t.slice(41)}`, page: 1 }));
    await expectNotFound(await post({ organizationId: ORG, token: t, page: 1 }, { origin: 'https://example.com' }));
    await expectNotFound(await post({ organizationId: ORG, token: t, page: 1 }, { 'sec-fetch-site': 'cross-site' }));
    await expectNotFound(await post({ organizationId: ORG, page: 1 }));
    as('editor');
    await expectNotFound(await post({ organizationId: ORG, token: t, page: 1 }));
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'off');
    as('owner');
    await expectNotFound(await post({ organizationId: ORG, token: t, page: 1 }));
  });
});

describe('the studio route body limit', () => {
  it('only a video job.create with a token may pass 64 KB, and only with the shield open', async () => {
    const studio = await import('@/app/api/brand-studio/route');
    as('owner');
    const big = (kind: string) => JSON.stringify({
      operation: 'job.create',
      input: { kind, organizationId: ORG, requestId: 'req_big_body_0001', model: kind === 'video' ? 'seedance-2.5' : 'seedream-5.5', prompt: 'x', aspect: '9:16', resolution: '720p', seconds: 5, reviewedToken: 'A'.repeat(100_000) },
    });
    const send = (body: string) => studio.POST(new NextRequest('http://localhost:3000/api/brand-studio', { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' } }));
    expect((await send(big('image'))).status).toBe(413);
    expect((await send(big('video_remix'))).status).toBe(413);
    // The video request reaches the service, which refuses the token itself.
    const video = await send(big('video'));
    expect(video.status).not.toBe(413);
    expect(await video.json()).toEqual({ ok: false, code: 'conflict' });
    vi.stubEnv('BRAND_STUDIO_VIDEO_PROMPT_SHIELD', 'off');
    expect((await send(big('video'))).status).toBe(413);
  });
});

describe('registration', () => {
  it('reachable on the brand host for GET and POST only', () => {
    expect(brandRouteAllowed('/api/brand-studio/prompt-image', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/prompt-image', 'HEAD')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/prompt-image', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-studio/prompt-image', 'DELETE')).toBe(false);
    expect(brandRouteAllowed('/api/brand-studio/prompt-image/x', 'GET')).toBe(false);
  });

  it('the route is the only place the font is traced into', async () => {
    const config = (await import('@/next.config')).default as { outputFileTracingIncludes?: Record<string, string[]> };
    expect(config.outputFileTracingIncludes).toEqual({ '/api/brand-studio/prompt-image': ['./assets/fonts/server/**'] });
  });
});
