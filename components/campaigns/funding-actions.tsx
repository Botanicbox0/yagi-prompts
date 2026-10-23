"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { fundingCopy } from "@/messages/campaign-funding";
import { fundingWidgetMethodSupported } from "@/lib/campaigns/funding/payment-method";
import {
  observeFundingAgreement,
  type FundingAgreementWidget,
} from "@/lib/campaigns/funding/widget-agreement";

async function request(operation: string, input: unknown) {
  const response = await fetch("/api/campaign-funding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });
  return response.json().catch(() => ({ ok: false, code: "unavailable" }));
}
export function FundingAction({
  locale,
  operation,
  input,
  label,
  consent = false,
}: {
  locale: string;
  operation: "quote.accept" | "order.create";
  input: Record<string, unknown>;
  label: string;
  consent?: boolean;
}) {
  const t = fundingCopy(locale),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  return (
    <form
      className="mt-5 grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          requestId.current ??= crypto.randomUUID();
          const result = await request(operation, {
            ...input,
            ...(consent ? { consent: true } : { requestId: requestId.current }),
          });
          if (!result.ok) {
            setError(t.errors[result.code as keyof typeof t.errors] ?? t.error);
            return;
          }
          if (result.href) window.location.assign(result.href);
          else window.location.reload();
        } catch {
          setError(t.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      {consent && (
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" required className="mt-1" />
          {t.consent}
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <div>
        <button type="submit" disabled={busy} className="bw-button bw-primary">
          {busy ? t.processing : label}
        </button>
      </div>
    </form>
  );
}
interface Widgets {
  setAmount(v: { currency: string; value: number }): Promise<void>;
  renderPaymentMethods(v: {
    selector: string;
  }): Promise<{ getSelectedPaymentMethod(): Promise<{ code: string }> }>;
  renderAgreement(v: { selector: string }): Promise<FundingAgreementWidget>;
  requestPayment(v: {
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
  }): Promise<unknown>;
}
type TossWindow = Window & {
  TossPayments?: (key: string) => {
    widgets(v: { customerKey: string }): Widgets;
  };
};
export function FundingCheckout({
  locale,
  projectId,
  order,
  kind,
  clientKey,
  customerKey,
}: {
  locale: string;
  projectId: string;
  order: { id: string; name: string; amountKrw: number };
  kind: "test" | "fake" | "live";
  clientKey: string | null;
  customerKey: string;
}) {
  const t = fundingCopy(locale),
    widgets = useRef<Widgets | null>(null),
    methods = useRef<Awaited<
      ReturnType<Widgets["renderPaymentMethods"]>
    > | null>(null),
    initializing = useRef(false),
    [ready, setReady] = useState(kind === "fake"),
    [agreed, setAgreed] = useState(kind === "fake"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function initialize() {
    if (initializing.current) return;
    initializing.current = true;
    try {
      const init = (window as TossWindow).TossPayments;
      if (!init || !clientKey) throw Error();
      const w = init(clientKey).widgets({ customerKey });
      widgets.current = w;
      await w.setAmount({ currency: "KRW", value: order.amountKrw });
      methods.current = await w.renderPaymentMethods({
        selector: "#funding-methods",
      });
      const agreement = await w.renderAgreement({
        selector: "#funding-agreement",
      });
      await observeFundingAgreement(agreement, setAgreed);
      setReady(true);
    } catch {
      setError(t.error);
    }
  }
  async function pay() {
    if (busy || !ready || !agreed) return;
    setBusy(true);
    try {
      if (kind === "fake") {
        const r = await request("order.confirm", {
          orderId: order.id,
          projectId,
          amount: order.amountKrw,
        });
        if (!r.ok) throw Error();
        window.location.assign(`/brand/projects/${projectId}#payments`);
      } else {
        const selected = await methods.current?.getSelectedPaymentMethod();
        if (!selected || !fundingWidgetMethodSupported(selected.code)) {
          setError(t.supportedMethods);
          setBusy(false);
          return;
        }
        await widgets.current!.requestPayment({
          orderId: order.id,
          orderName: order.name,
          successUrl: `${window.location.origin}/brand/projects/${projectId}/funding/return`,
          failUrl: `${window.location.origin}/brand/projects/${projectId}/funding?failed=1`,
        });
      }
    } catch {
      setError(t.error);
      setBusy(false);
    }
  }
  return (
    <div className="mt-6" data-campaign-funding-checkout>
      {kind !== "fake" && (
        <Script
          src="https://js.tosspayments.com/v2/standard"
          onReady={() => void initialize()}
          onError={() => setError(t.error)}
        />
      )}
      <p className="my-4 text-sm font-semibold">
        {kind === "fake" ? t.fake : kind === "test" ? t.test : t.live}
      </p>
      <div id="funding-methods" />
      <div id="funding-agreement" />
      {kind !== "fake" && (
        <p className="my-4 text-sm leading-relaxed">{t.supportedMethods}</p>
      )}
      {!ready && !error && <p role="status">{t.preparing}</p>}
      <p className="my-4 text-sm leading-relaxed">{t.recordOnly}</p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="bw-button bw-primary"
        disabled={!ready || !agreed || busy}
        onClick={() => void pay()}
      >
        {busy ? t.processing : t.payNow}
      </button>
    </div>
  );
}
export function FundingReturn({
  locale,
  projectId,
}: {
  locale: string;
  projectId: string;
}) {
  const t = fundingCopy(locale),
    [message, setMessage] = useState(t.returnHint),
    [attempt, setAttempt] = useState<{
      orderId: string;
      paymentKey: string;
      amount: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    parsed = useRef(false);
  const href = `/brand/projects/${projectId}#payments`;
  useEffect(() => {
    if (parsed.current) return;
    parsed.current = true;
    const params = new URLSearchParams(window.location.search),
      orderId = params.get("orderId"),
      paymentKey = params.get("paymentKey"),
      amount = Number(params.get("amount"));
    window.history.replaceState(null, "", window.location.pathname);
    if (orderId && paymentKey && Number.isSafeInteger(amount) && amount > 0)
      setAttempt({ orderId, paymentKey, amount });
    else setMessage(t.pending);
  }, [t]);
  return (
    <div data-campaign-funding-return>
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-4 max-w-prose text-sm leading-relaxed" role="status">
        {message}
      </p>
      {attempt && (
        <button
          type="button"
          className="bw-button bw-primary mt-6"
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const r = await request("order.confirm", {
                ...attempt,
                projectId,
              });
              if (r.ok) {
                window.location.replace(href);
                return;
              }
              setMessage(
                t.errors[r.code as keyof typeof t.errors] ?? t.pending,
              );
            } catch {
              setMessage(t.pending);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t.processing : t.returnConfirm}
        </button>
      )}
      <a className="bw-button mt-6" href={href}>
        {t.refresh}
      </a>
    </div>
  );
}
export function FundingStatus({
  locale,
  projectId,
  orderId,
  status,
}: {
  locale: string;
  projectId: string;
  orderId: string;
  status: string;
}) {
  const t = fundingCopy(locale),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div>
      <button
        type="button"
        className="bw-button"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            const result = await request("order.status", {
              projectId,
              orderId,
            });
            if (!result.ok) throw Error();
            if (result.status !== status) {
              window.location.reload();
              return;
            }
            setMessage(t.pending);
          } catch {
            setMessage(t.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t.processing : t.refresh}
      </button>
      {message && (
        <p role="status" className="mt-2 max-w-prose text-sm leading-relaxed">
          {message}
        </p>
      )}
    </div>
  );
}

export function RewardProposalForm({
  locale,
  projectId,
  campaigns,
}: {
  locale: string;
  projectId: string;
  campaigns: Array<{ id: string; title: { en: string; ko: string } }>;
}) {
  const t = fundingCopy(locale),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    requestId = useRef<string | null>(null);
  return (
    <form
      className="bw-form mt-5 grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          requestId.current ??= crypto.randomUUID();
          const result = await request("reward.propose", {
            projectId,
            campaignId: form.get("campaignId"),
            requestId: requestId.current,
            amountKrw: Number(form.get("amountKrw")),
            conditions: String(form.get("conditions") ?? ""),
          });
          if (!result.ok) {
            setError(t.errors[result.code as keyof typeof t.errors] ?? t.error);
            return;
          }
          window.location.reload();
        } catch {
          setError(t.error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="grid gap-2 text-sm">
        {t.campaign}
        <select name="campaignId" required className="bw-input">
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {locale === "ko" ? c.title.ko : c.title.en}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm">
        {t.reward.amount}
        <input
          name="amountKrw"
          type="number"
          min={1}
          max={2147483647}
          step={1}
          inputMode="numeric"
          required
          className="bw-input"
        />
      </label>
      <label className="grid gap-2 text-sm">
        {t.reward.conditions}
        <textarea
          name="conditions"
          rows={4}
          required
          maxLength={4000}
          className="bw-input"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div>
        <button className="bw-button bw-primary" type="submit" disabled={busy}>
          {busy ? t.processing : t.reward.send}
        </button>
      </div>
    </form>
  );
}
