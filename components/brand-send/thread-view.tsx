'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  sendInviteTransport,
  sendTransport,
  type SendInviteTransport,
  type SendTransport,
} from '@/components/brand-rooms/chat/transport';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
import type { SendMessage, SendPerson, SendPosted, SendThreadPage, SendThreadSummary } from '@/lib/brand-rooms/send-contracts';
import { SendComposer, type SendComposerSubmit } from './composer';
import { SendFileCardView } from './file-card';
import { SendFileStage } from './file-stage';
import { fileStageModel } from './file-stage-model';
import { SendInviteChips } from './invite-chips';
import { extractCopyableInviteTokens } from './invite-model';
import {
  fileCardInfo,
  formatSendClock,
  formatSendFullTime,
  formatThreadDay,
  initialChar,
  initialThreadPollState,
  refusalMessageText,
  sendRefusalOutcome,
  splitSendMentionRuns,
  threadHeadLead,
  threadPollIntervalMs,
  threadPollReduce,
  threadStreamItems,
  type SendCopy,
  type SendLocale,
  type ThreadPollAction,
  type ThreadPollCommand,
  type ThreadPollState,
} from './model';
import styles from './thread-view.module.css';

export interface SendThreadViewProps {
  organizationId: string;
  rootId: string;
  locale: SendLocale;
  copy: SendCopy;
  transport?: SendTransport;
  invite?: boolean;
  inviteTransport?: SendInviteTransport;
  initialThread?: SendThreadPage | null;
  initialGone?: boolean;
  markSeedRead?: boolean;
  initialPeople?: readonly SendPerson[];
  closed?: boolean;
  stage?: boolean;
  /** The instant day dividers are read against on the first render (see SendInboxPage.renderedAt); the live clock when absent. */
  now?: Date;
  headEnd?: ReactNode;
  onThreadLoaded?: (thread: SendThreadSummary, marked: boolean) => void;
  onReplyPosted?: (posted: SendPosted) => void;
  onClosed?: () => void;
}

function isDocumentVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

function HeadThumbGlyph({ available }: { available: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.headThumbIcon}>
      {available ? (
        <>
          <rect x="3" y="4.5" width="14" height="11" rx="2" />
          <circle cx="7.5" cy="8.5" r="1.2" />
          <path d="M4.5 14l3.5-3.5 2.5 2.5 2-2 3 3" />
        </>
      ) : (
        <>
          <path d="M4 4l12 12" />
          <rect x="3" y="4.5" width="14" height="11" rx="2" />
        </>
      )}
    </svg>
  );
}

function MessageRow({
  message,
  isRoot,
  pending,
  fileCard,
  invite = false,
  inviteTokens,
  locale,
  copy,
}: {
  message: SendMessage;
  isRoot: boolean;
  pending: boolean;
  fileCard?: ReactNode;
  invite?: boolean;
  inviteTokens?: Readonly<Record<string, string>>;
  locale: SendLocale;
  copy: SendCopy;
}) {
  const trimmedAuthor = message.authorName?.trim();
  const authorLabel = trimmedAuthor || (message.mine ? copy.you : copy.someone);
  const showSelfTag = message.mine && Boolean(trimmedAuthor);
  const runs = splitSendMentionRuns(message.body, message.mentions);

  return (
    <article
      className={styles.message}
      data-root={isRoot ? 'true' : undefined}
      data-pending={pending ? 'true' : undefined}
      aria-busy={pending ? 'true' : undefined}
      data-send-message={message.id}
    >
      <span className={styles.avatar} aria-hidden="true">
        {initialChar(trimmedAuthor || (message.mine ? copy.you : null))}
      </span>
      <div className={styles.msgBody}>
        <div className={styles.msgMeta}>
          <span className={styles.author}>{authorLabel}</span>
          {showSelfTag ? <span className={styles.selfTag}>{copy.you}</span> : null}
          <time
            className={styles.time}
            dateTime={message.createdAt}
            title={formatSendFullTime(message.createdAt, locale)}
          >
            {formatSendClock(message.createdAt, locale)}
          </time>
        </div>
        <p className={styles.text}>
          {runs.map((run, index) =>
            run.mention ? (
              <span key={index} className={styles.mention}>
                {run.text}
              </span>
            ) : (
              <span key={index}>{run.text}</span>
            ),
          )}
        </p>
        {invite && message.invites && message.invites.length > 0 ? (
          <SendInviteChips invites={message.invites} copy={copy} tokensByEmail={inviteTokens} />
        ) : null}
        {fileCard ? <div className={styles.rootCard}>{fileCard}</div> : null}
      </div>
    </article>
  );
}

