import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { openStudioDocument } from '@/lib/brand-studio/documents/open';
import { studioRuntimeDeps } from '@/lib/brand-studio/runtime';

/**
 * Opens a studio document (PDF, PPTX) for a member of its organization (docs/BRAND-STUDIO-V6-PLAN.md §4.7).
 * The bytes stay in the private store: cloud answers a 302 to a <=60 s signed download; local streams
 * them. Never cached, always a download, never rendered in this origin. Every miss is the same 404.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "sandbox; default-src 'none'",
};

type Context = { params: Promise<{ id: string }> };

const missing = (status = 404) => new NextResponse(null, { status, headers: HEADERS });

export async function GET(request: NextRequest, context: Context) {
  if (!brandStudioV2Open()) return missing();
  const [{ id }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
  if (!viewer.userId || !sql) return missing();
  const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
  try {
    const deps = await studioRuntimeDeps(sql);
    const store = deps.staging.privateObjects;
    if (!store) return missing();
    const file = await openStudioDocument(deps, viewer, organizationId, id);
    if (!file) return missing();
    const headers = {
      ...HEADERS,
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    };
    const url = await store.signedUrl(file.key, 60);
    if (url) return new NextResponse(null, { status: 302, headers: { ...headers, Location: url } });
    if (deps.staging.servesSignedUrls) return missing(503);
    const bytes = await store.read(file.key);
    return new NextResponse(Buffer.from(bytes), { headers: { ...headers, 'Content-Length': String(bytes.byteLength) } });
  } catch {
    return missing();
  }
}
