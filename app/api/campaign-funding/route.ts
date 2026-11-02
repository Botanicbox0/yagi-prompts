import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getViewer } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { resolveRequestUrl, sameOriginMutation } from "@/lib/routing/surfaces";
import { readBoundedBody } from "@/lib/creator-subscriptions/http";
import {
  acceptFundingQuote,
  loadFundingCheckout,
  proposeCampaignReward,
} from "@/lib/campaigns/funding/service";
import {
  createFundingOrder,
  confirmFundingPayment,
  reconcileFunding,
} from "@/lib/campaigns/funding/payment";
import { fundingDeps } from "@/lib/campaigns/funding/runtime";
import type { FakeTossGateway } from "@/lib/billing/toss-fake";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });
const failureStatus = (code: string) =>
  (
    ({
      invalid: 400,
      sign_in_required: 401,
      forbidden: 403,
      not_found: 404,
      conflict: 409,
      unavailable: 503,
      payments_closed: 503,
      amount_mismatch: 400,
      confirm_pending: 409,
      payment_failed: 409,
      payment_review: 409,
      rate_limited: 429,
    }) as Record<string, number>
  )[code] ?? 503;
export const dynamic = "force-dynamic";
const Envelope = z
  .object({
    operation: z.enum([
      "quote.accept",
      "order.create",
      "order.confirm",
      "reward.propose",
      "order.status",
    ]),
    input: z.record(z.string(), z.unknown()),
  })
  .strict();
export async function POST(request: NextRequest) {
  const origin = resolveRequestUrl(new URL(request.url), request.headers);
  if (!origin || !sameOriginMutation(origin, request.headers))
    return json({ ok: false, code: "forbidden" }, 403);
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
  if (viewer.isAdmin) return json({ ok: false, code: "forbidden" }, 403);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: "unavailable" }, 503);
    if (request.headers.get("content-type") !== "application/json")
      return json({ ok: false, code: "invalid" }, 400);
    const bytes = await readBoundedBody(request, 12000);
    if (!bytes) return json({ ok: false, code: "invalid" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json({ ok: false, code: "invalid" }, 400);
    }
    const parsed = Envelope.safeParse(body);
    if (!parsed.success) return json({ ok: false, code: "invalid" }, 400);
    const { operation, input } = parsed.data;
    if (operation === "reward.propose") {
      const result = await proposeCampaignReward({ sql }, viewer, input);
      return json(result, result.ok ? 200 : failureStatus(result.code));
    }
    if (operation === "order.status") {
      const p = z
        .object({ projectId: z.string().uuid(), orderId: z.string().uuid() })
        .strict()
        .safeParse(input);
      if (!p.success) return json({ ok: false, code: "invalid" }, 400);
      const own = await loadFundingCheckout(
        sql,
        viewer,
        p.data.projectId,
        p.data.orderId,
      );
      if (!own) return json({ ok: false, code: "not_found" }, 404);
      const recovery = fundingDeps(sql);
      if (recovery) await reconcileFunding(recovery, own.order.id);
      const current = await loadFundingCheckout(
        sql,
        viewer,
        p.data.projectId,
        p.data.orderId,
      );
      return json({
        ok: true,
        status: current?.order.status ?? own.order.status,
      });
    }
    const deps = fundingDeps(sql);
    if (!deps) return json({ ok: false, code: "payments_closed" }, 503);
    let result;
    if (operation === "quote.accept")
      result = await acceptFundingQuote(deps, viewer, input);
    else if (operation === "order.create") {
      result = await createFundingOrder(deps, viewer, input);
      if (result.ok) {
        const p = (
          await sql.query(
            "select c.project_id from campaign_funding_payments o join campaign_funding_cases c on c.id=o.case_id where o.id=$1",
            [result.order.id],
          )
        ).rows[0]!;
        return json({
          ...result,
          href: `/brand/projects/${p.project_id}/funding/${result.order.id}`,
        });
      }
    } else {
      const p = z
        .object({
          orderId: z.string().uuid(),
          projectId: z.string().uuid(),
          amount: z.number(),
          paymentKey: z.string().min(1).max(200).optional(),
        })
        .strict()
        .safeParse(input);
      if (!p.success) return json({ ok: false, code: "invalid" }, 400);
      const own = await loadFundingCheckout(
        sql,
        viewer,
        p.data.projectId,
        p.data.orderId,
      );
      if (!own) return json({ ok: false, code: "not_found" }, 404);
      let key = p.data.paymentKey;
      if (deps.gateway.kind === "fake") {
        const fake = deps.gateway as FakeTossGateway;
        fake.authorize(own.order.id, own.order.amountKrw);
        key = fake.keyFor(own.order.id);
      }
      result = await confirmFundingPayment(deps, viewer, {
        orderId: p.data.orderId,
        amount: p.data.amount,
        paymentKey: key,
      });
      if (result.ok)
        return json({
          ...result,
          href: `/brand/projects/${p.data.projectId}/funding`,
        });
    }
    return json(result, result.ok ? 200 : failureStatus(result.code));
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer.userId) return json({ ok: false, code: "sign_in_required" }, 401);
  const p = z
    .object({ projectId: z.string().uuid(), orderId: z.string().uuid() })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!p.success) return json({ ok: false, code: "invalid" }, 400);
  try {
    const sql = await getSqlRunner();
    if (!sql) return json({ ok: false, code: "unavailable" }, 503);
    const own = await loadFundingCheckout(
      sql,
      viewer,
      p.data.projectId,
      p.data.orderId,
    );
    if (!own) return json({ ok: false, code: "not_found" }, 404);
    // GET is a read; explicit same-origin order.status POST performs reconciliation.
    const current = await loadFundingCheckout(
      sql,
      viewer,
      p.data.projectId,
      p.data.orderId,
    );
    return json({
      ok: true,
      status: current?.order.status ?? own.order.status,
      href: `/brand/projects/${p.data.projectId}/funding`,
    });
  } catch {
    return json({ ok: false, code: "unavailable" }, 503);
  }
}
