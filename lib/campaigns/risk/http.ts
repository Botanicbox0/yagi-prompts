import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { getSqlRunner } from '@/lib/db/connect';
import { claimRiskJobs, completeRiskJob, riskHeartbeat } from './worker';
import { riskEnabled } from './queue';
import { dispatchRiskSlack, slackRiskConfig } from './slack';
function riskJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return Response.json(body, { ...init, headers });
}
export async function riskWorkerRoute(
  request: Request,
  action: 'claim' | 'complete' | 'heartbeat' | 'slack',
) {
  const secret = process.env.CAMPAIGN_RISK_WORKER_SECRET;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret ?? ''}`;
  if (
    !riskEnabled() ||
    !secret ||
    secret.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return riskJson({ error: 'unavailable' }, { status: 404 });
  // Check the stream itself: Content-Length is attacker-controlled and may be absent.
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
        if (size > 16_384) {
          await reader.cancel();
          return riskJson({ error: 'too_large' }, { status: 413 });
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } catch {
      return riskJson({ error: 'invalid' }, { status: 400 });
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return riskJson({ error: 'invalid' }, { status: 400 });
  }
  const sql = await getSqlRunner().catch(() => null);
  if (!sql) return riskJson({ error: 'unavailable' }, { status: 503 });
  try {
    if (action === 'claim') {
      const claim = z
        .object({ limit: z.number().int().min(1).max(10).default(1) })
        .strict()
        .safeParse(body);
      if (!claim.success) return riskJson({ error: 'invalid' }, { status: 400 });
      return riskJson(
        { jobs: await claimRiskJobs(sql, claim.data.limit) },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    if (action === 'complete') return riskJson({ ok: await completeRiskJob(sql, body) });
    if (action === 'heartbeat') return riskJson({ ok: await riskHeartbeat(sql, body) });
    return riskJson({ state: await dispatchRiskSlack(sql, slackRiskConfig(process.env)) });
  } catch {
    return riskJson({ error: 'unavailable' }, { status: 503 });
  }
}
