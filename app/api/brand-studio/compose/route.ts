import { NextResponse, type NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { StudioDenied, studioSeat } from '@/lib/brand-studio/access';
import { runComposeOperation } from '@/lib/brand-studio/compose/service';
import { STUDIO_HEADERS, studioJson, studioStatus } from '@/lib/brand-studio/http';
import { isStudioMediaKey, mimeForStudioKey } from '@/lib/brand-studio/media-store';
import { readyAsset, readyOutput } from '@/lib/brand-studio/repo';
import { studioLog, studioRuntimeDeps } from '@/lib/brand-studio/runtime';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';

/**
 * Brand Studio Video Composer gateway (`docs/BRAND-VIDEO-COMPOSE-D.md` §3, Founder Decision 3).
 *
 * - `GET` / `HEAD`: Same-origin media byte stream (`Range` supported) for organization-owned video/audio
 *   assets & outputs so browser `<video>`/`<audio>`/Canvas can composite without R2 CORS or tainted canvas.
 * - `POST`: TWINGS compose operations (`chat.edit` free + per-minute rate limit, `render.reserve` records a
 *   free 1080p MP4 export (0 credits), `render.refund` refunds a failed export only when it was still charged
 *   (pages loaded before export became free), and `assist.plan` "말로 편집" behind `BRAND_STUDIO_EDIT_ASSIST`,
 *   sharing `chat.edit`'s limit).
 *
 * Every path enforces: `BRAND_STUDIO_V2` (`404`), sign-in (`401`), membership + Morphic/sandbox hardline +
 * `generative_media` policy (`404`), and campaign-only guest exclusion (`404`). `POST` additionally enforces
 * `sameOriginMutation` (`403`) and `self_studio` (`404`).
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BODY_MAX = 65_536;

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
      const seat = await studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true });
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return studioJson({ ok: false, code: 'invalid' }, 413);
  }

  let body: { operation?: unknown; input?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || !body.input || typeof body.input !== 'object') {
      throw new Error('shape');
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    const deps = await studioRuntimeDeps(sql);
    const result = await runComposeOperation(deps, viewer, body.operation, body.input);
    if (!result.ok) {
      if (result.code === 'rate_limited') {
        return NextResponse.json(result, {
          status: 429,
          headers: {
            ...STUDIO_HEADERS,
            'Retry-After': String(result.retryAfterSec),
          },
        });
      }
      return studioJson(result, studioStatus(result.code));
    }
    return studioJson(result, 200);
  } catch (error) {
    studioLog('studio_compose_post_failed', {
      operation: String(body.operation).slice(0, 40),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
