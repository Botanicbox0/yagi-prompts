'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { usePathname } from 'next/navigation';
import { TwingsMark } from '@/components/brand/twings-mark';
import { useCreatorSession } from '@/components/nav/creator-account';
import {
  answerPersonalConciergeQuery,
  getPersonalConciergeFaqs,
  type ConciergeLocale,
  type EscalationReason,
  type PersonalConciergeFaqItem,
  type PersonalSupportReply,
} from '@/lib/support/personal-concierge';
import { supportConciergeEn, supportConciergeKo } from '@/messages/support-concierge';

interface ChatBubble {
  id: string;
  role: 'user' | 'ai' | 'human_agent';
  authorLabel: string;
  text: string;
  actionLabel?: string;
  actionHref?: string;
  needsHumanEscalation?: boolean;
  escalationReason?: EscalationReason;
  createdAt: string;
}

export function isEscalationAcceptedResponse(
  responseOk: boolean,
  payload: { ok?: boolean; stored?: boolean; delivered?: boolean },
): boolean {
  return Boolean(responseOk && payload.ok && (payload.stored === true || payload.delivered === true));
}

export const conciergeEscalatedStorageKey = (userKey: string): string =>
  `twings-concierge-escalated:${userKey}`;

export const conciergeSeenAtStorageKey = (userKey: string): string =>
  `twings-concierge-seen-at:${userKey}`;

export function shouldFetchConciergeOnEffect(params: {
  signedIn: boolean;
  isBrandSurface: boolean;
  isOpen: boolean;
  userKey: string | null;
  getItem?: (key: string) => string | null;
}): boolean {
  if (!params.signedIn || params.isBrandSurface) return false;
  if (params.isOpen) return true;
  if (!params.userKey) return false;
  try {
    const read =
      params.getItem ??
      (typeof window !== 'undefined' ? (k: string) => window.localStorage.getItem(k) : null);
    return read ? read(conciergeEscalatedStorageKey(params.userKey)) === '1' : false;
  } catch {
    return false;
  }
}

