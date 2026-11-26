'use client';
/**
 * Shell bell button and popover window for 직접 만들기 (docs/BRAND-PROJECT-SPINE.md §5.4; slice 3a Batch C).
 * Renders nothing when no active BellProvider context exists (or in 야기 팀과 mode / closed orgs).
 */
import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { interpolate } from '@/lib/i18n/format';
import {
  BELL_WINDOW_MAX,
  bellAccessibleLabel,
  bellBadgeText,
  bellCanMarkAllRead,
  bellCanMarkRead,
  bellLineProjectLabel,
  bellLineText,
  bellLineTime,
  bellSeeAllHref,
  bellThreadActorName,
  type BellItem,
  type BellLineKind,
} from './model';
import { useBell } from './provider';
import styles from './bell.module.css';

export interface WorkspaceBellProps {
  size?: 'default' | 'compact';
}

function KindGlyph({ kind }: { kind: BellLineKind }) {
  if (kind === 'storyboard') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.kindIcon} data-bell-kind-icon="storyboard">
        <rect x="3" y="4.5" width="14" height="11" rx="2" />
        <path d="M3 9h14M10 9v6.5" />
      </svg>
    );
  }
  if (kind === 'review') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.kindIcon} data-bell-kind-icon="review">
        <rect x="3" y="4.5" width="14" height="11" rx="2" />
        <path d="M8.5 8l4 2-4 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.kindIcon} data-bell-kind-icon="conversation">
      <path d="M4 5.5h12v7H9.5L6 15.5v-3H4z" />
    </svg>
  );
}

