"use client";
/**
 * The reference row of the prompt bar (docs/BRAND-STUDIO-V3.md §4): small square thumbnails, each
 * with just its number underneath (1, 2, 3 … per kind, the number the prompt can name), then "+".
 * Hover or focus shows ✕; a thumbnail is dragged to reorder (or moved with Alt + arrow keys); a press
 * opens a small popover for its role, what to take and what to leave out, and in a video run whether a
 * picture opens or closes the shot. Drops of new references land on the whole bar.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { STUDIO_LIMITS } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { studioVideoEn, studioVideoKo } from "@/messages/studio-video";
import { virtualMentionTag } from "./at-mention-menu";
import { fill, type StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import { TRAY_MOVE_TYPE, trayNumbers, trayThumbSrc, type TrayItem } from "./refs";
import { RoleChips } from "./role-chips";
import w from "./video/video-workspace.module.css";

export interface TrayProps {
  items: readonly TrayItem[];
  /** Per-kind labels ("이미지 1"), for screen readers and the popover title. */
  labels: readonly string[];
  medium: StudioMedium;
  copy: StudioCopy;
  dropActive: boolean;
  /** Something the bar takes is being dragged over the page: the row says what it takes. */
  dropReady?: boolean;
  uploading: readonly string[];
  /** Opens the popover for this key first (tests and "설정 다시 쓰기"). */
  initialOpen?: string | null;
  /** Keys of tray items currently referenced by `@` / natural mentions in the prompt bar. */
  mentionedKeys?: ReadonlySet<string>;
  /** Keys the member is pointing at right now: a mention under the pointer or caret, or this thumbnail itself. */
  linkedKeys?: ReadonlySet<string>;
  /** A thumbnail is hovered or focused (its key) or left (null), so the field can emphasise its mentions. */
  onLink?(key: string | null): void;
  /** Optional segment & crop trigger for `@video1` on the video screen. */
  onTrimVideo?(item: TrayItem): void;
  trimLabel?: string;
  /** Optional compact 1-line pending-video prompt rendered inside `.bs-tray-list` (VM-2 switch open only). */
  needVideoSlot?: ReactNode;
  /** Optional Re-Architect film-reading state badge on the first video thumbnail (VM-2 W1). */
  videoReadState?: "loading" | "read" | "unreadable" | null;
  videoReadLabels?: { loading: string; read: string; unreadable: string };
  onUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onRemove(key: string): void;
  onMove(from: number, to: number): void;
  onBrowse(): void;
}

function ThumbMedia({ item }: { item: TrayItem }) {
  if (item.thumbUrl || item.kind === "image") return <img src={trayThumbSrc(item)} alt="" draggable={false} />;
  if (item.kind === "video") return <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />;
  return <span className="bs-thumb-audio" aria-hidden="true" />;
}

