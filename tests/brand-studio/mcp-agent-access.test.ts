import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { setFeaturePolicy } from '@/lib/brands/entitlements';
import { WorkflowsHub } from '@/components/brand-studio/workflows/workflows-hub';
import {
  authenticateMcpToken,
  computePkceS256Challenge,
  issueMcpAuthorizationCode,
  listMcpTokens,
  mintMcpToken,
  registerMcpOAuthClient,
  revokeMcpToken,
} from '@/lib/brand-studio/mcp';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const routeState = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: { userId: null, isAdmin: false, tier: 'free', email: null, locale: 'ko' } as Viewer,
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/flags')>()),
  brandStudioV2Open: () => true,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeState.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => routeState.viewer }));
vi.mock('@/components/brand-workspace/context', () => ({
  brandContext: async () => {
    const dict = getDictionary('ko');
    return {
      viewer: routeState.viewer,
      sql: routeState.sql,
      verifiedEmail: undefined,
      brandHost: true,
      locale: 'ko' as const,
      dict,
      b: dict.brandWorkspace,
    };
  },
}));

import { GET as getMcpTokensRoute, POST as postMcpTokensRoute } from '@/app/api/brand-studio/mcp-tokens/route';
import { POST as postMcpRoute } from '@/app/api/mcp/route';
import { GET as getOAuthAuthorizeRoute } from '@/app/api/mcp/oauth/authorize/route';
import { POST as postOAuthTokenRoute } from '@/app/api/mcp/oauth/token/route';

let f: StudioFixture;

beforeEach(async () => {
  f = await studioFixture();
  routeState.sql = f.sql;
  routeState.viewer = viewerOf(f.ids.owner);
});

afterEach(async () => {
  await f.db.close();
});

const owner = () => viewerOf(f.ids.owner);
const admin = () => ({ ...viewerOf(f.ids.admin), isAdmin: true });

