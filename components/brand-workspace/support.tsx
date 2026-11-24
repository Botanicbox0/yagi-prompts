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
import { OPEN_BRAND_SUPPORT_EVENT, resolveSupportOpenDetail } from "./support-trigger";

function toBrandHandle(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `@${slug || "brand"}`;
}

/** Where this browser remembers, per brand, the newest team reply the support window has shown. */
export function supportSeenStorageKey(organizationId: string): string {
  return `twings_brand_support_seen_v1:${organizationId}`;
}

function readSeen(organizationId: string): string | null {
  try {
    return window.localStorage.getItem(supportSeenStorageKey(organizationId));
  } catch {
    return null;
  }
}

function writeSeen(organizationId: string, at: string): void {
  try {
    window.localStorage.setItem(supportSeenStorageKey(organizationId), at);
  } catch {
    // Private mode or full storage: the dot still clears on this page.
  }
}

function timeOf(value: string | null): number | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

/** The later of two times; an unreadable one never wins (and alone gives null). */
function laterOf(a: string | null, b: string | null): string | null {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (tb === null) return ta === null ? null : a;
  if (ta === null) return b;
  return tb > ta ? b : a;
}

function newestStudioReply(messages: BrandMessage[]): string | null {
  let newest: string | null = null;
  for (const m of messages) if (m.authorRole === "studio") newest = laterOf(newest, m.createdAt);
  return newest;
}

/** A team reply this browser has not shown yet: there is one, and nothing readable was seen at or after it. */
function unseen(latest: string | null, seen: string | null): boolean {
  const l = timeOf(latest);
  if (l === null) return false;
  const s = timeOf(seen);
  return s === null || l > s;
}

export function SupportDrawer({
  organizations,
  b,
  locale,
  hasProjects = false,
}: {
  organizations: BrandOrganization[];
  b: BrandCopy;
  locale: string;
  /** The brand has at least one campaign: the campaign question chips apply. Without one, only the quote chip. */
  hasProjects?: boolean;
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
  // The newest team reply known for a brand, and the newest one this browser has shown (the dot: the first is later).
  const [teamReplies, setTeamReplies] = useState<{
    organizationId: string;
    latest: string | null;
    seen: string | null;
  } | null>(null);
  // The brand whose thread `messages` holds (it lags behind `organizationId` until a load answers).
  const loadedFor = useRef("");
  const titleId = useId();

  const currentOrg =
    organizations.find((o) => o.id === organizationId) ?? organizations[0];
  const brandHandle = currentOrg ? toBrandHandle(currentOrg.name) : "@brand";
  const quoteTopic = { label: concierge.topics.quoteLabel, text: concierge.topics.quoteText };
  // A brand with no campaign yet is offered only the question that is already true for it.
  const quickTopics = hasProjects
    ? [
        { label: concierge.topics.timelineLabel, text: concierge.topics.timelineText },
        { label: concierge.topics.creatorsLabel, text: concierge.topics.creatorsText },
        quoteTopic,
        { label: concierge.topics.feedbackLabel, text: concierge.topics.feedbackText },
      ]
    : [quoteTopic];

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length, isOpen]);

  // One cheap read per brand shown: the newest team reply's time only, never the thread and never the
  // outside call the full read makes. Nothing polls while the window is closed; a failed read is no dot.
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/brand-workspace?organizationId=${encodeURIComponent(organizationId)}&peek=1`,
          { method: "GET", cache: "no-store", credentials: "same-origin", signal: controller.signal },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { ok?: unknown; latestStudioReplyAt?: unknown } | null;
        if (controller.signal.aborted || body?.ok !== true) return;
        const latest =
          typeof body.latestStudioReplyAt === "string" ? laterOf(null, body.latestStudioReplyAt) : null;
        const seen = readSeen(organizationId);
        setTeamReplies((current) =>
          current?.organizationId === organizationId
            ? { organizationId, latest: laterOf(current.latest, latest), seen: laterOf(current.seen, seen) }
            : { organizationId, latest, seen },
        );
      } catch {
        // Unknown: no dot.
      }
    })();
    return () => controller.abort();
  }, [organizationId]);

  // While the window is open, every team reply it has shown counts as seen, here and in this browser's storage.
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    const own = teamReplies?.organizationId === organizationId ? teamReplies : null;
    const shown = loadedFor.current === organizationId ? newestStudioReply(messages) : null;
    const latest = laterOf(own?.latest ?? null, shown);
    const seen = laterOf(own ? own.seen : readSeen(organizationId), latest);
    const stored = readSeen(organizationId);
    const keep = laterOf(stored, seen);
    if (keep && keep !== stored) writeSeen(organizationId, keep);
    if (!own || own.latest !== latest || own.seen !== seen) {
      setTeamReplies({ organizationId, latest, seen });
    }
  }, [isOpen, organizationId, messages, teamReplies]);

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
        loadedFor.current = id;
        setMessages(data.messages);
        setLoad("ready");
        return true;
      } catch {
        if (!silent) setLoad("failed");
        return false;
      }
    },
    [organizationId],
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

  const openWith = useCallback(
    (targetOrgId: string, nextDraft: string | null) => {
      setOrg(targetOrgId);
      if (nextDraft !== null) setDraft(nextDraft);
      setIsOpen(true);
      if (dialog.current && !dialog.current.open) {
        dialog.current.show();
      }
      setBusy(true);
      setNotice("");
      void refresh(targetOrgId, false).finally(() => setBusy(false));
      if (nextDraft !== null) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [refresh],
  );

  useEffect(() => {
    if (!organizations.length || typeof window === "undefined") return;
    const onOpen = (event: Event) => {
      event.preventDefault();
      const detail = event instanceof CustomEvent ? event.detail : null;
      const resolved = resolveSupportOpenDetail(detail, organizations, organizationId);
      openWith(resolved.organizationId, resolved.draft);
    };
    window.addEventListener(OPEN_BRAND_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BRAND_SUPPORT_EVENT, onOpen);
  }, [openWith, organizationId, organizations]);

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
          input: {
            body,
            organizationId,
            requestId: attempt.current.id,
            surface: "support_drawer",
          },
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

  // The dot is the launcher's only signal (no count: nothing is known before the window opens but the newest
  // reply's time): a team reply this browser has not shown yet for the brand shown.
  const ownReplies = teamReplies?.organizationId === organizationId ? teamReplies : null;
  const newReply = !isOpen && ownReplies !== null && unseen(ownReplies.latest, ownReplies.seen);
  const canWrite = Boolean(currentOrg);

  return (
    <>
      <button
        type="button"
        className={`bw-support-launch ${isOpen ? "bw-support-launch-open" : ""}`}
        onClick={toggleWidget}
        aria-label={newReply ? b.managed.supportNewReply : b.managed.support}
        aria-expanded={isOpen}
        data-concierge-launcher
      >
        {newReply ? <span className="bw-support-launch-dot" aria-hidden="true" data-concierge-new /> : null}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h16v12H9l-5 4V4Z" />
          <path d="M8 8h8M8 12h5" />
        </svg>
        <span className="bw-support-launch-label">
          {concierge.launcher}
        </span>
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
                <span className="bw-concierge-pill">
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
