import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioEditToWallOpenFor, brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { Id, RequestId, STUDIO_LIMITS, STUDIO_UPLOAD_MIMES } from '@/lib/brand-studio/contracts';
import { requireCreate, studioSeat, StudioDenied } from '@/lib/brand-studio/access';
import { editStagingKey, editSwitchEnvOf } from '@/lib/brand-studio/edit-save';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { studioRuntimeDeps } from '@/lib/brand-studio/runtime';

/**
 * Local mode only: the browser POSTs an edited canvas image's bytes here when `deps.staging.servesSignedUrls`
 * is false (`.storage/`). Cloud storage answers 405; `output.edit.complete` runs full image checks afterwards.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ requestId: string }> };

const ALLOWED_IMAGE_MIMES = new Set<string>(STUDIO_UPLOAD_MIMES.image);

export async function POST(request: NextRequest, context: Context) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) {
    return studioJson({ ok: false, code: 'studio_closed' }, 404);
  }

  const [{ requestId }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  const reqParsed = RequestId.safeParse(requestId);
  const orgParsed = Id.safeParse(new URL(request.url).searchParams.get('organizationId'));

  try {
    const deps = await studioRuntimeDeps(sql);
    if (deps.staging.servesSignedUrls) {
      return studioJson({ ok: false, code: 'invalid' }, 405);
    }
    if (!reqParsed.success || !orgParsed.success) {
      return studioJson({ ok: false, code: 'invalid' }, 400);
    }
    const organizationId = orgParsed.data;

    let seat: Awaited<ReturnType<typeof studioSeat>>;
    try {
      seat = await sql.transaction((tx) => studioSeat(tx, viewer.userId, organizationId, { requireSelfStudio: true }));
    } catch (error) {
      if (error instanceof StudioDenied) {
        return studioJson({ ok: false, code: error.code }, studioStatus(error.code));
      }
      throw error;
    }

    if (!brandStudioEditToWallOpenFor(organizationId, editSwitchEnvOf(deps))) {
      return studioJson({ ok: false, code: 'invalid' }, 400);
    }

    try {
      requireCreate(seat);
    } catch (error) {
      if (error instanceof StudioDenied) {
        return studioJson({ ok: false, code: error.code }, studioStatus(error.code));
      }
      throw error;
    }

    const mime = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!ALLOWED_IMAGE_MIMES.has(mime)) {
      return studioJson({ ok: false, code: 'unsupported_file' }, 415);
    }
    if (Number(request.headers.get('content-length') ?? 0) > STUDIO_LIMITS.imageBytesMax) {
      return studioJson({ ok: false, code: 'file_too_large' }, 413);
    }

    const reader = request.body?.getReader();
    if (!reader) return studioJson({ ok: false, code: 'invalid' }, 400);

    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > STUDIO_LIMITS.imageBytesMax) {
        await reader.cancel();
        return studioJson({ ok: false, code: 'file_too_large' }, 413);
      }
      chunks.push(next.value);
    }
    if (length === 0) return studioJson({ ok: false, code: 'invalid' }, 400);

    await deps.staging.putStaging(editStagingKey(organizationId, seat.userId, reqParsed.data), Buffer.concat(chunks), mime);
    return studioJson({ ok: true });
  } catch {
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
