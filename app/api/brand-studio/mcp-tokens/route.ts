import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson, studioStatus } from '@/lib/brand-studio/http';
import { listMcpTokens, mintMcpToken, revokeMcpToken } from '@/lib/brand-studio/mcp';
import { studioLog } from '@/lib/brand-studio/runtime';

export const dynamic = 'force-dynamic';

const BODY_MAX = 16_384;

export async function GET(request: NextRequest) {
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    const organizationId = request.nextUrl.searchParams.get('organizationId') ?? '';
    const result = await listMcpTokens(sql, viewer, organizationId);
    return studioJson(result, result.ok ? 200 : studioStatus(result.code));
  } catch (error) {
    studioLog('mcp_tokens_get_failed', {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) {
    return studioJson({ ok: false, code: 'forbidden' }, 403);
  }
  if (!brandStudioV2Open()) return studioJson({ ok: false, code: 'studio_closed' }, 404);
  const viewer = await getViewer();
  if (!viewer.userId) return studioJson({ ok: false, code: 'sign_in_required' }, 401);
  if (Number(request.headers.get('content-length') ?? 0) > BODY_MAX) {
    return studioJson({ ok: false, code: 'invalid' }, 413);
  }

  let op: unknown;
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > BODY_MAX) return studioJson({ ok: false, code: 'invalid' }, 413);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') throw new Error('shape');
    op = parsed.op ?? parsed.operation;
    if (parsed.input && typeof parsed.input === 'object') {
      payload = parsed.input as Record<string, unknown>;
    } else {
      const { op: _o1, operation: _o2, ...rest } = parsed;
      payload = rest;
    }
  } catch {
    return studioJson({ ok: false, code: 'invalid' }, 400);
  }

  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);

  try {
    if (op === 'create') {
      const result = await mintMcpToken(sql, viewer, payload);
      return studioJson(result, result.ok ? 201 : studioStatus(result.code));
    }
    if (op === 'revoke') {
      const result = await revokeMcpToken(sql, viewer, payload);
      return studioJson(result, result.ok ? 200 : studioStatus(result.code));
    }
    return studioJson({ ok: false, code: 'invalid' }, 400);
  } catch (error) {
    studioLog('mcp_tokens_post_failed', {
      op: String(op).slice(0, 32),
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
