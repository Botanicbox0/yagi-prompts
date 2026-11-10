"use client";
/**
 * The reference row of the prompt bar (docs/BRAND-STUDIO-V3.md §4): small square thumbnails, each
 * with just its number underneath (1, 2, 3 … per kind, the number the prompt can name), then "+".
 * Hover or focus shows ✕; a thumbnail is dragged to reorder (or moved with Alt + arrow keys); a press
 * opens a small popover for its role, what to take and what to leave out, and in a video run whether a
 * picture opens or closes the shot. Drops of new references land on the whole bar.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, type StudioAssetRole } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { fill, type StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import { TRAY_MOVE_TYPE, trayNumbers, type TrayItem } from "./refs";

export interface TrayProps {
  items: readonly TrayItem[];
  /** Per-kind labels ("이미지 1"), for screen readers and the popover title. */
  labels: readonly string[];
  medium: StudioMedium;
  copy: StudioCopy;
  dropActive: boolean;
  uploading: readonly string[];
  /** Opens the popover for this key first (tests and "설정 다시 쓰기"). */
  initialOpen?: string | null;
  onUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onRemove(key: string): void;
  onMove(from: number, to: number): void;
  onBrowse(): void;
}

function ThumbMedia({ item }: { item: TrayItem }) {
  if (item.thumbUrl || item.kind === "image") return <img src={item.thumbUrl ?? item.url} alt="" draggable={false} />;
  if (item.kind === "video") return <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />;
  return <span className="bs-thumb-audio" aria-hidden="true" />;
}

export function Tray({ items, labels, medium, copy, dropActive, uploading, initialOpen = null, onUpdate, onRemove, onMove, onBrowse }: TrayProps) {
  const t = copy.tray;
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [said, setSaid] = useState("");
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
    <div className="bs-tray" data-studio-tray data-empty={empty ? "" : undefined} data-drop-target={dropActive ? "" : undefined} aria-label={t.label} role="group">
      <ul className="bs-tray-list">
        {items.map((item, i) => {
          const label = labels[i] ?? "";
          const popoverId = `${base}-ref-${i}`;
          const expanded = open === item.key;
          return (
            <li
              key={item.key}
              className="bs-tray-item"
              data-ref-kind={item.kind}
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
                type="button"
                className="bs-thumb"
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
              </button>
              <span className="bs-thumb-n bs-num" aria-hidden="true">
                {numbers[i]}
              </span>
              <button type="button" className="bs-thumb-x" aria-label={fill(t.removeOne, { label })} onClick={() => onRemove(item.key)}>
                <StudioIcon name="close" />
              </button>
              {expanded && (
                <RefPopover
                  id={popoverId}
                  item={item}
                  label={label}
                  medium={medium}
                  copy={copy}
                  onUpdate={(patch) => onUpdate(item.key, patch)}
                  onRemove={() => {
                    setOpen(null);
                    onRemove(item.key);
                  }}
                  onClose={() => setOpen(null)}
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
        {empty && <li className="bs-tray-hint">{dropActive ? t.drop : t.hint}</li>}
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
  medium,
  copy,
  onUpdate,
  onRemove,
  onClose,
}: {
  id: string;
  item: TrayItem;
  label: string;
  medium: StudioMedium;
  copy: StudioCopy;
  onUpdate(patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onRemove(): void;
  onClose(): void;
}) {
  const t = copy.tray;
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSelectElement>(null);
  const [below, setBelow] = useState(false);
  const fields = useId();
  const close = useRef(onClose);
  close.current = onClose;

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
      if (event.key === "Escape") close.current();
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
          onClose();
        }
      }}
    >
      <p className="bs-popover-title">{label}</p>
      <label htmlFor={`${fields}-role`}>{t.role}</label>
      <select
        id={`${fields}-role`}
        ref={first}
        className="bs-field"
        value={item.role ?? ""}
        onChange={(event) => onUpdate({ role: (event.target.value || undefined) as StudioAssetRole | undefined })}
      >
        <option value="">{t.roleNone}</option>
        {STUDIO_ASSET_ROLES.map((role) => (
          <option key={role} value={role}>
            {copy.roles[role]}
          </option>
        ))}
      </select>
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
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
