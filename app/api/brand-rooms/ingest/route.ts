import type { NextRequest } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { getStorage } from '@/lib/storage';
import { studioJson } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { INGEST_SECRET_ENV, ingestSecretMatches, presentedSecret, readCappedBody, runIngest, type IngestContext } from '@/lib/brand-rooms/ingest';
import { ingestPendingUpload } from '@/lib/brand-rooms/storyboards';
import { isStoryboardErrorCode, storyboardHttpStatus } from '@/lib/brand-rooms/storyboard-contracts';

/**
 * The team's command-line door (lib/brand-rooms/ingest.ts; client: scripts/twings-room.mjs).
 * `Authorization: Bearer $BRAND_ROOM_INGEST_SECRET`, compared in constant time. The flag off, a missing
 * or wrong secret, and a sandboxed organization all answer 404. Not reachable on brand.twings.app
 * (lib/routing/surfaces.ts).
 *
 *   POST { operation, input }            one of INGEST_OPERATIONS (JSON)
 *   POST ?upload=<frameId>  <bytes>      local mode only: a reserved cut's picture (cloud storage gets a
 *                                        signed address from `storyboard.push` instead, and this answers 405)
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BODY_MAX = 262_144;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

const closed = () => studioJson({ ok: false, code: 'not_found' }, 404);

export async function POST(request: NextRequest) {
  if (!brandRoomsOpen()) return closed();
  if (!ingestSecretMatches(process.env[INGEST_SECRET_ENV], presentedSecret(request.headers))) return closed();
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const staging = await getStorage();
    const ctx: IngestContext = { sql, media: createStudioMediaStore(), staging, log };
    const upload = request.nextUrl.searchParams.get('upload');
    if (upload !== null) {
      if (staging.servesSignedUrls) return studioJson({ ok: false, code: 'invalid' }, 405);
      if (!UUID.test(upload)) return closed();
      const pending = await ingestPendingUpload(ctx, upload);
      if (!pending) return closed();
      if (request.headers.get('content-type')?.split(';')[0]?.trim() !== pending.mime) return studioJson({ ok: false, code: 'unsupported_file' }, 415);
      const body = await readCappedBody(request, pending.sizeBytes);
      if (!body.ok) return studioJson({ ok: false, code: body.code }, body.code === 'file_too_large' ? 413 : 400);
      await staging.putStaging(pending.key, body.bytes, pending.mime);
      return studioJson({ ok: true });
    }
    let parsed: { operation?: unknown; input?: unknown };
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.input || typeof parsed.input !== 'object') throw new Error('shape');
    } catch {
      return studioJson({ ok: false, code: 'invalid' }, 400);
    }
    const result = await runIngest(ctx, parsed.operation, parsed.input);
    if (!result.ok) return studioJson(result, isStoryboardErrorCode(result.code) ? storyboardHttpStatus(result.code) : 400);
    return studioJson(result);
  } catch (error) {
    log('ingest_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
