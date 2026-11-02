import { timingSafeEqual } from 'node:crypto';
import { getSqlRunner } from '@/lib/db/connect';
import { getStorage } from '@/lib/storage';
import { importShortlist } from './service';
import { SHORTLIST_IMPORT_MAX_BODY } from './schema';

/**
 * `POST /api/brand-shortlist-worker/import` — the shortlist import worker's door, with its own secret
 * `BRAND_SHORTLIST_IMPORT_SECRET` (32+ chars). Without the secret every request is a plain 404. The
 * body is bounded on the stream below the platform's request limit; the worker sends at most
 * `SHORTLIST_IMPORT_MAX` candidates per request and splits a longer list itself.
 */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export function shortlistWorkerAuthorized(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.BRAND_SHORTLIST_IMPORT_SECRET;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret ?? ''}`;
  return !!secret && secret.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function boundedJson(request: Request): Promise<unknown | 'too_large' | 'invalid'> {
  const reader = request.body?.getReader();
  if (!reader) return 'invalid';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SHORTLIST_IMPORT_MAX_BODY) {
        await reader.cancel();
        return 'too_large';
      }
      chunks.push(value);
    }
  } catch {
    return 'invalid';
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return 'invalid'; }
}

export async function shortlistWorkerRoute(request: Request): Promise<Response> {
  if (!shortlistWorkerAuthorized(request)) return json({ error: 'unavailable' }, 404);
  const body = await boundedJson(request);
  if (body === 'too_large') return json({ ok: false, code: 'too_large' }, 413);
  if (body === 'invalid') return json({ ok: false, code: 'invalid' }, 400);
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return json({ ok: false, code: 'storage_unavailable' }, 503);
  try {
    const result = await importShortlist({ sql, storage: await getStorage() }, { kind: 'worker' }, body);
    if (result.ok) return json(result);
    return json(result, result.code === 'not_found' ? 404 : result.code === 'storage_unavailable' ? 503 : result.code === 'not_active' ? 409 : 400);
  } catch {
    return json({ ok: false, code: 'storage_unavailable' }, 503);
  }
}
