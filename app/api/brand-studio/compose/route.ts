import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { STUDIO_HEADERS, studioJson, studioStatus } from '@/lib/brand-studio/http';
import { isStudioMediaKey, mimeForStudioKey } from '@/lib/brand-studio/media-store';
import { readyAsset, readyOutput } from '@/lib/brand-studio/repo';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';

/**
 * Same-origin media stream for Brand Studio Video Composer (`docs/BRAND-VIDEO-COMPOSE-D.md` §3).
 *
 * Production R2 (`media.twings.app`) intentionally omits CORS headers and `/api/brand-studio/media/[...key]`
 * serves pictures only in production. This route streams video and audio bytes ONLY after verifying:
 * 1. `BRAND_STUDIO_V2` flag is on (`404` otherwise)
 * 2. Viewer is signed in (`401` otherwise)
 * 3. Active organization membership + Morphic/sandbox hardline + `generative_media` policy (`404` otherwise)
 * 4. Campaign-only guests are excluded (`404`)
 * 5. The requested `asset` or `output` belongs to `organizationId` and is a live video/audio file.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function serve(request: NextRequest, head: boolean): Promise<NextResponse> {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
  if (!UUID.test(organizationId)) return studioJson({ ok: false, code: 'not_found' }, 404);

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    const deps = await studioRuntimeDeps(sql);
    const storageKey = await deps.sql.transaction(async (tx) => {
      const seat = await studioSeat(tx, viewer.userId, organizationId);
      if (seat.role === 'guest') throw new StudioDenied('not_found');

      const source = request.nextUrl.searchParams.get('source');
      const id = request.nextUrl.searchParams.get('id') ?? '';
      if (!UUID.test(id) || (source !== 'asset' && source !== 'output')) {
        throw new StudioDenied('not_found');
      }
      if (source === 'asset') {
        const asset = await readyAsset(tx, organizationId, id);
        if (!asset || (asset.kind !== 'video' && asset.kind !== 'audio') || !isStudioMediaKey(asset.storage_key)) {
          throw new StudioDenied('not_found');
        }
        return asset.storage_key;
      }
      const output = await readyOutput(tx, organizationId, id);
      if (!output || output.kind !== 'video' || !output.storage_key || !isStudioMediaKey(output.storage_key)) {
        throw new StudioDenied('not_found');
      }
      return output.storage_key;
    });

    let bytes: Uint8Array;
    try {
      bytes = await deps.media.read(storageKey);
    } catch {
      return studioJson({ ok: false, code: 'not_found' }, 404);
    }

    const headers = {
      ...STUDIO_HEADERS,
      'Content-Type': mimeForStudioKey(storageKey),
      'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    };
    const total = bytes.byteLength;
    const range = /^bytes=(\d*)-(\d*)$/i.exec(request.headers.get('range')?.trim() ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start > end || start >= total) {
        return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` } });
      }
      const slice = bytes.subarray(start, end + 1);
      return new NextResponse(head ? null : Buffer.from(slice), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': String(slice.byteLength),
        },
      });
    }
    return new NextResponse(head ? null : Buffer.from(bytes), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(total) },
    });
  } catch (error) {
    if (error instanceof StudioDenied) {
      return studioJson({ ok: false, code: error.code }, studioStatus(error.code));
    }
    studioLog('studio_compose_stream_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export const GET = (request: NextRequest) => serve(request, false);
export const HEAD = (request: NextRequest) => serve(request, true);
