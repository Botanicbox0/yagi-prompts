'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  sendInviteTransport,
  sendTransport,
  type SendInviteTransport,
  type SendTransport,
} from '@/components/brand-rooms/chat/transport';
import type { SendFileRef, SendFileThreads, SendPerson } from '@/lib/brand-rooms/send-contracts';
import { SendComposer, type SendComposerSubmit } from './composer';
import { SendInviteChips } from './invite-chips';
import { extractCopyableInviteTokens, inviteRefusalOutcome } from './invite-model';
import {
  inboxThreadHref,
  initialChar,
  initialSendFileState,
  isComposingKeyEvent,
  refusalMessageText,
  sendFileItems,
  sendFileReduce,
  sendFileRefKey,
  sendPanelLineWords,
  sendRefusalOutcome,
  type SendCopy,
  type SendFileAction,
  type SendFileState,
  type SendLocale,
} from './model';
import styles from './send-panel.module.css';

export interface SendPanelProps {
  organizationId: string;
  fileRef: SendFileRef;
  copy: SendCopy;
  locale: SendLocale;
  transport?: SendTransport;
  invite?: boolean;
  inviteTransport?: SendInviteTransport;
  initialFile?: SendFileThreads | null;
  initialPeople?: readonly SendPerson[];
  autoFocus?: boolean;
  closeLabel?: string;
  onClose: () => void;
  onClosed?: () => void;
  onUnsendable?: (fileKey: string) => void;
  onInnerEscape?: () => void;
}

const EMPTY_INVITE_TOKENS: Readonly<Record<string, Record<string, string>>> = {};

