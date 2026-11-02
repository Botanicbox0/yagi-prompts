import { after, NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/viewer';
import {
  getTossContext,
  isSameOrigin,
  TOSS_HEADERS,
} from '@/lib/billing/toss-runtime';
import { confirmTossOrder, loadOwnTossOrder } from '@/lib/billing/toss-service';
import type { FakeTossGateway } from '@/lib/billing/toss-fake';
import { runLiveRenderPass } from '@/lib/renders/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  const json = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: TOSS_HEADERS });
  if (!isSameOrigin(request)) return json({ ok: false }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: 'sign_in_required' }, 401);
  try {
    const body = await request.json();
    const deps = await getTossContext();
    if (!deps) return json({ ok: false, code: 'unavailable' }, 503);
    const o = await loadOwnTossOrder(
      deps.sql,
      viewer,
      String(body.orderId ?? ''),
    );
    if (!o) return json({ ok: false, code: 'not_found' }, 404);
    const consent = await deps.sql.query<{ consent_at: unknown }>(
      'select consent_at from billing_payments where id=$1',
      [o.id],
    );
    let paymentKey = String(body.paymentKey ?? '');
    if (deps.gateway.kind === 'fake') {
      const fake = deps.gateway as FakeTossGateway;
      fake.authorize(o.id, o.amount_krw);
      paymentKey = fake.keyFor(o.id);
    }
    const result = await confirmTossOrder(deps, viewer, {
      orderId: o.id,
      paymentKey,
      amount: body.amount,
      consent: !!consent.rows[0]?.consent_at,
    });
    if (!result.ok)
      return json(result, result.code === 'already_processed' ? 409 : 400);
    if (!result.held)
      after(async () => {
        try {
          await runLiveRenderPass(deps.sql, { jobId: result.id, limit: 1 });
        } catch {
          /* durable queue retries */
        }
      });
    return json({ ...result, href: `/renders/${result.id}` });
  } catch {
    return json({ ok: false, code: 'unavailable' }, 503);
  }
}
