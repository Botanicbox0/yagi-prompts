"use client";
import { useEffect, useRef, useState } from "react";
import type { BrandCopy } from "./action-form";
import { USAGE_RETURN_KEY } from "./usage-checkout";

const ORDER_ID = /^[0-9a-f-]{36}$/i;
/**
 * The provider's parameters carry the payment key: they leave the URL at once and are never shown.
 * A reload never re-confirms; it reads the order's status (which also runs the recovery pass).
 */
export function UsageReturn({ copy: c }: { copy: BrandCopy["secondaryUsage"]["payment"] }) {
  const started = useRef(false);
  const [message, setMessage] = useState(c.processing);
  const [href, setHref] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const p = new URLSearchParams(window.location.search);
    const id = p.get("orderId") ?? "";
    const body = { orderId: id, paymentKey: p.get("paymentKey"), amount: Number(p.get("amount")) };
    window.history.replaceState(null, "", window.location.pathname);
    const status = async (orderId: string) => {
      const r = await fetch(`/api/brand-workspace/usage?orderId=${encodeURIComponent(orderId)}`).catch(() => null);
      const result = r && r.ok ? await r.json().catch(() => null) : null;
      if (typeof result?.href === "string") setHref(result.href);
      setMessage(result?.status === "paid" ? c.success : c.pending);
    };
    if (!ORDER_ID.test(id)) {
      let remembered = "";
      try { remembered = window.sessionStorage.getItem(USAGE_RETURN_KEY) ?? ""; } catch { /* storage unavailable */ }
      if (ORDER_ID.test(remembered)) void status(remembered);
      else setMessage(c.pending);
      return;
    }
    void fetch("/api/brand-workspace/usage", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "order.confirm", input: body }),
    }).then(async (r) => {
      const result = await r.json().catch(() => null);
      if (r.ok && result?.ok && typeof result.href === "string") { window.location.replace(result.href); return; }
      await status(id);
    }).catch(() => status(id));
  }, [c]);
  return (
    <div data-usage-return>
      <h1 role="status">{message}</h1>
      {href && <a className="bw-button" href={href}>{c.back} →</a>}
    </div>
  );
}
