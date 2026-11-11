import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getSqlRunner } from '@/lib/db/connect';
import { brandRoomsOpen } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { STUDIO_HEADERS } from '@/lib/brand-studio/http';
import { createStudioMediaStore } from '@/lib/brand-studio/media-store';
import { countShareView, guestComment, unlockShare, VISITOR_COOKIE, type ShareDeps } from '@/lib/brand-rooms/shares';
import { shareHttpStatus, type ShareErrorCode } from '@/lib/brand-rooms/share-contracts';

/**
 * The share page's own door (docs/BRAND-ROOMS.md §6, §9-3). No sign-in: the token in the body is the key.
 * Same-origin posts only. Anything about a link that does not resolve answers `not_found` (404), the same
 * as a token that never existed.
 *
 *   POST { op: 'view', token }                      count this visitor once per hour
 *   POST { op: 'unlock', token, passphrase }        the passphrase gate; sets an http-only proof cookie
 *   POST { op: 'comment', token, name, body, … }    a guest's note, when the link allows comments
 *
 * Besides the per-link limits in the service, each server instance also slows down one address that
 * hammers this door. The address is held in memory for a minute and never stored.
 */
export const dynamic = 'force-dynamic';

const BODY_MAX = 65_536;
const PER_MINUTE: Record<string, number> = { view: 60, unlock: 12, comment: 12 };
const recent = new Map<string, number[]>();

function slowDown(op: string, address: string): boolean {
  const key = `${op}:${address}`;
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5_000) for (const [k, v] of recent) if (!v.some((t) => now - t < 60_000)) recent.delete(k);
  return hits.length > (PER_MINUTE[op] ?? 30);
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: STUDIO_HEADERS });
}

const fail = (code: ShareErrorCode) => json({ ok: false, code }, shareHttpStatus(code));

function log(event: string, detail: Record<string, unknown> = {}): void {
  console.warn(`[brand-rooms] ${event}`, JSON.stringify(detail).slice(0, 600));
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return fail('forbidden');
  if (!brandRoomsOpen()) return fail('not_found');
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) return fail('invalid');
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return fail('invalid');
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') throw new Error('shape');
  } catch {
    return fail('invalid');
  }
  const op = body.op;
  if (op !== 'view' && op !== 'unlock' && op !== 'comment') return fail('invalid');
  const address = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || request.headers.get('x-real-ip') || 'local';
  if (slowDown(op, address)) return fail('rate_limited');
  const sql = await getSqlRunner();
  if (!sql) return fail('provider_unavailable');
  const deps: ShareDeps = { sql, media: createStudioMediaStore() };
  const cookies = { get: (name: string) => request.cookies.get(name)?.value };
  const secure = origin.protocol === 'https:';
  const clientKey = createHash('sha256').update(address).digest('hex').slice(0, 16);
  const userAgent = request.headers.get('user-agent');
  try {
    if (op === 'view') {
      const result = await countShareView(deps, body, cookies, { userAgent });
      if (!result.ok) return fail(result.code);
      const response = json({ ok: true });
      response.cookies.set(VISITOR_COOKIE, result.visitor, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 30 * 86_400 });
      return response;
    }
    if (op === 'unlock') {
      const result = await unlockShare(deps, body, { clientKey });
      if (!result.ok) return fail(result.code);
      const response = json({ ok: true });
      response.cookies.set(result.cookie.name, result.cookie.value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: result.cookie.maxAge });
      return response;
    }
    const result = await guestComment(deps, body, cookies);
    if (!result.ok) return fail(result.code);
    return json(result, 201);
  } catch (error) {
    log('share_public_failed', { op, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return fail('failed');
  }
}
