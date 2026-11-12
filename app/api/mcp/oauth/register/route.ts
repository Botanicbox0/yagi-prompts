import { NextResponse, type NextRequest } from 'next/server';
import { brandStudioV2Open } from '@/lib/flags';
import { registerMcpOAuthClient } from '@/lib/brand-studio/mcp';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
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
  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16_384) {
      return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 413, headers: CORS_HEADERS });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400, headers: CORS_HEADERS });
  }

  const registered = registerMcpOAuthClient(body);
  if (!registered.ok) {
    return NextResponse.json(
      { error: registered.error, error_description: registered.description },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  return NextResponse.json(registered.client, { status: 201, headers: CORS_HEADERS });
}
