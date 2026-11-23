"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { studioShareDialogEn, studioShareDialogKo } from "@/messages/studio-share-dialog";

export const OPEN_SHARE_REVIEW_EVENT = "twings:open-share-review";

export interface ShareReviewTarget {
  organizationId: string;
  reviewId?: string | null;
  assetId?: string | null;
  outputId?: string | null;
  title?: string;
}

export function normalizeShareReviewDetail(raw: unknown, fallbackOrganizationId: string): ShareReviewTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const nestedRef =
    (obj.ref && typeof obj.ref === "object" ? (obj.ref as Record<string, unknown>) : null) ??
    (obj.source && typeof obj.source === "object" ? (obj.source as Record<string, unknown>) : null);

  let assetId = typeof obj.assetId === "string" ? obj.assetId : typeof nestedRef?.assetId === "string" ? nestedRef.assetId : null;
  let outputId = typeof obj.outputId === "string" ? obj.outputId : typeof nestedRef?.outputId === "string" ? nestedRef.outputId : null;
  const reviewId = typeof obj.reviewId === "string" ? obj.reviewId : null;

  if (!assetId && !outputId && typeof obj.key === "string") {
    if (obj.key.startsWith("a:")) assetId = obj.key.slice(2);
    else if (obj.key.startsWith("o:")) outputId = obj.key.slice(2);
  }

  if (!reviewId && !assetId && !outputId) return null;

  const organizationId = typeof obj.organizationId === "string" && obj.organizationId ? obj.organizationId : fallbackOrganizationId;
  if (!organizationId) return null;

  const rawTitle =
    typeof obj.title === "string"
      ? obj.title
      : typeof obj.name === "string"
        ? obj.name
        : typeof obj.label === "string"
          ? obj.label
          : "";

  return {
    organizationId,
    reviewId,
    assetId,
    outputId,
    title: rawTitle.trim(),
  };
}

export function openShareReview(detail: ShareReviewTarget): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_SHARE_REVIEW_EVENT, { detail }));
}

export function useShareReviewEvent(organizationId: string, onOpen: (target: ShareReviewTarget) => void): void {
  const handlerRef = useRef(onOpen);
  handlerRef.current = onOpen;

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<unknown>;
      const target = normalizeShareReviewDetail(custom.detail, organizationId);
      if (target) handlerRef.current(target);
    };
    window.addEventListener(OPEN_SHARE_REVIEW_EVENT, listener);
    return () => window.removeEventListener(OPEN_SHARE_REVIEW_EVENT, listener);
  }, [organizationId]);
}

interface BridgeProject {
  id: string;
  title: string;
  status: string;
  isDefaultWorkspace: boolean;
}

interface BridgeContextResponse {
  ok: boolean;
  code?: string;
  canWrite?: boolean;
  roomsOpen?: boolean;
  review?: {
    id: string;
    title: string;
    status: string;
    projectId: string | null;
    reviewHref: string;
  } | null;
  projects?: BridgeProject[];
  shares?: Array<{
    id: string;
    expiresAt: string;
    allowComments: boolean;
    allowDownload: boolean;
    hasPassphrase: boolean;
    views: number;
  }>;
}

export interface ShareReviewDialogProps {
  target: ShareReviewTarget;
  locale?: "ko" | "en";
  onClose: () => void;
  onNavigate?: (href: string) => void;
}

const EXPIRY_OPTIONS = [7, 14, 30] as const;

async function postBridge(operation: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/brand-studio/share-bridge", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, input }),
  });
  return (await res.json()) as Record<string, unknown>;
}