export function WorkspaceBell({ size = 'default' }: WorkspaceBellProps) {
  const bell = useBell();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const windowId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !wrapRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const onFocusIn = (event: FocusEvent['nativeEvent'] | globalThis.FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && target !== document.body && !wrapRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  if (!bell || !bell.copy) return null;
  const { copy, locale } = bell;

  const displayUnread = bell.loaded ? bell.unread : 0;
  const badge = bellBadgeText(displayUnread);
  const buttonLabel = bellAccessibleLabel(displayUnread, copy);
  const shownItems = bell.items.slice(0, BELL_WINDOW_MAX);
  const renderNow = new Date();

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !wrapRef.current?.contains(next)) {
      setOpen(false);
    }
  };

  const handleMarkRead = (item: BellItem) => {
    // Keep focus inside the open dialog before the row's action button unmounts after markRead succeeds.
    windowRef.current?.focus();
    void bell.markRead(item);
  };

  const sendCopy = bell.sendOpen && bell.sendCopy ? bell.sendCopy : null;
  const sendOpen = Boolean(sendCopy);
  const activeView = bell.view ?? 'all';
  const mentionsBadge = sendOpen ? bellBadgeText(bell.mentionsUnread ?? 0) : null;
  const canMarkAll = sendOpen ? bellCanMarkAllRead({ unread: displayUnread, items: shownItems }, { sendOpen }) : false;

  const handleMarkAllRead = () => {
    if (!sendOpen || !bell.markAllRead) return;
    windowRef.current?.focus();
    void bell.markAllRead();
  };

  const seeAllHref = bellSeeAllHref(bell.organizationId, {
    sendOpen: sendOpen || Boolean(bell.sendConfigured && !bell.loaded),
    view: activeView,
  });

  return (
    <div ref={wrapRef} className={styles.wrap} data-bell-wrap="" onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        data-bell=""
        data-size={size === 'compact' ? 'compact' : undefined}
        aria-label={buttonLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? windowId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.icon}>
          <path d="M5.2 8.4a4.8 4.8 0 0 1 9.6 0c0 3.9 1.6 5 1.6 5H3.6s1.6-1.1 1.6-5zM8.3 15.8a1.8 1.8 0 0 0 3.4 0" />
        </svg>
        {badge ? (
          <span className={styles.count} data-bell-count="">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={windowRef}
          id={windowId}
          tabIndex={-1}
          className={styles.window}
          role="dialog"
          aria-label={copy.bellTitle}
          data-bell-window=""
        >
          <div className={styles.head}>
            {sendCopy ? (
              <>
                <div className={styles.headMain}>
                  <strong className={styles.title}>{copy.bellTitle}</strong>
                  <div className={styles.views} role="group" aria-label={copy.bellTitle} data-bell-views="">
                    <button
                      type="button"
                      className={styles.viewBtn}
                      data-bell-view="all"
                      aria-pressed={activeView === 'all'}
                      onClick={() => bell.setView?.('all')}
                    >
                      {sendCopy.viewAll}
                    </button>
                    <button
                      type="button"
                      className={styles.viewBtn}
                      data-bell-view="mentions"
                      aria-pressed={activeView === 'mentions'}
                      onClick={() => bell.setView?.('mentions')}
                    >
                      <span>{sendCopy.viewMentions}</span>
                      {mentionsBadge ? (
                        <span className={styles.viewCount} data-bell-mentions-count="">
                          {mentionsBadge}
                        </span>
                      ) : null}
                    </button>
                  </div>
                </div>
                {activeView === 'all' ? (
                  <button
                    type="button"
                    className={styles.markAll}
                    data-bell-mark-all=""
                    disabled={!canMarkAll || Boolean(bell.markingAll)}
                    onClick={handleMarkAllRead}
                  >
                    {sendCopy.markAllRead}
                  </button>
                ) : null}
              </>
            ) : (
              <strong className={styles.title}>{copy.bellTitle}</strong>
            )}
          </div>

          <div className={styles.scroll} aria-busy={sendCopy && bell.viewLoading ? true : undefined}>
            {sendCopy && bell.viewLoading ? (
              <p className={styles.empty} data-bell-loading="">
                {sendCopy.loading}
              </p>
            ) : shownItems.length === 0 ? (
              <p className={styles.empty} data-bell-empty="">
                {sendCopy && activeView === 'mentions' ? sendCopy.inboxMentionsEmpty : copy.bellEmpty}
              </p>
            ) : (
              <ul className={styles.list}>
                {shownItems.map((item) => {
                  const projectLabel = bellLineProjectLabel(item, copy.general, sendCopy);
                  const isSendThread = Boolean(sendCopy && item.kind === 'thread');
                  const actorName = isSendThread ? bellThreadActorName(item, sendCopy) : '';
                  const lineText = bellLineText(item, copy, { sendOpen });
                  const timeText = bellLineTime(item, locale, renderNow);
                  const canMark = bellCanMarkRead(item, { sendOpen });
                  const unreadBadge =
                    item.kind === 'conversation' && item.unreadCount > 0
                      ? interpolate(copy.unread, { count: item.unreadCount })
                      : null;

                  return (
                    <li
                      key={item.id}
                      className={styles.row}
                      data-bell-item={item.id}
                      data-kind={item.kind}
                      data-unread={item.unread ? 'true' : undefined}
                      data-can-mark={canMark ? 'true' : undefined}
                    >
                      <a href={item.href} className={styles.item} onClick={() => setOpen(false)}>
                        <span className={styles.media} aria-hidden={!item.thumbUrl}>
                          {item.thumbUrl ? (
                            <img
                              className={styles.thumb}
                              src={item.thumbUrl}
                              alt=""
                              width={40}
                              height={40}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <KindGlyph kind={item.kind} />
                          )}
                        </span>
                        <span className={styles.body}>
                          <span className={styles.topLine}>
                            {isSendThread && sendCopy ? (
                              <>
                                <span className={styles.actor}>{actorName}</span>
                                {projectLabel ? <span className={styles.context}> · {projectLabel}</span> : null}
                                {item.mentioned ? (
                                  <span className={styles.mentionBadge} data-bell-mention="">
                                    {sendCopy.mentionMark}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <>
                                <span className={styles.project}>{projectLabel}</span>
                                {unreadBadge ? (
                                  <span className={styles.badge} data-bell-item-unread="">
                                    {unreadBadge}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </span>
                          <span className={styles.line}>{lineText}</span>
                        </span>
                      </a>
                      <span className={styles.side} data-bell-side="">
                        <span className={styles.sideMeta}>
                          <time className={styles.time} dateTime={item.at}>
                            {timeText}
                          </time>
                          {item.unread ? <span className={styles.dot} aria-hidden="true" data-bell-dot="" /> : null}
                        </span>
                        {canMark ? (
                          <button
                            type="button"
                            className={styles.markRead}
                            data-bell-mark-read={item.id}
                            onClick={() => handleMarkRead(item)}
                          >
                            {copy.bellMarkRead}
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <a
            className={styles.all}
            href={seeAllHref}
            data-bell-see-all=""
            data-bell-more={bell.more ? 'true' : undefined}
            onClick={() => setOpen(false)}
          >
            {copy.bellSeeAll}
          </a>
        </div>
      ) : null}
    </div>
  );
}