function readConciergeUidCookie(): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('twings_concierge_uid=')) {
      const value = trimmed.slice('twings_concierge_uid='.length).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function TwingsAiConcierge({
  locale = 'ko',
  defaultOpen = false,
  initialSignedIn,
  initialDisplayName,
  initialUnreadCount = 0,
  initialUserKey,
}: {
  locale?: string;
  defaultOpen?: boolean;
  /** Optional override for unit tests; in browser uses live `/api/account/session`. */
  initialSignedIn?: boolean;
  initialDisplayName?: string | null;
  initialUnreadCount?: number;
  initialUserKey?: string | null;
}) {
  const resolvedLocale: ConciergeLocale = locale === 'en' ? 'en' : 'ko';
  const isKo = resolvedLocale === 'ko';
  const copy = isKo ? supportConciergeKo : supportConciergeEn;
  const pathname = usePathname() ?? `/${resolvedLocale}`;

  // Hide on brand landing/workspace pages so it never overlaps with the B2B brand concierge
  const isBrandSurface =
    pathname === `/${resolvedLocale}/brands` ||
    pathname.startsWith(`/${resolvedLocale}/brands/`) ||
    pathname === '/brand' ||
    pathname.startsWith('/brand/');

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showAllFaqs, setShowAllFaqs] = useState(true);
  const [humanModeRequested, setHumanModeRequested] = useState(false);
  const [hasOpenEscalation, setHasOpenEscalation] = useState(false);
  const [escalationReason, setEscalationReason] =
    useState<EscalationReason>('user_requested_human');
  const [inputText, setInputText] = useState('');
  const [humanMessageDraft, setHumanMessageDraft] = useState('');
  const [sendingInquiry, setSendingInquiry] = useState(false);
  const [escalationNotice, setEscalationNotice] = useState<string | null>(null);
  const [staffReplies, setStaffReplies] = useState<PersonalSupportReply[]>([]);
  const [persistedThread, setPersistedThread] = useState<ChatBubble[]>([]);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [resolvedUserKey, setResolvedUserKey] = useState<string | null>(initialUserKey ?? null);

  const titleId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const escalationAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const liveSession = useCreatorSession(!isBrandSurface && initialSignedIn === undefined);

  const signedIn = initialSignedIn ?? liveSession.signedIn;
  const activeUserKey =
    initialUserKey ?? resolvedUserKey ?? (signedIn ? readConciergeUidCookie() : null);
  const displayName =
    initialDisplayName !== undefined
      ? initialDisplayName
      : liveSession.signedIn
        ? (liveSession.displayName ?? null)
        : null;

  const faqs = useMemo(() => getPersonalConciergeFaqs(resolvedLocale), [resolvedLocale]);

  const signInHref = `/auth/signin?next=${encodeURIComponent(pathname)}&locale=${resolvedLocale}`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [bubbles.length, persistedThread.length, staffReplies.length, humanModeRequested, isOpen]);

  // Hydrate consumer threads only when opened OR when THIS user has a remembered escalation in localStorage
  const syncSupportThread = useCallback(async () => {
    if (!signedIn || isBrandSurface) return;
    try {
      const response = await fetch(`/api/support/concierge?locale=${resolvedLocale}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        ok?: boolean;
        userKey?: string;
        replies?: PersonalSupportReply[];
        hasEscalation?: boolean;
        latestStaffReplyAt?: string | null;
        thread?: Array<{
          id: string;
          role: 'user' | 'human_agent';
          authorLabel: string;
          text: string;
          createdAt: string;
        }>;
      };
      if (!data.ok) return;
      if (data.userKey) {
        setResolvedUserKey(data.userKey);
      }
      const storageKeyUser = data.userKey ?? activeUserKey;
      const replies = Array.isArray(data.replies) ? data.replies : [];
      setStaffReplies(replies);
      setHasOpenEscalation(Boolean(data.hasEscalation));
      if (Array.isArray(data.thread)) {
        setPersistedThread(
          data.thread.map((m) => ({
            id: m.id,
            role: m.role,
            authorLabel: m.authorLabel,
            text: m.text,
            createdAt: m.createdAt,
          })),
        );
      }
      if (typeof window !== 'undefined' && storageKeyUser) {
        const seenKey = conciergeSeenAtStorageKey(storageKeyUser);
        const escalatedKey = conciergeEscalatedStorageKey(storageKeyUser);
        if (isOpen) {
          setUnreadCount(0);
          try {
            if (data.latestStaffReplyAt) {
              window.localStorage.setItem(seenKey, data.latestStaffReplyAt);
            }
            if (!data.hasEscalation || data.latestStaffReplyAt) {
              window.localStorage.removeItem(escalatedKey);
            }
          } catch {
            // ignore storage errors
          }
        } else {
          if (!data.hasEscalation) {
            try {
              window.localStorage.removeItem(escalatedKey);
            } catch {
              // ignore storage errors
            }
          } else if (replies.length > 0) {
            let seenAt = '';
            try {
              seenAt = window.localStorage.getItem(seenKey) ?? '';
            } catch {
              seenAt = '';
            }
            const unseen = seenAt ? replies.filter((r) => r.createdAt > seenAt).length : replies.length;
            setUnreadCount(unseen);
            if (unseen === 0) {
              try {
                window.localStorage.removeItem(escalatedKey);
              } catch {
                // ignore storage errors
              }
            }
          }
        }
      } else if (isOpen) {
        setUnreadCount(0);
      }
    } catch {
      // Ignore transient polling error
    }
  }, [signedIn, isBrandSurface, isOpen, resolvedLocale, activeUserKey]);

  useEffect(() => {
    if (
      !shouldFetchConciergeOnEffect({
        signedIn,
        isBrandSurface,
        isOpen,
        userKey: activeUserKey,
      })
    ) {
      return;
    }
    void syncSupportThread();
  }, [signedIn, isBrandSurface, isOpen, activeUserKey, syncSupportThread]);

  useEffect(() => {
    if (!signedIn || isBrandSurface || !isOpen) return;
    if (!humanModeRequested && !hasOpenEscalation) return;
    const timer = setInterval(() => {
      void syncSupportThread();
    }, 4000);
    return () => clearInterval(timer);
  }, [signedIn, isBrandSurface, isOpen, humanModeRequested, hasOpenEscalation, syncSupportThread]);

  if (isBrandSurface) return null;

  function handleSelectFaq(faq: PersonalConciergeFaqItem) {
    const nowIso = new Date().toISOString();
    setShowAllFaqs(false);
    setBubbles((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}-${faq.id}`,
        role: 'user',
        authorLabel: isKo ? '나' : 'You',
        text: faq.question,
        createdAt: nowIso,
      },
      {
        id: `a-${Date.now()}-${faq.id}`,
        role: 'ai',
        authorLabel: isKo ? 'TWINGS AI 상담센터' : 'TWINGS AI Concierge',
        text: faq.answer,
        actionLabel: faq.actionLabel,
        actionHref: faq.actionHref,
        needsHumanEscalation: false,
        createdAt: nowIso,
      },
    ]);
  }

  function handleAskSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitUserQuery(inputText);
  }

  function submitUserQuery(rawText: string) {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    setInputText('');
    setShowAllFaqs(false);

    const nowIso = new Date().toISOString();
    const aiResult = answerPersonalConciergeQuery({
      query: trimmed,
      locale: resolvedLocale,
    });

    setBubbles((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        authorLabel: isKo ? '나' : 'You',
        text: trimmed,
        createdAt: nowIso,
      },
      {
        id: `a-${Date.now() + 1}`,
        role: 'ai',
        authorLabel: isKo ? 'TWINGS AI 상담센터' : 'TWINGS AI Concierge',
        text: aiResult.reply,
        actionLabel: aiResult.actionLabel,
        actionHref: aiResult.actionHref,
        needsHumanEscalation: aiResult.needsHumanEscalation,
        escalationReason: aiResult.escalationReason,
        createdAt: nowIso,
      },
    ]);

    if (aiResult.needsHumanEscalation) {
      setHumanModeRequested(true);
      setEscalationReason(aiResult.escalationReason ?? 'ai_unanswered');
      if (!humanMessageDraft.trim()) {
        setHumanMessageDraft(trimmed);
      }
    }
  }

  function activateHumanEscalation(reason: EscalationReason = 'user_requested_human') {
    setHumanModeRequested(true);
    setEscalationReason(reason);
    setEscalationNotice(null);
  }

  async function handleSubmitEscalation(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!signedIn) return;
    const message = humanMessageDraft.trim() || inputText.trim();
    if (!message || sendingInquiry) return;

    const fingerprint = `${escalationReason}:${message}`;
    if (escalationAttempt.current?.fingerprint !== fingerprint) {
      escalationAttempt.current = { fingerprint, id: crypto.randomUUID() };
    }

    setSendingInquiry(true);
    setEscalationNotice(null);

    try {
      const transcript = bubbles.slice(-6).map((b) => ({
        role: b.role,
        text: b.text,
      }));

      const response = await fetch('/api/support/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          operation: 'escalate',
          locale: resolvedLocale,
          reason: escalationReason,
          message,
          pagePath: pathname,
          transcript,
          requestId: escalationAttempt.current.id,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        stored?: boolean;
        delivered?: boolean;
        userKey?: string;
        code?: string;
      };

      if (response.status === 401 || payload.code === 'sign_in_required') {
        setEscalationNotice(copy.signInRequired);
        return;
      }

      if (response.status === 429 || payload.code === 'rate_limited') {
        setEscalationNotice(copy.rateLimited);
        return;
      }

      if (!isEscalationAcceptedResponse(response.ok, payload)) {
        setEscalationNotice(copy.saveFailed);
        return;
      }

      escalationAttempt.current = null;
      setHasOpenEscalation(true);
      const storageKeyUser = payload.userKey ?? activeUserKey;
      if (payload.userKey) {
        setResolvedUserKey(payload.userKey);
      }
      if (storageKeyUser && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(conciergeEscalatedStorageKey(storageKeyUser), '1');
        } catch {
          // ignore storage errors
        }
      }
      const nowIso = new Date().toISOString();
      if (payload.stored) {
        void syncSupportThread();
      }
      setBubbles((prev) => [
        ...prev,
        ...(payload.stored
          ? []
          : [
              {
                id: `u-support-${Date.now()}`,
                role: 'user' as const,
                authorLabel: displayName || (isKo ? '회원' : 'Member'),
                text: message,
                createdAt: nowIso,
              },
            ]),
        {
          id: `sys-support-${Date.now() + 1}`,
          role: 'human_agent',
          authorLabel: copy.receivedAuthor,
          text: copy.receivedBody,
          createdAt: nowIso,
        },
      ]);
      setHumanMessageDraft('');
    } catch {
      setEscalationNotice(copy.networkError);
    } finally {
      setSendingInquiry(false);
    }
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitUserQuery(inputText);
    }
  }

  const isTemplateDetail = pathname.includes('/t/');

  return (
    <div
      data-twings-ai-concierge
      className={[
        'fixed right-4 z-[48] flex flex-col items-end sm:right-6 md:bottom-6',
        isTemplateDetail ? 'bottom-20' : 'bottom-4',
      ].join(' ')}
    >
      {isOpen && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-twings-ai-concierge-dialog
          className="mb-3 flex max-h-[min(640px,calc(100dvh-6.5rem))] w-[min(392px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[24px] bg-white text-[#09090B] shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_20px_48px_-12px_rgba(0,0,0,0.12)]"
        >
          {/* ChannelTalk / Sendbird-style Top Header with Circular TWINGS Mark */}
          <header className="flex items-center justify-between gap-3 bg-[#F4F4F5] px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div
                data-concierge-logo-circle
                className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[#09090B] text-white"
              >
                <TwingsMark className="h-[16px] text-white" />
                <span
                  aria-hidden="true"
                  className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-white bg-[#FF58AE]"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 id={titleId} className="text-[0.9375rem] font-semibold tracking-tight text-[#09090B]">
                    {isKo ? 'TWINGS AI 상담센터' : 'TWINGS AI Concierge'}
                  </h2>
                  <span className="rounded-full bg-[#09090B] px-2 py-0.5 font-mono text-[0.625rem] font-semibold text-white">
                    24/7 LIVE
                  </span>
                </div>
                <p className="mt-0.5 text-[0.75rem] text-[#71717A]">
                  {isKo
                    ? 'AI 즉시 답변 · 미해결 시 담당 상담원 1:1 연결'
                    : 'Instant AI answers · 1:1 specialist handoff'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (activeUserKey && (staffReplies.length > 0 || !hasOpenEscalation) && typeof window !== 'undefined') {
                  try {
                    window.localStorage.removeItem(conciergeEscalatedStorageKey(activeUserKey));
                  } catch {
                    // ignore storage errors
                  }
                }
              }}
              aria-label={isKo ? '상담센터 닫기' : 'Close support center'}
              className="flex size-8 items-center justify-center rounded-full bg-white text-sm font-semibold text-[#52525B] transition-colors hover:bg-[#E4E4E7] hover:text-[#09090B]"
            >
              ×
            </button>
          </header>

          {/* Scrollable Conversation & FAQ Body */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4"
          >
            {/* Welcome Greeting Card */}
            <div className="rounded-[18px] bg-[#F4F4F5] p-3.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#09090B] text-white">
                  <TwingsMark className="h-[10px] text-white" />
                </span>
                <span className="text-xs font-semibold text-[#09090B]">
                  {isKo ? '무엇을 도와드릴까요?' : 'How can we help you today?'}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[#71717A]">
                {isKo
                  ? '자주 묻는 질문을 눌러 바로 확인하거나 궁금한 점을 입력해 보세요. AI가 답변하기 어려운 문의나 사람과의 대화가 필요하시면 담당 상담원에게 바로 연결해 드립니다.'
                  : 'Tap a frequently asked question below or ask anything. If AI cannot resolve your issue or you prefer a human, we connect you straight to a support specialist.'}
              </p>
            </div>

            {/* Frequently Asked Questions (자주 묻는 질문) */}
            <div data-concierge-faq-list className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-[#52525B]">
                  {isKo ? '자주 묻는 질문 (FAQ)' : 'Frequently Asked Questions'}
                </span>
                {bubbles.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllFaqs((prev) => !prev)}
                    className="text-[0.75rem] font-medium text-[#09090B] underline underline-offset-2"
                  >
                    {showAllFaqs
                      ? isKo
                        ? '질문 목록 접기'
                        : 'Hide FAQs'
                      : isKo
                        ? '자주 묻는 질문 펼치기'
                        : 'Show FAQs'}
                  </button>
                )}
              </div>

              {showAllFaqs && (
                <div className="grid grid-cols-1 gap-1.5">
                  {faqs.map((faq) => (
                    <button
                      key={faq.id}
                      type="button"
                      data-concierge-faq-item={faq.id}
                      onClick={() => handleSelectFaq(faq)}
                      className="flex w-full items-center justify-between gap-2 rounded-[14px] bg-[#F4F4F5] px-3 py-2.5 text-left text-xs font-medium text-[#09090B] transition-colors hover:bg-[#E4E4E7]"
                    >
                      <span>{faq.shortLabel}</span>
                      <span aria-hidden="true" className="shrink-0 font-mono text-[#52525B]">
                        →
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Chat Bubbles */}
            {bubbles.map((bubble) => (
              <article
                key={bubble.id}
                data-concierge-bubble={bubble.role}
                className={`flex flex-col ${
                  bubble.role === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <span className="mb-1 px-1 text-[0.6875rem] font-medium text-[#71717A]">
                  {bubble.authorLabel}
                </span>
                <div
                  className={`max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-xs leading-relaxed ${
                    bubble.role === 'user'
                      ? 'bg-[#09090B] text-white'
                      : 'bg-[#F4F4F5] text-[#09090B]'
                  }`}
                >
                  <p>{bubble.text}</p>
                  {bubble.actionHref && bubble.actionLabel && (
                    <a
                      href={bubble.actionHref}
                      className="mt-2 inline-flex items-center rounded-full bg-white px-3 py-1 text-[0.6875rem] font-semibold text-[#09090B] hover:underline"
                    >
                      {bubble.actionLabel}
                    </a>
                  )}
                </div>
              </article>
            ))}

            {/* Persisted Escalation Thread (restored across reloads, F8) */}
            {persistedThread.map((item) => (
              <article
                key={item.id}
                data-concierge-bubble={item.role === 'human_agent' ? 'staff_reply' : 'user'}
                className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className="mb-1 px-1 text-[0.6875rem] font-semibold text-[#09090B]">
                  {item.authorLabel}
                </span>
                <div
                  className={`max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-xs leading-relaxed ${
                    item.role === 'user' ? 'bg-[#09090B] text-white' : 'bg-[#F4F4F5] text-[#09090B]'
                  }`}
                >
                  <p>{item.text}</p>
                </div>
              </article>
            ))}

            {/* Inbound Replies fallback when thread snapshot is absent */}
            {persistedThread.length === 0 &&
              staffReplies.map((reply) => (
                <article
                  key={reply.id}
                  data-concierge-bubble="staff_reply"
                  className="flex flex-col items-start"
                >
                  <span className="mb-1 px-1 text-[0.6875rem] font-semibold text-[#09090B]">
                    {reply.authorLabel}
                  </span>
                  <div className="max-w-[88%] rounded-[16px] bg-[#F4F4F5] px-3.5 py-2.5 text-xs leading-relaxed text-[#09090B]">
                    <p>{reply.body}</p>
                  </div>
                </article>
              ))}

            {/* Human Escalation Box (Triggered when AI cannot answer OR user clicks "사람과 대화하기") */}
            {(humanModeRequested || hasOpenEscalation) && (
              <div
                data-concierge-escalation-panel
                className="rounded-[18px] bg-[#F4F4F5] p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider text-[#52525B]">
                    {isKo ? '1:1 담당 상담원 연결' : 'LIVE SPECIALIST HANDOFF'}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[0.6875rem] font-semibold text-[#09090B]">
                    {signedIn
                      ? isKo
                        ? '로그인 확인됨'
                        : 'Signed In'
                      : isKo
                        ? '로그인 필요'
                        : 'Sign-in Required'}
                  </span>
                </div>

                {!signedIn ? (
                  /* Login Gate: Require sign-in before connecting to a human specialist */
                  <div data-concierge-login-gate className="mt-2.5 space-y-2.5">
                    <p className="text-xs leading-relaxed text-[#09090B]">
                      {isKo
                        ? '상담원(사람)과 실시간으로 대화하려면 로그인이 필요합니다. 로그인하시면 회원님의 계정·제작 내역을 확인하고 담당 상담원과 바로 연결해 드립니다.'
                        : 'Please sign in to talk with a human specialist. Once signed in, we verify your account and connect you straight to our support team.'}
                    </p>
                    <a
                      href={signInHref}
                      data-concierge-login-cta
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[#09090B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#27272A]"
                    >
                      {isKo ? '로그인하고 상담원 연결하기 →' : 'Sign in to connect with a specialist →'}
                    </a>
                  </div>
                ) : (
                  /* Signed-in Human Escalation Form */
                  <form
                    onSubmit={handleSubmitEscalation}
                    data-concierge-handoff-form
                    className="mt-2.5 space-y-2.5"
                  >
                    <p className="text-xs leading-relaxed text-[#71717A]">
                      {isKo
                        ? `${displayName ?? '회원'}님 계정으로 담당 상담원에게 문의를 접수합니다. 내용을 남겨주시면 이 채팅창으로 바로 답변이 도착합니다.`
                        : `Connected as ${displayName ?? 'Member'}. Send your message below and our specialist will reply right here.`}
                    </p>
                    <textarea
                      rows={2}
                      value={humanMessageDraft}
                      onChange={(e) => setHumanMessageDraft(e.target.value)}
                      placeholder={
                        isKo
                          ? '상담원에게 전달할 문의 내용을 입력해 주세요...'
                          : 'Describe what you need help with for our team...'
                      }
                      className="w-full rounded-[12px] bg-white px-3 py-2 text-xs text-[#09090B] placeholder:text-[#A1A1AA] focus:outline-2 focus:outline-[#09090B]"
                    />
                    {escalationNotice && (
                      <p role="alert" className="text-[0.6875rem] font-medium text-[#09090B]">
                        {escalationNotice}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={sendingInquiry || !humanMessageDraft.trim()}
                      data-concierge-handoff-submit
                      className="inline-flex min-h-9 w-full items-center justify-center rounded-full bg-[#09090B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#27272A] disabled:opacity-50"
                    >
                      {sendingInquiry ? copy.sendingLabel : copy.submitLabel}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* Bottom Action Bar: Direct Human Request Button + AI Chat Input */}
          <footer className="bg-white p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                data-concierge-request-human
                onClick={() => activateHumanEscalation('user_requested_human')}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F4F5] px-3 py-1 text-[0.6875rem] font-semibold text-[#09090B] transition-colors hover:bg-[#E4E4E7]"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-[#09090B]" />
                {isKo ? '사람(상담원)과 1:1 대화하기' : 'Talk to a human specialist'}
              </button>
              <a
                href={`/${resolvedLocale}/faq`}
                className="text-[0.6875rem] font-medium text-[#52525B] hover:text-[#09090B] hover:underline"
              >
                {isKo ? '전체 FAQ ↗' : 'All FAQs ↗'}
              </a>
            </div>

            <form onSubmit={handleAskSubmit} className="flex items-center gap-2">
              <label htmlFor="twings-ai-concierge-input" className="sr-only">
                {isKo ? 'AI 상담 질문 입력' : 'Ask TWINGS AI Concierge'}
              </label>
              <input
                id="twings-ai-concierge-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  isKo
                    ? '궁금한 점을 물어보세요 (예: 옷 변경, 5장 선택, 상담원 연결)'
                    : 'Ask anything (e.g. outfit change, 5-shot pick, human agent)'
                }
                className="min-h-10 flex-1 rounded-full bg-[#F4F4F5] px-3.5 py-2 text-xs text-[#09090B] placeholder:text-[#A1A1AA] focus:bg-white focus:outline-2 focus:outline-[#09090B]"
              />
              <button
                type="submit"
                data-concierge-ask-submit
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-[#09090B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#27272A]"
              >
                {isKo ? '질문' : 'Ask'}
              </button>
            </form>
          </footer>
        </section>
      )}

      {/* Floating Circular TWINGS Logo Launcher (ChannelTalk / Sendbird style) */}
      <button
        type="button"
        onClick={() => {
          setIsOpen((prev) => {
            const next = !prev;
            if (!next && activeUserKey && (staffReplies.length > 0 || !hasOpenEscalation) && typeof window !== 'undefined') {
              try {
                window.localStorage.removeItem(conciergeEscalatedStorageKey(activeUserKey));
              } catch {
                // ignore storage errors
              }
            }
            return next;
          });
        }}
        aria-expanded={isOpen}
        aria-label={isKo ? 'TWINGS AI 상담센터 열기' : 'Open TWINGS AI Support Center'}
        data-twings-ai-concierge-launcher
        className="group relative flex size-11 items-center justify-center rounded-full border-2 border-white bg-[#09090B] text-white shadow-[0_14px_34px_-8px_rgba(9,9,11,0.38)] transition-transform duration-200 hover:scale-105 focus:outline-none sm:size-14"
      >
        <TwingsMark className="h-[18px] text-white transition-transform duration-200 group-hover:scale-110 sm:h-[22px]" />
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-white bg-[#0B0D12] font-mono text-[0.45rem] font-bold text-white sm:size-4 sm:text-[0.5rem]"
        >
          AI
        </span>
        {!isOpen && unreadCount > 0 && (
          <span
            data-concierge-unread-dot
            aria-label={isKo ? '새 답변 알림' : 'New reply'}
            className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-white bg-[#2563EB]"
          />
        )}
      </button>
    </div>
  );
}
