import { describe, expect, it, vi } from "vitest";
import {
  createTossGateway,
  getTossGateway,
  tossConfigFromEnv,
  TossError,
} from "@/lib/billing/toss-gateway";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { legalDocument } from "@/lib/legal/documents";

describe("Toss provider boundary", () => {
  it("uses a fake only without credentials in a local/test environment", () => {
    expect(getTossGateway({ NODE_ENV: "test" })?.kind).toBe("fake");
    expect(
      getTossGateway({ NODE_ENV: "production", PLAYBOOK_MODE: "cloud" }),
    ).toBeNull();
    expect(
      getTossGateway({ NODE_ENV: "test", PLAYBOOK_MODE: "local", VERCEL: "1" }),
    ).toBeNull();
    expect(() =>
      tossConfigFromEnv({
        NODE_ENV: "test",
        TOSS_CLIENT_KEY: "test_gck_fixture",
      }),
    ).toThrow(TossError);
    expect(() =>
      tossConfigFromEnv({
        NODE_ENV: "test",
        TOSS_CLIENT_KEY: "test_gck_fixture",
        TOSS_SECRET_KEY: "live_gsk_fixture",
      }),
    ).toThrow(TossError);
  });
  it("confirms on the server with an idempotency key and returns a narrow snapshot", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            paymentKey: "fixture_payment",
            orderId: "fixture_order",
            totalAmount: 2900,
            balanceAmount: 2900,
            currency: "KRW",
            status: "DONE",
            method: "간편결제",
            easyPay: { provider: "토스페이", amount: 2900 },
            virtualAccount: { accountNumber: "must not escape" },
            card: { number: "should not escape" },
          }),
        ),
    );
    const g = createTossGateway(
      {
        kind: "test",
        clientKey: "test_gck_fixture",
        secretKey: "test_gsk_fixture",
      },
      transport,
    );
    const result = await g.confirm({
      paymentKey: "fixture_payment",
      orderId: "fixture_order",
      amount: 2900,
      idempotencyKey: "confirm-fixture",
    });
    expect(result).toEqual({
      paymentKey: "fixture_payment",
      orderId: "fixture_order",
      amount: 2900,
      balance: 2900,
      currency: "KRW",
      status: "DONE",
      method: "간편결제",
      easyPayProvider: "토스페이",
    });
    const [, request] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe(
      "confirm-fixture",
    );
    expect(JSON.parse(request.body as string).amount).toBe(2900);
  });
  it("does not expose response bodies or provider error messages", async () => {
    const g = createTossGateway(
      {
        kind: "test",
        clientKey: "test_gck_fixture",
        secretKey: "test_gsk_fixture",
      },
      async () => new Response("sensitive provider body", { status: 401 }),
    );
    await expect(
      g.retrieve("private-payment-identifier"),
    ).rejects.toMatchObject({
      code: "HTTP_401",
      message: "Payment provider request could not be completed",
    });
  });
  it("uses the exact existing refund section for checkout consent in both languages", () => {
    for (const locale of ["ko", "en"] as const) {
      const body = legalDocument("refund", locale).body;
      const section = body
        .split("## 2.")[1]!
        .split("## 3.")[0]!
        .split("\n")
        .slice(1)
        .join(" ")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .trim();
      expect(getDictionary(locale).billing.toss.notice).toBe(section);
    }
  });
});
