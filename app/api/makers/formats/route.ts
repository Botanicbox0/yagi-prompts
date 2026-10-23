import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { isSameOrigin } from '@/lib/billing/toss-runtime';
import { readBoundedBody } from '@/lib/creator-subscriptions/http';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { PlatformError } from '@/lib/creator-platform/contract';
import { loadMakerDraft, makerAction, RecipeRejected } from '@/lib/recipes/maker';
import { MAX_RECIPE_BYTES } from '@/lib/recipes/schema';
import { getRenderStore } from '@/lib/renders/store';
import { runLiveRenderPass } from '@/lib/renders/runtime';

/**
 * `POST /api/makers/formats` — the recipe editor's JSON actions (lib/recipes/maker.ts): save a draft,
 * delete a file, start a test render, submit. Same-origin, signed-in, bounded body; the domain
 * demands an approved supplier, the open supplier flag and 0059 again. Answers carry ids and codes
 * only — never the recipe, a storage key or a cost.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const STATUS: Record<string, number> = { sign_in_required: 401, forbidden: 403, not_open: 403, not_found: 404, rate_limited: 429, test_limit: 429, too_large: 413 };

/** `GET ?id=` — the editor's poll: the draft's status and its test renders, nothing else. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const access = await platformAccess(sql);
    const draft = await loadMakerDraft(sql, viewer, new URL(request.url).searchParams.get('id') ?? '', { creators: access.creators });
    if (!draft) return json({ code: 'not_found' }, 404);
    return json({ ok: true, status: draft.status, testRendersUsed: draft.testRendersUsed, tests: draft.tests });
  } catch (error) {
    if (error instanceof PlatformError) return json({ code: error.code }, STATUS[error.code] ?? 409);
    return json({ code: 'unavailable' }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ code: 'sign_in_required' }, 401);
  try {
    const bytes = await readBoundedBody(request, MAX_RECIPE_BYTES + 8_000);
    if (!bytes) return json({ code: 'too_large' }, 413);
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { return json({ code: 'invalid' }, 400); }
    const sql = await getSqlRunner();
    if (!sql) return json({ code: 'unavailable' }, 503);
    const access = await platformAccess(sql);
    const result = await makerAction({ sql, store: await getRenderStore() }, viewer, raw, { creators: access.creators });
    if (result.renderId) {
      const renderId = result.renderId;
      after(async () => { try { await runLiveRenderPass(sql, { jobId: renderId, limit: 1 }); } catch { /* The queued test render stays recoverable by the next pass. */ } });
    }
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof RecipeRejected) return json({ code: error.code, issues: error.issues }, 422);
    if (error instanceof PlatformError) return json({ code: error.code }, STATUS[error.code] ?? 409);
    return json({ code: 'unavailable' }, 503);
  }
}
