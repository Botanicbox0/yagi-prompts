import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { createStudioJob } from '@/lib/brand-studio/jobs';
import { loadFolderItems } from '@/lib/brand-studio/library';
import {
  buildMcpClientSnippet,
  computePkceS256Challenge,
  hashMcpToken,
  MCP_CLIENT_TABS,
  registerMcpOAuthClient,
} from '@/lib/brand-studio/mcp';
import { authReturnPath } from '@/lib/routing/surfaces';
import type { StudioDeps } from '@/lib/brand-studio/types';
import {
  loadWorkflowsHubState,
  runCharacterSheetWorkflow,
  runWorkflowOperation,
  STARTER_WORKFLOWS,
} from '@/lib/brand-studio/workflows';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { RAIL_GROUP, RAIL_HREF, railActive, railItems } from '@/components/brand-workspace/rail-model';
import { McpConnectModal } from '@/components/brand-studio/workflows/mcp-connect-modal';
import { WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import {
  requestId,
  seedImageAsset,
  seedVideoAsset,
  studioDeps,
  studioFixture,
  viewerOf,
} from './server/helpers';

const routeState = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  deps: null as StudioDeps | null,
  viewer: { userId: null, isAdmin: false, tier: 'free', email: null, locale: 'ko' } as Viewer,
  studioOpen: true,
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/studio/workflows',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (cb: () => unknown) => {
    routeState.afterCallbacks.push(cb);
  },
}));

vi.mock('@/lib/flags', async (original) => {
  const actual = await original<typeof import('@/lib/flags')>();
  return {
    ...actual,
    brandStudioV2Open: () => routeState.studioOpen,
  };
});

vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => routeState.sql,
}));

vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => routeState.viewer,
}));

vi.mock('@/lib/brand-studio/runtime', async (original) => {
  const actual = await original<typeof import('@/lib/brand-studio/runtime')>();
  return {
    ...actual,
    studioRuntimeDeps: async (sql: SqlRunner) => routeState.deps ?? studioDeps(sql),
  };
});

vi.mock('@/components/brand-workspace/context', () => ({
  brandContext: async () => {
    const dict = getDictionary(routeState.viewer.locale === 'en' ? 'en' : 'ko');
    return {
      viewer: routeState.viewer,
      sql: routeState.sql,
      verifiedEmail: routeState.viewer.email ?? undefined,
      brandHost: true,
      locale: routeState.viewer.locale === 'en' ? ('en' as const) : ('ko' as const),
      dict,
      b: dict.brandWorkspace,
    };
  },
}));

import { GET as getWorkflowsRoute, POST as postWorkflowsRoute } from '@/app/api/brand-studio/workflows/route';
import { GET as getMcpTokensRoute, POST as postMcpTokensRoute } from '@/app/api/brand-studio/mcp-tokens/route';
import { GET as getMcpRoute, POST as postMcpRoute } from '@/app/api/mcp/route';
import { GET as getProtectedResourceRoute } from '@/app/.well-known/oauth-protected-resource/route';
import { GET as getAuthServerRoute } from '@/app/.well-known/oauth-authorization-server/route';
import { POST as postOAuthRegisterRoute } from '@/app/api/mcp/oauth/register/route';
import { GET as getOAuthAuthorizeRoute, POST as postOAuthAuthorizeRoute } from '@/app/api/mcp/oauth/authorize/route';
import { POST as postOAuthTokenRoute } from '@/app/api/mcp/oauth/token/route';
import StudioWorkflowsPage from '@/app/(brand)/brand/studio/workflows/page';

