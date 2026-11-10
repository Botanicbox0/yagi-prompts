"use client";
/**
 * One line of a conversation: the author row (name, "야기 팀" badge, time), the text with its mentions,
 * files, the card of what it points at, reactions, the thread summary, and the actions that appear on
 * hover or keyboard focus. Event lines (a storyboard shared, a deliverable approved) are a compact card.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { interpolate } from "@/lib/i18n/format";
import {
  formatBytes,
  mentionRuns,
  ROOM_REACTION_GLYPHS,
  ROOM_REACTIONS,
  type RoomAttachment,
  type RoomMessage,
  type RoomReaction,
  type RoomRef,
  type RoomRefView,
} from "@/lib/brand-rooms/message-contracts";
import type { RoomsChatCopy } from "@/messages/rooms-chat";
import { fullLabel, initialOf, shortTime, timeLabel } from "./format";
import type { ShownMessage } from "./use-feed";

type Locale = "ko" | "en";

export interface MessageActions {
  onReply?: (message: RoomMessage) => void;
  onReact?: (messageId: string, emoji: RoomReaction) => void;
  onEdit?: (messageId: string, body: string) => Promise<boolean>;
  onDelete?: (messageId: string) => void;
  onPin?: (messageId: string, pinned: boolean) => void;
}

export interface MessageItemProps extends MessageActions {
  message: ShownMessage;
  grouped: boolean;
  copy: RoomsChatCopy;
  locale: Locale;
  peopleNames: ReadonlyMap<string, string>;
  canPin: boolean;
  /** The team may take down any line. */
  canDeleteAny: boolean;
  refHref: (projectId: string, ref: RoomRef) => string | null;
  /** Where the viewer had stopped reading: newer replies are marked. */
  lastReadAt?: string | null;
  /** Inside a thread or a cut's column: no thread summary. */
  inThread?: boolean;
  /** In the column of the very thing a ref points at, its card would only repeat it. */
  hideRef?: boolean;
}

/* ----------------------------------------------------------------- icons */

const Icon = {
  smile: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M7.2 11.6c.7.9 1.6 1.4 2.8 1.4s2.1-.5 2.8-1.4M7.5 8h.01M12.5 8h.01" />
    </svg>
  ),
  reply: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 5.5h12v7H9.5L6 15.5v-3H4z" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.5 4.5l3 3L8 15H5v-3z" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8 3.5h4l-.5 4 2.5 2.5H6l2.5-2.5zM10 10v6.5" />
    </svg>
  ),
  trash: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.8 9.5h6.4L14 6" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z" />
      <path d="M11.5 2.5V6H15" />
    </svg>
  ),
};

/* ----------------------------------------------------------------- pieces */

export function Avatar({ name, team, copy }: { name: string | null; team: boolean; copy: RoomsChatCopy }) {
  return (
    <span className="brc-avatar" data-team={team ? "true" : undefined} aria-hidden="true">
      {team && !name ? initialOf(copy.author.team) : initialOf(name)}
    </span>
  );
}

export function AuthorName({ message, copy }: { message: Pick<RoomMessage, "authorRole" | "authorName">; copy: RoomsChatCopy }) {
  if (message.authorRole === "studio" || (message.authorRole === "system" && !message.authorName)) {
    return (
      <span className="brc-author">
        <span className="brc-team-badge">{copy.author.team}</span>
        {message.authorName && <span className="brc-author-name">{message.authorName}</span>}
      </span>
    );
  }
  return (
    <span className="brc-author">
      <span className="brc-author-name">{message.authorName ?? copy.author.someone}</span>
    </span>
  );
}

