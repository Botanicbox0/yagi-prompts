import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  sql: vi.fn(),
  checkout: vi.fn(),
  reconcile: vi.fn(),
  runtime: vi.fn(),
  propose: vi.fn(),
}));
vi.mock("@/lib/auth/viewer", () => ({ getViewer: mocks.viewer }));
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: mocks.sql }));
vi.mock("@/lib/campaigns/funding/service", () => ({
  acceptFundingQuote: vi.fn(),
  createFundingOrder: vi.fn(),
  proposeCampaignReward: mocks.propose,
  loadFundingCheckout: mocks.checkout,
}));
vi.mock("@/lib/campaigns/funding/payment", () => ({
  createFundingOrder: vi.fn(),
  confirmFundingPayment: vi.fn(),
  reconcileFunding: mocks.reconcile,
}));
vi.mock("@/lib/campaigns/funding/runtime", () => ({
  fundingDeps: mocks.runtime,
}));
vi.mock("server-only", () => ({}));
import { GET, POST } from "@/app/api/campaign-funding/route";
afterEach(() => {
  vi.resetAllMocks();
});
const post = (body: string, origin = "https://brand.twings.app") =>
  new NextRequest("https://brand.twings.app/api/campaign-funding", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body,
  });
it("rejects cross-origin funding posts before authentication or database access", async () => {
  expect((await POST(post("{}", "https://foreign.example"))).status).toBe(403);
  expect(mocks.viewer).not.toHaveBeenCalled();
  expect(mocks.sql).not.toHaveBeenCalled();
});
it("classifies malformed JSON as invalid400 without consulting the provider", async () => {
  mocks.viewer.mockResolvedValue({ userId: randomUUID(), isAdmin: false });
  mocks.sql.mockResolvedValue({});
  const response = await POST(post("{invalid"));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, code: "invalid" });
  expect(mocks.runtime).not.toHaveBeenCalled();
});
it("keeps GET status read-only; explicit same-origin status POST performs recovery", async () => {
  const projectId = randomUUID(),
    orderId = randomUUID();
  mocks.viewer.mockResolvedValue({ userId: randomUUID(), isAdmin: false });
  mocks.sql.mockResolvedValue({});
  mocks.checkout.mockResolvedValue({
    order: { id: orderId, status: "confirming" },
  });
  mocks.runtime.mockReturnValue({ enabled: false, policyReady: false });
  expect(
    (
      await GET(
        new NextRequest(
          `https://brand.twings.app/api/campaign-funding?projectId=${projectId}&orderId=${orderId}`,
        ),
      )
    ).status,
  ).toBe(200);
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(
    (
      await POST(
        post(
          JSON.stringify({
            operation: "order.status",
            input: { projectId, orderId },
          }),
        ),
      )
    ).status,
  ).toBe(200);
  expect(mocks.reconcile).toHaveBeenCalledTimes(1);
});

it.each([
  ["invalid", 400],
  ["unavailable", 503],
  ["rate_limited", 429],
  ["forbidden", 403],
  ["not_found", 404],
  ["conflict", 409],
] as const)("maps reward proposal %s to HTTP%s", async (code, status) => {
  mocks.viewer.mockResolvedValue({ userId: randomUUID(), isAdmin: false });
  mocks.sql.mockResolvedValue({});
  mocks.propose.mockResolvedValue({ ok: false, code });
  const response = await POST(
    post(JSON.stringify({ operation: "reward.propose", input: {} })),
  );
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ ok: false, code });
});
