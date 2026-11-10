import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { pendingUpload } from '@/lib/brand-studio/assets';
import { studioRuntimeDeps } from '@/lib/brand-studio/runtime';
import { studioJson } from '@/lib/brand-studio/http';

/**
 * Local mode only: the browser POSTs a reserved upload's bytes here (no signed staging URL exists for
 * `.storage/`). Cloud storage answers 405; the browser PUTs to the signed URL `asset.reserve` returned.
 * `asset.complete` checks the bytes afterwards; this route only enforces who, how much and what type.
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return studioJson({ ok: false, code: 'forbidden' }, 403);
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const [{ id }, viewer, sql] = await Promise.all([context.params, getViewer(), getSqlRunner()]);
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const deps = await studioRuntimeDeps(sql);
    if (deps.staging.servesSignedUrls) return studioJson({ ok: false, code: 'invalid' }, 405);
    const upload = await pendingUpload(deps, viewer, id);
    if (!upload) return studioJson({ ok: false, code: 'not_found' }, 404);
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== upload.mime) return studioJson({ ok: false, code: 'unsupported_file' }, 415);
    if (Number(request.headers.get('content-length') ?? 0) > upload.sizeBytes) return studioJson({ ok: false, code: 'file_too_large' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return studioJson({ ok: false, code: 'invalid' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > upload.sizeBytes) {
        await reader.cancel();
        return studioJson({ ok: false, code: 'file_too_large' }, 413);
      }
      chunks.push(next.value);
    }
    if (length !== upload.sizeBytes) return studioJson({ ok: false, code: 'invalid' }, 400);
    await deps.staging.putStaging(upload.key, Buffer.concat(chunks), upload.mime);
    return studioJson({ ok: true });
  } catch {
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
