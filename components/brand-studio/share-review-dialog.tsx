"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

const COPY = {
  ko: {
    heading: "검수 · 외부 공유 · 대화방 연결",
    close: "닫기",
    pieceFallback: "스튜디오 작업물",
    titleLabel: "검수 제목",
    shareHeading: "무로그인 공유 링크 발급 (/s/...)",
    shareSub: "계정이 없는 외부 담당자도 링크 하나로 재생하고 피드백을 남길 수 있습니다.",
    allowComments: "타임코드·화면 그리기 코멘트 허용",
    allowDownload: "다운로드 허용",
    expiryLabel: "만료 기간",
    daysUnit: (d: number) => `${d}일`,
    passwordLabel: "비밀번호 (선택)",
    passwordPlaceholder: "비워두면 비밀번호 없음 (4~64자)",
    mintCta: "공유 링크 발급",
    minting: "발급 중…",
    copyBtn: "링크 복사",
    copiedBtn: "복사됨",
    openShareTab: "새 창으로 열기",
    activeLinksCount: (n: number) => `활성 공유 링크 ${n}개`,
    reviewHeading: "정밀 검수 화면 열기",
    reviewSub: "타임코드 구간 코멘트, 화면 위 펜·화살표 그리기, 버전 나란히 비교(A/B)로 검토합니다.",
    openReviewCta: "정밀 검수 화면 열기 →",
    openingReview: "여는 중…",
    chatHeading: "고객사 · 팀 대화방으로 보내기",
    chatSub: "프로젝트 대화방에 시안 카드를 올리고 바로 대화를 이어갑니다.",
    roomSelectLabel: "연결할 프로젝트 룸",
    defaultRoomOption: "스튜디오 공유 · 검수함 (자동 연결)",
    notePlaceholder: "함께 전달할 메모 (선택 — 예: 00:04 제품 클로즈업 톤 확인 부탁드립니다)",
    sendChatCta: "대화방으로 보내고 열기 →",
    sendingChat: "보내는 중…",
    errorPasswordShort: "비밀번호는 4자 이상 입력해 주세요.",
    errorGeneric: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  },
  en: {
    heading: "Review, Share Link & Client Chat",
    close: "Close",
    pieceFallback: "Studio deliverable",
    titleLabel: "Review title",
    shareHeading: "No-login share link (/s/...)",
    shareSub: "External stakeholders can play and leave frame-accurate feedback without signing in.",
    allowComments: "Allow timecode & frame drawing comments",
    allowDownload: "Allow file download",
    expiryLabel: "Expires in",
    daysUnit: (d: number) => `${d}d`,
    passwordLabel: "Passphrase (optional)",
    passwordPlaceholder: "Leave blank for open link (4–64 chars)",
    mintCta: "Create share link",
    minting: "Creating…",
    copyBtn: "Copy link",
    copiedBtn: "Copied",
    openShareTab: "Open link",
    activeLinksCount: (n: number) => `${n} active share link${n === 1 ? "" : "s"}`,
    reviewHeading: "Open precision review stage",
    reviewSub: "Timecode range notes, pen & arrow frame markup, and synchronized A/B version compare.",
    openReviewCta: "Open review stage →",
    openingReview: "Opening…",
    chatHeading: "Send to client & team conversation",
    chatSub: "Post this deliverable card to a project room and jump straight into chat.",
    roomSelectLabel: "Project room",
    defaultRoomOption: "Studio Share & Review Inbox (auto)",
    notePlaceholder: "Optional note (e.g. Please check the packshot lighting at 00:04)",
    sendChatCta: "Post & open chat →",
    sendingChat: "Sending…",
    errorPasswordShort: "Passphrase must be at least 4 characters.",
    errorGeneric: "Could not complete this request right now. Please try again.",
  },
} as const;

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
  background: #ffffff;
  color: #09090b;
  box-shadow: 0 24px 60px rgba(9, 9, 11, 0.16);
  font-family: 'Geist', 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, sans-serif;
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
  color: #09090b;
}
.srd-close {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: #f4f4f5;
  color: #09090b;
  cursor: pointer;
}
.srd-close:hover {
  background: #e4e4e7;
}
.srd-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  background: #f4f4f5;
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
  color: #09090b;
}
.srd-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: #52525b;
}
.srd-badge {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  background: #ffffff;
  color: #09090b;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
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
  color: #52525b;
}
.srd-input,
.srd-select,
.srd-textarea {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  border-radius: 12px;
  background: #ffffff;
  color: #09090b;
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
  color: #71717a;
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
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #52525b;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  cursor: pointer;
}
.srd-pill:hover:not(:disabled) {
  background: #e4e4e7;
  color: #09090b;
}
.srd-pill[aria-pressed="true"] {
  background: #09090b;
  color: #ffffff;
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
  background: #ffffff;
}
.srd-expiry-btn {
  min-height: 28px;
  padding: 0 11px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #52525b;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.srd-expiry-btn[aria-pressed="true"] {
  background: #09090b;
  color: #ffffff;
}
.srd-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: #0033ff;
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(0, 51, 255, 0.28);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  cursor: pointer;
}
.srd-primary:hover:not(:disabled) {
  background: #0026cc;
}
.srd-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  background: #09090b;
  color: #ffffff;
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
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #09090b;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-decoration: none;
  cursor: pointer;
}
.srd-ghost:hover:not(:disabled) {
  background: #e4e4e7;
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
  background: #ffffff;
}
.srd-url {
  flex: 1 1 220px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: #09090b;
}
.srd-error {
  margin: 0;
  font-size: 12.5px;
  font-weight: 500;
  color: #71717a;
}
.srd-modal :is(button, a, input, select, textarea):focus-visible {
  outline: 2px solid #0033ff;
  outline-offset: 2px;
}
`;

export function ShareReviewDialog({ target, locale = "ko", onClose, onNavigate }: ShareReviewDialogProps) {
  const c = COPY[locale];
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
            {activeShareCount > 0 && <span className="srd-badge">{c.activeLinksCount(activeShareCount)}</span>}
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
                  {c.daysUnit(days)}
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
