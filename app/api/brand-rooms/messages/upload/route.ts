import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { getStorage } from '@/lib/storage';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { localUploadAllowed } from '@/lib/brand-rooms/messages';
import { ROOM_ATTACHMENT_TYPES, ROOM_LIMITS } from '@/lib/brand-rooms/message-contracts';

/**
 * Local mode only: the browser POSTs a reserved attachment's bytes here (no signed staging URL exists
 * for `.storage/`). Cloud storage answers 405; the browser PUTs to the signed URL `attachment.reserve`
 * returned. `attachment.complete` checks the bytes afterwards; this route only enforces who, how much
 * and that the type is one a message may carry.
 *
 *   POST ?organizationId=&projectId=&key=<staging key>&size=<bytes>   body: the file
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'rooms_closed' }, 404);
  const [viewer, sql] = await Promise.all([getViewer(), getSqlRunner()]);
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const staging = await getStorage();
    if (staging.servesSignedUrls) return studioJson({ ok: false, code: 'invalid' }, 405);
    const params = request.nextUrl.searchParams;
    const query = { organizationId: params.get('organizationId') ?? '', projectId: params.get('projectId') ?? '', key: params.get('key') ?? '' };
    const size = Number(params.get('size') ?? '');
    if (!(await localUploadAllowed({ sql, media: createStudioMediaStore() }, viewer, query))) return studioJson({ ok: false, code: 'not_found' }, 404);
    if (!Number.isInteger(size) || size < 1) return studioJson({ ok: false, code: 'invalid' }, 400);
    if (size > ROOM_LIMITS.attachmentBytesMax) return studioJson({ ok: false, code: 'file_too_large' }, 413);
    const mime = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ROOM_ATTACHMENT_TYPES[mime]) return studioJson({ ok: false, code: 'unsupported_file' }, 415);
    if (Number(request.headers.get('content-length') ?? 0) > size) return studioJson({ ok: false, code: 'file_too_large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return studioJson({ ok: false, code: 'invalid' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > size) {
        await reader.cancel();
        return studioJson({ ok: false, code: 'file_too_large' }, 413);
      }
      chunks.push(next.value);
    }
    if (length !== size) return studioJson({ ok: false, code: 'invalid' }, 400);
    await staging.putStaging(query.key, Buffer.concat(chunks), mime);
    return studioJson({ ok: true });
  } catch {
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
