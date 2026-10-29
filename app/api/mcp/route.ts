import { after, NextResponse } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { resolveMakerToken } from '@/lib/makers/tokens';
import { handleMcp } from '@/lib/mcp/server';
import { getRenderStore } from '@/lib/renders/store';
import { runLiveRenderPass } from '@/lib/renders/runtime';
import { resolveRequestUrl } from '@/lib/routing/surfaces';
import { getStorage } from '@/lib/storage';

/**
 * `POST /api/mcp` — the TWINGS MCP server for AI creatives (docs/PLATFORM-2.0.md §20.5,
 * lib/mcp/server.ts). Streamable HTTP, stateless: every POST carries one JSON-RPC message and gets
 * one JSON answer (or 202 for a notification). No session id, no SSE stream — GET and DELETE say so.
 *
 *   auth     `Authorization: Bearer twk_…`, a creative's personal access token, on every request.
 *   origin   a browser page on another site cannot drive it: a request that carries an Origin
 *            header must come from this site (the MCP DNS-rebinding rule). Agents send none.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
/** A tool call may carry a ~3 MB base64 file; the platform refuses bodies past 4.5 MB anyway. */
const MAX_BODY = 4_400_000;

const unauthorized = () => NextResponse.json(
  { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'A TWINGS creative access token is required (Authorization: Bearer twk_…). Create one in your Creative Studio.' } },
  { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer realm="twings-mcp"' } },
);

export async function POST(request: Request) {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  const origin = request.headers.get('origin');
  if (!url || (origin && origin !== url.origin)) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Forbidden origin' } }, { status: 403, headers });
  try {
    const sql = await getSqlRunner();
    if (!sql) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Unavailable' } }, { status: 503, headers });
    const userId = await resolveMakerToken(sql, request.headers.get('authorization'));
    if (!userId) return unauthorized();
    const bytes = await readBoundedBody(request, MAX_BODY);
    if (!bytes) return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch {
      return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers });
    }
    const response = await handleMcp({
      sql, store: await getRenderStore(), storage: await getStorage(), userId, origin: url.origin,
      afterRender: (renderId) => after(async () => { try { await runLiveRenderPass(sql, { jobId: renderId, limit: 1 }); } catch { /* the next pass recovers it */ } }),
    }, body);
    if (response === null) return new NextResponse(null, { status: 202, headers });
    return NextResponse.json(response, { headers });
  } catch {
    return NextResponse.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }, { status: 500, headers });
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
}

export function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
}