function sameOriginJsonPost(url: string, body: unknown): NextRequest {
  const u = new URL(url);
  return new NextRequest(u, {
    method: 'POST',
    headers: {
      host: u.host,
      origin: u.origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('1. Starter Workflows (`캐릭터 시트 메이커`), Custom Workflows, Save from Job, AI Builder & Playbooks', () => {
  beforeEach(() => {
    routeState.studioOpen = true;
    routeState.afterCallbacks = [];
  });

  it('exposes STARTER_WORKFLOWS led by #1 Flagship 캐릭터 시트 메이커 and executes multi-step turnaround + expression + detail sheets into a shared folder', async () => {
    expect(STARTER_WORKFLOWS.map((w) => w.slug)).toEqual([
      'character-sheet-maker',
      'product-packshot-sheet',
      'reference-video-ad-pack',
    ]);
    expect(STARTER_WORKFLOWS[0]!.title).toBe('캐릭터 시트 메이커');
    expect(STARTER_WORKFLOWS[0]!.category).toBe('character');

    const fix = await studioFixture();
    const deps = studioDeps(fix.sql);
    const owner = viewerOf(fix.ids.owner, 'ko');
    const refAssetId = await seedImageAsset(deps, fix.orgId, fix.ids.owner, { role: 'person', width: 512, height: 640 });

    const runRes = await runCharacterSheetWorkflow(deps, owner, {
      organizationId: fix.orgId,
      requestId: requestId(),
      image1Ref: { assetId: refAssetId, role: 'person' },
      subject: '소라',
      prompt: '차콜 울 테일러드 재킷과 화이트 셔츠, 자연스러운 스튜디오 조명',
    });

    expect(runRes.ok).toBe(true);
    if (!runRes.ok) return;

    // 3 jobs: 16:9 single-canvas turnaround + 1:1 4-expression sheet + 4:3 wardrobe detail sheet
    expect(runRes.jobs).toHaveLength(3);
    expect(runRes.jobs.map((j) => j.aspect)).toEqual(['16:9', '1:1', '4:3']);
    expect(runRes.jobs[0]!.prompt).toContain('Front · 90° Side · Back');
    expect(runRes.jobs[1]!.prompt).toContain('4-panel expression grid');
    expect(runRes.jobs.every((j) => j.status === 'succeeded' && j.outputs.length === 1)).toBe(true);
    expect(runRes.jobs.every((j) => j.references[0]?.assetId === refAssetId)).toBe(true);

    // Consistency check passed + outputs filed into shared folder `캐릭터 시트 · 소라`
    expect(runRes.consistency?.checked).toBe(true);
    expect(runRes.consistency?.passed).toBe(true);
    expect(runRes.folder?.name).toBe('캐릭터 시트 · 소라');

    const folderItems = await loadFolderItems(deps, owner, fix.orgId, runRes.folder!.id);
    expect(folderItems.ok).toBe(true);
    if (folderItems.ok) {
      // Anchor asset + 3 generated outputs = 4 ready items in the shared folder!
      expect(folderItems.items).toHaveLength(4);
    }

    await fix.db.close();
  });

  it('generates a hero front anchor first when 캐릭터 시트 메이커 runs text-only without @image1, and auto-retries once when Gemini vision detects drift', async () => {
    const fix = await studioFixture();
    let geminiCalls = 0;
    const mockFetch: typeof fetch = (async () => {
      geminiCalls += 1;
      const verdict =
        geminiCalls === 1
          ? { passed: false, score: 58, driftedStepIds: ['expressions'], notes: 'Hair silhouette drifted on expression panel.' }
          : { passed: true, score: 97, driftedStepIds: [], notes: 'All sheets match anchor portrait.' };
      return new Response(
        JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(verdict) }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const deps = studioDeps(fix.sql, {
      intelDeps: { fetch: mockFetch, env: { GEMINI_API_KEY: 'test-gemini-key' } },
    });
    const editor = viewerOf(fix.ids.editor, 'ko');

    const res = await runCharacterSheetWorkflow(deps, editor, {
      organizationId: fix.orgId,
      requestId: requestId(),
      subject: '루카스',
      prompt: '네이비 트렌치코트와 미니멀 안경',
      packs: ['turnaround', 'expressions'],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 1 hero_front anchor + turnaround + retried expressions = 3 final jobs
    expect(res.jobs).toHaveLength(3);
    expect(res.jobs[0]!.aspect).toBe('3:4');
    // Turnaround and retried expressions locked onto the hero_front outputId!
    const heroOutId = res.jobs[0]!.outputs[0]!.id;
    expect(res.jobs[1]!.references[0]?.outputId).toBe(heroOutId);
    expect(res.jobs[2]!.references[0]?.outputId).toBe(heroOutId);
    expect(res.jobs[2]!.prompt).toContain('STRICT IDENTITY & WARDROBE LOCK RETRY');

    expect(geminiCalls).toBe(2);
    expect(res.consistency).toMatchObject({
      checked: true,
      passed: true,
      score: 97,
      retried: true,
      retriedStepId: 'expressions',
      mode: 'gemini-vision',
    });

    await fix.db.close();
  });

  it('supports reference-video-ad-pack, custom workflow CRUD, save_from_job, AI builder fallback, and inject_director playbooks', async () => {
    const fix = await studioFixture();
    const deps = studioDeps(fix.sql);
    const owner = viewerOf(fix.ids.owner, 'ko');
    const viewer = viewerOf(fix.ids.viewer, 'ko');

    const imgId = await seedImageAsset(deps, fix.orgId, fix.ids.owner, { role: 'product' });
    const vidId = await seedVideoAsset(deps, fix.orgId, fix.ids.owner, 6);

    // 1) Playbook CRUD + inject_director
    const pbSaved = await runWorkflowOperation(deps, owner, 'save_playbook', {
      organizationId: fix.orgId,
      requestId: requestId(),
      title: '26FW 조명 및 색감 규칙',
      bodyMd: '차가운 자연광 키라이트와 뉴트럴 스톤 배경만 사용합니다.',
      tags: ['조명', '컬러'],
      injectDirector: true,
      status: 'published',
    });
    expect(pbSaved.ok).toBe(true);

    // Viewer cannot mutate workflows or playbooks (403 forbidden)
    const viewerAttempt = await runWorkflowOperation(deps, viewer, 'delete_playbook', {
      organizationId: fix.orgId,
      playbookId: pbSaved.ok && 'playbook' in pbSaved ? pbSaved.playbook.id : randomUUID(),
    });
    expect(viewerAttempt).toEqual({ ok: false, code: 'forbidden' });

    // 2) Run reference-video-ad-pack (1 cut) and verify injected playbook rules + blueprint video_remix
    const adRun = await runWorkflowOperation(deps, owner, 'run', {
      organizationId: fix.orgId,
      requestId: requestId(),
      workflowId: 'reference-video-ad-pack',
      inputs: {
        video1Ref: { assetId: vidId },
        image1Ref: { assetId: imgId },
        subject: '글로우 세럼',
        prompt: '유리 보틀 반사광 강조',
        packs: ['cut_hook'],
      },
    });
    expect(adRun.ok).toBe(true);
    if (adRun.ok && 'jobs' in adRun) {
      expect(adRun.jobs).toHaveLength(1);
      expect(adRun.jobs[0]!.kind).toBe('video_remix');
      expect(adRun.jobs[0]!.audio).toBe('ambient');
      expect(adRun.jobs[0]!.prompt).toContain('26FW 조명 및 색감 규칙');
    }

    // 3) Save from recent Studio job
    const directJob = await createStudioJob(deps, owner, {
      kind: 'image',
      organizationId: fix.orgId,
      requestId: requestId(),
      model: 'nano-banana-pro',
      prompt: 'French cobalt bottle studio hero shot',
      enhance: true,
      aspect: '4:5',
      resolution: '2K',
      count: 1,
      references: [{ assetId: imgId, role: 'product' }],
    });
    expect(directJob.ok).toBe(true);
    if (!directJob.ok) return;

    const savedFromJob = await runWorkflowOperation(deps, owner, 'save_from_job', {
      organizationId: fix.orgId,
      requestId: requestId(),
      jobId: directJob.job.id,
      title: '코발트 보틀 고정 화보',
      summary: '신제품 상세페이지 상단용',
    });
    expect(savedFromJob.ok).toBe(true);
    if (savedFromJob.ok && 'workflow' in savedFromJob) {
      expect(savedFromJob.workflow.source).toBe('saved_run');
      expect(savedFromJob.workflow.recipe.steps[0]?.aspect).toBe('4:5');
    }

    // 4) AI Workflow Builder deterministic offline fallback
    const aiBuilt = await runWorkflowOperation(deps, owner, 'build_with_ai', {
      organizationId: fix.orgId,
      requestId: requestId(),
      brief: '향수 보틀 사진 1장 넣으면 스튜디오 화보 3컷과 9:16 오프닝 영상을 만드는 워크플로우',
    });
    expect(aiBuilt.ok).toBe(true);
    if (aiBuilt.ok && 'workflow' in aiBuilt) {
      expect(aiBuilt.builderMode).toBe('fallback');
      expect(aiBuilt.workflow.source).toBe('ai_builder');
      // 3 image stills + 1 9:16 opening video = 4 steps
      expect(aiBuilt.workflow.recipe.steps).toHaveLength(4);
      expect(aiBuilt.workflow.recipe.steps.filter((s) => s.medium === 'image')).toHaveLength(3);
      expect(aiBuilt.workflow.recipe.steps.find((s) => s.medium === 'video')?.aspect).toBe('9:16');

      // Update + delete custom workflow
      const updated = await runWorkflowOperation(deps, owner, 'update', {
        organizationId: fix.orgId,
        workflowId: aiBuilt.workflow.id,
        title: '향수 런칭 4종 풀패키지',
      });
      expect(updated.ok && 'workflow' in updated && updated.workflow.title).toBe('향수 런칭 4종 풀패키지');

      const hub = await loadWorkflowsHubState(deps, owner, fix.orgId);
      expect(hub.ok).toBe(true);
      if (hub.ok) {
        expect(hub.workflows).toHaveLength(2);
        expect(hub.playbooks).toHaveLength(1);
        expect(hub.recentRuns.length).toBeGreaterThanOrEqual(1);
      }

      const deleted = await runWorkflowOperation(deps, owner, 'delete', {
        organizationId: fix.orgId,
        workflowId: aiBuilt.workflow.id,
      });
      expect(deleted.ok).toBe(true);
    }

    await fix.db.close();
  });
});

describe('2. MCP SHA-256 Tokens, Revocation, Member Removal, OAuth 2.1 PKCE & Morphic Sandbox 404 Hardline', () => {
  beforeEach(() => {
    routeState.studioOpen = true;
    routeState.afterCallbacks = [];
  });

  it('stores ONLY SHA-256 token_hash (never raw twmcp_ token), rejects cookie-only /api/mcp, and invalidates immediately on revoke or member removal', async () => {
    const fix = await studioFixture();
    const deps = studioDeps(fix.sql);
    routeState.sql = fix.sql;
    routeState.deps = deps;
    routeState.viewer = viewerOf(fix.ids.editor, 'ko');

    // Mint token via POST /api/brand-studio/mcp-tokens
    const mintRes = await postMcpTokensRoute(
      sameOriginJsonPost('https://brand.twings.app/api/brand-studio/mcp-tokens', {
        op: 'create',
        organizationId: fix.orgId,
        clientId: 'claude-code',
        label: 'Editor MacBook',
      }),
    );
    expect(mintRes.status).toBe(201);
    const mintJson = (await mintRes.json()) as { ok: true; token: string; record: { id: string; tokenPrefix: string } };
    expect(mintJson.token).toMatch(/^twmcp_[0-9a-f]{48}$/);
    expect(mintJson.record.tokenPrefix).toBe(mintJson.token.slice(0, 14));

    // Verify raw token is NEVER stored anywhere in brand_studio_mcp_tokens
    const storedRow = (
      await fix.sql.query<{ token_hash: string; token_prefix: string; last_used_at: Date | null }>(
        'select token_hash, token_prefix, last_used_at from brand_studio_mcp_tokens where id = $1',
        [mintJson.record.id],
      )
    ).rows[0]!;
    expect(storedRow.token_hash).toBe(hashMcpToken(mintJson.token));
    expect(storedRow.token_hash).not.toContain('twmcp_');
    expect(storedRow.token_prefix).not.toBe(mintJson.token);
    expect(storedRow.last_used_at).toBeNull();

    // Cookie-only request (signed-in routeState.viewer, no Bearer header and no ?token=) MUST get 401 + WWW-Authenticate
    const cookieOnlyRes = await postMcpRoute(
      new NextRequest('https://brand.twings.app/api/mcp', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          cookie: 'sb-access-token=session-cookie-ignored',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(cookieOnlyRes.status).toBe(401);
    expect(cookieOnlyRes.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource');

    // Valid Bearer token succeeds and stamps last_used_at
    const authedPing = await postMcpRoute(
      new NextRequest('https://brand.twings.app/api/mcp', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          authorization: `Bearer ${mintJson.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      }),
    );
    expect(authedPing.status).toBe(200);
    const afterUse = (
      await fix.sql.query<{ last_used_at: Date | null }>('select last_used_at from brand_studio_mcp_tokens where id = $1', [
        mintJson.record.id,
      ])
    ).rows[0]!;
    expect(afterUse.last_used_at).not.toBeNull();

    // Mint a second token to test member removal invalidation separately from explicit revoke
    const secondMint = await postMcpTokensRoute(
      sameOriginJsonPost('https://brand.twings.app/api/brand-studio/mcp-tokens', {
        op: 'create',
        organizationId: fix.orgId,
        clientId: 'cursor',
        label: 'Editor Cursor',
      }),
    );
    const secondToken = ((await secondMint.json()) as { token: string }).token;

    // 1-click Revoke invalidates token #1 -> 401
    const revokeRes = await postMcpTokensRoute(
      sameOriginJsonPost('https://brand.twings.app/api/brand-studio/mcp-tokens', {
        op: 'revoke',
        organizationId: fix.orgId,
        tokenId: mintJson.record.id,
      }),
    );
    expect(revokeRes.status).toBe(200);

    const afterRevoke = await postMcpRoute(
      new NextRequest('https://brand.twings.app/api/mcp', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          authorization: `Bearer ${mintJson.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      }),
    );
    expect(afterRevoke.status).toBe(401);

    // Removing editor from brand_memberships immediately causes token #2 to get 404!
    await fix.sql.query('delete from brand_memberships where organization_id = $1 and user_id = $2', [
      fix.orgId,
      fix.ids.editor,
    ]);
    const afterRemoval = await postMcpRoute(
      new NextRequest('https://brand.twings.app/api/mcp', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          authorization: `Bearer ${secondToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
      }),
    );
    expect(afterRemoval.status).toBe(404);

    await fix.db.close();
  });

  it('completes full OAuth 2.1 Discovery + Dynamic Registration + PKCE S256 Authorize + Single-Use Token Exchange', async () => {
    const fix = await studioFixture();
    const deps = studioDeps(fix.sql);
    routeState.sql = fix.sql;
    routeState.deps = deps;
    routeState.viewer = viewerOf(fix.ids.owner, 'ko');

    const prmRes = await getProtectedResourceRoute(new NextRequest('https://brand.twings.app/.well-known/oauth-protected-resource'));
    expect(prmRes.status).toBe(200);
    const prm = (await prmRes.json()) as { resource: string; authorization_servers: string[] };
    expect(prm.resource).toBe('https://brand.twings.app/api/mcp');

    const asmRes = await getAuthServerRoute(new NextRequest('https://brand.twings.app/.well-known/oauth-authorization-server'));
    expect(asmRes.status).toBe(200);
    const asm = (await asmRes.json()) as { authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
    expect(asm.authorization_endpoint).toBe('https://brand.twings.app/api/mcp/oauth/authorize');

    const regRes = await postOAuthRegisterRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Claude Desktop',
          redirect_uris: ['http://127.0.0.1:49152/callback'],
        }),
      }),
    );
    expect(regRes.status).toBe(201);
    const regClient = (await regRes.json()) as { client_id: string };
    expect(regClient.client_id).toMatch(/^twc_/);

    const codeVerifier = 'v'.repeat(64);
    const codeChallenge = computePkceS256Challenge(codeVerifier);

    const consentUrl = new URL('https://brand.twings.app/api/mcp/oauth/authorize');
    consentUrl.searchParams.set('client_id', regClient.client_id);
    consentUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:49152/callback');
    consentUrl.searchParams.set('response_type', 'code');
    consentUrl.searchParams.set('code_challenge', codeChallenge);
    consentUrl.searchParams.set('code_challenge_method', 'S256');
    consentUrl.searchParams.set('state', 'xyz123');

    const consentGet = await getOAuthAuthorizeRoute(new NextRequest(consentUrl.toString()));
    expect(consentGet.status).toBe(200);
    const consentHtml = await consentGet.text();
    expect(consentHtml).toContain('data-mcp-oauth-consent');
    expect(consentHtml).toContain('Claude Desktop');
    expect(consentHtml).toContain('http://localhost:49152');

    // Unregistered client_id + arbitrary https redirect_uri must be rejected (P0-2)
    const unregisteredUrl = new URL('https://brand.twings.app/api/mcp/oauth/authorize');
    unregisteredUrl.searchParams.set('client_id', 'unregistered-attacker-client');
    unregisteredUrl.searchParams.set('redirect_uri', 'https://attacker.example/callback');
    unregisteredUrl.searchParams.set('response_type', 'code');
    unregisteredUrl.searchParams.set('code_challenge', codeChallenge);
    unregisteredUrl.searchParams.set('code_challenge_method', 'S256');
    const unregisteredRes = await getOAuthAuthorizeRoute(new NextRequest(unregisteredUrl.toString()));
    expect(unregisteredRes.status).toBe(400);

    // BRAND_STUDIO_WEBHOOK_SECRET is never used as OAuth signing secret in production (P0-1)
    expect(() =>
      registerMcpOAuthClient(
        { client_name: 'Test', redirect_uris: ['http://127.0.0.1:49152/callback'] },
        { NODE_ENV: 'production', BRAND_STUDIO_WEBHOOK_SECRET: 'external-webhook-secret-must-not-sign-oauth' },
      ),
    ).toThrow('mcp_oauth_secret_missing');

    // authReturnPath preserves /api/mcp/oauth/authorize on brand.twings.app (P1-3)
    expect(
      authReturnPath('/api/mcp/oauth/authorize?client_id=twc_test', 'brand.twings.app', '/brand'),
    ).toBe('/api/mcp/oauth/authorize?client_id=twc_test');

    // Browser form submit (`sec-fetch-dest: document`) returns CSP-safe 200 HTML handoff (P1-2)
    const browserApprovePost = await postOAuthAuthorizeRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/authorize', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          origin: 'https://brand.twings.app',
          'sec-fetch-site': 'same-origin',
          'sec-fetch-dest': 'document',
          'x-nonce': 'test-csp-nonce-123',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: regClient.client_id,
          redirect_uri: 'http://127.0.0.1:49152/callback',
          response_type: 'code',
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state: 'xyz123',
          organizationId: fix.orgId,
          decision: 'approve',
        }).toString(),
      }),
    );
    expect(browserApprovePost.status).toBe(200);
    expect(browserApprovePost.headers.get('x-oauth-redirect-to')).toContain('code=twa_');
    const browserHtml = await browserApprovePost.text();
    expect(browserHtml).toContain('data-mcp-oauth-handoff');
    expect(browserHtml).toContain('nonce="test-csp-nonce-123"');

    const approveForm = new URLSearchParams({
      client_id: regClient.client_id,
      redirect_uri: 'http://127.0.0.1:49152/callback',
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'xyz123',
      organizationId: fix.orgId,
      decision: 'approve',
    });
    const approvePost = await postOAuthAuthorizeRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/authorize', {
        method: 'POST',
        headers: {
          host: 'brand.twings.app',
          origin: 'https://brand.twings.app',
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: approveForm.toString(),
      }),
    );
    expect(approvePost.status).toBe(302);
    const redirectLoc = new URL(approvePost.headers.get('location')!);
    const authCode = redirectLoc.searchParams.get('code')!;
    expect(authCode).toMatch(/^twa_/);
    expect(redirectLoc.searchParams.get('state')).toBe('xyz123');

    // Exchange PKCE code for Bearer twmcp_ token
    const tokenRes = await postOAuthTokenRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: 'http://127.0.0.1:49152/callback',
          client_id: regClient.client_id,
        }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(200);
    const tokenJson = (await tokenRes.json()) as { access_token: string; token_type: string };
    expect(tokenJson.token_type).toBe('Bearer');
    expect(tokenJson.access_token).toMatch(/^twmcp_[0-9a-f]{48}$/);

    // Replay of the same auth code is rejected
    const replayRes = await postOAuthTokenRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: 'http://127.0.0.1:49152/callback',
          client_id: regClient.client_id,
        }).toString(),
      }),
    );
    expect(replayRes.status).toBe(400);

    await fix.db.close();
  });

  it('enforces Morphic sandbox & generative_media-denied 404 across /brand/studio/workflows, /api/brand-studio/workflows, /api/brand-studio/mcp-tokens, /api/mcp, and /api/mcp/oauth/authorize', async () => {
    for (const sandboxId of SANDBOXED_CLIENT_ORG_IDS) {
      const fix = await studioFixture({ orgId: sandboxId, orgName: 'Morphic' });
      const deps = studioDeps(fix.sql);
      routeState.sql = fix.sql;
      routeState.deps = deps;
      routeState.viewer = viewerOf(fix.ids.owner, 'ko');

      // 1. Page /brand/studio/workflows -> 404 NEXT_NOT_FOUND
      await expect(
        StudioWorkflowsPage({ searchParams: Promise.resolve({ organizationId: fix.orgId }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND');

      // 2. GET & POST /api/brand-studio/workflows -> 404
      const wfGet = await getWorkflowsRoute(
        new NextRequest(`https://brand.twings.app/api/brand-studio/workflows?organizationId=${fix.orgId}`),
      );
      expect(wfGet.status).toBe(404);

      const wfPost = await postWorkflowsRoute(
        sameOriginJsonPost('https://brand.twings.app/api/brand-studio/workflows', {
          op: 'build_with_ai',
          input: { organizationId: fix.orgId, requestId: requestId(), brief: '캐릭터 시트 워크플로우' },
        }),
      );
      expect(wfPost.status).toBe(404);

      // 3. GET & POST /api/brand-studio/mcp-tokens -> 404
      const tokGet = await getMcpTokensRoute(
        new NextRequest(`https://brand.twings.app/api/brand-studio/mcp-tokens?organizationId=${fix.orgId}`),
      );
      expect(tokGet.status).toBe(404);

      const tokPost = await postMcpTokensRoute(
        sameOriginJsonPost('https://brand.twings.app/api/brand-studio/mcp-tokens', {
          op: 'create',
          organizationId: fix.orgId,
          clientId: 'claude',
        }),
      );
      expect(tokPost.status).toBe(404);

      // 4. Even if a raw token hash were seeded directly in DB for Morphic, /api/mcp returns 404!
      const forgedRaw = `twmcp_${'a'.repeat(48)}`;
      await fix.sql.query(
        `insert into brand_studio_mcp_tokens (organization_id, user_id, client_id, label, token_prefix, token_hash)
         values ($1, $2, 'claude', 'Forged', 'twmcp_aaaaaaaa', $3)`,
        [fix.orgId, fix.ids.owner, hashMcpToken(forgedRaw)],
      );
      const mcpPost = await postMcpRoute(
        new NextRequest('https://brand.twings.app/api/mcp', {
          method: 'POST',
          headers: {
            host: 'brand.twings.app',
            authorization: `Bearer ${forgedRaw}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      );
      expect(mcpPost.status).toBe(404);

      // 5. OAuth authorize -> 404
      const oauthUrl = new URL('https://brand.twings.app/api/mcp/oauth/authorize');
      oauthUrl.searchParams.set('organizationId', fix.orgId);
      oauthUrl.searchParams.set('client_id', 'claude');
      oauthUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:8787/cb');
      oauthUrl.searchParams.set('response_type', 'code');
      oauthUrl.searchParams.set('code_challenge', computePkceS256Challenge('x'.repeat(64)));
      oauthUrl.searchParams.set('code_challenge_method', 'S256');
      const oauthRes = await getOAuthAuthorizeRoute(new NextRequest(oauthUrl));
      expect(oauthRes.status).toBe(404);

      await fix.db.close();
    }

    // Also verify generative_media-denied policy org returns 404 everywhere
    const genDeniedFix = await studioFixture({ orgName: 'Gen Denied Brand' });
    await genDeniedFix.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, note, revision)
       values ($1, array['generative_media']::text[], 'test deny', 1)`,
      [genDeniedFix.orgId],
    );
    routeState.sql = genDeniedFix.sql;
    routeState.deps = studioDeps(genDeniedFix.sql);
    routeState.viewer = viewerOf(genDeniedFix.ids.owner, 'ko');
    await expect(
      StudioWorkflowsPage({ searchParams: Promise.resolve({ organizationId: genDeniedFix.orgId }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    const genDeniedApi = await getWorkflowsRoute(
      new NextRequest(`https://brand.twings.app/api/brand-studio/workflows?organizationId=${genDeniedFix.orgId}`),
    );
    expect(genDeniedApi.status).toBe(404);
    await genDeniedFix.db.close();

    // Also verify project_only (self_studio denied, generative_media open) org renders <StudioShowroom /> on /brand/studio/workflows
    const projOnlyFix = await studioFixture({ orgName: 'Project Only Client' });
    await projOnlyFix.sql.query(
      `insert into brand_feature_policies (organization_id, denied_features, note, revision)
       values ($1, array['self_studio']::text[], 'project-only client', 1)`,
      [projOnlyFix.orgId],
    );
    routeState.sql = projOnlyFix.sql;
    routeState.deps = studioDeps(projOnlyFix.sql);
    routeState.viewer = viewerOf(projOnlyFix.ids.owner, 'ko');

    const showroomElement = await StudioWorkflowsPage({
      searchParams: Promise.resolve({ organizationId: projOnlyFix.orgId }),
    });
    const showroomHtml = renderToStaticMarkup(showroomElement);
    expect(showroomHtml).toContain('Project Only Client');
    await projOnlyFix.db.close();
  });
});

describe('3. Full JSON-RPC 2.0 Streamable HTTP MCP Flow (/api/mcp)', () => {
  it('executes initialize -> notifications/initialized -> tools/list -> tools/call (workflow create/run, playbook save, assets, image/video gen) -> resources/list & read', async () => {
    const fix = await studioFixture();
    const deps = studioDeps(fix.sql);
    routeState.sql = fix.sql;
    routeState.deps = deps;
    routeState.viewer = viewerOf(fix.ids.owner, 'ko');

    const assetId = await seedImageAsset(deps, fix.orgId, fix.ids.owner, { role: 'person' });

    const mintRes = await postMcpTokensRoute(
      sameOriginJsonPost('https://brand.twings.app/api/brand-studio/mcp-tokens', {
        op: 'create',
        organizationId: fix.orgId,
        clientId: 'claude',
        label: 'Claude Connector',
      }),
    );
    const { token } = (await mintRes.json()) as { token: string };

    const callRpc = async (body: unknown, viaQuery = false) => {
      const url = viaQuery
        ? `https://brand.twings.app/api/mcp?token=${encodeURIComponent(token)}`
        : 'https://brand.twings.app/api/mcp';
      const headers: Record<string, string> = {
        host: 'brand.twings.app',
        'content-type': 'application/json',
      };
      if (!viaQuery) headers.authorization = `Bearer ${token}`;
      return postMcpRoute(new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) }));
    };

    // 1. initialize (also testing ?token= single-URL connector auth)
    const initRes = await callRpc(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      true,
    );
    expect(initRes.status).toBe(200);
    const initBody = (await initRes.json()) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(initBody.result.protocolVersion).toBe('2025-03-26');
    expect(initBody.result.serverInfo.name).toBe('twings-brand-studio');

    // 2. notifications/initialized -> 202 Accepted
    const notifRes = await callRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(notifRes.status).toBe(202);

    // 3. tools/list -> all 8 tools
    const listToolsRes = await callRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const listToolsJson = (await listToolsRes.json()) as { result: { tools: Array<{ name: string }> } };
    expect(listToolsJson.result.tools.map((t) => t.name)).toEqual([
      'twings_list_assets',
      'twings_list_workflows',
      'twings_create_workflow',
      'twings_run_workflow',
      'twings_list_playbooks',
      'twings_save_playbook',
      'twings_generate_image',
      'twings_generate_video',
    ]);

    // 4. twings_create_workflow
    const createWfRes = await callRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'twings_create_workflow',
        arguments: {
          title: 'MCP 신제품 2컷 화보',
          brief: '보틀 사진 1장으로 화보 2컷 만드는 워크플로우',
        },
      },
    });
    const createdWfPayload = ((await createWfRes.json()) as { result: { structuredContent: { ok: boolean; workflow: { id: string; source: string } } } }).result.structuredContent;
    expect(createdWfPayload.ok).toBe(true);
    expect(createdWfPayload.workflow.source).toBe('mcp');

    // 5. twings_run_workflow (`character-sheet-maker`)
    const runWfRes = await callRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'twings_run_workflow',
        arguments: {
          workflowId: 'character-sheet-maker',
          imageAssetId: assetId,
          subject: '하루',
          packs: ['turnaround', 'expressions'],
        },
      },
    });
    const runWfPayload = ((await runWfRes.json()) as { result: { structuredContent: { ok: boolean; jobs: unknown[]; folder: { name: string } } } }).result.structuredContent;
    expect(runWfPayload.ok).toBe(true);
    expect(runWfPayload.jobs).toHaveLength(2);
    expect(runWfPayload.folder.name).toBe('캐릭터 시트 · 하루');

    // 6. twings_save_playbook & twings_list_playbooks
    const savePbRes = await callRpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'twings_save_playbook',
        arguments: {
          title: '브랜드 타이포 · 톤 가이드',
          bodyMd: '과장된 광택 없이 매트한 자연광 스튜디오 질감을 유지합니다.',
          tags: ['브랜드톤'],
          injectDirector: true,
        },
      },
    });
    const savedPb = ((await savePbRes.json()) as { result: { structuredContent: { playbook: { id: string } } } }).result.structuredContent.playbook;
    expect(savedPb.id).toBeTruthy();

    // 7. twings_list_assets + twings_generate_image + twings_generate_video
    const assetsRes = await callRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'twings_list_assets', arguments: { kind: 'image' } },
    });
    const assetsPayload = ((await assetsRes.json()) as { result: { structuredContent: { ok: boolean; assets: unknown[]; recentOutputs: unknown[] } } }).result.structuredContent;
    expect(assetsPayload.ok).toBe(true);
    expect(assetsPayload.assets.length).toBeGreaterThanOrEqual(1);
    expect(assetsPayload.recentOutputs.length).toBeGreaterThanOrEqual(2);

    const genImgRes = await callRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'twings_generate_image', arguments: { prompt: 'Minimal ceramic bottle on limestone' } },
    });
    expect(((await genImgRes.json()) as { result: { isError: boolean } }).result.isError).toBe(false);

    const genVidRes = await callRpc({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'twings_generate_video', arguments: { prompt: 'Slow push-in on bottle, morning light', seconds: 5 } },
    });
    expect(((await genVidRes.json()) as { result: { isError: boolean } }).result.isError).toBe(false);

    // 8. resources/list & resources/read (playbooks + workflows)
    const resList = await callRpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
    const resources = ((await resList.json()) as { result: { resources: Array<{ uri: string }> } }).result.resources;
    expect(resources.some((r) => r.uri === `twings://playbooks/${savedPb.id}`)).toBe(true);
    expect(resources.some((r) => r.uri === `twings://workflows/${createdWfPayload.workflow.id}`)).toBe(true);
    expect(resources.some((r) => r.uri === 'twings://workflows/character-sheet-maker')).toBe(true);

    const readPb = await callRpc({
      jsonrpc: '2.0',
      id: 10,
      method: 'resources/read',
      params: { uri: `twings://playbooks/${savedPb.id}` },
    });
    const pbText = ((await readPb.json()) as { result: { contents: Array<{ text: string }> } }).result.contents[0]!.text;
    expect(pbText).toContain('매트한 자연광 스튜디오 질감');

    const readWf = await callRpc({
      jsonrpc: '2.0',
      id: 11,
      method: 'resources/read',
      params: { uri: `twings://workflows/${createdWfPayload.workflow.id}` },
    });
    const wfText = ((await readWf.json()) as { result: { contents: Array<{ text: string }> } }).result.contents[0]!.text;
    expect(wfText).toContain('MCP 신제품 2컷 화보');

    // GET /api/mcp returns 405 (stateless Streamable HTTP) when authenticated
    const sseProbe = await getMcpRoute(
      new NextRequest('https://brand.twings.app/api/mcp', {
        headers: { host: 'brand.twings.app', authorization: `Bearer ${token}` },
      }),
    );
    expect(sseProbe.status).toBe(405);

    await fix.db.close();
  });
});

