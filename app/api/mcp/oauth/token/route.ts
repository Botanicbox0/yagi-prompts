import { NextResponse, type NextRequest } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { exchangeMcpAuthorizationCode } from '@/lib/brand-studio/mcp';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  if (!brandStudioV2Open()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: CORS_HEADERS });
  }
  const sql = await getSqlRunner();
  if (!sql) {
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503, headers: CORS_HEADERS });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let params: Record<string, string> = {};
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16_384) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 413, headers: CORS_HEADERS });
    }
    if (contentType.includes('application/json')) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') params[k] = v;
      }
    } else {
      const sp = new URLSearchParams(raw);
      sp.forEach((v, k) => {
        params[k] = v;
      });
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: CORS_HEADERS });
  }

  const exchanged = await exchangeMcpAuthorizationCode(sql, {
    grant_type: params.grant_type ?? null,
    code: params.code ?? null,
    code_verifier: params.code_verifier ?? null,
    redirect_uri: params.redirect_uri ?? null,
    client_id: params.client_id ?? null,
  });

  if (!exchanged.ok) {
    if (exchanged.status === 404) {
      return NextResponse.json({ error: 'not_found' }, { status: 404, headers: CORS_HEADERS });
    }
    return NextResponse.json(
      { error: exchanged.error, error_description: exchanged.error_description },
      { status: exchanged.status, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    {
      access_token: exchanged.access_token,
      token_type: exchanged.token_type,
      scope: exchanged.scope,
    },
    { status: 200, headers: CORS_HEADERS },
  );
}
