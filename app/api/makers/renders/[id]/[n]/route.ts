import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { recipeRenderOutput } from '@/lib/recipes/media';
import { getRenderStore } from '@/lib/renders/store';

/** `GET /api/makers/renders/{id}/{n}` — the Nth result of a recipe render, to its owner (lib/recipes/media.ts). */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const viewer = await getViewer();
  if (!viewer.userId) return new NextResponse(null, { status: 404, headers });
  const { id, n } = await params;
  try {
    const sql = await getSqlRunner();
    if (!sql) return new NextResponse(null, { status: 503, headers });
    const object = await recipeRenderOutput(sql, viewer, id, /^\d$/.test(n) ? Number(n) : -1);
    if (!object) return new NextResponse(null, { status: 404, headers });
    const store = await getRenderStore(), signed = await store.url(object.key, 60);
    if (signed) return new NextResponse(null, { status: 302, headers: { ...headers, Location: signed } });
    return new NextResponse(new Uint8Array(await store.read(object.key)), { headers: { ...headers, 'Content-Type': object.mime } });
  } catch { return new NextResponse(null, { status: 503, headers }); }
}
