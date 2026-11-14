import { after, NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { resolveMakerToken } from '@/lib/makers/tokens';
import { handleMcp } from '@/lib/mcp/server';
import { getRenderStore } from '@/lib/renders/store';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { resolveRequestUrl, resolveSurface } from '@/lib/routing/surfaces';
import { getStorage } from '@/lib/storage';
import { advanceStudioJobsWith } from '@/lib/brand-studio/engine';
import {
  authenticateMcpToken,
  dispatchMcpJsonRpc,
  extractMcpBearerToken,
  MCP_PROTOCOL_VERSION,
  normalizeMcpOrigin,
} from '@/lib/brand-studio/mcp';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';

/**
 * Unified TWINGS Streamable HTTP MCP endpoint (`/api/mcp`):
 *  1. Brand Studio MCP (`docs/STUDIO-PRO-SUITE-V4.md` §1.5):
 *     - Triggered when token starts with `twmcp_` or request arrives on `brand.twings.app` (without `twk_`).
 *     - Strictly Bearer (`Authorization: Bearer twmcp_...`) or `?token=twmcp_...` — NEVER browser session cookies.
 *     - Live `studioSeat(sql, user_id, organization_id, { requireSelfStudio: true })` check (`404` for Morphic/sandbox).
 *  2. Creative / Maker MCP (`docs/PLATFORM-2.0.md` §20.5):
 *     - Triggered for `Authorization: Bearer twk_...` or unauthenticated consumer `twings.app` requests.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CREATIVE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};
const CREATIVE_MAX_BODY = 4_400_000;
const STUDIO_MAX_BODY = 131_072;

const ALLOWED_WEB_MCP_ORIGINS = new Set([
  'https://claude.ai',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://gemini.google.com',
  'https://aistudio.google.com',
]);

function isAllowedMcpOrigin(originHeader: string | null, selfOrigin: string): boolean {
  if (!originHeader) return true;
  if (originHeader === selfOrigin) return true;
  return ALLOWED_WEB_MCP_ORIGINS.has(originHeader);
}

function mcpCorsHeaders(originHeader?: string | null, selfOrigin?: string, extra?: Record<string, string>): Record<string, string> {
  const allowOrigin =
    originHeader && selfOrigin && isAllowedMcpOrigin(originHeader, selfOrigin)
      ? originHeader
      : selfOrigin ?? 'https://brand.twings.app';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Protocol-Version',
    Vary: 'Origin',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    ...(extra ?? {}),
  };
}

function originOf(request: Request): string {
  const resolved = resolveRequestUrl(new URL(request.url), request.headers);
  return normalizeMcpOrigin(resolved?.origin ?? new URL(request.url).origin);
}

function shouldUseBrandStudioMcp(request: Request): { useStudio: boolean; rawToken: string | null } {
  const reqUrl = new URL(request.url);
  const rawToken = extractMcpBearerToken(reqUrl, request.headers);
  if (rawToken?.startsWith('twmcp_')) return { useStudio: true, rawToken };
  if (rawToken?.startsWith('twk_')) return { useStudio: false, rawToken };
  if (resolveSurface(reqUrl, request.headers) === 'brand') return { useStudio: true, rawToken };
  return { useStudio: false, rawToken };
}

function studioUnauthorizedResponse(request: Request): NextResponse {
  const base = originOf(request);
  const originHeader = request.headers.get('origin');
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: 'Bearer token required' },
    },
    {
      status: 401,
      headers: mcpCorsHeaders(originHeader, base, {
        'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      }),
    },
  );
}

const creativeUnauthorized = () =>
  NextResponse.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32001,
        message: 'A TWINGS creative access token is required (Authorization: Bearer twk_…). Create one in your Creative Studio.',
      },
    },
    { status: 401, headers: { ...CREATIVE_HEADERS, 'WWW-Authenticate': 'Bearer realm="twings-mcp"' } },
  );

export async function OPTIONS(request?: Request) {
  const base = request ? originOf(request) : 'https://brand.twings.app';
  const originHeader = request?.headers.get('origin') ?? null;
  if (originHeader && !isAllowedMcpOrigin(originHeader, base)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } },
      { status: 403, headers: CREATIVE_HEADERS },
    );
  }
  return new NextResponse(null, { status: 204, headers: mcpCorsHeaders(originHeader, base) });
}

export function GET(): NextResponse;
export function GET(request: Request): Promise<NextResponse>;
export function GET(request?: Request): NextResponse | Promise<NextResponse> {
  if (!request) {
    return new NextResponse(null, { status: 405, headers: { ...CREATIVE_HEADERS, Allow: 'POST' } });
  }
  return handleMcpGet(request);
}

async function handleMcpGet(request: Request): Promise<NextResponse> {
  const { useStudio, rawToken } = shouldUseBrandStudioMcp(request);
  if (!useStudio) {
    return new NextResponse(null, { status: 405, headers: { ...CREATIVE_HEADERS, Allow: 'POST' } });
  }
  const base = originOf(request);
  const originHeader = request.headers.get('origin');
  if (!isAllowedMcpOrigin(originHeader, base)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } },
      { status: 403, headers: mcpCorsHeaders(originHeader, base) },
    );
  }
  if (!brandStudioV2Open()) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: mcpCorsHeaders(originHeader, base) });
  }
  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'provider_unavailable' }, { status: 503, headers: mcpCorsHeaders(originHeader, base) });
  }
  const auth = await authenticateMcpToken(sql, rawToken);
  if (!auth.ok) {
    if (auth.status === 401) return studioUnauthorizedResponse(request);
    return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status, headers: mcpCorsHeaders(originHeader, base) });
  }
  return new NextResponse(null, {
    status: 405,
    headers: mcpCorsHeaders(originHeader, base, { Allow: 'POST, DELETE, OPTIONS' }),
  });
}

export function DELETE(): NextResponse;
export function DELETE(request: Request): Promise<NextResponse>;
export function DELETE(request?: Request): NextResponse | Promise<NextResponse> {
  if (!request) {
    return new NextResponse(null, { status: 405, headers: { ...CREATIVE_HEADERS, Allow: 'POST' } });
  }
  return handleMcpDelete(request);
}

async function handleMcpDelete(request: Request): Promise<NextResponse> {
  const { useStudio, rawToken } = shouldUseBrandStudioMcp(request);
  if (!useStudio) {
    return new NextResponse(null, { status: 405, headers: { ...CREATIVE_HEADERS, Allow: 'POST' } });
  }
  const base = originOf(request);
  const originHeader = request.headers.get('origin');
  if (!isAllowedMcpOrigin(originHeader, base)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } },
      { status: 403, headers: mcpCorsHeaders(originHeader, base) },
    );
  }
  if (!brandStudioV2Open()) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: mcpCorsHeaders(originHeader, base) });
  }
  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ ok: false, code: 'provider_unavailable' }, { status: 503, headers: mcpCorsHeaders(originHeader, base) });
  }
  const auth = await authenticateMcpToken(sql, rawToken);
  if (!auth.ok) {
    if (auth.status === 401) return studioUnauthorizedResponse(request);
    return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status, headers: mcpCorsHeaders(originHeader, base) });
  }
  return new NextResponse(null, { status: 204, headers: mcpCorsHeaders(originHeader, base) });
}

export async function POST(request: Request) {
  const { useStudio, rawToken } = shouldUseBrandStudioMcp(request);
  if (!useStudio) {
    return handleCreativeMcpPost(request);
  }

  const base = originOf(request);
  const originHeader = request.headers.get('origin');
  if (!isAllowedMcpOrigin(originHeader, base)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } },
      { status: 403, headers: mcpCorsHeaders(originHeader, base) },
    );
  }
  if (!brandStudioV2Open()) {
    return NextResponse.json({ ok: false, code: 'not_found' }, { status: 404, headers: mcpCorsHeaders(originHeader, base) });
  }
  if (Number(request.headers.get('content-length') ?? 0) > STUDIO_MAX_BODY) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } },
      { status: 413, headers: mcpCorsHeaders(originHeader, base) },
    );
  }

  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Service unavailable' } },
      { status: 503, headers: mcpCorsHeaders(originHeader, base) },
    );
  }

  const auth = await authenticateMcpToken(sql, rawToken);
  if (!auth.ok) {
    if (auth.status === 401) return studioUnauthorizedResponse(request);
    return NextResponse.json({ ok: false, code: auth.code }, { status: auth.status, headers: mcpCorsHeaders(originHeader, base) });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > STUDIO_MAX_BODY) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Payload too large' } },
        { status: 413, headers: mcpCorsHeaders(originHeader, base) },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400, headers: mcpCorsHeaders(originHeader, base) },
    );
  }

  try {
    const deps = await studioRuntimeDeps(sql);
    const result = await dispatchMcpJsonRpc({ deps, seat: auth.seat, viewer: auth.viewer }, body);

    if (result.queuedJobIds.length > 0) {
      after(async () => {
        try {
          await advanceStudioJobsWith(deps, { jobIds: result.queuedJobIds });
        } catch (error) {
          studioLog('mcp_after_failed', {
            message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
          });
        }
      });
    }

    if (result.kind === 'accepted') {
      return new NextResponse(null, { status: 202, headers: mcpCorsHeaders(originHeader, base) });
    }
    return NextResponse.json(result.payload, { status: 200, headers: mcpCorsHeaders(originHeader, base) });
  } catch (error) {
    studioLog('mcp_post_failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      { status: 500, headers: mcpCorsHeaders(originHeader, base) },
    );
  }
}

async function handleCreativeMcpPost(request: Request): Promise<NextResponse> {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  const origin = request.headers.get('origin');
  if (!url || (origin && origin !== url.origin)) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } },
      { status: 403, headers: CREATIVE_HEADERS },
    );
  }
  try {
    const sql = await getSqlRunner();
    if (!sql) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Unavailable' } },
        { status: 503, headers: CREATIVE_HEADERS },
      );
    }
    const userId = await resolveMakerToken(sql, request.headers.get('authorization'));
    if (!userId) return creativeUnauthorized();
    const bytes = await readBoundedBody(request, CREATIVE_MAX_BODY);
    if (!bytes) {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } },
        { status: 413, headers: CREATIVE_HEADERS },
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return NextResponse.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        { status: 400, headers: CREATIVE_HEADERS },
      );
    }
    const response = await handleMcp(
      {
        sql,
        store: await getRenderStore(),
        storage: await getStorage(),
        userId,
        origin: url.origin,
        afterRender: (renderId) =>
          after(async () => {
            try {
              await runLiveRenderPass(sql, { jobId: renderId, limit: 1 });
            } catch {
              /* the next pass recovers it */
            }
          }),
      },
      body,
    );
    if (response === null) return new NextResponse(null, { status: 202, headers: CREATIVE_HEADERS });
    return NextResponse.json(response, { headers: CREATIVE_HEADERS });
  } catch {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } },
      { status: 500, headers: CREATIVE_HEADERS },
    );
  }
}
