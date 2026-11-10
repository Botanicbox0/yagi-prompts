"use client";
/**
 * The message box: Enter sends, Shift+Enter breaks the line (and Korean input is never cut off while a
 * syllable is still being composed), files by button, paste or drop with upload progress, and `@`
 * mentions of the room's people and "야기 팀". A refused send puts the words and files back.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { interpolate } from "@/lib/i18n/format";
import { attachmentMimeOf, formatBytes, mentionQueryAt, ROOM_LIMITS, type RoomAttachment, type RoomPerson } from "@/lib/brand-rooms/message-contracts";
import type { RoomsChatCopy } from "@/messages/rooms-chat";
import type { Fail } from "./transport";

type Locale = "ko" | "en";

export interface ComposerDraft {
  body: string;
  attachments: RoomAttachment[];
  mentions: string[];
  mentionsTeam: boolean;
}

interface PendingFile {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "ready" | "error";
  attachment?: RoomAttachment;
}

interface Suggestion {
  id: string;
  name: string;
  team: boolean;
}

const TEAM_ID = "__team__";

export function errorText(copy: RoomsChatCopy, code: Fail["code"]): string {
  switch (code) {
    case "rate_limited":
    case "forbidden":
    case "not_found":
    case "invalid":
    case "conflict":
    case "file_too_large":
    case "unsupported_file":
    case "offline":
      return copy.errors[code];
    default:
      return copy.errors.actionFailed;
  }
}

export function Composer({
  copy,
  locale,
  people,
  placeholder,
  allowTeamMention,
  upload,
  onSend,
  compact,
  autoFocus,
  label,
  selfId,
}: {
  copy: RoomsChatCopy;
  locale: Locale;
  people: readonly RoomPerson[];
  placeholder: string;
  allowTeamMention: boolean;
  /** Absent: no files (the team side). */
  upload?: (file: File, mime: string, onProgress: (ratio: number) => void) => Promise<{ ok: true; attachment: RoomAttachment } | Fail>;
  onSend: (draft: ComposerDraft) => Promise<{ ok: true } | Fail>;
  compact?: boolean;
  autoFocus?: boolean;
  /** A line above the box ("컷 3에 남기기"). */
  label?: string;
  /** The writer: not offered as a mention. */
  selfId?: string | null;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [chosen, setChosen] = useState<Suggestion[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hintId = useId();

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 160 : 240)}px`;
  }, [text, compact]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const list: Suggestion[] = [
      ...(allowTeamMention ? [{ id: TEAM_ID, name: copy.composer.mentionTeam, team: true }] : []),
      ...people.filter((p) => p.id !== selfId).map((p) => ({ id: p.id, name: p.name, team: false })),
    ];
    return list.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [allowTeamMention, copy.composer.mentionTeam, mention, people, selfId]);

  const uploading = files.some((f) => f.status === "uploading");

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      if (!upload) return;
      const incoming = Array.from(list);
      if (incoming.length === 0) return;
      setNotice(null);
      const room = ROOM_LIMITS.attachmentsPerMessage - files.length;
      if (incoming.length > room) setNotice(interpolate(copy.composer.tooMany, { count: ROOM_LIMITS.attachmentsPerMessage }));
      for (const file of incoming.slice(0, Math.max(0, room))) {
        const mime = attachmentMimeOf(file.name, file.type);
        if (!mime) {
          setNotice(interpolate(copy.composer.unsupported, { name: file.name }));
          continue;
        }
        if (file.size > ROOM_LIMITS.attachmentBytesMax) {
          setNotice(interpolate(copy.composer.tooLarge, { name: file.name }));
          continue;
        }
        const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        setFiles((current) => [...current, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);
        void upload(file, mime, (ratio) => setFiles((current) => current.map((f) => (f.id === id ? { ...f, progress: ratio } : f)))).then((result) => {
          setFiles((current) => current.map((f) => (f.id === id ? (result.ok ? { ...f, progress: 1, status: "ready", attachment: result.attachment } : { ...f, status: "error" }) : f)));
          if (!result.ok) setNotice(result.code === "file_too_large" ? interpolate(copy.composer.tooLarge, { name: file.name }) : result.code === "unsupported_file" ? interpolate(copy.composer.unsupported, { name: file.name }) : interpolate(copy.composer.uploadFailed, { name: file.name }));
        });
      }
    },
    [copy.composer, files.length, upload],
  );

  const pick = (s: Suggestion) => {
    const el = area.current;
    if (!el || !mention) return;
    const caret = el.selectionStart ?? text.length;
    const insert = `@${s.name} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setChosen((current) => (current.some((c) => c.id === s.id) ? current : [...current, s]));
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const at = mention.start + insert.length;
      el.setSelectionRange(at, at);
    });
  };

  const send = async () => {
    if (sending) return;
    const body = text.trim();
    const ready = files.filter((f) => f.status === "ready" && f.attachment).map((f) => f.attachment!);
    if (uploading) {
      setNotice(copy.composer.waitUploads);
      return;
    }
    if (!body && ready.length === 0) return;
    const named = chosen.filter((c) => body.includes(`@${c.name}`));
    const draft: ComposerDraft = {
      body,
      attachments: ready,
      mentions: named.filter((c) => !c.team).map((c) => c.id),
      mentionsTeam: named.some((c) => c.team),
    };
    const keptText = text;
    const keptFiles = files;
    const keptChosen = chosen;
    setText("");
    setFiles([]);
    setChosen([]);
    setNotice(null);
    setSending(true);
    const result = await onSend(draft);
    setSending(false);
    if (!result.ok) {
      setText(keptText);
      setFiles(keptFiles);
      setChosen(keptChosen);
      setNotice(result.code === "failed" || result.code === "offline" ? copy.errors.failed : errorText(copy, result.code));
    }
    area.current?.focus();
  };

  const onChange = (value: string) => {
    setText(value);
    const caret = area.current?.selectionStart ?? value.length;
    const q = mentionQueryAt(value, caret);
    setMention(q ? { ...q, index: 0 } : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (mention && suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMention({ ...mention, index: (mention.index + step + suggestions.length) % suggestions.length });
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !composing) {
        event.preventDefault();
        pick(suggestions[mention.index] ?? suggestions[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    // On a touch screen the return key breaks the line, as in every phone chat; the button sends.
    const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
    if (event.key === "Enter" && !event.shiftKey && !composing && !touch) {
      event.preventDefault();
      void send();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!upload || event.clipboardData.files.length === 0) return;
    event.preventDefault();
    addFiles(event.clipboardData.files);
  };

  const dragProps = upload
    ? {
        onDragOver: (event: DragEvent) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        },
      }
    : {};

  const active = mention && suggestions.length > 0 ? `${listId}-${mention.index}` : undefined;
  const canSend = (text.trim().length > 0 || files.some((f) => f.status === "ready")) && !uploading && !sending;

  return (
    <div className="brc-composer" data-room-composer data-compact={compact ? "true" : undefined} data-dragging={dragging ? "true" : undefined} {...dragProps}>
      {label && <p className="brc-composer-label">{label}</p>}
      {files.length > 0 && (
        <ul className="brc-uploads" aria-label={copy.composer.attach}>
          {files.map((f) => (
            <li key={f.id} className="brc-upload" data-status={f.status}>
              <span className="brc-upload-name">{f.name}</span>
              <span className="brc-upload-size">{formatBytes(f.size, locale)}</span>
              {f.status === "uploading" && (
                <span className="brc-upload-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f.progress * 100)} aria-label={interpolate(copy.composer.uploading, { name: f.name })}>
                  <span style={{ width: `${Math.round(f.progress * 100)}%` }} />
                </span>
              )}
              <button type="button" className="brc-upload-remove" aria-label={interpolate(copy.composer.removeFile, { name: f.name })} onClick={() => setFiles((current) => current.filter((x) => x.id !== f.id))}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M6 6l8 8M14 6l-8 8" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="brc-box">
        {upload && (
          <>
            <button type="button" className="brc-attach" aria-label={copy.composer.attach} title={copy.composer.attach} onClick={() => picker.current?.click()}>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M14.5 9.5l-5.2 5.2a3.2 3.2 0 01-4.5-4.5l6-6a2.1 2.1 0 013 3l-6 6a1 1 0 01-1.5-1.5l5.3-5.3" />
              </svg>
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </>
        )}
        <textarea
          ref={area}
          className="brc-input"
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={copy.composer.label}
          aria-describedby={hintId}
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && suggestions.length > 0)}
          aria-controls={mention && suggestions.length > 0 ? listId : undefined}
          aria-activedescendant={active}
          role="combobox"
          maxLength={ROOM_LIMITS.bodyMax}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
        />
        <button type="button" className="brc-send" onClick={() => void send()} disabled={!canSend} aria-label={copy.composer.send} title={copy.composer.send}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h11M11 5.5L15.5 10 11 14.5" />
          </svg>
        </button>
        {mention && suggestions.length > 0 && (
          <ul className="brc-suggest" id={listId} role="listbox" aria-label={copy.composer.mentionsLabel}>
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === mention.index}
                className="brc-suggest-item"
                data-team={s.team ? "true" : undefined}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(s);
                }}
              >
                <span className="brc-suggest-name">@{s.name}</span>
                {s.team && <span className="brc-suggest-hint">{copy.composer.mentionTeamHint}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="brc-hint" id={hintId} aria-live="polite">
        {notice ? <span className="brc-notice">{notice}</span> : <span>{copy.composer.hint}</span>}
      </p>
      {dragging && (
        <div className="brc-drop" aria-hidden="true">
          {copy.composer.dropHere}
        </div>
      )}
    </div>
  );
}
