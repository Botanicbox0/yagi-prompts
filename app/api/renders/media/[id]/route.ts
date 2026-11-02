import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { loadOwnRender, loadSharedRender, type RenderView } from '@/lib/renders/service';
import { loadRenderExtras } from '@/lib/renders/extras';
import { RenderObjectNotFound, getRenderStore } from '@/lib/renders/store';
import { renderFilename } from '@/lib/renders/frames';
import { renderFrameParam } from '@/lib/renders/share';
import { listJobOutputs } from '@/lib/recipes/repo';

/**
 * `GET /api/renders/media/[id]` — the render gateway. Two doors, one object:
 *   · the owner, on a session (`/renders/{id}`);
 *   · anyone holding the 3-day token (`?s=…`, from `/r/{id}/{token}` and the email preview).
 * `?download=1` asks for an attachment; `?poster=1` serves the film's captured frame instead (0055,
 * `POST /api/renders/[id]/poster`) — the share card's OG image, scoped by the same token. `?frame=N`
 * serves the Nth picture of a set (`render_job_outputs`, lib/renders/frames.ts) through the same door
 * as the result, so the token that opens frame 1 opens every frame and nothing else. Cloud: a signed URL for `MEDIA_URL_TTL_SECONDS` (a film
 * has to survive a seek, so minutes, not the publish gateway's 60s). Local: the bytes are
 * streamed. Every answer is `private, no-store` + noindex, refusals included.
 */
export const dynamic = 'force-dynamic';

export const MEDIA_URL_TTL_SECONDS = 600;

const HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};

function refuse(status: 401 | 403 | 404 | 500, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: HEADERS });
}

function attachment(filename: string): string {
  const ascii = filename.replace(/["\\]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(request.url);
  const share = url.searchParams.get('s');
  const poster = url.searchParams.get('poster') === '1';
  const download = !poster && url.searchParams.get('download') === '1';
  const frame = renderFrameParam(url.searchParams.get('frame'));
  if (frame === 'invalid' || (poster && frame !== null)) return refuse(404, 'not_found');

  const sql = await getSqlRunner();
  if (sql === null) return refuse(404, 'not_found');

  let view: RenderView | null;
  if (share) {
    const shared = await loadSharedRender(sql, id, share);
    if (shared.status === 'not_found') return refuse(404, 'not_found');
    if (shared.status === 'expired') return refuse(403, 'link_expired');
    view = shared.view;
  } else {
    const viewer = await getViewer();
    if (viewer.userId === null) return refuse(401, 'sign_in_required');
    view = await loadOwnRender(sql, viewer, id);
    if (view === null) return refuse(404, 'not_found');
  }

  const { job } = view;
  if (job.status !== 'succeeded' || job.resultKey === null || job.resultMime === null) return refuse(404, 'not_ready');

  const posterKey = poster ? (await loadRenderExtras(sql, job.id)).posterKey : null;
  if (poster && posterKey === null) return refuse(404, 'not_found');
  // A set's picture: the row says which object it is; frame 1 is the result itself.
  const output = frame === null ? null : (await listJobOutputs(sql, job.id)).find((item) => item.position === frame - 1) ?? null;
  if (frame !== null && frame > 1 && output === null) return refuse(404, 'not_found');
  const objectKey = posterKey ?? output?.key ?? job.resultKey;
  const objectMime = posterKey ? 'image/jpeg' : output?.mime ?? job.resultMime;

  const store = await getRenderStore();
  const filename = renderFilename(job, objectMime, frame);
  try {
    const signed = await store.url(objectKey, MEDIA_URL_TTL_SECONDS, download ? { download: filename } : undefined);
    // 302, not 307/308: a one-off capability URL, never a permanent identity for the object.
    if (signed) return new NextResponse(null, { status: 302, headers: { ...HEADERS, Location: signed } });

    const bytes = await store.read(objectKey);
    const headers: Record<string, string> = {
      ...HEADERS,
      'Content-Type': objectMime,
      'Content-Length': String(bytes.byteLength),
    };
    if (download) headers['Content-Disposition'] = attachment(filename);
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
  } catch (error) {
    if (error instanceof RenderObjectNotFound) return refuse(404, 'not_found');
    console.error('[renders] media read failed', error);
    return refuse(500, 'storage_error');
  }
}
