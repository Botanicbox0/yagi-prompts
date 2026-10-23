import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getSqlRunner } from '@/lib/db/connect';
import { getRenderStore } from '@/lib/renders/store';
import { influencersOpen } from './rules';
import { claimSocialJobs, completeSocialJob, leasedEvidence, socialHeartbeat } from './worker';

/**
 * `/api/social-verify-worker/{claim,complete,heartbeat,evidence}` — the campaign-risk worker's door
 * (`lib/campaigns/risk/http.ts`) with its own secret, `SOCIAL_VERIFY_WORKER_SECRET` (32+ chars).
 * Without the flag or the secret every action is a plain 404; bodies are bounded on the stream.
 */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export type SocialWorkerAction = 'claim' | 'complete' | 'heartbeat' | 'evidence';

export function socialWorkerAuthorized(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.SOCIAL_VERIFY_WORKER_SECRET;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret ?? ''}`;
  return (
    influencersOpen(env) &&
    !!secret &&
    secret.length >= 32 &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  );
}

async function boundedJson(request: Request): Promise<unknown | 'too_large' | 'invalid'> {
  let raw = '';
  const reader = request.body?.getReader();
  if (reader) {
    let size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8_192) {
          await reader.cancel();
          return 'too_large';
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch {
      return 'invalid';
    }
  }
  try { return JSON.parse(raw || '{}'); } catch { return 'invalid'; }
}

export async function socialWorkerRoute(request: Request, action: SocialWorkerAction): Promise<Response> {
  if (!socialWorkerAuthorized(request)) return json({ error: 'unavailable' }, 404);
  const body = await boundedJson(request);
  if (body === 'too_large') return json({ error: 'too_large' }, 413);
  if (body === 'invalid') return json({ error: 'invalid' }, 400);
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return json({ error: 'unavailable' }, 503);
  try {
    if (action === 'claim') {
      const claim = z.object({ limit: z.number().int().min(1).max(5).default(1) }).strict().safeParse(body);
      if (!claim.success) return json({ error: 'invalid' }, 400);
      return json({ jobs: await claimSocialJobs(sql, await getRenderStore(), claim.data.limit) });
    }
    if (action === 'evidence') {
      const bytes = await leasedEvidence(sql, await getRenderStore(), body);
      if (!bytes) return json({ error: 'not_found' }, 404);
      return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (action === 'complete') return json({ ok: await completeSocialJob(sql, body) });
    return json({ ok: await socialHeartbeat(sql, body) });
  } catch {
    return json({ error: 'unavailable' }, 503);
  }
}
