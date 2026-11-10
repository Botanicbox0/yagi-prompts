import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { getStorage } from '@/lib/storage';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { pendingFrameUpload } from '@/lib/brand-rooms/storyboards';
import { readCappedBody } from '@/lib/brand-rooms/ingest';

/**
 * Local mode only: the browser POSTs a reserved cut's bytes here (no signed staging URL exists for
 * `.storage/`). Cloud storage answers 405; the browser PUTs to the signed URL `frame.reserve` returned.
 * `frame.complete` checks the bytes afterwards; this route only enforces who, how much and what type.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandRoomsOpen()) return studioJson({ ok: false, code: 'not_found' }, 404);
  const [{ id }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const staging = await getStorage();
    if (staging.servesSignedUrls) return studioJson({ ok: false, code: 'invalid' }, 405);
    const upload = await pendingFrameUpload({ sql, media: createStudioMediaStore(), staging }, viewer, id);
    if (!upload) return studioJson({ ok: false, code: 'not_found' }, 404);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== upload.mime) return studioJson({ ok: false, code: 'unsupported_file' }, 415);
    const body = await readCappedBody(request, upload.sizeBytes);
    if (!body.ok) return studioJson({ ok: false, code: body.code }, body.code === 'file_too_large' ? 413 : 400);
    await staging.putStaging(upload.key, body.bytes, upload.mime);
    return studioJson({ ok: true });
  } catch {
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
