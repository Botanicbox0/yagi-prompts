import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { creativeGate } from '@/lib/makers/access';
import { TokenError, createMakerToken, listMakerTokens, revokeMakerToken } from '@/lib/makers/tokens';

/**
 * `/api/makers/tokens` — an AI creative's personal access tokens for their own agent (TWINGS MCP,
 * docs/PLATFORM-2.0.md §20.5). POST `{name}` creates one and returns the token ONCE; DELETE `?id=`
 * revokes. Same-origin, signed-in, an active creative with the program open.
 */
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const STATUS: Record<string, number> = { sign_in_required: 401, forbidden: 403, not_open: 403, not_found: 404, limit_reached: 409, invalid: 400, unavailable: 503 };

async function gate(request: Request, write: boolean) {
  if (write && !isSameOrigin(request)) return { error: json({ code: 'forbidden' }, 403) } as const;
  const viewer = await getViewer();
  if (!viewer.userId) return { error: json({ code: 'sign_in_required' }, 401) } as const;
  const sql = await getSqlRunner();
  if (!sql) return { error: json({ code: 'unavailable' }, 503) } as const;
  const access = await creativeGate(sql, viewer.userId);
  if (!access.ok) return { error: json({ code: access.code }, STATUS[access.code]) } as const;
  return { sql, userId: access.userId } as const;
}

const failed = (error: unknown) => (error instanceof TokenError ? json({ code: error.code }, STATUS[error.code] ?? 409) : json({ code: 'unavailable' }, 503));

export async function GET(request: Request) {
  const g = await gate(request, false);
  if ('error' in g) return g.error;
  try { return json({ ok: true, tokens: await listMakerTokens(g.sql, g.userId) }); } catch (error) { return failed(error); }
}

export async function POST(request: Request) {
  const g = await gate(request, true);
  if ('error' in g) return g.error;
  try {
    const bytes = await readBoundedBody(request, 2_000);
    if (!bytes) return json({ code: 'too_large' }, 413);
    let body: { name?: unknown };
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ code: 'invalid' }, 400); }
    const { token, record } = await createMakerToken(g.sql, g.userId, body.name);
    return json({ ok: true, token, record }, 201);
  } catch (error) { return failed(error); }
}

export async function DELETE(request: Request) {
  const g = await gate(request, true);
  if ('error' in g) return g.error;
  try {
    await revokeMakerToken(g.sql, g.userId, new URL(request.url).searchParams.get('id'));
    return json({ ok: true });
  } catch (error) { return failed(error); }
}
