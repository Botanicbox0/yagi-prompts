import type { NextRequest } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { brandStudioV2Open } from '@/lib/flags';
import { resolveRequestUrl, sameOriginMutation } from '@/lib/routing/surfaces';
import { studioJson } from '@/lib/brand-studio/http';
import { takeFreeIntelSlot } from '@/lib/brand-studio/jobs';
import { shieldedJobText, shieldedTokenText } from '@/lib/brand-studio/prompt-shield/picture';
import { renderPromptPage } from '@/lib/brand-studio/prompt-shield/render';
import { PROMPT_TOKEN_MAX } from '@/lib/brand-studio/prompt-shield/token';
import { studioLog } from '@/lib/brand-studio/runtime';

/**
 * The video prompt shield's pictures (`BRAND_STUDIO_VIDEO_PROMPT_SHIELD`): one page of a sent VIDEO prompt as a PNG.
 *
 *   GET  ?organizationId=…&jobId=…&page=N        a stored run's sent text (the view's `sent.pages`)
 *   POST { organizationId, token, page }         a `prompt.enhance` design (its `pages`), for the member who made it
 *
 * Every refusal is the same 404 — closed studio or shield, not signed in, not a member, no such run, another
 * organization's run, an image run, nothing designed, a page out of range, a bad token — so an answer never says
 * whether something exists. The text is never in a header, a file name, a log line or an error.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Pictures one person may have drawn per minute (a 15,000-character prompt is at most 24 pages). */
const PICTURES_PER_MINUTE = 120;
const POST_BODY_MAX = PROMPT_TOKEN_MAX + 1_024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => studioJson({ ok: false, code: 'not_found' }, 404);

function pageOf(value: unknown): number | null {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  return /^[1-9]\d{0,2}$/.test(s) ? Number(s) : null;
}

async function picture(text: string | null, page: number): Promise<Response> {
  if (text === null) return notFound();
  try {
    const out = await renderPromptPage(text, page);
    if (!out) return notFound();
    return new Response(new Uint8Array(out.png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(out.png.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch {
    studioLog('prompt_image_failed', { stage: 'render' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

/** Sign-in and the per-person rate, before anything is read. Null when the request may go on. */
async function gate(): Promise<{ viewer: { userId: string } } | Response> {
  if (!brandStudioV2Open()) return notFound();
  const viewer = await getViewer();
  if (!viewer.userId) return notFound();
  if (!takeFreeIntelSlot(`prompt-image:${viewer.userId}`, PICTURES_PER_MINUTE, Date.now())) {
    return studioJson({ ok: false, code: 'too_many_running' }, 429);
  }
  return { viewer: { userId: viewer.userId } };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const organizationId = params.get('organizationId') ?? '';
  const jobId = params.get('jobId') ?? '';
  const page = pageOf(params.get('page'));
  if (!UUID.test(organizationId) || !UUID.test(jobId) || page === null) return notFound();
  const allowed = await gate();
  if (allowed instanceof Response) return allowed;
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    return await picture(await shieldedJobText(sql, allowed.viewer, organizationId, jobId), page);
  } catch {
    studioLog('prompt_image_failed', { stage: 'read' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return notFound();
  if (Number(request.headers.get('content-length') ?? 0) > POST_BODY_MAX) return notFound();
  let body: { organizationId?: unknown; token?: unknown; page?: unknown };
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > POST_BODY_MAX) return notFound();
    body = JSON.parse(raw);
    if (!body || typeof body !== 'object') return notFound();
  } catch {
    return notFound();
  }
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : '';
  const page = pageOf(body.page);
  if (!UUID.test(organizationId) || page === null || typeof body.token !== 'string') return notFound();
  const allowed = await gate();
  if (allowed instanceof Response) return allowed;
  const sql = await getSqlRunner();
  if (!sql) return studioJson({ ok: false, code: 'provider_unavailable' }, 503);
  try {
    return await picture(await shieldedTokenText(sql, allowed.viewer, organizationId, body.token), page);
  } catch {
    studioLog('prompt_image_failed', { stage: 'read' });
    return studioJson({ ok: false, code: 'failed' }, 500);
  }
}