describe('agent_access deny-list on MCP endpoints', () => {
  it('allows MCP token lifecycle, OAuth authorize/token, and /api/mcp when agent_access is unset or explicitly on', async () => {
    const unsetList = await listMcpTokens(f.sql, owner(), f.orgId);
    expect(unsetList.ok).toBe(true);

    const minted = await mintMcpToken(f.sql, owner(), { organizationId: f.orgId, clientId: 'claude', label: 'Default' });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    const auth = await authenticateMcpToken(f.sql, minted.token);
    expect(auth.ok).toBe(true);

    // Explicitly turn agent_access ON (empty deny list) -> stays open.
    const onPolicy = await setFeaturePolicy({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      denied: [],
      note: 'explicit enable',
      expectedRevision: 0,
    });
    expect(onPolicy.ok).toBe(true);
    expect((await listMcpTokens(f.sql, owner(), f.orgId)).ok).toBe(true);
    expect((await authenticateMcpToken(f.sql, minted.token)).ok).toBe(true);
  });

  it('refuses with feature_unavailable / 404 everywhere when agent_access is explicitly off', async () => {
    const mintedBefore = await mintMcpToken(f.sql, owner(), { organizationId: f.orgId, clientId: 'claude', label: 'Existing' });
    expect(mintedBefore.ok).toBe(true);
    if (!mintedBefore.ok) return;

    const reg = registerMcpOAuthClient({
      client_name: 'Claude Desktop',
      redirect_uris: ['http://127.0.0.1:43210/callback'],
    });
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    const verifier = 'v'.repeat(48);
    const challenge = computePkceS256Challenge(verifier);
    const code = issueMcpAuthorizationCode({
      userId: f.ids.owner,
      organizationId: f.orgId,
      clientId: String(reg.client.client_id),
      clientName: 'Claude Desktop',
      redirectUri: 'http://127.0.0.1:43210/callback',
      codeChallenge: challenge,
    });

    const offPolicy = await setFeaturePolicy({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      denied: ['agent_access'],
      note: 'disable agent access',
      expectedRevision: 0,
    });
    expect(offPolicy.ok).toBe(true);

    // Token service calls refuse with feature_unavailable.
    expect(await listMcpTokens(f.sql, owner(), f.orgId)).toEqual({ ok: false, code: 'feature_unavailable' });
    expect(await mintMcpToken(f.sql, owner(), { organizationId: f.orgId, clientId: 'claude', label: 'Blocked' })).toEqual({
      ok: false,
      code: 'feature_unavailable',
    });
    expect(await revokeMcpToken(f.sql, owner(), { organizationId: f.orgId, tokenId: mintedBefore.record.id })).toEqual({
      ok: false,
      code: 'feature_unavailable',
    });

    // Previously minted tokens are refused on live auth and /api/mcp returns 404.
    const authRes = await authenticateMcpToken(f.sql, mintedBefore.token);
    expect(authRes).toEqual({ ok: false, status: 404, code: 'not_found' });

    const mcpRes = await postMcpRoute(
      new Request('https://brand.twings.app/api/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mintedBefore.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      }),
    );
    expect(mcpRes.status).toBe(404);

    // /api/brand-studio/mcp-tokens GET & POST answer 404.
    const getTokensRes = await getMcpTokensRoute(
      new NextRequest(`https://brand.twings.app/api/brand-studio/mcp-tokens?organizationId=${f.orgId}`),
    );
    expect(getTokensRes.status).toBe(404);
    expect(await getTokensRes.json()).toEqual({ ok: false, code: 'feature_unavailable' });

    const postTokensRes = await postMcpTokensRoute(
      new NextRequest('https://brand.twings.app/api/brand-studio/mcp-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://brand.twings.app', host: 'brand.twings.app' },
        body: JSON.stringify({ op: 'create', organizationId: f.orgId, clientId: 'claude', label: 'Blocked' }),
      }),
    );
    expect(postTokensRes.status).toBe(404);

    // OAuth authorize & token exchange refuse with 404.
    const authorizeUrl = new URL('https://brand.twings.app/api/mcp/oauth/authorize');
    authorizeUrl.searchParams.set('organizationId', f.orgId);
    authorizeUrl.searchParams.set('client_id', String(reg.client.client_id));
    authorizeUrl.searchParams.set('redirect_uri', 'http://127.0.0.1:43210/callback');
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    const authGetRes = await getOAuthAuthorizeRoute(new NextRequest(authorizeUrl));
    expect(authGetRes.status).toBe(404);

    const tokenRes = await postOAuthTokenRoute(
      new NextRequest('https://brand.twings.app/api/mcp/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: 'http://127.0.0.1:43210/callback',
          client_id: String(reg.client.client_id),
        }).toString(),
      }),
    );
    expect(tokenRes.status).toBe(404);

    // WorkflowsHub hides MCP connect controls when agentAccessAllowed is false, and renders them when true.
    const dict = getDictionary('ko');
    const sharedHubProps = {
      organizationId: f.orgId,
      locale: 'ko' as const,
      canCreate: true,
      mcpOrigin: 'https://brand.twings.app',
      copy: dict.studioWorkflows,
      imageStudioHref: '/brand/studio',
      videoStudioHref: '/brand/studio/video',
      assetsHref: '/brand/library',
      initialAllowance: { capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' },
      initialStarters: [],
      initialWorkflows: [],
      initialPlaybooks: [],
      initialRecentRuns: [],
      initialImageAssets: [],
      initialVideoAssets: [],
      initialImageOutputs: [],
      initialMcpTokens: [],
    };
    const closedHubHtml = renderToStaticMarkup(createElement(WorkflowsHub, { ...sharedHubProps, agentAccessAllowed: false }));
    expect(closedHubHtml).not.toContain('data-mcp-connect-open');
    expect(closedHubHtml).not.toContain(dict.studioWorkflows.header.connectMcp);
    const openHubHtml = renderToStaticMarkup(createElement(WorkflowsHub, { ...sharedHubProps, agentAccessAllowed: true }));
    expect(openHubHtml).toContain('data-mcp-connect-open');
    expect(openHubHtml).toContain(dict.studioWorkflows.header.connectMcp);
  });
});
