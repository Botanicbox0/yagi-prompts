"use client";
/**
 * A conversation on screen (docs/BRAND-ROOMS.md §4): the stream with day dividers, grouped lines, the
 * "new" divider, the earlier project conversation at the start, pinned lines, a thread in a side panel
 * and the composer. The same component serves the brand (inbox, room tab) and the team (admin), through
 * whichever transport it is handed. `RefThreadView` is the compact column beside a cut or a deliverable.
 */
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { interpolate } from "@/lib/i18n/format";
import { continuesGroup, dayKey, parseRefKey, type RoomMessage, type RoomPerson, type RoomReaction } from "@/lib/brand-rooms/message-contracts";
import type { RoomsChatCopy } from "@/messages/rooms-chat";
import { Composer, errorText, type ComposerDraft } from "./composer";
import { dayLabel, fullLabel } from "./format";
import { AuthorName, MessageItem, type MessageActions } from "./message";
import type { ChatTransport, Fail } from "./transport";
import { useFeed, useReadMark, type ShownMessage } from "./use-feed";
import { ChatPresenceContext, readMarkAllowed } from "./presence";

type Locale = "ko" | "en";

function useFlash() {
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timer);
  }, [flash]);
  return [flash, setFlash] as const;
}

function viewerOf(messages: readonly ShownMessage[], parent?: ShownMessage | null): { authorId: string | null; authorName: string | null } {
  const mine = [...(parent ? [parent] : []), ...messages].find((m) => m.mine && !m.pending && m.authorId);
  return { authorId: mine?.authorId ?? null, authorName: mine?.authorName ?? null };
}

/** The actions a line gets, wired to a feed; refusals become one short sentence. */
function useLineActions(
  feed: ReturnType<typeof useFeed>,
  transport: ChatTransport,
  copy: RoomsChatCopy,
  setFlash: (text: string) => void,
  onReply?: (message: RoomMessage) => void,
): MessageActions {
  return useMemo(() => {
    const report = (result: { ok: true } | Fail) => {
      if (!result.ok) setFlash(errorText(copy, result.code));
      return result.ok;
    };
    return {
      onReply,
      onReact: transport.react ? (id: string, emoji: RoomReaction) => void feed.react(id, emoji).then(report) : undefined,
      onEdit: transport.edit ? async (id: string, body: string) => report(await feed.edit(id, body)) : undefined,
      onDelete: (id: string) => void feed.remove(id).then(report),
      onPin: transport.pin ? (id: string, pinned: boolean) => void feed.pin(id, pinned).then(report) : undefined,
    };
  }, [copy, feed, onReply, setFlash, transport]);
}

/* ----------------------------------------------------------------- thread */