export function Tray({
  items,
  labels,
  medium,
  copy,
  dropActive,
  dropReady = false,
  uploading,
  initialOpen = null,
  mentionedKeys,
  linkedKeys,
  onLink,
  onTrimVideo,
  trimLabel,
  needVideoSlot,
  videoReadState = null,
  videoReadLabels,
  onUpdate,
  onRemove,
  onMove,
  onBrowse,
}: TrayProps) {
  const t = copy.tray;
  const resolvedTrimLabel = trimLabel ?? (/[가-힣]/.test(t.label) ? studioVideoKo.remix.trayTrim : studioVideoEn.remix.trayTrim);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  // Closing a popover with Escape or 완료 puts focus back on the thumbnail that opened it.
  const thumbs = useRef(new Map<string, HTMLButtonElement>());
  const base = useId();
  const numbers = trayNumbers(items);
  const empty = !items.length && !uploading.length;

  const dropAt = (event: DragEvent, to: number) => {
    if (!event.dataTransfer.types.includes(TRAY_MOVE_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const from = Number(event.dataTransfer.getData(TRAY_MOVE_TYPE));
    setDragging(null);
    setOver(null);
    if (Number.isInteger(from) && from !== to) onMove(from, to);
  };

  return (
    <div className="bs-tray" data-studio-tray data-empty={empty ? "" : undefined} data-drop-target={dropActive ? "" : undefined} data-drop-ready={dropReady && !dropActive ? "" : undefined} aria-label={t.label} role="group">
      <ul className="bs-tray-list">
        {items.map((item, i) => {
          const label = labels[i] ?? "";
          const virtualTag = virtualMentionTag(item.kind, numbers[i] ?? 1);
          const popoverId = `${base}-ref-${i}`;
          const expanded = open === item.key;
          const mentioned = Boolean(mentionedKeys?.has(item.key));
          const linked = Boolean(linkedKeys?.has(item.key));
          return (
            <li
              key={item.key}
              className="bs-tray-item"
              data-ref-kind={item.kind}
              data-virtual-tag={virtualTag}
              data-mentioned={mentioned ? "" : undefined}
              data-linked={linked ? "" : undefined}
              onPointerEnter={onLink ? () => onLink(item.key) : undefined}
              onPointerLeave={onLink ? () => onLink(null) : undefined}
              onFocus={onLink ? () => onLink(item.key) : undefined}
              onBlur={onLink ? () => onLink(null) : undefined}
              data-dragging={dragging === i ? "" : undefined}
              data-drop-before={over === i && dragging !== null && dragging !== i ? "" : undefined}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(TRAY_MOVE_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setOver(i);
              }}
              onDrop={(event) => dropAt(event, i)}
            >
              <button
                ref={(element) => {
                  if (element) thumbs.current.set(item.key, element);
                  else thumbs.current.delete(item.key);
                }}
                type="button"
                className="bs-thumb"
                data-mentioned={mentioned ? "" : undefined}
                data-selected={expanded ? "" : undefined}
                draggable
                aria-label={fill(t.edit, { label })}
                aria-describedby={`${base}-move`}
                aria-expanded={expanded}
                aria-haspopup="dialog"
                aria-controls={expanded ? popoverId : undefined}
                onClick={() => setOpen(expanded ? null : item.key)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(TRAY_MOVE_TYPE, String(i));
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(i);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onKeyDown={(event) => {
                  if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                  event.preventDefault();
                  const to = event.key === "ArrowLeft" ? i - 1 : i + 1;
                  if (to < 0 || to >= items.length) return;
                  onMove(i, to);
                  setSaid(fill(t.moved, { label, n: to + 1 }));
                }}
              >
                <ThumbMedia item={item} />
                {item.kind !== "image" && (
                  <span className="bs-thumb-kind" aria-hidden="true">
                    <StudioIcon name={item.kind === "video" ? "play" : "spark"} />
                  </span>
                )}
                {medium === "video" &&
                  item.kind === "video" &&
                  numbers[i] === 1 &&
                  videoReadState &&
                  videoReadLabels && (
                    <span
                      className="bs-thumb-read"
                      data-video-read-state={videoReadState}
                      data-film-state={videoReadState}
                      role="status"
                      aria-label={videoReadLabels[videoReadState]}
                      title={videoReadLabels[videoReadState]}
                    >
                      {videoReadState === "read" ? (
                        <StudioIcon name="check" />
                      ) : videoReadState === "loading" ? (
                        <span className="bs-thumb-read-dot" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">!</span>
                      )}
                      <span className="bs-sr">{videoReadLabels[videoReadState]}</span>
                    </span>
                  )}
                {medium === "video" && item.kind === "image" && item.frame && (
                  <span className={w.trayFrameBadge} data-tray-frame={item.frame} aria-hidden="true">
                    {item.frame}
                  </span>
                )}
              </button>
              <span className="bs-thumb-n bs-num" aria-hidden="true" data-text={virtualTag}>
                {virtualTag}
              </span>
              {medium === "video" && item.kind === "video" && onTrimVideo && (
                <button
                  type="button"
                  className={w.trayTrimBtn}
                  data-tray-trim={item.key}
                  onClick={() => onTrimVideo(item)}
                >
                  {resolvedTrimLabel}
                </button>
              )}
              <button type="button" className="bs-thumb-x" aria-label={fill(t.removeOne, { label })} onClick={() => onRemove(item.key)}>
                <StudioIcon name="close" />
              </button>
              {expanded && (
                <RefPopover
                  id={popoverId}
                  item={item}
                  label={label}
                  virtualTag={virtualTag}
                  medium={medium}
                  copy={copy}
                  trimLabel={medium === "video" && item.kind === "video" && onTrimVideo ? resolvedTrimLabel : null}
                  onTrim={
                    medium === "video" && item.kind === "video" && onTrimVideo
                      ? () => {
                          setOpen(null);
                          onTrimVideo(item);
                        }
                      : undefined
                  }
                  onUpdate={(patch) => onUpdate(item.key, patch)}
                  onRemove={() => {
                    setOpen(null);
                    onRemove(item.key);
                  }}
                  onClose={() => setOpen(null)}
                  onDismiss={() => {
                    setOpen(null);
                    thumbs.current.get(item.key)?.focus({ preventScroll: true });
                  }}
                />
              )}
            </li>
          );
        })}
        {uploading.map((name) => (
          <li key={`up-${name}`} className="bs-tray-item" data-state="pending">
            <span className="bs-thumb" data-state="pending" role="status" aria-label={fill(t.uploading, { name })} />
            <span className="bs-thumb-n" aria-hidden="true">
              …
            </span>
          </li>
        ))}
        <li className="bs-tray-item">
          <button type="button" className="bs-thumb bs-thumb-add" onClick={onBrowse} aria-label={copy.dock.addRef} title={copy.dock.addRef}>
            <StudioIcon name="plus" />
          </button>
        </li>
        {needVideoSlot ? (
          needVideoSlot
        ) : (
          (empty || dropReady) && (
            <li className="bs-tray-hint" data-tray-drop-hint={dropReady ? "" : undefined}>
              {dropActive ? t.drop : medium === "video" ? t.hintVideo : t.hint}
            </li>
          )
        )}
      </ul>
      <span id={`${base}-move`} className="bs-sr">
        {t.moveHint}
      </span>
      <span className="bs-sr" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

function RefPopover({
  id,
  item,
  label,
  virtualTag,
  medium,
  copy,
  trimLabel,
  onTrim,
  onUpdate,
  onRemove,
  onClose,
  onDismiss,
}: {
  id: string;
  item: TrayItem;
  label: string;
  virtualTag: string;
  medium: StudioMedium;
  copy: StudioCopy;
  trimLabel?: string | null;
  onTrim?(): void;
  onUpdate(patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onRemove(): void;
  /** A press outside: focus stays where the press put it. */
  onClose(): void;
  /** Escape or 완료: focus goes back to the thumbnail. */
  onDismiss(): void;
}) {
  const t = copy.tray;
  const box = useRef<HTMLDivElement>(null);
  // The chosen role chip: focus lands there when the popover opens.
  const first = useRef<HTMLButtonElement>(null);
  const [below, setBelow] = useState(false);
  const fields = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => first.current?.focus(), []);
  // Opens upward over the wall; when that would run under the top of the screen, it opens downward
  // instead (a phone shows it as a bottom sheet either way).
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.top < 72 && getComputedStyle(box.current!).position === "absolute") setBelow(true);
  }, []);
  // Escape or a press anywhere outside the thumbnail and the popover closes it.
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const owner = box.current?.parentElement;
      if (owner && event.target instanceof Node && !owner.contains(event.target)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, []);

  return (
    <div
      ref={box}
      id={id}
      className="bs-popover"
      role="dialog"
      aria-label={fill(t.edit, { label })}
      data-place={below ? "below" : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <p className="bs-popover-title">
        {label} <span className="bs-num">({virtualTag})</span>
      </p>
      {trimLabel && onTrim && (
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={onTrim} data-popover-trim>
          {trimLabel}
        </button>
      )}
      <span id={`${fields}-role`} className="bs-popover-label">
        {t.role}
      </span>
      <RoleChips
        value={item.role ?? ""}
        onChange={(role) => onUpdate({ role: role || undefined })}
        noneLabel={t.roleNone}
        roleLabels={copy.roles}
        labelledBy={`${fields}-role`}
        chosenRef={first}
      />
      <label htmlFor={`${fields}-use`}>{t.use}</label>
      <input
        id={`${fields}-use`}
        className="bs-field"
        value={item.use ?? ""}
        maxLength={STUDIO_LIMITS.noteMax}
        placeholder={t.usePlaceholder}
        onChange={(event) => onUpdate({ use: event.target.value })}
      />
      <label htmlFor={`${fields}-avoid`}>{t.avoid}</label>
      <input
        id={`${fields}-avoid`}
        className="bs-field"
        value={item.avoid ?? ""}
        maxLength={STUDIO_LIMITS.noteMax}
        placeholder={t.avoidPlaceholder}
        onChange={(event) => onUpdate({ avoid: event.target.value })}
      />
      {medium === "video" && item.kind === "image" && (
        <fieldset className="bs-seg" data-studio-frame>
          <legend>{t.frame}</legend>
          {(["", "start", "end"] as const).map((frame) => (
            <label key={frame || "none"} className="bs-seg-option">
              <input
                type="radio"
                name={`${fields}-frame`}
                value={frame}
                checked={(item.frame ?? "") === frame}
                onChange={() => onUpdate({ frame: frame || undefined })}
              />
              <span>{frame === "start" ? t.frameStart : frame === "end" ? t.frameEnd : t.frameNone}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="bs-row bs-popover-actions">
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={onRemove}>
          {t.remove}
        </button>
        <span className="bs-spacer" />
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={onDismiss}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
