'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { sendTransport, type SendInviteTransport, type SendTransport } from '@/components/brand-rooms/chat/transport';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
import { WorkspaceBell } from '@/components/brand-workspace/bell';
import { ROOM_POLL_HIDDEN_MS } from '@/lib/brand-rooms/message-contracts';
import type {
  SendInboxPage as SendInboxPageData,
  SendInboxView,
  SendPerson,
  SendPosted,
  SendThreadPage,
  SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import {
  inboxPollReduce,
  inboxThreadHref,
  inboxUnreadBadgeText,
  initialInboxPollState,
  refusalMessageText,
  sendRefusalOutcome,
  threadRowWords,
  type BrandSendClientProp,
  type InboxPollAction,
  type InboxPollCommand,
  type InboxPollState,
  type SendCopy,
  type SendLocale,
} from './model';
import { SendThreadView } from './thread-view';
import styles from './inbox-page.module.css';

export interface SendInboxPageProps {
  send: BrandSendClientProp;
  initialThreadId?: string | null;
  initialView?: SendInboxView;
  locale: SendLocale;
  copy: SendCopy;
  transport?: SendTransport;
  inviteTransport?: SendInviteTransport;
  initialInbox?: SendInboxPageData | null;
  initialThread?: SendThreadPage | null;
  initialThreadGone?: boolean;
  initialPeople?: readonly SendPerson[];
}

function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function threadParamFromLocation(): string | null {
  if (typeof window === 'undefined' || !window.location?.search) return null;
  const raw = new URLSearchParams(window.location.search).get('thread');
  return raw && raw.trim() ? raw.trim() : null;
}

function RowThumbGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.rowThumbIcon}>
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
      <circle cx="7.5" cy="8.5" r="1.2" />
      <path d="M4.5 14l3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

function useFitHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el || typeof window === 'undefined' || typeof el.getBoundingClientRect !== 'function') return;
      const top = el.getBoundingClientRect().top + (window.scrollY || 0);
      let bottom = 0;
      if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
        for (const node of Array.from(document.querySelectorAll<HTMLElement>("nav, [class*='tabs'], [role='tablist']"))) {
          if (node.contains(el) || el.contains(node)) continue;
          const style = getComputedStyle(node);
          if (style.position !== 'fixed' || style.display === 'none' || style.visibility === 'hidden') continue;
          const rect = node.getBoundingClientRect();
          if (rect.bottom >= window.innerHeight - 1 && rect.width >= window.innerWidth * 0.9 && rect.height < window.innerHeight / 3) {
            bottom = Math.max(bottom, rect.height);
          }
        }
      }
      const margin = window.innerWidth < 900 ? 8 : 16;
      el.style?.setProperty?.('--send-fit-h', `${Math.max(380, Math.floor(window.innerHeight - top - bottom - margin))}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return ref;
}

export function SendInboxPage({
  send,
  initialThreadId = null,
  initialView = 'all',
  locale,
  copy,
  transport,
  inviteTransport,
  initialInbox = null,
  initialThread = null,
  initialThreadGone = false,
  initialPeople,
}: SendInboxPageProps) {
  const organizationId = send.organizationId;
  const activeTransport = useMemo(() => transport ?? sendTransport(organizationId), [organizationId, transport]);
  const bellSlot = useMemo(() => <WorkspaceBell size="compact" />, []);
  const fitRef = useFitHeight();

  const [state, setState] = useState<InboxPollState>(() => initialInboxPollState(initialView, initialInbox));
  const [selectedRootId, setSelectedRootId] = useState<string | null>(initialThreadId);
  const [markingAll, setMarkingAll] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const listRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const orgMountedRef = useRef(organizationId);
  const markingAllRef = useRef(false);
  const suppressActivityRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedulePollRef = useRef<() => void>(() => {});
  const runCommandRef = useRef<(cmd: InboxPollCommand) => void>(() => {});

  const dispatchInbox = useCallback((action: InboxPollAction) => {
    const { state: nextState, command } = inboxPollReduce(stateRef.current, action);
    stateRef.current = nextState;
    setState(nextState);
    if (command) {
      runCommandRef.current(command);
    }
  }, []);

  schedulePollRef.current = () => {
    clearTimer();
    const s = stateRef.current;
    if (!mountedRef.current || s.stopped || s.closed || !isDocumentVisible()) return;
    timerRef.current = setTimeout(() => {
      dispatchInbox({ type: 'tick', visible: isDocumentVisible() });
    }, ROOM_POLL_HIDDEN_MS);
  };

  runCommandRef.current = (cmd: InboxPollCommand) => {
    const req = cmd.cursor ? { view: cmd.view, cursor: cmd.cursor } : { view: cmd.view };
    void activeTransport
      .inbox(req)
      .then((result) => {
        if (!mountedRef.current) return;
        dispatchInbox({ type: 'answer', kind: cmd.kind, seq: cmd.seq, result });
        schedulePollRef.current();
      })
      .catch(() => {
        if (!mountedRef.current) return;
        dispatchInbox({ type: 'answer', kind: cmd.kind, seq: cmd.seq, result: { ok: false, code: 'offline' } });
        schedulePollRef.current();
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    const handleVisibility = () => {
      const visible = isDocumentVisible();
      dispatchInbox({ type: 'visible', visible });
      schedulePollRef.current();
    };
    const handleFocus = () => {
      dispatchInbox({ type: 'focus', visible: isDocumentVisible() });
    };
    const handleActivity = () => {
      if (suppressActivityRef.current) return;
      dispatchInbox({ type: 'activity' });
    };
    const handlePopState = () => {
      if (stateRef.current.closed) return;
      const nextThread = threadParamFromLocation();
      setSelectedRootId(nextThread);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      window.addEventListener(ROOM_ACTIVITY, handleActivity);
      window.addEventListener('popstate', handlePopState);
    }

    return () => {
      mountedRef.current = false;
      clearTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener(ROOM_ACTIVITY, handleActivity);
        window.removeEventListener('popstate', handlePopState);
      }
    };
  }, [clearTimer, dispatchInbox]);

  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const onEnter = () => dispatchInbox({ type: 'pointer_enter' });
    const onLeave = () => dispatchInbox({ type: 'pointer_leave' });
    listEl.addEventListener('pointerenter', onEnter);
    listEl.addEventListener('pointerleave', onLeave);
    return () => {
      listEl.removeEventListener('pointerenter', onEnter);
      listEl.removeEventListener('pointerleave', onLeave);
    };
  }, [dispatchInbox]);

  useEffect(() => {
    if (orgMountedRef.current !== organizationId) {
      orgMountedRef.current = organizationId;
      const fresh = initialInboxPollState(initialView, null);
      stateRef.current = fresh;
      setState(fresh);
      setSelectedRootId(initialThreadId);
    }
    dispatchInbox({ type: 'mount' });
    schedulePollRef.current();
  }, [activeTransport, dispatchInbox, initialThreadId, initialView, organizationId]);

  const handleSelectRow = (event: MouseEvent<HTMLAnchorElement>, rootId: string) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (typeof event.button === 'number' && event.button !== 0)
    ) {
      return;
    }
    event.preventDefault();
    if (stateRef.current.closed) {
      return;
    }
    dispatchInbox({ type: 'mark_read', rootId });
    if (selectedRootId !== null && selectedRootId.toLowerCase() === rootId.toLowerCase()) {
      return;
    }
    setSelectedRootId(rootId);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const params = new URLSearchParams(window.location?.search ?? '');
      params.set('organizationId', organizationId);
      params.set('thread', rootId);
      window.history.pushState(null, '', `/brand/inbox?${params.toString()}`);
    }
  };

  const handleMarkAllRead = useCallback(async () => {
    if (
      markingAllRef.current ||
      stateRef.current.view !== 'all' ||
      (!stateRef.current.hasMoreUnread && stateRef.current.unread <= 0)
    )
      return;
    markingAllRef.current = true;
    setMarkingAll(true);
    try {
      const res = await activeTransport.readAll();
      if (!mountedRef.current) return;
      if (res.ok) {
        dispatchInbox({ type: 'read_all_done', more: res.more });
        if (typeof window !== 'undefined') {
          suppressActivityRef.current = true;
          try {
            window.dispatchEvent(new CustomEvent(ROOM_ACTIVITY));
          } finally {
            suppressActivityRef.current = false;
          }
        }
      }
    } finally {
      markingAllRef.current = false;
      if (mountedRef.current) setMarkingAll(false);
    }
  }, [activeTransport, dispatchInbox]);

  const handleThreadLoaded = useCallback(
    (thread: SendThreadSummary, marked: boolean) => {
      if (!marked) return;
      dispatchInbox({ type: 'mark_read', rootId: thread.rootId });
    },
    [dispatchInbox],
  );

  const handleReplyPosted = useCallback(
    (posted: SendPosted) => {
      dispatchInbox({ type: 'upsert_thread', thread: posted.thread });
    },
    [dispatchInbox],
  );

  const handleThreadClosed = useCallback(() => {
    dispatchInbox({ type: 'close' });
    clearTimer();
  }, [clearTimer, dispatchInbox]);

  const allBadge = inboxUnreadBadgeText(state.unread);
  const mentionsBadge = inboxUnreadBadgeText(state.mentionsUnread);

  const matchingInitialThread =
    selectedRootId && initialThread && initialThread.thread.rootId.toLowerCase() === selectedRootId.toLowerCase()
      ? initialThread
      : null;
  const matchingInitialGone =
    Boolean(selectedRootId) &&
    Boolean(initialThreadId) &&
    selectedRootId?.toLowerCase() === initialThreadId?.toLowerCase() &&
    initialThreadGone;

  const errorText =
    state.error && !state.closed
      ? (refusalMessageText(sendRefusalOutcome(state.error, 'inbox'), copy) ?? copy.failedLoad)
      : null;

  return (
    <div ref={fitRef} className={styles.shell} data-send-inbox>
      <aside className={styles.left} aria-label={copy.inboxTitle}>
        <div className={styles.leftHead}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{copy.inboxTitle}</h1>
            {!state.closed && state.view === 'all' ? (
              <button
                type="button"
                className={styles.markAllBtn}
                data-send-mark-all
                disabled={markingAll || (!state.hasMoreUnread && state.unread <= 0)}
                onClick={() => void handleMarkAllRead()}
              >
                {copy.markAllRead}
              </button>
            ) : null}
          </div>

          <div className={styles.tabs} role="group" aria-label={copy.inboxTitle}>
            <button
              type="button"
              className={styles.tabBtn}
              data-send-view="all"
              aria-pressed={state.view === 'all'}
              disabled={state.closed}
              onClick={() => dispatchInbox({ type: 'switch_view', view: 'all' })}
            >
              <span>{copy.viewAll}</span>
              {allBadge ? <span className={styles.tabCount}>{allBadge}</span> : null}
            </button>
            <button
              type="button"
              className={styles.tabBtn}
              data-send-view="mentions"
              aria-pressed={state.view === 'mentions'}
              disabled={state.closed}
              onClick={() => dispatchInbox({ type: 'switch_view', view: 'mentions' })}
            >
              <span>{copy.viewMentions}</span>
              {mentionsBadge ? <span className={styles.tabCount}>{mentionsBadge}</span> : null}
            </button>
          </div>
        </div>

        <div ref={listRef} className={styles.list} data-send-inbox-list>
          {!state.loaded && errorText ? (
            <div className={styles.listEmpty} data-send-inbox-error>
              <span>{errorText}</span>
              <button type="button" className={styles.retryBtn} onClick={() => dispatchInbox({ type: 'retry' })}>
                {copy.retry}
              </button>
            </div>
          ) : !state.loaded ? (
            <div className={styles.listEmpty} aria-busy="true">
              <span>{copy.loading}</span>
            </div>
          ) : state.threads.length === 0 ? (
            <div className={styles.listEmpty} data-send-inbox-empty>
              <span>{state.view === 'mentions' ? copy.inboxMentionsEmpty : copy.inboxEmpty}</span>
            </div>
          ) : (
            <>
              {state.threads.map((thread) => {
                const words = threadRowWords(thread, copy, locale);
                const isActive =
                  selectedRootId !== null && selectedRootId.toLowerCase() === thread.rootId.toLowerCase();
                const rowInner = (
                  <>
                    <span className={styles.rowThumb}>
                      {words.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={words.thumbUrl}
                          alt=""
                          width={48}
                          height={36}
                          loading="lazy"
                          className={styles.rowThumbImg}
                        />
                      ) : (
                        <RowThumbGlyph />
                      )}
                    </span>

                    <span className={styles.rowBody}>
                      <span className={styles.rowTop}>
                        <span className={styles.rowHeadline}>
                          <span className={styles.rowActor}>{words.actorName}</span>
                          <span className={styles.rowSep} aria-hidden="true">
                            {' · '}
                          </span>
                          <span className={styles.rowProject}>{words.projectLabel}</span>
                        </span>
                        {words.mentioned ? <span className={styles.rowMention}>{copy.mentionMark}</span> : null}
                        <time className={styles.rowTime} dateTime={thread.lastActivityAt}>
                          {words.time}
                        </time>
                      </span>
                      <span className={styles.rowBottom}>
                        <span className={styles.rowLine}>{words.line}</span>
                        {words.unread ? (
                          <span className={styles.unreadDot} aria-hidden="true" data-send-unread-dot="" />
                        ) : null}
                      </span>
                    </span>
                  </>
                );
                if (state.closed) {
                  return (
                    <div
                      key={thread.rootId}
                      className={styles.row}
                      data-send-inbox-row={thread.rootId}
                      data-active={isActive ? 'true' : undefined}
                      data-unread={words.unread ? 'true' : undefined}
                      data-closed="true"
                    >
                      {rowInner}
                    </div>
                  );
                }
                return (
                  <a
                    key={thread.rootId}
                    href={inboxThreadHref(organizationId, thread.rootId)}
                    className={styles.row}
                    data-send-inbox-row={thread.rootId}
                    data-active={isActive ? 'true' : undefined}
                    data-unread={words.unread ? 'true' : undefined}
                    onClick={(event) => handleSelectRow(event, thread.rootId)}
                  >
                    {rowInner}
                  </a>
                );
              })}

              {!state.closed && state.next ? (
                <button
                  type="button"
                  className={styles.moreBtn}
                  data-send-inbox-more
                  disabled={state.loadingMore}
                  onClick={() => dispatchInbox({ type: 'more' })}
                >
                  {state.loadingMore ? copy.loading : copy.loadMore}
                </button>
              ) : null}
            </>
          )}
        </div>
      </aside>

      <section className={styles.right}>
        {selectedRootId ? (
          <SendThreadView
            organizationId={organizationId}
            rootId={selectedRootId}
            locale={locale}
            copy={copy}
            transport={activeTransport}
            invite={send.invite}
            inviteTransport={inviteTransport}
            initialThread={matchingInitialThread}
            initialGone={matchingInitialGone}
            markSeedRead={Boolean(matchingInitialThread)}
            initialPeople={initialPeople}
            closed={state.closed}
            headEnd={bellSlot}
            onThreadLoaded={handleThreadLoaded}
            onReplyPosted={handleReplyPosted}
            onClosed={handleThreadClosed}
          />
        ) : state.closed ? (
          <div className={styles.pickWrap} data-send-inbox-closed="true">
            <div className={styles.pickHead}>{bellSlot}</div>
            <div className={styles.pickEmpty}>
              <span>{copy.threadGone}</span>
            </div>
          </div>
        ) : (
          <div className={styles.pickWrap} data-send-inbox-pick>
            <div className={styles.pickHead}>{bellSlot}</div>
            <div className={styles.pickEmpty}>
              <span>{copy.inboxPick}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