const DIALOG_STYLES = `
.srd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(9, 9, 11, 0.36);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.srd-modal {
  width: min(580px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 24px;
  border-radius: 20px;
  background: var(--ys-surface, #111113);
  color: var(--ys-ink, #ededed);
  border: 1px solid var(--ys-line-strong, rgba(255, 255, 255, 0.18));
  box-shadow: var(--ys-float, inset 0 1px 0 0 rgba(255, 255, 255, 0.06));
  font-family: var(--bw-font, 'Pretendard Variable', Pretendard, 'Geist', -apple-system, BlinkMacSystemFont, sans-serif);
  box-sizing: border-box;
  display: grid;
  gap: 16px;
}
.srd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.srd-title {
  margin: 0;
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.035em;
  line-height: 1.25;
  color: var(--ys-ink, #ededed);
}
.srd-close {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: var(--ys-raised, #18181b);
  color: var(--ys-ink, #ededed);
  cursor: pointer;
}
.srd-close:hover {
  background: var(--ys-hover, #27272a);
}
.srd-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  background: var(--ys-panel, #18181b);
  border: 1px solid var(--ys-hairline, rgba(255, 255, 255, 0.08));
}
.srd-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.srd-card-title {
  margin: 0;
  font-size: 14.5px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--ys-ink, #ededed);
}
.srd-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ys-ink-secondary, rgba(255, 255, 255, 0.64));
}
.srd-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--ys-surface, #111113);
  color: var(--ys-ink, #ededed);
  font-family: var(--ys-mono, 'Geist Mono', ui-monospace, SFMono-Regular, monospace);
  font-size: 11.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.srd-field {
  display: grid;
  gap: 6px;
}
.srd-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ys-ink-secondary, rgba(255, 255, 255, 0.64));
}
.srd-input,
.srd-select,
.srd-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ys-hairline, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  background: var(--ys-input-bg, #111113);
  color: var(--ys-ink, #ededed);
  font: inherit;
  font-size: 13.5px;
  padding: 10px 12px;
}
.srd-textarea {
  min-height: 68px;
  resize: vertical;
  line-height: 1.45;
}
.srd-input::placeholder,
.srd-textarea::placeholder {
  color: var(--ys-placeholder, rgba(255, 255, 255, 0.42));
}
.srd-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.srd-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid var(--ys-hairline, rgba(255, 255, 255, 0.08));
  border-radius: 999px;
  background: var(--ys-surface, #111113);
  color: var(--ys-ink-secondary, rgba(255, 255, 255, 0.64));
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  cursor: pointer;
}
.srd-pill:hover:not(:disabled) {
  background: var(--ys-hover, #27272a);
  color: var(--ys-ink, #ededed);
}
.srd-pill[aria-pressed="true"] {
  background: var(--ys-active-bg, #ededed);
  color: var(--ys-active-fg, #09090b);
}
.srd-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.srd-expiry-group {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: var(--ys-surface, #111113);
}
.srd-expiry-btn {
  min-height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ys-ink-secondary, rgba(255, 255, 255, 0.64));
  font-family: var(--ys-mono, 'Geist Mono', ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.srd-expiry-btn[aria-pressed="true"] {
  background: var(--ys-active-bg, #ededed);
  color: var(--ys-active-fg, #09090b);
}
.srd-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--ys-accent, #ff58ae);
  color: var(--ys-on-accent, #09090b);
  box-shadow: var(--ys-cta-shadow, none);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  cursor: pointer;
}
.srd-primary:hover:not(:disabled) {
  background: var(--ys-accent-hover, #ff389f);
}
.srd-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: var(--ys-active-bg, #ededed);
  color: var(--ys-active-fg, #09090b);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-decoration: none;
  cursor: pointer;
}
.srd-secondary:hover:not(:disabled) {
  opacity: 0.88;
}
.srd-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 13px;
  border: 1px solid var(--ys-hairline, rgba(255, 255, 255, 0.08));
  border-radius: 999px;
  background: var(--ys-surface, #111113);
  color: var(--ys-ink, #ededed);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-decoration: none;
  cursor: pointer;
}
.srd-ghost:hover:not(:disabled) {
  background: var(--ys-hover, #27272a);
}
.srd-primary:disabled,
.srd-secondary:disabled,
.srd-ghost:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.srd-minted {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--ys-surface, #111113);
}
.srd-url {
  flex: 1 1 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ys-mono, 'Geist Mono', ui-monospace, SFMono-Regular, monospace);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ys-ink, #ededed);
}
.srd-error {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ys-danger, #f87171);
}
.srd-modal :is(button, a, input, select, textarea):focus-visible {
  outline: 2px solid var(--ys-focus, #ededed);
  outline-offset: 2px;
}
`;