function ThreadPanel({
  transport,
  channel,
  parent,
  copy,
  locale,
  canTalk,
  canPin,
  canDeleteAny,
  people,
  lastReadAt,
  onClose,
  onSent,
}: {
  transport: ChatTransport;
  channel: string;
  parent: RoomMessage;
  copy: RoomsChatCopy;
  locale: Locale;
  canTalk: boolean;
  canPin: boolean;
  canDeleteAny: boolean;
  people: readonly RoomPerson[];
  lastReadAt: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [flash, setFlash] = useFlash();
  const viewer = viewerOf([], parent);
  const feed = useFeed(transport, channel, { kind: "thread", parentId: parent.id }, viewer);
  const actions = useLineActions(feed, transport, copy, setFlash);
  const head = feed.state.parent ?? parent;
  const peopleNames = useMemo(() => new Map((feed.state.people.length ? feed.state.people : people).map((p) => [p.id, p.name])), [feed.state.people, people]);
  const listRef = useRef<HTMLDivElement>(null);
  const count = feed.state.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <aside className="brc-thread" aria-label={copy.thread.title} data-room-thread={parent.id}>
      <header className="brc-thread-head">
        <h3>{copy.thread.title}</h3>
        <button type="button" className="brc-icon-btn" onClick={onClose} aria-label={copy.thread.close} title={copy.thread.close}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M6 6l8 8M14 6l-8 8" />
          </svg>
        </button>
      </header>
      <div className="brc-thread-list" ref={listRef}>
        <MessageItem message={head} grouped={false} copy={copy} locale={locale} peopleNames={peopleNames} canPin={canPin} canDeleteAny={canDeleteAny} refHref={transport.refHref} inThread {...actions} />
        {head.replyCount > 0 && <div className="brc-thread-rule" role="separator">{head.replyCount === 1 ? copy.thread.oneReply : interpolate(copy.thread.replies, { count: head.replyCount })}</div>}
        {feed.state.messages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            grouped={continuesGroup(feed.state.messages[i - 1] ?? null, m)}
            copy={copy}
            locale={locale}
            peopleNames={peopleNames}
            canPin={canPin}
            canDeleteAny={canDeleteAny}
            refHref={transport.refHref}
            lastReadAt={lastReadAt}
            inThread
            {...actions}
          />
        ))}
      </div>
      {flash && (
        <p className="brc-flash" role="status">
          {flash}
        </p>
      )}
      {canTalk && !head.deleted && (
        <Composer
          copy={copy}
          locale={locale}
          people={feed.state.people.length ? feed.state.people : people}
          placeholder={copy.composer.placeholderThread}
          allowTeamMention={transport.side === "brand"}
          upload={transport.upload ? (file, mime, p) => transport.upload!(channel, file, mime, p) : undefined}
          onSend={async (draft) => {
            const result = await feed.send({ ...draft, parentId: parent.id });
            if (result.ok) onSent();
            return result;
          }}
          compact
          autoFocus
          selfId={viewer.authorId}
        />
      )}
    </aside>
  );
}

/* ----------------------------------------------------------------- pinned */

