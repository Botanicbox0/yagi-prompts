"use client";
import {
  useId,
  useRef,
  useState,
  useEffect,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  BrandOrganization,
  BrandMessage,
} from "@/lib/brands/workspace/types";
import type { BrandCopy } from "./action-form";
import { formatBrandTimestamp } from "./format";

function toBrandHandle(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `@${slug || "brand"}`;
}

export function SupportDrawer({
  organizations,
  b,
  locale,
}: {
  organizations: BrandOrganization[];
  b: BrandCopy;
  locale: string;
}) {
  const concierge = b.managed.concierge;
  const list = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attempt = useRef<{
    body: string;
    organizationId: string;
    id: string;
  } | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [organizationId, setOrg] = useState(organizations[0]?.id ?? "");
  const [messages, setMessages] = useState<BrandMessage[]>([]);
  // "idle" until first opened; the empty invitation only shows once a load has actually answered.
  const [load, setLoad] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [seenCount, setSeenCount] = useState(0);
  const titleId = useId();

  const currentOrg =
    organizations.find((o) => o.id === organizationId) ?? organizations[0];
  const brandHandle = currentOrg ? toBrandHandle(currentOrg.name) : "@brand";
  const quickTopics = [
    { label: concierge.topics.timelineLabel, text: concierge.topics.timelineText },
    { label: concierge.topics.creatorsLabel, text: concierge.topics.creatorsText },
    { label: concierge.topics.quoteLabel, text: concierge.topics.quoteText },
    { label: concierge.topics.feedbackLabel, text: concierge.topics.feedbackText },
  ];

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length, isOpen]);

  const refresh = useCallback(
    async (id = organizationId, silent = false): Promise<boolean> => {
      if (!id) return false;
      if (!silent) setLoad("loading");
      try {
        const r = await fetch(
          `/api/brand-workspace?organizationId=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const data = await r.json();
        if (!r.ok || !data.ok) throw Error();
        setMessages(data.messages);
        setLoad("ready");
        if (isOpen) {
          setSeenCount(data.messages.length);
        }
        return true;
      } catch {
        if (!silent) setLoad("failed");
        return false;
      }
    },
    [organizationId, isOpen],
  );

  // Live poll every 4s while the ChannelTalk/Sendbird widget is open and tab is visible
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refresh(organizationId, true);
    }, 4000);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void refresh(organizationId, true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isOpen, organizationId, refresh]);

  if (!organizations.length) return null;

  async function reload(id = organizationId) {
    setBusy(true);
    setNotice("");
    await refresh(id, false);
    setBusy(false);
  }

  function openWidget() {
    setIsOpen(true);
    if (dialog.current && !dialog.current.open) {
      dialog.current.show();
    }
    void reload();
  }

  function closeWidget() {
    setIsOpen(false);
    dialog.current?.close();
  }

  function toggleWidget() {
    if (isOpen) closeWidget();
    else openWidget();
  }

  async function submitMessage(rawBody: string) {
    if (busy) return;
    const body = rawBody.trim();
    if (!body) return;
    if (
      attempt.current?.body !== body ||
      attempt.current.organizationId !== organizationId
    ) {
      attempt.current = { body, organizationId, id: crypto.randomUUID() };
    }
    setBusy(true);
    setNotice("");
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
      if (!r.ok || !result.ok) {
        setNotice(
          result.code === "rate_limited" ? b.errors.rateLimited : b.error,
        );
        return;
      }
      attempt.current = null;
      setDraft("");
      // The message is stored; a failed reload must not read as a failed send.
      if (!(await refresh(organizationId, true))) {
        setNotice(b.managed.supportSentNotLoaded);
      }
    } catch {
      setNotice(b.error);
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formBody = String(new FormData(form).get("body") ?? "");
    await submitMessage(draft || formBody);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitMessage(draft);
    }
  }

  function applyQuickTopic(text: string) {
    setDraft(text);
    textareaRef.current?.focus();
  }

  const unreadCount = Math.max(0, messages.length - seenCount);
  const canWrite = currentOrg?.role !== "viewer";

  return (
    <>
      <button
        type="button"
        className={`bw-support-launch ${isOpen ? "bw-support-launch-open" : ""}`}
        onClick={toggleWidget}
        aria-label={b.managed.support}
        aria-expanded={isOpen}
        data-concierge-launcher
      >
        <span className="bw-support-launch-dot" aria-hidden="true" />
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H9l-5 4V4Z" />
          <path d="M8 8h8M8 12h5" />
        </svg>
        <span className="bw-support-launch-label">
          {concierge.launcher}
        </span>
        {!isOpen && unreadCount > 0 && (
          <span className="bw-support-unread" data-concierge-unread>
            {unreadCount}
          </span>
        )}
      </button>

      <dialog
        ref={dialog}
        open={isOpen}
        className="bw-support-dialog"
        aria-labelledby={titleId}
        data-support-dialog
        data-concierge-handle={brandHandle}
      >
        <header className="bw-concierge-header">
          <div className="bw-concierge-brand">
            <div className="bw-concierge-avatar" aria-hidden="true">
              <span>Y</span>
              <i className="bw-concierge-online" />
            </div>
            <div>
              <div className="bw-concierge-title-row">
                <strong id={titleId}>{b.managed.support}</strong>
                <span className="bw-concierge-slack-pill">
                  1:1 · {brandHandle}
                </span>
              </div>
              <p>{concierge.subtitle}</p>
            </div>
          </div>
          <div className="bw-concierge-header-actions">
            <button
              type="button"
              className="bw-concierge-icon-btn"
              disabled={busy}
              onClick={() => void reload()}
              title={b.managed.refresh}
              aria-label={b.managed.refresh}
            >
              ↻
            </button>
            <button
              type="button"
              className="bw-concierge-icon-btn"
              onClick={closeWidget}
              aria-label={b.managed.close}
            >
              ×
            </button>
          </div>
        </header>

        {organizations.length > 1 && (
          <div className="bw-support-tools">
            <select
              aria-label={b.organization}
              value={organizationId}
              disabled={busy}
              onChange={(e) => {
                setOrg(e.target.value);
                setMessages([]);
                void reload(e.target.value);
              }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => void reload()}>
              {b.managed.refresh}
            </button>
          </div>
        )}

        <div
          ref={list}
          className="bw-support-messages"
          aria-live="polite"
          aria-busy={load === "loading"}
          data-support-state={load}
        >
          {/* Welcome card inside messenger */}
          <div className="bw-concierge-welcome">
            <div className="bw-concierge-welcome-top">
              <span className="bw-concierge-tag">{concierge.tag}</span>
              <span className="bw-concierge-org-badge">{currentOrg?.name}</span>
            </div>
            <p>
              {concierge.welcome.replace(
                "{org}",
                currentOrg?.name ?? concierge.defaultOrg,
              )}
            </p>
          </div>

          {load === "loading" && !messages.length && (
            <p className="bw-muted" role="status">
              {b.managed.supportLoading}
            </p>
          )}
          {load === "failed" && (
            <p className="bw-error" role="alert">
              {b.managed.supportLoadFailed}
            </p>
          )}
          {load === "ready" && !messages.length && (
            <p className="bw-muted">{b.managed.supportEmpty}</p>
          )}
          {messages.map((m) => (
            <article
              className="bw-support-bubble"
              data-author={m.authorRole}
              key={m.id}
            >
              <div className="bw-support-bubble-meta">
                <strong>
                  {m.authorRole === "studio"
                    ? b.dashboard.studio
                    : currentOrg?.name}
                </strong>
                <time>{formatBrandTimestamp(m.createdAt, locale)}</time>
              </div>
              <p>{m.body}</p>
            </article>
          ))}
        </div>

        {canWrite && messages.length === 0 && (
          <div className="bw-concierge-quick-chips" aria-label={concierge.quickLabel}>
            {quickTopics.map((topic) => (
              <button
                key={topic.label}
                type="button"
                className="bw-concierge-chip"
                onClick={() => applyQuickTopic(topic.text)}
              >
                {topic.label}
              </button>
            ))}
          </div>
        )}

        {notice && (
          <p role="alert" className="bw-error bw-concierge-notice">
            {notice}
          </p>
        )}

        {canWrite && (
          <form onSubmit={send} className="bw-concierge-composer">
            <label className="sr-only" htmlFor="support-message">
              {b.managed.message}
            </label>
            <textarea
              ref={textareaRef}
              id="support-message"
              name="body"
              rows={2}
              required
              maxLength={4000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={concierge.placeholder}
              disabled={busy}
            />
            <button
              type="submit"
              className="bw-button bw-primary bw-concierge-send"
              disabled={busy}
            >
              {busy ? b.working : b.send}
            </button>
          </form>
        )}
      </dialog>
    </>
  );
}