export function SendPanel({
  organizationId,
  fileRef,
  copy,
  locale,
  transport,
  invite = false,
  inviteTransport,
  initialFile,
  initialPeople,
  autoFocus = false,
  closeLabel,
  onClose,
  onClosed,
  onUnsendable,
  onInnerEscape,
}: SendPanelProps) {
  const refKind = fileRef.kind;
  const refId = fileRef.kind === 'output' ? fileRef.outputId : fileRef.assetId;
  const fileKey = sendFileRefKey(fileRef);

  const activeTransport = useMemo(
    () => transport ?? sendTransport(organizationId),
    [transport, organizationId],
  );
  const activeInviteTransport = useMemo(
    () => (invite ? (inviteTransport ?? sendInviteTransport(organizationId)) : null),
    [invite, inviteTransport, organizationId],
  );

  const [state, setState] = useState<SendFileState>(() => initialSendFileState(fileKey, initialFile));
  const [inviteTokensByMsg, setInviteTokensByMsg] =
    useState<Readonly<Record<string, Record<string, string>>>>(EMPTY_INVITE_TOKENS);
  const stateRef = useRef<SendFileState>(state);
  const mountedRef = useRef(true);
  const loadedTargetRef = useRef<string | null>(initialFile ? `${organizationId}:${fileKey}` : null);
  const peopleCacheRef = useRef<SendPerson[] | null>(initialPeople ? [...initialPeople] : null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const onUnsendableRef = useRef(onUnsendable);
  onUnsendableRef.current = onUnsendable;
  const onInnerEscapeRef = useRef(onInnerEscape);
  onInnerEscapeRef.current = onInnerEscape;

  const dispatch = useCallback((action: SendFileAction) => {
    const { state: next, command } = sendFileReduce(stateRef.current, action);
    stateRef.current = next;
    setState(next);
    return command;
  }, []);

  const loadFile = useCallback(
    (targetTransport: SendTransport, kind: SendFileRef['kind'], id: string, key: string) => {
      if (stateRef.current.closed) return;
      const ref: SendFileRef = kind === 'output' ? { kind: 'output', outputId: id } : { kind: 'asset', assetId: id };
      const command = dispatch({ type: 'start', fileKey: key });
      if (!command) return;
      void targetTransport
        .file(ref)
        .then((result) => {
          if (!mountedRef.current) return;
          const accepted = stateRef.current.seq === command.seq;
          dispatch({ type: 'answer', seq: command.seq, result });
          if (!accepted || result.ok) return;
          if (result.code === 'not_found') {
            onUnsendableRef.current?.(key);
          } else {
            const outcome = sendRefusalOutcome(result.code, 'file');
            if (outcome.hideSend) {
              onClosedRef.current?.();
            }
          }
        })
        .catch(() => {
          if (!mountedRef.current) return;
          dispatch({ type: 'answer', seq: command.seq, result: { ok: false, code: 'offline' } });
        });
    },
    [dispatch],
  );

  useEffect(() => {
    mountedRef.current = true;
    setInviteTokensByMsg((prev) => (Object.keys(prev).length === 0 ? prev : EMPTY_INVITE_TOKENS));
    return () => {
      mountedRef.current = false;
      if (stateRef.current.postGone) {
        onUnsendableRef.current?.(fileKey);
      }
    };
  }, [fileKey]);

  const closeByUser = useCallback(() => {
    if (stateRef.current.postGone) {
      onUnsendableRef.current?.(fileKey);
    }
    onCloseRef.current();
  }, [fileKey]);

  useEffect(() => {
    if (stateRef.current.closed) return;
    if (initialFile) {
      loadedTargetRef.current = `${organizationId}:${fileKey}`;
      return;
    }
    const loadKey = `${organizationId}:${fileKey}`;
    if (loadedTargetRef.current === loadKey) return;
    loadedTargetRef.current = loadKey;
    loadFile(activeTransport, refKind, refId, fileKey);
  }, [activeTransport, fileKey, initialFile, loadFile, organizationId, refId, refKind]);

  const loadPeople = useCallback(async () => {
    if (peopleCacheRef.current) {
      return { ok: true as const, people: peopleCacheRef.current };
    }
    const res = await activeTransport.people();
    if (res.ok) {
      peopleCacheRef.current = [...res.people];
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

  const handleSend = useCallback(
    async ({ body, mentions, invites, requestId }: SendComposerSubmit) => {
      const ref: SendFileRef =
        refKind === 'output' ? { kind: 'output', outputId: refId } : { kind: 'asset', assetId: refId };
      dispatch({
        type: 'queue_post',
        requestId,
        body,
        createdAt: new Date().toISOString(),
        authorName: copy.you,
      });
      try {
        const res =
          invite && invites && invites.length > 0 && activeInviteTransport
            ? await activeInviteTransport.post({ requestId, file: ref, body, mentions, invites })
            : await activeTransport.post({ requestId, file: ref, body, mentions });
        if (!mountedRef.current) {
          return res.ok ? { ok: true as const } : res;
        }
        if (res.ok) {
          if (invite && res.invited) {
            const tokens = extractCopyableInviteTokens(res.invited);
            if (Object.keys(tokens).length > 0) {
              setInviteTokensByMsg((prev) => ({ ...prev, [res.message.id]: tokens }));
            }
          }
          dispatch({ type: 'apply_post', requestId, posted: res });
          return { ok: true as const };
        }
        dispatch({ type: 'drop_post', requestId });
        if (res.code === 'not_found') {
          dispatch({ type: 'post_gone' });
        } else {
          const carriedInvites = Boolean(invite && invites && invites.length > 0);
          const refusedList = 'refused' in res && Array.isArray(res.refused) ? (res.refused as readonly string[]) : undefined;
          const outcome = invite
            ? inviteRefusalOutcome(
                res.code,
                refusedList,
                'compose_post',
                copy,
                carriedInvites,
              )
            : sendRefusalOutcome(res.code, 'compose_post');
          if (outcome.hideSend) {
            onClosedRef.current?.();
          }
        }
        return res;
      } catch {
        if (mountedRef.current) {
          dispatch({ type: 'drop_post', requestId });
        }
        return { ok: false as const, code: 'offline' as const };
      }
    },
    [activeInviteTransport, activeTransport, copy, dispatch, invite, refId, refKind],
  );

  const handleEscapeCapture = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      onInnerEscapeRef.current?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && !isComposingKeyEvent(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent?.stopPropagation?.();
      closeByUser();
    }
  };

  const items = sendFileItems(state.threads, state.pendingPosts, state.settledKeys);
  const initialFileGone = Boolean(state.file && !state.file.available);
  const fileGone = state.postGone || initialFileGone;
  const canCompose = !state.closed && !state.unsendable && (!initialFileGone || state.postGone);
  const loadErrorText = state.error
    ? refusalMessageText(sendRefusalOutcome(state.error, 'file'), copy)
    : null;

  return (
    <section
      className={styles.panel}
      aria-label={copy.action}
      data-send-panel
      onKeyDownCapture={handleEscapeCapture}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <h3 className={styles.title}>{copy.action}</h3>
          <p className={styles.sub} data-send-file-gone={fileGone ? 'true' : undefined}>
            {fileGone ? copy.fileGone : copy.sendSub}
          </p>
        </div>
        {closeLabel ? (
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={closeLabel}
            title={closeLabel}
            data-send-panel-close
            onClick={closeByUser}
          >
            <svg className={styles.closeIcon} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>

      {state.closed ? (
        <p className={styles.note} data-send-panel-closed>
          {copy.threadGone}
        </p>
      ) : (
        <>
          {state.loading && !state.loaded ? <p className={styles.note}>{copy.loading}</p> : null}

          {loadErrorText ? (
            <div className={styles.errorBox} role="alert" data-send-file-error>
              <span>{loadErrorText}</span>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => loadFile(activeTransport, refKind, refId, fileKey)}
              >
                {copy.retry}
              </button>
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul className={styles.list}>
              {items.map((item) => {
                const words = sendPanelLineWords(item.thread, copy, locale);
                if (item.pending) {
                  return (
                    <li key={item.key} className={styles.row} aria-busy="true" data-send-pending>
                      <div className={styles.rowPending}>
                        <span className={styles.avatar} title={words.who} aria-hidden="true">
                          {initialChar(words.who)}
                        </span>
                        <span className={styles.rowText}>{words.firstWords}</span>
                        <span className={styles.meta}>{words.time}</span>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={item.key} className={styles.row}>
                    <a className={styles.rowLink} href={inboxThreadHref(organizationId, item.thread.rootId)}>
                      <span className={styles.avatar} title={words.who} aria-hidden="true">
                        {initialChar(words.who)}
                      </span>
                      <span className={styles.rowText}>{words.firstWords}</span>
                      <span className={styles.meta}>
                        {words.replyCountText ? `${words.time} · ${words.replyCountText}` : words.time}
                      </span>
                    </a>
                    {invite && item.thread.root.invites && item.thread.root.invites.length > 0 ? (
                      <SendInviteChips
                        invites={item.thread.root.invites}
                        copy={copy}
                        tokensByEmail={inviteTokensByMsg[item.thread.root.id]}
                        compact
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {canCompose ? (
            <div className={styles.composerSticky} data-send-panel-composer>
              <SendComposer
                copy={copy}
                placeholder={copy.sendPlaceholder}
                hint={copy.sendHint}
                onSend={handleSend}
                loadPeople={loadPeople}
                invite={invite}
                lookupAddress={invite ? handleLookup : undefined}
                showNoMentionHint
                submitDisabled={state.postGone}
                hideNotFoundError
                refusalContext="compose_post"
                autoFocus={autoFocus}
                initialPeople={initialPeople}
                compact
                onClosed={() => {
                  onClosedRef.current?.();
                  closeByUser();
                }}
                ariaLabel={copy.action}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