function PinnedList({ pinned, copy, locale, onJump }: { pinned: readonly RoomMessage[]; copy: RoomsChatCopy; locale: Locale; onJump: (m: RoomMessage) => void }) {
  if (pinned.length === 0) return <p className="brc-pinned-empty">{copy.channel.pinnedEmpty}</p>;
  return (
    <ul className="brc-pinned-list">
      {pinned.map((m) => (
        <li key={m.id}>
          <button type="button" className="brc-pinned-item" onClick={() => onJump(m)}>
            <span className="brc-pinned-meta">
              <AuthorName message={m} copy={copy} />
              <time dateTime={m.createdAt}>{fullLabel(m.createdAt, locale)}</time>
            </span>
            <span className="brc-pinned-body">{m.body || m.attachments[0]?.name || (m.event ? copy.events[m.event] : "")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- channel */

export interface ChannelViewProps {
  transport: ChatTransport;
  channel: string;
  locale: Locale;
  copy: RoomsChatCopy;
  canTalk: boolean;
  layout: "fill" | "flow";
  /** The title area (inbox, admin). Without it only the pinned control shows. */
  header?: ReactNode;
  /** The channel's name for the composer's placeholder. */
  channelName?: string;
}

export function ChannelView({ transport, channel, locale, copy, canTalk, layout, header, channelName }: ChannelViewProps) {
  const [flash, setFlash] = useFlash();
  const [thread, setThread] = useState<RoomMessage | null>(null);
  const [showPinned, setShowPinned] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [seen, setSeen] = useState(false);
  const viewerHint = useRef<{ authorId: string | null; authorName: string | null }>({ authorId: null, authorName: null });
  const feed = useFeed(transport, channel, { kind: "stream" }, viewerHint.current);
  const { state } = feed;
  viewerHint.current = viewerOf(state.messages);
  const openThread = useCallback((m: RoomMessage) => setThread(m), []);
  const actions = useLineActions(feed, transport, copy, setFlash, openThread);
  const peopleNames = useMemo(() => new Map(state.people.map((p) => [p.id, p.name])), [state.people]);
  const talk = canTalk && state.canTalk;
  const canDeleteAny = transport.side === "team";

  useEffect(() => {
    setThread(null);
    setShowPinned(false);
  }, [channel]);

  // Keep the open thread's head in step with the stream (reply counts, edits).
  useEffect(() => {
    if (!thread) return;
    const fresh = state.messages.find((m) => m.id === thread.id);
    if (fresh && fresh.updatedAt !== thread.updatedAt) setThread(fresh);
  }, [state.messages, thread]);

  // Where the person stopped reading: the first newer line not their own gets the divider.
  const firstUnreadId = useMemo(() => {
    if (!state.lastReadAt) return null;
    return state.messages.find((m) => !m.mine && !m.pending && m.createdAt > state.lastReadAt!)?.id ?? null;
  }, [state.lastReadAt, state.messages]);

  /* scrolling (fill: the stream scrolls inside the panel) */
  const scrollToBottom = useCallback(() => {
    if (layout === "fill") {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [layout]);

  const settled = useRef(false);
  useEffect(() => {
    settled.current = false;
  }, [channel]);
  useLayoutEffect(() => {
    if (state.status !== "ready" || settled.current) return;
    settled.current = true;
    const divider = firstUnreadId ? document.getElementById(`brc-msg-${firstUnreadId}`) : null;
    if (layout !== "fill") {
      // In a page that scrolls (a room tab), only new lines are worth moving the page for.
      divider?.scrollIntoView({ block: "center" });
      return;
    }
    const el = scrollRef.current;
    if (divider && el) el.scrollTop = Math.max(0, divider.offsetTop - 80);
    else scrollToBottom();
  }, [firstUnreadId, layout, scrollToBottom, state.status]);

  const lastId = state.messages[state.messages.length - 1]?.id;
  const lastMine = state.messages[state.messages.length - 1]?.mine;
  useLayoutEffect(() => {
    if (!settled.current || layout !== "fill") return;
    if (nearBottom.current || lastMine) scrollToBottom();
  }, [lastId, lastMine, layout, scrollToBottom]);

  // Older pages keep the reader where they were.
  const before = useRef<number | null>(null);
  const firstId = state.messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && before.current != null) {
      el.scrollTop += el.scrollHeight - before.current;
      before.current = null;
    }
  }, [firstId, state.legacy.length]);
  const loadOlder = () => {
    if (layout === "fill" && scrollRef.current) before.current = scrollRef.current.scrollHeight;
    void feed.loadOlder();
  };

  // Seen = the end of the stream is on screen.
  useEffect(() => {
    const target = bottomRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => setSeen(entries.some((e) => e.isIntersecting)), { root: layout === "fill" ? scrollRef.current : null, threshold: 0 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [layout, state.status]);

  // Read up to the newest line or thread reply seen in this stream.
  const newestAt = useMemo(() => {
    let best: string | null = null;
    for (const m of state.messages) {
      if (m.pending) continue;
      for (const at of [m.createdAt, m.lastReplyAt]) if (at && (!best || at > best)) best = at;
    }
    return best;
  }, [state.messages]);
  // Only while the conversation is in front of the person: a shut drawer on the team's desk reads nothing.
  const presence = useContext(ChatPresenceContext);
  useReadMark(transport, channel, newestAt, readMarkAllowed({ seen, ready: state.status === "ready", visible: presence.visible, pageVisible: true }));
  const onNewest = presence.onNewest;
  useEffect(() => {
    if (state.status === "ready") onNewest?.(newestAt);
  }, [newestAt, onNewest, state.status]);

  const onSend = async (draft: ComposerDraft) => {
    nearBottom.current = true;
    const result = await feed.send(draft);
    if (layout === "flow" && result.ok) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "nearest" }));
    return result;
  };

  const jump = (m: RoomMessage) => {
    setShowPinned(false);
    const target = document.getElementById(`brc-msg-${m.parentId ?? m.id}`);
    if (target) {
      target.scrollIntoView({ block: "center" });
      target.setAttribute("data-flash", "true");
      window.setTimeout(() => target.removeAttribute("data-flash"), 1600);
    }
    if (m.parentId) {
      const parent = state.messages.find((x) => x.id === m.parentId);
      if (parent) setThread(parent);
    }
  };

  const items: ReactNode[] = [];
  let lastDay: string | null = null;
  state.messages.forEach((m, i) => {
    const day = dayKey(m.createdAt);
    const newDay = day !== lastDay;
    if (newDay) {
      lastDay = day;
      items.push(
        <div key={`day-${day}`} className="brc-day" role="separator">
          <span>{dayLabel(m.createdAt, locale, copy.channel)}</span>
        </div>,
      );
    }
    const unread = m.id === firstUnreadId;
    if (unread) {
      items.push(
        <div key="unread" className="brc-unread" role="separator" data-room-unread-divider>
          <span>{copy.channel.newDivider}</span>
        </div>,
      );
    }
    items.push(
      <MessageItem
        key={m.id}
        message={m}
        grouped={!newDay && !unread && continuesGroup(state.messages[i - 1] ?? null, m)}
        copy={copy}
        locale={locale}
        peopleNames={peopleNames}
        canPin={state.canPin}
        canDeleteAny={canDeleteAny}
        refHref={transport.refHref}
        lastReadAt={state.lastReadAt}
        {...actions}
      />,
    );
  });

  const pinnedButton = (
    <div className="brc-pinned">
      <button type="button" className="brc-chip" aria-expanded={showPinned} onClick={() => setShowPinned((v) => !v)} disabled={state.status !== "ready"} data-room-pinned={state.pinned.length}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M8 3.5h4l-.5 4 2.5 2.5H6l2.5-2.5zM10 10v6.5" />
        </svg>
        <span>{state.pinned.length ? interpolate(copy.channel.pinnedCount, { count: state.pinned.length }) : copy.channel.pinnedList}</span>
      </button>
      {showPinned && (
        <div className="brc-pinned-pop" onKeyDown={(e) => e.key === "Escape" && setShowPinned(false)}>
          <PinnedList pinned={state.pinned} copy={copy} locale={locale} onJump={jump} />
        </div>
      )}
    </div>
  );

  return (
    <section className="brc-channel" data-layout={layout} data-room-channel={channel} data-thread-open={thread ? "true" : undefined}>
      <div className="brc-channel-head">
        <div className="brc-channel-title">{header}</div>
        {pinnedButton}
      </div>
      <div className="brc-channel-body">
        <div className="brc-stream-col">
          <div
            className="brc-scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
            }}
          >
            <div className="brc-stream" role="log" aria-label={copy.channel.streamLabel} aria-live="polite" aria-relevant="additions" data-room-stream>
              {state.status === "loading" && <p className="brc-state">{copy.channel.loading}</p>}
              {(state.status === "error" || state.status === "gone") && state.messages.length === 0 && (
                <div className="brc-state" role="alert">
                  <p>{copy.channel.failedLoad}</p>
                  {state.status === "error" && (
                    <button type="button" className="brc-btn" onClick={() => void feed.reload()}>
                      {copy.channel.retry}
                    </button>
                  )}
                </div>
              )}
              {state.status === "ready" && state.hasMore && (
                <button type="button" className="brc-older" onClick={loadOlder} disabled={state.loadingOlder}>
                  {state.loadingOlder ? copy.channel.loading : copy.channel.loadOlder}
                </button>
              )}
              {state.status === "ready" && !state.hasMore && state.legacy.length > 0 && (
                <section className="brc-legacy" data-room-legacy={state.legacy.length}>
                  <header>
                    <h3>{copy.channel.legacyTitle}</h3>
                    <p>{copy.channel.legacyHint}</p>
                  </header>
                  {state.legacy.map((m) => (
                    <div key={m.id} className="brc-legacy-line" data-team={m.authorRole === "studio" ? "true" : undefined}>
                      <span className="brc-legacy-meta">
                        <AuthorName message={{ authorRole: m.authorRole, authorName: m.authorName }} copy={copy} />
                        <time dateTime={m.createdAt}>{fullLabel(m.createdAt, locale)}</time>
                      </span>
                      <p className="brc-body">{m.body}</p>
                    </div>
                  ))}
                </section>
              )}
              {state.status === "ready" && state.messages.length === 0 && state.legacy.length === 0 && <p className="brc-state brc-empty">{copy.channel.empty}</p>}
              {items}
              <div ref={bottomRef} className="brc-bottom" aria-hidden="true" />
            </div>
          </div>
          {flash && (
            <p className="brc-flash" role="status">
              {flash}
            </p>
          )}
          {state.status !== "gone" &&
            (talk ? (
              <Composer
                copy={copy}
                locale={locale}
                people={state.people}
                placeholder={interpolate(copy.composer.placeholder, { channel: channelName ?? state.title ?? copy.inbox.general })}
                allowTeamMention={transport.side === "brand"}
                upload={transport.upload ? (file, mime, p) => transport.upload!(channel, file, mime, p) : undefined}
                onSend={onSend}
                selfId={viewerHint.current.authorId}
              />
            ) : (
              state.status === "ready" && <p className="brc-readonly">{copy.channel.readOnly}</p>
            ))}
        </div>
        {thread && (
          <ThreadPanel
            key={thread.id}
            transport={transport}
            channel={channel}
            parent={thread}
            copy={copy}
            locale={locale}
            canTalk={talk}
            canPin={state.canPin}
            canDeleteAny={canDeleteAny}
            people={state.people}
            lastReadAt={state.lastReadAt}
            onClose={() => setThread(null)}
            onSent={() => void feed.poll()}
          />
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- ref column */

export interface RefThreadViewProps {
  transport: ChatTransport;
  projectId: string;
  refKey: string;
  locale: Locale;
  copy: RoomsChatCopy;
  canTalk: boolean;
  label: string;
}

/** Every line about one cut or one deliverable, oldest first, and a box that posts with that ref. */
export function RefThreadView({ transport, projectId, refKey, locale, copy, canTalk, label }: RefThreadViewProps) {
  const [flash, setFlash] = useFlash();
  const viewerHint = useRef<{ authorId: string | null; authorName: string | null }>({ authorId: null, authorName: null });
  const channel = projectId.toLowerCase();
  const feed = useFeed(transport, channel, { kind: "ref", refKey }, viewerHint.current);
  const { state } = feed;
  viewerHint.current = viewerOf(state.messages);
  const actions = useLineActions(feed, transport, copy, setFlash);
  const peopleNames = useMemo(() => new Map(state.people.map((p) => [p.id, p.name])), [state.people]);
  const ref = useMemo(() => parseRefKey(refKey), [refKey]);
  const listRef = useRef<HTMLDivElement>(null);
  const count = state.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);
  // Reading a cut's thread does not move the channel's read mark: the channel's own lines may still be unread.
  return (
    <section className="brc-refthread" data-room-ref-thread={refKey}>
      <div className="brc-refthread-list" ref={listRef} role="log" aria-label={label} aria-live="polite">
        {state.status === "loading" && <p className="brc-state">{copy.channel.loading}</p>}
        {(state.status === "error" || state.status === "gone") && (
          <p className="brc-state" role="alert">
            {copy.channel.failedLoad}
          </p>
        )}
        {state.status === "ready" && state.messages.length === 0 && <p className="brc-state brc-empty">{copy.channel.emptyRef}</p>}
        {state.messages.map((m, i) => (
          <MessageItem
            key={m.id}
            message={m}
            grouped={continuesGroup(state.messages[i - 1] ?? null, m) && dayKey(m.createdAt) === dayKey(state.messages[i - 1]!.createdAt)}
            copy={copy}
            locale={locale}
            peopleNames={peopleNames}
            canPin={false}
            canDeleteAny={transport.side === "team"}
            refHref={transport.refHref}
            inThread
            hideRef
            {...actions}
            onPin={undefined}
          />
        ))}
      </div>
      {flash && (
        <p className="brc-flash" role="status">
          {flash}
        </p>
      )}
      {canTalk && state.canTalk && ref && state.status !== "gone" && (
        <Composer
          copy={copy}
          locale={locale}
          people={state.people}
          placeholder={copy.composer.placeholderRef}
          allowTeamMention={transport.side === "brand"}
          upload={transport.upload ? (file, mime, p) => transport.upload!(channel, file, mime, p) : undefined}
          onSend={(draft) => feed.send({ ...draft, ref })}
          compact
          label={label}
          selfId={viewerHint.current.authorId}
        />
      )}
    </section>
  );
}