const EMPTY_INVITE_TOKENS: Readonly<Record<string, Record<string, string>>> = {};

export function SendThreadView({
  organizationId,
  rootId,
  locale,
  copy,
  transport,
  invite = false,
  inviteTransport,
  initialThread = null,
  initialGone = false,
  markSeedRead = false,
  initialPeople,
  closed = false,
  stage = false,
  now,
  headEnd,
  onThreadLoaded,
  onReplyPosted,
  onClosed,
}: SendThreadViewProps) {
  const activeTransport = useMemo(() => transport ?? sendTransport(organizationId), [organizationId, transport]);
  const activeInviteTransport = useMemo(
    () => (invite ? (inviteTransport ?? sendInviteTransport(organizationId)) : null),
    [invite, inviteTransport, organizationId],
  );

  const [state, setState] = useState<ThreadPollState>(() =>
    initialThreadPollState(rootId, initialThread, initialGone, closed, markSeedRead),
  );
  const [inviteTokensByMsg, setInviteTokensByMsg] =
    useState<Readonly<Record<string, Record<string, string>>>>(EMPTY_INVITE_TOKENS);
  const stateRef = useRef(state);
  stateRef.current = state;

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orgMountedRef = useRef(organizationId);
  const initialThreadRef = useRef(initialThread);
  initialThreadRef.current = initialThread;
  const markSeedReadRef = useRef(markSeedRead);
  markSeedReadRef.current = markSeedRead;
  const initialPeopleRef = useRef(initialPeople);
  initialPeopleRef.current = initialPeople;
  const peopleCacheRef = useRef<SendPerson[] | null>(initialPeople ? [...initialPeople] : null);

  const onThreadLoadedRef = useRef(onThreadLoaded);
  onThreadLoadedRef.current = onThreadLoaded;
  const onReplyPostedRef = useRef(onReplyPosted);
  onReplyPostedRef.current = onReplyPosted;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleNextRef = useRef<() => void>(() => {});
  const runCommandRef = useRef<(cmd: ThreadPollCommand) => void>(() => {});

  const dispatchAction = useCallback((action: ThreadPollAction) => {
    const { state: nextState, command } = threadPollReduce(stateRef.current, action);
    stateRef.current = nextState;
    setState(nextState);
    if (command) {
      runCommandRef.current(command);
    }
  }, []);

  scheduleNextRef.current = () => {
    clearTimer();
    const s = stateRef.current;
    if (!mountedRef.current || !s.rootId || s.stopped || s.closed || s.gone) return;
    timerRef.current = setTimeout(() => {
      dispatchAction({ type: 'tick', visible: isDocumentVisible() });
    }, threadPollIntervalMs(isDocumentVisible()));
  };

  runCommandRef.current = (cmd: ThreadPollCommand) => {
    void activeTransport
      .thread(cmd.rootId, { markRead: cmd.markRead })
      .then((result) => {
        if (!mountedRef.current) return;
        const accepted = stateRef.current.seq === cmd.seq;
        dispatchAction({ type: 'answer', seq: cmd.seq, result, visible: isDocumentVisible() });
        if (accepted) {
          if (result.ok) {
            onThreadLoadedRef.current?.(result.thread, cmd.markRead);
          } else {
            const outcome = sendRefusalOutcome(result.code, 'thread');
            if (outcome.hideSend) {
              onClosedRef.current?.();
            }
          }
        }
        scheduleNextRef.current();
      })
      .catch(() => {
        if (!mountedRef.current) return;
        dispatchAction({
          type: 'answer',
          seq: cmd.seq,
          result: { ok: false, code: 'offline' },
          visible: isDocumentVisible(),
        });
        scheduleNextRef.current();
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    const handleVisibility = () => {
      const visible = isDocumentVisible();
      dispatchAction({ type: 'visible', visible });
      scheduleNextRef.current();
    };
    const handleFocus = () => {
      dispatchAction({ type: 'focus', visible: isDocumentVisible() });
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
    }
    return () => {
      mountedRef.current = false;
      clearTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
      }
    };
  }, [clearTimer, dispatchAction]);

  useEffect(() => {
    setInviteTokensByMsg((prev) => (Object.keys(prev).length === 0 ? prev : EMPTY_INVITE_TOKENS));
    if (orgMountedRef.current !== organizationId) {
      orgMountedRef.current = organizationId;
      peopleCacheRef.current = initialPeopleRef.current ? [...initialPeopleRef.current] : null;
      const fresh = initialThreadPollState(null, null, false);
      stateRef.current = fresh;
      setState(fresh);
    }
    const seedCandidate = initialThreadRef.current;
    const seed =
      seedCandidate && seedCandidate.thread.rootId.toLowerCase() === rootId.toLowerCase() ? seedCandidate : null;
    dispatchAction({
      type: 'open',
      rootId,
      seed,
      visible: isDocumentVisible(),
      closed,
      markSeedRead: Boolean(seed && markSeedReadRef.current),
    });
    scheduleNextRef.current();
  }, [activeTransport, closed, dispatchAction, organizationId, rootId]);

  useEffect(() => {
    if (!closed) return;
    dispatchAction({ type: 'close' });
    clearTimer();
  }, [clearTimer, closed, dispatchAction]);

  const handleLoadPeople = useCallback(async () => {
    if (peopleCacheRef.current) {
      return { ok: true as const, people: peopleCacheRef.current };
    }
    const res = await activeTransport.people();
    if (res.ok) {
      peopleCacheRef.current = res.people;
    }
    return res;
  }, [activeTransport]);

  const handleLookup = useCallback(
    async (email: string) => {
      if (!activeInviteTransport) return { ok: false as const, code: 'invalid' as const };
      return activeInviteTransport.lookup(email);
    },
    [activeInviteTransport],
  );

  const handleReplySend = useCallback(
    async (draft: SendComposerSubmit) => {
      const current = stateRef.current;
      const people = peopleCacheRef.current ?? [];
      const selfFromPeople = people.find((person) => person.me) ?? null;
      const knownMessages = current.thread ? [current.thread.root, ...current.replies] : current.replies;
      const selfFromMessages = knownMessages.find((msg) => msg.mine) ?? null;
      const authorId = selfFromPeople?.id ?? selfFromMessages?.authorId ?? null;
      const authorName = selfFromPeople?.name ?? selfFromMessages?.authorName ?? null;
      const mentionNameById = new Map<string, string | null>();
      for (const person of people) {
        mentionNameById.set(person.id, person.name);
      }
      for (const msg of knownMessages) {
        for (const m of msg.mentions) {
          if (!mentionNameById.has(m.id)) mentionNameById.set(m.id, m.name);
        }
      }
      const optimisticMentions = draft.mentions.map((id) => ({
        id,
        name: mentionNameById.get(id) ?? null,
      }));

      dispatchAction({
        type: 'queue_reply',
        requestId: draft.requestId,
        body: draft.body,
        mentions: optimisticMentions,
        authorId,
        authorName,
        createdAt: new Date().toISOString(),
      });

      let result: Awaited<ReturnType<SendInviteTransport['reply']>>;
      try {
        result =
          invite && draft.invites && draft.invites.length > 0 && activeInviteTransport
            ? await activeInviteTransport.reply({
                rootId,
                body: draft.body,
                mentions: draft.mentions,
                invites: draft.invites,
                requestId: draft.requestId,
              })
            : await activeTransport.reply({
                rootId,
                body: draft.body,
                mentions: draft.mentions,
                requestId: draft.requestId,
              });
      } catch (err) {
        if (mountedRef.current) {
          dispatchAction({ type: 'drop_reply', requestId: draft.requestId });
        }
        throw err;
      }

      if (!mountedRef.current) return result;
      if (result.ok) {
        if (invite && result.invited) {
          const tokens = extractCopyableInviteTokens(result.invited);
          if (Object.keys(tokens).length > 0) {
            setInviteTokensByMsg((prev) => ({ ...prev, [result.message.id]: tokens }));
          }
        }
        dispatchAction({ type: 'apply_reply', posted: result, requestId: draft.requestId });
        onReplyPostedRef.current?.(result);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(ROOM_ACTIVITY));
        }
        return { ok: true as const };
      }

      dispatchAction({ type: 'drop_reply', requestId: draft.requestId });
      return result;
    },
    [activeInviteTransport, activeTransport, dispatchAction, invite, rootId],
  );

  const streamRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const settledRootRef = useRef<string | null>(null);

  const items =
    state.loaded && state.thread
      ? threadStreamItems(state.thread, state.replies, state.pendingReplies, state.settledKeys)
      : null;
  const lastStreamItem = items && items.length > 0 ? items[items.length - 1] : null;
  const lastStreamKey = lastStreamItem ? `${lastStreamItem.key}:${lastStreamItem.pending ? 1 : 0}` : '';
  const lastStreamMine = Boolean(lastStreamItem?.message.mine);
  const loadedRootId = state.loaded && state.thread ? state.thread.rootId : null;

  const handleStreamScroll = useCallback(() => {
    const el = streamRef.current;
    if (!el || typeof el.scrollHeight !== 'number' || typeof el.clientHeight !== 'number') return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
  }, []);

  useLayoutEffect(() => {
    if (!loadedRootId) {
      settledRootRef.current = null;
      return;
    }
    const el = streamRef.current;
    if (!el || typeof el.scrollHeight !== 'number') return;
    if (settledRootRef.current !== loadedRootId) {
      settledRootRef.current = loadedRootId;
      nearBottomRef.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (nearBottomRef.current || lastStreamMine) {
      nearBottomRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
  }, [lastStreamKey, lastStreamMine, loadedRootId]);

  const handleComposerClosed = useCallback(() => {
    dispatchAction({ type: 'close' });
    clearTimer();
    onClosedRef.current?.();
  }, [clearTimer, dispatchAction]);

  if (state.gone || state.closed) {
    return (
      <section
        className={styles.wrap}
        data-send-thread-closed={state.closed ? 'true' : undefined}
        data-send-thread-gone={!state.closed ? '' : undefined}
      >
        {headEnd ? (
          <div className={styles.head}>
            <div className={styles.headTop}>
              <div className={styles.headEnd}>{headEnd}</div>
            </div>
          </div>
        ) : null}
        <div className={styles.stateBox}>
          <span>{copy.threadGone}</span>
        </div>
      </section>
    );
  }

  if (!state.loaded || !state.thread) {
    if (state.error) {
      const msg = refusalMessageText(sendRefusalOutcome(state.error, 'thread'), copy) ?? copy.failedLoad;
      return (
        <section className={styles.wrap} data-send-thread-error>
          {headEnd ? (
            <div className={styles.head}>
              <div className={styles.headTop}>
                <div className={styles.headEnd}>{headEnd}</div>
              </div>
            </div>
          ) : null}
          <div className={styles.stateBox}>
            <span>{msg}</span>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => dispatchAction({ type: 'manual', visible: isDocumentVisible() })}
            >
              {copy.retry}
            </button>
          </div>
        </section>
      );
    }

    return (
      <section className={styles.wrap} aria-busy="true" data-send-thread-loading>
        {headEnd ? (
          <div className={styles.head}>
            <div className={styles.headTop}>
              <div className={styles.headEnd}>{headEnd}</div>
            </div>
          </div>
        ) : null}
        <div className={styles.stateBox}>
          <span>{copy.loading}</span>
        </div>
      </section>
    );
  }

  const thread = state.thread;
  const headCard = fileCardInfo(thread.file, organizationId, copy);
  const headProject = thread.file.available ? (thread.file.project?.title ?? copy.unfiled) : copy.fileGone;
  const composerInvite = invite && thread.file.kind !== 'image';
  const threadMatchesRoot = thread.rootId.toLowerCase() === rootId.toLowerCase();
  let lastDay = '';

  const pollError =
    state.error && !state.closed
      ? (refusalMessageText(sendRefusalOutcome(state.error, 'thread'), copy) ?? copy.failedLoad)
      : null;

  const headEl = (
    <header className={styles.head}>
      <div className={styles.headTop}>
        <div className={styles.headMain}>
          <span className={styles.headThumb}>
            {headCard.available && headCard.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headCard.thumbUrl}
                alt=""
                width={36}
                height={27}
                loading="lazy"
                className={styles.headThumbImg}
              />
            ) : (
              <HeadThumbGlyph available={headCard.available} />
            )}
          </span>
          <div className={styles.headCopy}>
            <span className={styles.headProject}>{headProject}</span>
            <p className={styles.lead}>{threadHeadLead(thread.root.authorName, copy)}</p>
          </div>
        </div>
        <div className={styles.headRight}>
          {headCard.openHref ? (
            <a href={headCard.openHref} className={styles.headOpen} data-send-head-open>
              {copy.openFile}
            </a>
          ) : null}
          {headEnd ? <div className={styles.headEnd}>{headEnd}</div> : null}
        </div>
      </div>
    </header>
  );

  const streamEl = (
    <div ref={streamRef} className={styles.stream} onScroll={handleStreamScroll} data-send-thread-stream>
      {(items ?? []).map((item) => {
        const day = formatThreadDay(item.message.createdAt, locale, copy, now);
        const showDay = day !== '' && day !== lastDay;
        if (day) lastDay = day;
        return (
          <div key={item.key}>
            {showDay ? <div className={styles.dayDivider}>{day}</div> : null}
            <MessageRow
              message={item.message}
              isRoot={item.isRoot}
              pending={item.pending}
              fileCard={
                item.isRoot && !stage ? <SendFileCardView file={thread.file} organizationId={organizationId} copy={copy} /> : undefined
              }
              invite={invite}
              inviteTokens={invite ? inviteTokensByMsg[item.message.id] : undefined}
              locale={locale}
              copy={copy}
            />
          </div>
        );
      })}
    </div>
  );

  const composerEl = !state.closed ? (
    <div className={styles.composerDock}>
      {pollError ? (
        <p className={styles.inlineError} role="status">
          {pollError}
        </p>
      ) : null}
      <SendComposer
        key={thread.rootId}
        copy={copy}
        placeholder={copy.replyPlaceholder}
        hint={copy.composerHint}
        refusalContext="compose_reply"
        invite={composerInvite}
        lookupAddress={composerInvite ? handleLookup : undefined}
        initialPeople={initialPeople}
        loadPeople={handleLoadPeople}
        onSend={handleReplySend}
        onClosed={handleComposerClosed}
        ariaLabel={copy.replyPlaceholder}
      />
    </div>
  ) : null;

  if (stage) {
    const stageVariant = threadMatchesRoot ? fileStageModel(thread.file, copy).variant : 'switching';
    return (
      <section className={styles.wrap} data-send-thread={thread.rootId} data-send-stage="true">
        {headEl}
        <div className={styles.stageShell}>
          <div className={styles.stageBody} data-send-thread-split="true">
            <div className={styles.stagePane} data-stage-variant={stageVariant}>
              {threadMatchesRoot ? (
                <SendFileStage rootId={thread.rootId} file={thread.file} copy={copy} />
              ) : null}
            </div>
            <div className={styles.convoPane}>
              {streamEl}
              {composerEl}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.wrap} data-send-thread={thread.rootId}>
      {headEl}
      {streamEl}
      {composerEl}
    </section>
  );
}
