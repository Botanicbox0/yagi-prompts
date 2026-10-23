"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { getDictionary } from "@/lib/i18n/dictionaries";
/** The production result page, with the brand it belongs to so the workspace keeps that brand selected. */
export function productionResultHref(id: string, organizationId: string | null, locale: string): string {
  const query = new URLSearchParams(organizationId ? { organizationId, locale } : { locale });
  return `/brand/studio/${encodeURIComponent(id)}?${query}`;
}
type T = ReturnType<typeof getDictionary>["brandWorkspace"]["productionStudio"];
export function ProductionCreate({
  contractId,
  organizationId = null,
  templateId,
  selfieId,
  locale,
  t,
  disabled,
}: {
  contractId: string;
  /** The selected brand, kept on the result page link so it opens without a brand re-selection. */
  organizationId?: string | null;
  templateId: string;
  selfieId: string | null;
  locale: string;
  t: T;
  disabled: boolean;
}) {
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef("");
  useEffect(() => setReady(true), []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    request.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/brand-production", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId,
          templateId,
          selfieId,
          requestId: request.current,
          locale,
          ownFaceConfirmed:
            new FormData(e.currentTarget).get("ownFace") === "on",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(
          t.errors[data.code as keyof typeof t.errors] ?? t.errors.unavailable,
        );
        setBusy(false);
        return;
      }
      window.location.assign(productionResultHref(String(data.id), organizationId, locale));
    } catch {
      setError(t.errors.unavailable);
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      method="post"
      className="bw-production-create"
      aria-busy={busy}
    >
      <label className="bw-check">
        <input
          type="checkbox"
          name="ownFace"
          required
          disabled={disabled || busy || !ready}
        />
        <span>{t.ownFace}</span>
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className="bw-button bw-primary"
        disabled={disabled || busy || !ready}
      >
        {busy ? t.starting : t.create}
      </button>
    </form>
  );
}
