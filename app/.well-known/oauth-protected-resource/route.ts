import { NextResponse, type NextRequest } from 'next/server';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl } from '@/lib/routing/surfaces';
import { buildOAuthProtectedResourceMetadata } from '@/lib/brand-studio/mcp';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: CORS_HEADERS });
  }
  const resolved = resolveRequestUrl(new URL(request.url), request.headers);
  const origin = resolved?.origin ?? new URL(request.url).origin;
  return NextResponse.json(buildOAuthProtectedResourceMetadata(origin), {
    status: 200,
    headers: CORS_HEADERS,
  });
}