function BodyText({ message, peopleNames, copy }: { message: RoomMessage; peopleNames: ReadonlyMap<string, string>; copy: RoomsChatCopy }) {
  if (!message.body) return null;
  const names = message.mentions.map((id) => peopleNames.get(id)).filter((n): n is string => Boolean(n));
  const runs = mentionRuns(message.body, names, message.mentionsTeam ? copy.composer.mentionTeam : null);
  return (
    <p className="brc-body">
      {runs.map((run, i) =>
        run.mention ? (
          <span key={i} className="brc-mention">
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
      {message.edited && <span className="brc-edited"> {copy.author.edited}</span>}
    </p>
  );
}

export function Attachments({ items, locale }: { items: readonly RoomAttachment[]; locale: Locale }) {
  if (items.length === 0) return null;
  const media = items.filter((a) => a.kind !== "file");
  const files = items.filter((a) => a.kind === "file");
  return (
    <div className="brc-attachments" data-room-attachments={items.length}>
      {media.length > 0 && (
        <div className="brc-media" data-count={Math.min(media.length, 4)}>
          {media.map((a) =>
            a.kind === "image" ? (
              <a key={a.key} href={a.url} target="_blank" rel="noopener noreferrer" className="brc-media-item" title={a.name}>
                <img src={a.url} alt={a.name} loading="lazy" width={a.width ?? undefined} height={a.height ?? undefined} />
              </a>
            ) : (
              <div key={a.key} className="brc-media-item" data-kind="video">
                <video src={a.url} controls preload="metadata" playsInline aria-label={a.name} />
              </div>
            ),
          )}
        </div>
      )}
      {files.map((a) => (
        <a key={a.key} href={a.url} target="_blank" rel="noopener noreferrer" className="brc-file">
          <span className="brc-file-icon">{Icon.file}</span>
          <span className="brc-file-text">
            <span className="brc-file-name">{a.name}</span>
            <span className="brc-file-size">{formatBytes(a.size, locale)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

export function refLabel(view: RoomRefView, copy: RoomsChatCopy): string {
  if (view.ref.kind === "storyboard") {
    const board = view.version != null ? interpolate(copy.ref.storyboardVersion, { version: view.version }) : copy.ref.storyboard;
    return view.cut != null ? `${board} · ${interpolate(copy.ref.cut, { cut: view.cut })}` : board;
  }
  const item = view.version != null ? interpolate(copy.ref.reviewVersion, { version: view.version }) : copy.ref.review;
  return view.ref.commentId ? `${item} · ${copy.ref.note}` : item;
}

export function RefCard({ view, projectId, copy, refHref }: { view: RoomRefView; projectId: string | null; copy: RoomsChatCopy; refHref: (projectId: string, ref: RoomRef) => string | null }) {
  const href = view.available && projectId ? refHref(projectId, view.ref) : null;
  const inner = (
    <>
      <span className="brc-ref-thumb" aria-hidden="true">
        {view.thumbUrl ? <img src={view.thumbUrl} alt="" loading="lazy" /> : null}
      </span>
      <span className="brc-ref-text">
        <span className="brc-ref-kind">{refLabel(view, copy)}</span>
        <span className="brc-ref-title">{view.available ? (view.title ?? "") : copy.ref.unavailable}</span>
      </span>
      {href && <span className="brc-ref-open">{copy.ref.open}</span>}
    </>
  );
  return href ? (
    <a className="brc-ref" href={href} data-room-ref={view.ref.kind}>
      {inner}
    </a>
  ) : (
    <span className="brc-ref" data-room-ref={view.ref.kind} data-unavailable={view.available ? undefined : "true"}>
      {inner}
    </span>
  );
}

function ReactionPicker({ copy, onPick, onClose }: { copy: RoomsChatCopy; onPick: (emoji: RoomReaction) => void; onClose: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      className="brc-picker"
      role="menu"
      aria-label={copy.actions.react}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {ROOM_REACTIONS.map((emoji, i) => (
        <button
          key={emoji}
          ref={i === 0 ? first : undefined}
          type="button"
          role="menuitem"
          className="brc-picker-item"
          aria-label={interpolate(copy.actions.reactWith, { emoji: ROOM_REACTION_GLYPHS[emoji] })}
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
        >
          {ROOM_REACTION_GLYPHS[emoji]}
        </button>
      ))}
    </div>
  );
}

function Reactions({ message, copy, onReact }: { message: RoomMessage; copy: RoomsChatCopy; onReact?: (messageId: string, emoji: RoomReaction) => void }) {
  if (message.reactions.length === 0) return null;
  return (
    <div className="brc-reactions">
      {message.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className="brc-reaction"
          aria-pressed={r.mine}
          disabled={!onReact}
          title={interpolate(copy.actions.reactedBy, { count: r.count, emoji: ROOM_REACTION_GLYPHS[r.emoji] })}
          aria-label={interpolate(copy.actions.reactedBy, { count: r.count, emoji: ROOM_REACTION_GLYPHS[r.emoji] })}
          onClick={() => onReact?.(message.id, r.emoji)}
        >
          <span aria-hidden="true">{ROOM_REACTION_GLYPHS[r.emoji]}</span>
          <span className="brc-reaction-count">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- event */

export function EventLine({ message, copy, locale, refHref }: { message: RoomMessage; copy: RoomsChatCopy; locale: Locale; refHref: MessageItemProps["refHref"] }) {
  const phrase = message.event ? copy.events[message.event] : "";
  return (
    <div className="brc-event" data-room-event={message.event ?? ""} id={`brc-msg-${message.id}`}>
      <span className="brc-event-dot" aria-hidden="true" />
      <div className="brc-event-main">
        <p className="brc-event-text">
          <strong>{message.authorName ?? copy.author.team}</strong> {phrase}
          <time className="brc-time" dateTime={message.createdAt} title={fullLabel(message.createdAt, locale)}>
            {timeLabel(message.createdAt, locale)}
          </time>
        </p>
        {message.ref && <RefCard view={{ ...message.ref, title: message.ref.title ?? message.detail?.title ?? null }} projectId={message.projectId} copy={copy} refHref={refHref} />}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- line */

function EditBox({ initial, copy, onSave, onCancel }: { initial: string; copy: RoomsChatCopy; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(value);
    setBusy(false);
    if (ok) onCancel();
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      void save();
    }
  };
  return (
    <div className="brc-edit">
      <textarea ref={ref} className="brc-edit-input" value={value} rows={Math.min(8, value.split("\n").length + 1)} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} aria-label={copy.actions.edit} />
      <div className="brc-edit-actions">
        <button type="button" className="brc-btn" onClick={onCancel}>
          {copy.actions.cancel}
        </button>
        <button type="button" className="brc-btn" data-primary="true" onClick={() => void save()} disabled={busy}>
          {copy.actions.save}
        </button>
      </div>
    </div>
  );
}

export function MessageItem(props: MessageItemProps) {
  const { message, grouped, copy, locale, peopleNames, canPin, canDeleteAny, refHref, lastReadAt, inThread, hideRef, onReply, onReact, onEdit, onDelete, onPin } = props;
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const toolbarId = useId();
  if (message.kind === "event") return <EventLine message={message} copy={copy} locale={locale} refHref={refHref} />;
  const team = message.authorRole === "studio";
  const live = !message.deleted && !message.pending;
  const canEditThis = live && message.mine && Boolean(onEdit);
  const canDeleteThis = live && Boolean(onDelete) && (message.mine || canDeleteAny);
  const canPinThis = live && canPin && Boolean(onPin);
  const newReplies = Boolean(lastReadAt && message.lastReplyAt && message.lastReplyAt > lastReadAt && !message.lastReplyMine);
  return (
    <article
      className="brc-line"
      id={`brc-msg-${message.id}`}
      data-room-message={message.id}
      data-grouped={grouped ? "true" : undefined}
      data-team={team ? "true" : undefined}
      data-pending={message.pending ? "true" : undefined}
      data-pinned={message.pinned ? "true" : undefined}
      aria-busy={message.pending ? true : undefined}
      // A tap focuses the line, which shows its actions on touch screens.
      tabIndex={-1}
    >
      <div className="brc-gutter">
        {grouped ? (
          <time className="brc-time brc-time-hover" dateTime={message.createdAt} title={fullLabel(message.createdAt, locale)}>
            {shortTime(message.createdAt, locale)}
          </time>
        ) : (
          <Avatar name={message.authorName} team={team} copy={copy} />
        )}
      </div>
      <div className="brc-main">
        {!grouped && (
          <header className="brc-line-head">
            <AuthorName message={message} copy={copy} />
            <time className="brc-time" dateTime={message.createdAt} title={fullLabel(message.createdAt, locale)}>
              {timeLabel(message.createdAt, locale)}
            </time>
            {message.pinned && <span className="brc-pin-mark">{copy.channel.pinned}</span>}
          </header>
        )}
        {message.deleted ? (
          <p className="brc-body brc-deleted">{copy.author.deleted}</p>
        ) : editing && onEdit ? (
          <EditBox initial={message.body} copy={copy} onSave={(body) => onEdit(message.id, body)} onCancel={() => setEditing(false)} />
        ) : (
          <BodyText message={message} peopleNames={peopleNames} copy={copy} />
        )}
        {!message.deleted && <Attachments items={message.attachments} locale={locale} />}
        {!message.deleted && message.ref && !hideRef && <RefCard view={message.ref} projectId={message.projectId} copy={copy} refHref={refHref} />}
        <Reactions message={message} copy={copy} onReact={live ? onReact : undefined} />
        {!inThread && message.replyCount > 0 && onReply && (
          <button type="button" className="brc-thread-link" onClick={() => onReply(message)} data-new={newReplies ? "true" : undefined}>
            <span>{message.replyCount === 1 ? copy.thread.oneReply : interpolate(copy.thread.replies, { count: message.replyCount })}</span>
            {newReplies && <span className="brc-thread-new">{copy.thread.newReplies}</span>}
            {message.lastReplyAt && <span className="brc-thread-time">{timeLabel(message.lastReplyAt, locale)}</span>}
          </button>
        )}
      </div>
      {live && (onReact || (onReply && !inThread) || canEditThis || canPinThis || canDeleteThis) && (
        <div className="brc-tools" role="toolbar" aria-label={copy.actions.toolbar} id={toolbarId} data-open={picking ? "true" : undefined}>
          {onReact && (
            <button type="button" className="brc-tool" aria-label={copy.actions.react} title={copy.actions.react} aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
              {Icon.smile}
            </button>
          )}
          {onReply && !inThread && (
            <button type="button" className="brc-tool" aria-label={copy.actions.reply} title={copy.actions.reply} onClick={() => onReply(message)}>
              {Icon.reply}
            </button>
          )}
          {canEditThis && (
            <button type="button" className="brc-tool" aria-label={copy.actions.edit} title={copy.actions.edit} onClick={() => setEditing(true)}>
              {Icon.edit}
            </button>
          )}
          {canPinThis && (
            <button
              type="button"
              className="brc-tool"
              aria-pressed={message.pinned}
              aria-label={message.pinned ? copy.actions.unpin : copy.actions.pin}
              title={message.pinned ? copy.actions.unpin : copy.actions.pin}
              onClick={() => onPin!(message.id, !message.pinned)}
            >
              {Icon.pin}
            </button>
          )}
          {canDeleteThis && (
            <button
              type="button"
              className="brc-tool"
              data-danger="true"
              aria-label={copy.actions.delete}
              title={copy.actions.delete}
              onClick={() => {
                if (window.confirm(copy.actions.confirmDelete)) onDelete!(message.id);
              }}
            >
              {Icon.trash}
            </button>
          )}
          {picking && onReact && <ReactionPicker copy={copy} onPick={(emoji) => onReact(message.id, emoji)} onClose={() => setPicking(false)} />}
        </div>
      )}
    </article>
  );
}
