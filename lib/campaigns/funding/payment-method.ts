import type { TossPayment } from "@/lib/billing/toss-gateway";

/** Only methods supported by the account-free full-refund adapter. */
export function fundingProviderMethodSupported(
  payment: TossPayment | null,
): boolean {
  return (
    payment?.method === "카드" ||
    (payment?.method === "간편결제" && payment.easyPayProvider === "토스페이")
  );
}

export function fundingWidgetMethodSupported(code: string): boolean {
  return code === "CARD" || code === "TOSSPAY";
}
