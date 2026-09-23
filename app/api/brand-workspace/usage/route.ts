import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import { getTossGateway } from "@/lib/billing/toss-gateway";
import type { FakeTossGateway } from "@/lib/billing/toss-fake";
import { usagePaymentsOpen } from "@/lib/brands/usage/runtime";
import { confirmUsagePayment, createUsageOrder, loadOwnUsageOrder, reconcileBrandUsagePayments } from "@/lib/brands/usage/payment";

/**
 * Secondary-usage payment (docs/SECONDARY-USAGE.md). A separate order kind with no render hook and no
 * relation to `RENDER_PIPELINE_PUBLIC`. The fake gateway exists only on an explicitly local/test runtime
 * (`getTossGateway`); a deployment without keys has no gateway and answers 503, never a fake success.
 */
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: HEADERS });
const STATUS: Record<string, number> = { sign_in_required: 401, not_found: 404, forbidden: 403, conflict: 409, already_processed: 409, rate_limited: 429, payments_closed: 403, unavailable: 503, confirm_pending: 202, payment_review: 202 };

export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers)) return json({ ok: false, code: "forbidden" }, 403);
  try {
    const viewer = await getViewer();
    if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 8192) return json({ ok: false, code: "invalid" }, 413);
    let body: { operation?: unknown; input?: Record<string, unknown> };
    try { body = JSON.parse(raw); } catch { return json({ ok: false, code: "invalid" }, 400); }
    if (!body || typeof body.input !== "object" || body.input === null) return json({ ok: false, code: "invalid" }, 400);
    const [sql, gateway] = [await getSqlRunner(), getTossGateway()];
    if (!sql || !gateway) return json({ ok: false, code: "unavailable" }, 503);
    const deps = { sql, gateway, paymentsOpen: usagePaymentsOpen() };
    if (body.operation === "order.create") {
      const result = await createUsageOrder(deps, viewer, body.input);
      if (!result.ok) return json({ ok: false, code: result.code }, STATUS[result.code] ?? 400);
      return json({ ok: true, order: result.order, kind: gateway.kind });
    }
    if (body.operation === "order.confirm") {
      const orderId = String(body.input.orderId ?? "");
      let paymentKey = String(body.input.paymentKey ?? "");
      if (gateway.kind === "fake") {
        // Local/test only: stand in for the provider window, bound to the buyer's own order and its stored amount.
        const own = await loadOwnUsageOrder(sql, viewer, orderId);
        if (!own) return json({ ok: false, code: "not_found" }, 404);
        const fake = gateway as FakeTossGateway;
        fake.authorize(orderId, Number(own.amount_krw));
        paymentKey = fake.keyFor(orderId);
      }
      const result = await confirmUsagePayment(deps, viewer, { orderId, paymentKey, amount: body.input.amount });
      // Only the outcome: no provider message, internal reason or payment key.
      if (!result.ok) return json({ ok: false, code: result.code }, STATUS[result.code] ?? 400);
      return json({ ok: true, state: result.state, href: `/brand/projects/${result.projectId}#usage` });
    }
    return json({ ok: false, code: "invalid" }, 400);
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}

/** The buyer's own order status. Also an opportunistic recovery pass (the daily tick is the durable one). */
export async function GET(request: NextRequest) {
  try {
    const viewer = await getViewer();
    if (!viewer.userId) return json({ ok: false }, 401);
    const [sql, gateway] = [await getSqlRunner(), getTossGateway()];
    if (!sql || !gateway) return json({ ok: false }, 503);
    const id = request.nextUrl.searchParams.get("orderId") ?? "";
    if (!(await loadOwnUsageOrder(sql, viewer, id))) return json({ ok: false }, 404);
    await reconcileBrandUsagePayments({ sql, gateway });
    const o = (await loadOwnUsageOrder(sql, viewer, id))!;
    return json({ ok: true, status: String(o.status), href: `/brand/projects/${String(o.project_id)}#usage` });
  } catch {
    return json({ ok: false }, 503);
  }
}
