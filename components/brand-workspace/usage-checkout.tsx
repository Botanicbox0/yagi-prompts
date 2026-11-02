"use client";
import Script from "next/script";
import { useRef, useState } from "react";
import type { BrandCopy } from "./action-form";
import { formatKrw, interpolate } from "@/lib/i18n/format";

/**
 * Secondary-usage checkout (docs/SECONDARY-USAGE.md), modeled on the render checkout's Toss widget but
 * posting only to `/api/brand-workspace/usage`. The order amount is set by the server from the accepted
 * quote; this component shows it and the provider window charges exactly that.
 */
type Copy = BrandCopy["secondaryUsage"]["payment"];
interface Widgets {
  setAmount(input: { currency: string; value: number }): Promise<void>;
  renderPaymentMethods(input: { selector: string }): Promise<unknown>;
  renderAgreement(input: { selector: string }): Promise<{ on(event: "agreementStatusChange", cb: (s: { agreedRequiredTerms: boolean }) => void): void }>;
  requestPayment(input: { orderId: string; orderName: string; successUrl: string; failUrl: string }): Promise<unknown>;
}
type TossWindow = Window & { TossPayments?: (key: string) => { widgets(input: { customerKey: string }): Widgets } };
export const USAGE_RETURN_KEY = "twings.usage.returnOrder";

async function post(operation: string, input: Record<string, unknown>) {
  const response = await fetch("/api/brand-workspace/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, input }) });
  const result = await response.json().catch(() => ({ ok: false }));
  return response.ok && result.ok ? result : null;
}

export function UsageCheckout(props: { caseId: string; projectId: string; amount: number; kind: "fake" | "test" | "live"; clientKey: string | null; customerKey: string; locale: string; copy: Copy }) {
  const c = props.copy;
  const widgets = useRef<Widgets | null>(null);
  const initialized = useRef(false);
  const requestId = useRef<string | null>(null);
  const [ready, setReady] = useState(props.kind === "fake");
  const [terms, setTerms] = useState<boolean | null>(props.kind === "fake" ? true : null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function initialize() {
    if (initialized.current) return;
    initialized.current = true;
    try {
      const init = (window as TossWindow).TossPayments;
      if (!init || !props.clientKey) throw new Error();
      const w = init(props.clientKey).widgets({ customerKey: props.customerKey });
      widgets.current = w;
      await w.setAmount({ currency: "KRW", value: props.amount });
      await w.renderPaymentMethods({ selector: "#usage-methods" });
      const a = await w.renderAgreement({ selector: "#usage-agreement" });
      a.on("agreementStatusChange", (s) => setTerms(s.agreedRequiredTerms));
      setReady(true);
    } catch { setError(c.unavailable); }
  }
  async function pay() {
    if (!consent || terms === false || busy) return;
    setBusy(true);
    setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      const created = await post("order.create", { caseId: props.caseId, requestId: requestId.current, consent: true });
      if (!created || created.order.amountKrw !== props.amount) throw new Error();
      if (props.kind === "fake") {
        const confirmed = await post("order.confirm", { orderId: created.order.id, amount: created.order.amountKrw });
        if (!confirmed) throw new Error();
        window.location.assign(confirmed.href);
        return;
      }
      try { window.sessionStorage.setItem(USAGE_RETURN_KEY, created.order.id); } catch { /* the return page still reads the URL */ }
      await widgets.current!.requestPayment({
        orderId: created.order.id, orderName: created.order.name,
        successUrl: `${window.location.origin}/brand/usage/return`,
        failUrl: `${window.location.origin}/brand/projects/${props.projectId}/usage/${props.caseId}/pay?failed=1`,
      });
    } catch {
      setError(c.failed);
      setBusy(false);
    }
  }
  return (
    <div data-usage-checkout className="bw-panel">
      {props.kind !== "fake" && <Script src="https://js.tosspayments.com/v2/standard" onReady={() => void initialize()} onError={() => setError(c.unavailable)} />}
      {props.kind !== "live" && <p className="bw-note" data-usage-test-mode>{props.kind === "fake" ? c.fake : c.test}</p>}
      <div id="usage-methods" />
      <div id="usage-agreement" />
      {!ready && !error && <p role="status">{c.preparing}</p>}
      <p className="bw-muted" data-usage-payment-notice>{c.notice}</p>
      <label className="bw-check"><input type="checkbox" data-usage-consent checked={consent} onChange={(e) => setConsent(e.target.checked)} />{c.consent}</label>
      {error && <p role="alert" className="bw-error">{error}</p>}
      <button type="button" className="bw-button bw-primary" data-usage-pay-submit onClick={() => void pay()} disabled={!ready || terms === false || !consent || busy}>
        {busy ? c.processing : interpolate(c.pay, { amount: formatKrw(props.amount, props.locale) })}
      </button>
    </div>
  );
}
