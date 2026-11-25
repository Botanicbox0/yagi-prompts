import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import { purchaseOpenFor } from '@/lib/auth/purchase-gate';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import { retryTossOrder } from '@/lib/billing/toss-service';
import { copyRetryPhotos, planRetryPhotos } from '@/lib/renders/cast-form';
import { ORDER_EDIT_REFUSAL_STATUS, specEditRefusal } from '@/lib/prompts/edits-closed';
import { parseDirectorSpecInput } from '@/lib/template-director/schema';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: TOSS_HEADERS });
const STATUS: Record<string, number> = {
  sign_in_required: 401,
  not_open: 403,
  not_found: 404,
  not_retryable: 409,
  photo_gone: 410,
  photos_gone: 410,
  rate_limited: 429,
  // docs/PERSONAL-STUDIO.md §6.1–6.2 (switch on only), refused by planRetryPhotos before the new order exists.
  adult_confirmation_required: 400,
  adult_only: 403,
  adult_check_unavailable: 503,
  partner_check_unavailable: 503,
};

/**
 * `POST /api/billing/toss/orders/{id}/retry` — 다시 결제하기 (docs/PLATFORM-2.0.md §2.2-1). A new
 * pending order from the owner's failed one: same template, options and stored photo. The browser
 * names nothing but the failed order; the price comes from the template row, as for any order.
 */
export async function POST(request: Request, { params }: Context) {
  if (!isSameOrigin(request)) return json({ ok: false, code: 'forbidden' }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  if (!purchaseOpenFor(viewer)) return json({ ok: false, code: 'not_open' }, 403);
  try {
    const deps = await getTossContext();
    if (!deps) return json({ ok: false, code: 'unavailable' }, 503);
    const id = (await params).id;
    // Founder 2026-11-25 — the old order's edit is checked again against the template as it is now (its text may have
    // changed since): an edit it cannot take is refused before the new order exists.
    const { rows: prior } = await deps.sql.query<{ slug: string | null; spec: unknown }>(
      "select to_jsonb(b.*)->>'template_slug' as slug, to_jsonb(b.*)->'director_spec' as spec from billing_payments b where id = $1 and user_id = $2",
      [id, viewer.userId],
    );
    const refusal = prior[0]?.slug ? await specEditRefusal(deps.sql, prior[0].slug, parseDirectorSpecInput(prior[0].spec)) : null;
    if (refusal) return json({ ok: false, code: refusal }, ORDER_EDIT_REFUSAL_STATUS[refusal]);
    // docs/CAST-CATEGORIES.md §3: a pet or couple order's second photo is bound to the old render_ref.
    // A solo order (plan 'solo') goes straight to the retry, exactly as before.
    const plan = await planRetryPhotos(deps.sql, viewer.userId, id);
    if (plan.kind === 'refuse') return json({ ok: false, code: plan.code }, STATUS[plan.code] ?? 400);
    const result = await retryTossOrder(deps, viewer, id);
    if (result.ok && plan.kind === 'copy') {
      await copyRetryPhotos(deps.sql, deps.store, { plan, newOrderId: result.order.id, userId: viewer.userId, now: new Date() });
    }
    return result.ok
      ? json({ ok: true, href: `/billing/toss/${result.order.id}` }, 201)
      : json(result, STATUS[result.code] ?? 400);
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
