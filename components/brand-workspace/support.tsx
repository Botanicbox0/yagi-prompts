"use client";
import { useRef, useState, useEffect, type FormEvent } from "react";
import type {
  BrandOrganization,
  BrandMessage,
} from "@/lib/brands/workspace/types";
import type { BrandCopy } from "./action-form";
import { formatBrandTimestamp } from "./format";
export function SupportDrawer({
  organizations,
  b,
  locale,
}: {
  organizations: BrandOrganization[];
  b: BrandCopy;
  locale: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    attempt = useRef<{
      body: string;
      organizationId: string;
      id: string;
    } | null>(null);
  const [organizationId, setOrg] = useState(organizations[0]?.id ?? ""),
    [messages, setMessages] = useState<BrandMessage[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages]);
  if (!organizations.length) return null;
  async function refresh(id = organizationId) {
    setBusy(true);
    setError(false);
    try {
      const r = await fetch(
        `/api/brand-workspace?organizationId=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      if (!r.ok || !data.ok) throw Error();
      setMessages(data.messages);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget,
      body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return;
    if (
      attempt.current?.body !== body ||
      attempt.current.organizationId !== organizationId
    )
      attempt.current = { body, organizationId, id: crypto.randomUUID() };
    setBusy(true);
    setError(false);
    try {
      const r = await fetch("/api/brand-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "support.send",
          input: { body, organizationId, requestId: attempt.current.id },
        }),
      });
      const result = await r.json();
      if (!r.ok || !result.ok) throw Error();
      attempt.current = null;
      form.reset();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="bw-support-launch"
        onClick={() => {
          dialog.current?.showModal();
          void refresh();
        }}
        aria-label={b.managed.support}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H9l-5 4V4Z" />
          <path d="M8 8h8M8 12h5" />
        </svg>
      </button>
      <dialog ref={dialog} className="bw-support-dialog">
        <header>
          <div>
            <strong>{b.managed.support}</strong>
            <p>{b.managed.supportHint}</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label={b.managed.close}
          >
            ×
          </button>
        </header>
        <div className="bw-support-tools">
          <select
            aria-label={b.organization}
            value={organizationId}
            disabled={busy}
            onChange={(e) => {
              setOrg(e.target.value);
              setMessages([]);
              void refresh(e.target.value);
            }}
          >
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            {b.managed.refresh}
          </button>
        </div>
        <div ref={list} className="bw-support-messages" aria-live="polite">
          {!messages.length && (
            <p className="bw-muted">{b.managed.supportEmpty}</p>
          )}
          {messages.map((m) => (
            <article
              className="bw-support-bubble"
              data-author={m.authorRole}
              key={m.id}
            >
              <strong>
                {m.authorRole === "studio"
                  ? b.dashboard.studio
                  : organizations.find((o) => o.id === organizationId)?.name}
              </strong>
              <p>{m.body}</p>
              <time>{formatBrandTimestamp(m.createdAt, locale)}</time>
            </article>
          ))}
        </div>
        {error && (
          <p role="alert" className="bw-error">
            {b.error}
          </p>
        )}
        {organizations.find((o) => o.id === organizationId)?.role !==
          "viewer" && (
          <form onSubmit={send}>
            <label className="sr-only" htmlFor="support-message">
              {b.managed.message}
            </label>
            <textarea
              id="support-message"
              name="body"
              required
              maxLength={4000}
              placeholder={b.managed.message}
              disabled={busy}
            />
            <button className="bw-button bw-primary" disabled={busy}>
              {busy ? b.working : b.send}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