describe('4. Studio UI v4 Markup, 8-Client Connect Modal, Copy Hygiene & Left Rail', () => {
  it('renders WorkflowsHub & McpConnectModal with all 8 client tabs, credits-only copy, zero #EBF5FF, and crisp Left Rail video/workflows labels', () => {
    const ko = getDictionary('ko');
    const en = getDictionary('en');

    // Left Rail check
    expect(ko.studioShell.rail.video).toBe('영상 스튜디오');
    expect(en.studioShell.rail.video).toBe('Video Studio');
    expect(ko.studioShell.rail.workflows).toBe('워크플로우');
    expect(en.studioShell.rail.workflows).toBe('Workflows');
    expect(RAIL_GROUP.workflows).toBe('make');
    expect(RAIL_HREF.workflows).toBe('/brand/studio/workflows');
    expect(railItems({ studio: true, creators: true, identity: true, rooms: true })).toContain('workflows');
    expect(railActive('/brand/studio/workflows', '/brand/studio/workflows')).toBe(true);
    expect(railActive('/brand/studio', '/brand/studio/workflows')).toBe(false);

    // Render WorkflowsHub
    const hubHtml = renderToStaticMarkup(
      createElement(WorkflowsHub, {
        organizationId: randomUUID(),
        locale: 'ko',
        canCreate: true,
        copy: ko.studioWorkflows,
        imageStudioHref: '/brand/studio',
        videoStudioHref: '/brand/studio/video',
        assetsHref: '/brand/library',
        initialAllowance: { capKrw: 490_000, usedKrw: 40_000, resetsAt: '2026-12-01T00:00:00.000Z' },
        initialStarters: [...STARTER_WORKFLOWS],
        initialWorkflows: [],
        initialPlaybooks: [],
        initialRecentRuns: [],
        initialImageAssets: [],
        initialVideoAssets: [],
        initialImageOutputs: [],
        initialMcpTokens: [],
      }),
    );

    expect(hubHtml).toContain('data-workflows-hub');
    expect(hubHtml).toContain('캐릭터 시트 메이커');
    expect(hubHtml).toContain('제품 다각도 팩샷 시트');
    expect(hubHtml).toContain('레퍼런스 영상 리버스');
    expect(hubHtml).toContain('MCP 연결하기');
    expect(hubHtml).toContain('45,000 크레딧');
    expect(hubHtml).not.toMatch(/₩|KRW|490,000원/);

    // Render McpConnectModal open and verify all 8 [data-mcp-client-tab] pills + snippets
    const modalHtml = renderToStaticMarkup(
      createElement(McpConnectModal, {
        open: true,
        onClose: () => {},
        organizationId: randomUUID(),
        canCreate: true,
        locale: 'ko',
        copy: ko.studioWorkflows.mcp,
        errorCopy: ko.studioWorkflows.errors,
        initialTokens: [],
      }),
    );

    expect(MCP_CLIENT_TABS.map((t) => t.id)).toEqual([
      'claude',
      'claude-code',
      'chatgpt',
      'gemini',
      'cursor',
      'codex',
      'openclaw',
      'hermes',
    ]);
    for (const tab of MCP_CLIENT_TABS) {
      expect(modalHtml).toContain(`data-mcp-client-tab="${tab.id}"`);
      const snippet = buildMcpClientSnippet(tab.id, 'twmcp_demo123');
      expect(snippet).toContain('https://brand.twings.app/api/mcp');
      if (tab.id !== 'codex') {
        expect(snippet).toContain('twmcp_demo123');
      } else {
        expect(snippet).toContain('TWINGS_MCP_TOKEN');
      }
    }

    // CSS & Copy Hygiene check (zero #EBF5FF, zero internal infra terms)
    const cssText = readFileSync('components/brand-studio/workflows/workflows.module.css', 'utf8');
    expect(cssText.toLowerCase()).not.toContain('#ebf5ff');
    expect(cssText.toLowerCase()).toContain('#0033ff');
    expect(cssText.toLowerCase()).toContain('#f4f4f5');

    for (const surfaceText of [hubHtml, modalHtml]) {
      expect(surfaceText).not.toMatch(
        /Slack|슬랙|웹훅|Supabase|ComfyUI|YuE2|SheetSage|YAGI-SERVER|gpu-arbiter|RECIPE V2|STAGE 01|\{\{selfie\}\}/i,
      );
    }
  });
});
