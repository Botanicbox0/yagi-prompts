import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import {
  loadOwnTossOrder,
  reconcileTossPayments,
  tossOrderView,
  TOSS_CONSENT_VERSION,
} from '@/lib/billing/toss-service';
import { purchaseOpenFor } from '@/lib/auth/purchase-gate';
import { runLiveRenderPass } from '@/lib/renders/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: TOSS_HEADERS });

export async function GET(_request: Request, { params }: Context) {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false }, 401);
  try {
    const deps = await getTossContext();
    if (!deps) return json({ ok: false }, 503);
    const { id } = await params;
    if (!(await loadOwnTossOrder(deps.sql, viewer, id)))
      return json({ ok: false }, 404);
    // This order only (docs/PLATFORM-2.0.md §2.2-8); everyone's payments are the render pass's and the cron's.
    await reconcileTossPayments(deps, { orderId: id });
    const o = (await loadOwnTossOrder(deps.sql, viewer, id))!;
    if (o.status === 'paid' && o.render_id)
      after(async () => {
        try {
          await runLiveRenderPass(deps.sql, { jobId: o.render_id, limit: 1 });
        } catch {
          /* durable queue retries */
        }
      });
    const view = tossOrderView(o);
    return json({
      ok: true,
      status: view.status,
      reason: view.reason,
      retry: view.retry && purchaseOpenFor(viewer),
      renderId: view.renderId,
    });
  } catch {
    return json({ ok: false }, 503);
  }
}

/** Record the reader's separate withdrawal consent BEFORE opening the provider window. */
export async function POST(request: Request, { params }: Context) {
  if (!isSameOrigin(request)) return json({ ok: false }, 403);
  const viewer = await getViewer();
  if (!purchaseOpenFor(viewer))
    return json({ ok: false }, 403);
  try {
    const body = await request.json();
    if (body.consent !== true)
      return json({ ok: false, code: 'consent_required' }, 400);
    const deps = await getTossContext();
    if (!deps) return json({ ok: false }, 503);
    const { id } = await params;
    const o = await loadOwnTossOrder(deps.sql, viewer, id);
    if (!o || o.status !== 'pending') return json({ ok: false }, 409);
    // The first consent stands (§2.2-7): reopening the window does not move it.
    await deps.sql.query(
      "update billing_payments set consent_at=coalesce(consent_at,now()),consent_version=coalesce(consent_version,$2) where id=$1 and user_id=$3 and status='pending'",
      [id, TOSS_CONSENT_VERSION, viewer.userId],
    );
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 400);
  }
}
