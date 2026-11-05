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

function toSlackHandle(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `@${slug || "brand"}`;
}

const QUICK_TOPICS_KO = [
  { label: "일정·납기 문의", text: "안녕하세요, 이번 캠페인 첫 시안(v1) 및 최종 납기 일정이 궁금합니다." },
  { label: "크리에이터 리스트", text: "캠페인에 매칭 가능한 추천 크리에이터 리스트를 받아볼 수 있을까요?" },
  { label: "견적·예산 상담", text: "예산 범위에 따른 제작 편수 및 시딩 구성을 상담하고 싶습니다." },
  { label: "시안 수정 피드백", text: "전달주신 시안 관련하여 추가 연출 피드백 드립니다: " },
] as const;

const QUICK_TOPICS_EN = [
  { label: "Timeline & Delivery", text: "Hi, could we check the schedule for Cut v1 and final delivery?" },
  { label: "Creator Lineup", text: "Could you share the recommended creator list for our campaign?" },
  { label: "Quote & Scope", text: "We'd like to discuss production volume and seeding options for our budget." },
  { label: "Cut Feedback", text: "Sharing additional direction feedback on the latest cut: " },
] as const;

export function SupportDrawer({
  organizations,
  b,
  locale,
}: {
  organizations: BrandOrganization[];
  b: BrandCopy;
  locale: string;
}) {
  const isKo = locale === "ko";
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
  const brandHandle = currentOrg ? toSlackHandle(currentOrg.name) : "@brand";
  const quickTopics = isKo ? QUICK_TOPICS_KO : QUICK_TOPICS_EN;

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

  // Live poll every 4s while the ChannelTalk/Sendbird widget is open so Slack replies appear in real time
  useEffect(() => {
    if (!isOpen || !organizationId) return;
    const timer = setInterval(() => {
      void refresh(organizationId, true);
    }, 4000);
    return () => clearInterval(timer);
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
          {isKo ? "실시간 문의" : "Live Concierge"}
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
              <p>
                {isKo
                  ? "전담 프로듀서와 1:1 실시간 연동됩니다"
                  : "Connected live with your dedicated YAGI PD"}
              </p>
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
              <span className="bw-concierge-tag">YAGI STUDIO DIRECT</span>
              <span className="bw-concierge-org-badge">{currentOrg?.name}</span>
            </div>
            <p>
              {isKo
                ? `${currentOrg?.name ?? "고객사"} 전용 실시간 문의창입니다. 메시지를 남기시면 전담 프로듀서에게 즉시 전달되며, 답변도 이곳으로 바로 도착합니다.`
                : `Direct line for ${currentOrg?.name ?? "your team"}. Messages go straight to our producers and replies appear here live.`}
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
          <div className="bw-concierge-quick-chips" aria-label={isKo ? "빠른 문의 선택" : "Quick inquiry topics"}>
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
              placeholder={
                isKo
                  ? "메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                  : "Type a message (Enter to send · Shift+Enter for new line)"
              }
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
