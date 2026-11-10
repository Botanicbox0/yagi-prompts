/**
 * The reference tray: numbered chips in order ("이미지 1", "영상 1"). A chip opens a small popover
 * for its role, what to take and what to leave out, and in a video run whether a picture opens or
 * closes the shot. Drops land on the whole dock; the tray only shows that it will take them.
 */
import { useEffect, useId, useRef, useState } from "react";
import { STUDIO_ASSET_ROLES, STUDIO_LIMITS, type StudioAssetRole } from "@/lib/brand-studio/contracts";
import type { StudioMedium } from "@/lib/brand-studio/models";
import { fill, type StudioCopy } from "./copy";
import { StudioIcon } from "./icons";
import type { TrayItem } from "./refs";

export interface TrayProps {
  items: readonly TrayItem[];
  labels: readonly string[];
  medium: StudioMedium;
  copy: StudioCopy;
  dropActive: boolean;
  uploading: readonly string[];
  /** Opens the chip popover for this key first (tests and "use these settings again"). */
  initialOpen?: string | null;
  onUpdate(key: string, patch: Partial<Pick<TrayItem, "role" | "use" | "avoid" | "frame">>): void;
  onRemove(key: string): void;
  onBrowse(): void;
}

export function Tray({ items, labels, medium, copy, dropActive, uploading, initialOpen = null, onUpdate, onRemove, onBrowse }: TrayProps) {
  const t = copy.tray;
  const [open, setOpen] = useState<string | null>(initialOpen);
  const base = useId();
  return (
    <div className="bs-tray" data-studio-tray data-drop-target={dropActive ? "" : undefined} aria-label={t.label} role="group">
      <ul className="bs-tray-list">
        {items.map((item, i) => {
          const label = labels[i] ?? "";
          const popoverId = `${base}-ref-${i}`;
          const expanded = open === item.key;
          return (
            <li key={item.key} className="bs-tray-item" data-ref-kind={item.kind}>
              <button
                type="button"
                className="bs-chip"
                data-selected={expanded ? "" : undefined}
                aria-expanded={expanded}
                aria-haspopup="dialog"
                aria-controls={expanded ? popoverId : undefined}
                onClick={() => setOpen(expanded ? null : item.key)}
              >
                {item.thumbUrl || item.kind === "image" ? <img src={item.thumbUrl ?? item.url} alt="" /> : <span className="bs-chip-dot" aria-hidden="true" />}
                <span className="bs-chip-label">{label}</span>
                {item.role && <span className="bs-chip-role">{copy.roles[item.role]}</span>}
                {item.kind === "image" && medium === "video" && item.frame && (
                  <span className="bs-chip-role">{item.frame === "start" ? t.frameStart : t.frameEnd}</span>
                )}
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
            <span className="bs-chip" aria-live="polite">{fill(t.uploading, { name })}</span>
          </li>
        ))}
        <li>
          <button type="button" className="bs-chip" data-variant="ghost" onClick={onBrowse} aria-label={copy.assets.toggle}>
            <StudioIcon name="plus" />
          </button>
        </li>
      </ul>
      {!items.length && <p className="bs-tray-hint">{dropActive ? t.drop : t.hint}</p>}
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
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  const fields = useId();
  return (
    <div
      id={id}
      className="bs-popover"
      role="dialog"
      aria-label={fill(t.edit, { label })}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
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
      <div className="bs-row">
        <button type="button" className="bs-btn" data-variant="ghost" data-size="sm" onClick={onRemove}>
          {t.remove}
        </button>
        <button type="button" className="bs-btn" data-variant="soft" data-size="sm" onClick={onClose}>
          {t.done}
        </button>
      </div>
    </div>
  );
}