export function ShareReviewDialog({ target, locale = "ko", onClose, onNavigate }: ShareReviewDialogProps) {
  const c = locale === "en" ? studioShareDialogEn : studioShareDialogKo;
  const headingId = useId();
  const [pieceTitle, setPieceTitle] = useState(() => target.title?.trim() || c.pieceFallback);
  const [allowComments, setAllowComments] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<(typeof EXPIRY_OPTIONS)[number]>(14);
  const [password, setPassword] = useState("");
  const [projects, setProjects] = useState<BridgeProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [chatNote, setChatNote] = useState("");
  const [knownReviewId, setKnownReviewId] = useState<string | null>(target.reviewId ?? null);
  const [activeShareCount, setActiveShareCount] = useState(0);
  const [mintedPath, setMintedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<"mint" | "review" | "chat" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback(
    (href: string) => {
      if (onNavigate) onNavigate(href);
      else if (typeof window !== "undefined") window.location.assign(href);
    },
    [onNavigate],
  );

  useEffect(() => {
    let cancelled = false;
    void postBridge("bridge.context", {
      organizationId: target.organizationId,
      reviewId: target.reviewId ?? null,
      assetId: target.assetId ?? null,
      outputId: target.outputId ?? null,
    })
      .then((raw) => {
        if (cancelled) return;
        const data = raw as unknown as BridgeContextResponse;
        if (!data.ok) return;
        if (data.review) {
          setKnownReviewId(data.review.id);
          if (!target.title && data.review.title) setPieceTitle(data.review.title);
          if (data.review.projectId) setSelectedProjectId(data.review.projectId);
        }
        if (Array.isArray(data.projects)) {
          setProjects(data.projects);
          setSelectedProjectId((prev) => {
            if (prev) return prev;
            const defaultRoom = data.projects?.find((p) => p.isDefaultWorkspace) ?? data.projects?.[0];
            return defaultRoom ? defaultRoom.id : "";
          });
        }
        if (Array.isArray(data.shares)) {
          setActiveShareCount(data.shares.length);
        }
      })
      .catch(() => {
        // Non-fatal: actions still work even if initial context fetch failed.
      });
    return () => {
      cancelled = true;
    };
  }, [target.assetId, target.organizationId, target.outputId, target.reviewId, target.title]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fullShareUrl =
    mintedPath && typeof window !== "undefined" && window.location?.origin
      ? `${window.location.origin}${mintedPath}`
      : mintedPath;

  const handleMintShare = async () => {
    const trimmedPw = password.trim();
    if (trimmedPw.length > 0 && trimmedPw.length < 4) {
      setError(c.errorPasswordShort);
      return;
    }
    setError(null);
    setBusyAction("mint");
    try {
      const res = await postBridge("bridge.create_share", {
        organizationId: target.organizationId,
        reviewId: knownReviewId,
        assetId: knownReviewId ? null : (target.assetId ?? null),
        outputId: knownReviewId ? null : (target.outputId ?? null),
        title: pieceTitle.trim() || c.pieceFallback,
        projectId: selectedProjectId || null,
        allowComments,
        allowDownload,
        password: trimmedPw || null,
        expiresInDays,
        postToChat: false,
      });
      if (!res.ok || typeof res.shareUrl !== "string") {
        setError(c.errorGeneric);
        return;
      }
      if (typeof res.reviewId === "string") setKnownReviewId(res.reviewId);
      if (typeof res.projectId === "string" && !selectedProjectId) setSelectedProjectId(res.projectId);
      setMintedPath(res.shareUrl);
      setActiveShareCount((n) => n + 1);
      setCopied(false);
    } catch {
      setError(c.errorGeneric);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyUrl = async () => {
    if (!fullShareUrl) return;
    try {
      await navigator.clipboard.writeText(fullShareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleOpenPrecisionReview = async () => {
    setError(null);
    if (knownReviewId) {
      navigate(`/brand/studio/review?organizationId=${encodeURIComponent(target.organizationId)}&review=${encodeURIComponent(knownReviewId)}`);
      return;
    }
    setBusyAction("review");
    try {
      const res = await postBridge("bridge.ensure_review", {
        organizationId: target.organizationId,
        assetId: target.assetId ?? null,
        outputId: target.outputId ?? null,
        title: pieceTitle.trim() || c.pieceFallback,
      });
      if (!res.ok || typeof res.reviewHref !== "string") {
        setError(c.errorGeneric);
        return;
      }
      navigate(res.reviewHref);
    } catch {
      setError(c.errorGeneric);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSendToChat = async () => {
    setError(null);
    setBusyAction("chat");
    try {
      const res = await postBridge("bridge.post_chat", {
        organizationId: target.organizationId,
        reviewId: knownReviewId,
        assetId: knownReviewId ? null : (target.assetId ?? null),
        outputId: knownReviewId ? null : (target.outputId ?? null),
        title: pieceTitle.trim() || c.pieceFallback,
        projectId: selectedProjectId || null,
        chatNote: chatNote.trim() || null,
      });
      if (!res.ok || typeof res.roomChatHref !== "string") {
        setError(c.errorGeneric);
        return;
      }
      navigate(res.roomChatHref);
    } catch {
      setError(c.errorGeneric);
    } finally {
      setBusyAction(null);
    }
  };

  const content = (
    <div
      className="srd-backdrop"
      data-share-review-dialog
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{DIALOG_STYLES}</style>
      <div className="srd-modal" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="srd-head">
          <h2 id={headingId} className="srd-title">
            {c.heading}
          </h2>
          <button type="button" className="srd-close" aria-label={c.close} onClick={onClose} data-share-bridge-close>
            ×
          </button>
        </div>

        <label className="srd-field">
          <span className="srd-label">{c.titleLabel}</span>
          <input
            type="text"
            className="srd-input"
            maxLength={120}
            value={pieceTitle}
            onChange={(e) => setPieceTitle(e.target.value)}
            data-share-bridge-title
          />
        </label>

        {/* 1. External /s/[token] share link */}
        <section className="srd-card" data-share-bridge-link-section>
          <div className="srd-card-head">
            <h3 className="srd-card-title">{c.shareHeading}</h3>
            {activeShareCount > 0 && (
              <span className="srd-badge">
                {activeShareCount === 1
                  ? c.activeLinksOne
                  : c.activeLinksCount.replace("{count}", String(activeShareCount))}
              </span>
            )}
          </div>
          <p className="srd-sub">{c.shareSub}</p>

          <div className="srd-toggles">
            <button
              type="button"
              className="srd-pill"
              aria-pressed={allowComments}
              onClick={() => setAllowComments((v) => !v)}
              data-share-bridge-allow-comments
            >
              {c.allowComments}
            </button>
            <button
              type="button"
              className="srd-pill"
              aria-pressed={allowDownload}
              onClick={() => setAllowDownload((v) => !v)}
              data-share-bridge-allow-download
            >
              {c.allowDownload}
            </button>
          </div>

          <div className="srd-row">
            <span className="srd-label">{c.expiryLabel}</span>
            <div className="srd-expiry-group" role="group" aria-label={c.expiryLabel}>
              {EXPIRY_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  className="srd-expiry-btn"
                  aria-pressed={expiresInDays === days}
                  onClick={() => setExpiresInDays(days)}
                  data-share-bridge-expiry={days}
                >
                  {c.daysUnit.replace("{days}", String(days))}
                </button>
              ))}
            </div>
          </div>

          <label className="srd-field">
            <span className="srd-label">{c.passwordLabel}</span>
            <input
              type="password"
              className="srd-input"
              maxLength={64}
              placeholder={c.passwordPlaceholder}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-share-bridge-password
            />
          </label>

          <div className="srd-row">
            <button
              type="button"
              className="srd-primary"
              disabled={busyAction !== null}
              onClick={() => void handleMintShare()}
              data-share-bridge-mint
            >
              {busyAction === "mint" ? c.minting : c.mintCta}
            </button>
          </div>

          {mintedPath && fullShareUrl && (
            <div className="srd-minted" data-share-bridge-minted>
              <code className="srd-url" data-share-bridge-url>
                {fullShareUrl}
              </code>
              <button type="button" className="srd-ghost" onClick={() => void handleCopyUrl()} data-share-bridge-copy>
                {copied ? c.copiedBtn : c.copyBtn}
              </button>
              <a className="srd-ghost" href={mintedPath} target="_blank" rel="noopener noreferrer">
                {c.openShareTab}
              </a>
            </div>
          )}
        </section>

        {/* 2. Frame.io-grade precision review stage */}
        <section className="srd-card" data-share-bridge-review-section>
          <h3 className="srd-card-title">{c.reviewHeading}</h3>
          <p className="srd-sub">{c.reviewSub}</p>
          <div>
            <button
              type="button"
              className="srd-secondary"
              disabled={busyAction !== null}
              onClick={() => void handleOpenPrecisionReview()}
              data-share-bridge-open-review
            >
              {busyAction === "review" ? c.openingReview : c.openReviewCta}
            </button>
          </div>
        </section>

        {/* 3. Send to client & team room conversation */}
        <section className="srd-card" data-share-bridge-chat-section>
          <h3 className="srd-card-title">{c.chatHeading}</h3>
          <p className="srd-sub">{c.chatSub}</p>

          <label className="srd-field">
            <span className="srd-label">{c.roomSelectLabel}</span>
            <select
              className="srd-select"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              data-share-bridge-project-select
            >
              <option value="">{c.defaultRoomOption}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          <textarea
            className="srd-textarea"
            maxLength={2000}
            placeholder={c.notePlaceholder}
            value={chatNote}
            onChange={(e) => setChatNote(e.target.value)}
            data-share-bridge-chat-note
          />

          <div>
            <button
              type="button"
              className="srd-secondary"
              disabled={busyAction !== null}
              onClick={() => void handleSendToChat()}
              data-share-bridge-send-chat
            >
              {busyAction === "chat" ? c.sendingChat : c.sendChatCta}
            </button>
          </div>
        </section>

        {error && (
          <p className="srd-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
