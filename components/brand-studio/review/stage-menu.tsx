"use client";
/**
 * The review stage's small menus and popovers (the head's "⋯", the notes panel's filter and export, the
 * player's shortcuts), on the studio's own menu primitive (../gallery/menu.tsx): the menu opens with focus on
 * its first item, ↑/↓/Home/End move, Escape or a press outside closes it, and focus goes back to the button.
 *
 * Doing less at rest is the point (docs/BRAND-ROOMS-FEEDBACK.md §11): tool-like actions fold into a menu, so
 * the screen a client sees carries one primary action and quiet icons for the rest.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Menu, moveFocus, useAnchored, useDismiss, type MenuEntry } from "../gallery/menu";

/** True while the window is at most `px` wide (false on the server and the first paint). */
export function useNarrow(px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(`(max-width: ${px}px)`);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [px]);
  return narrow;
}

export type StageMenuEntry =Pick<MenuEntry, "key" | "label" | "run" | "disabled"> & { marker?: Record<string, string> };

/** An icon button that opens a menu of actions. */
export function StageMenuButton({
  label,
  icon,
  entries,
  className = "bsv-icon-btn",
  marker,
  children,
}: {
  label: string;
  icon: ReactNode;
  entries: readonly StageMenuEntry[];
  className?: string;
  /** A data attribute for the button (tests and the sweep find it by this). */
  marker?: Record<string, string>;
  /** A visible label next to the icon (none: an icon button with a tooltip). */
  children?: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  }, []);
  if (!entries.length) return null;
  return (
    <span className="bsv-menu-anchor">
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        {...marker}
      >
        {icon}
        {children}
      </button>
      {open && (
        <Menu
          id={id}
          label={label}
          anchor={button.current}
          className="bsv-menu"
          onClose={close}
          entries={entries.map((entry) => ({ key: entry.key, label: entry.label, run: entry.run, disabled: entry.disabled }))}
        />
      )}
    </span>
  );
}

/** An icon button that opens a small panel (the filter controls, the shortcuts). */
export function StagePopover({
  label,
  icon,
  children,
  active = false,
  marker,
  open: controlledOpen,
  onOpenChange,
  wide = false,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  /** A small dot on the button: something in the panel is set. */
  active?: boolean;
  marker?: Record<string, string>;
  /** Controlled (the `?` key opens the shortcuts). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wide?: boolean;
}) {
  const id = useId();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = useCallback((value: boolean) => (onOpenChange ? onOpenChange(value) : setOwnOpen(value)), [onOpenChange]);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <span className="bsv-menu-anchor">
      <button
        ref={button}
        type="button"
        className="bsv-icon-btn"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-active={active ? "" : undefined}
        onClick={() => setOpen(!open)}
        {...marker}
      >
        {icon}
      </button>
      {open && (
        <PopoverPanel
          id={id}
          label={label}
          anchor={button.current}
          wide={wide}
          onClose={() => {
            setOpen(false);
            button.current?.focus({ preventScroll: true });
          }}
        >
          {children}
        </PopoverPanel>
      )}
    </span>
  );
}

/**
 * An on/off choice on the dark stage ("팀만 보기", "그림 표시만"): the native checkbox, kept for its keyboard,
 * form and screen-reader behaviour (`role="switch"`), drawn as a small track and thumb in the stage's own
 * tokens instead of the browser's white box. The focus ring sits on the track.
 */
export function StageSwitch({
  checked,
  onChange,
  children,
  describedBy,
  marker,
  className,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  children: ReactNode;
  describedBy?: string;
  marker?: Record<string, string>;
  className?: string;
}) {
  return (
    <label className={className ? `bsv-switch ${className}` : "bsv-switch"}>
      <input type="checkbox" role="switch" className="bsv-switch-input" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-describedby={describedBy} {...marker} />
      <span className="bsv-switch-track" aria-hidden="true" />
      <span className="bsv-switch-label">{children}</span>
    </label>
  );
}

export interface StageSelectOption {
  value: string;
  label: string;
}

/**
 * A choice of one (the version, the playback speed, a compare side) in the stage's own dress: a button that
 * shows the current value with a chevron and opens a menu of options (`menuitemradio`, the current one
 * checked). It replaces the browser's own select element, whose white list and box broke the dark stage.
 * ↑/↓/Home/End move, Enter or a click picks and closes, Escape or a press outside closes, focus returns to it.
 */
export function StageSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = "md",
  marker,
  className,
}: {
  /** The control's name (spoken with the current value). */
  label: string;
  value: string;
  options: readonly StageSelectOption[];
  onChange(value: string): void;
  disabled?: boolean;
  /** `sm`: 28px, beside the title. `md`: 34px, the size of the stage's icon buttons. */
  size?: "sm" | "md";
  marker?: Record<string, string>;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? null;
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  }, []);
  return (
    <span className="bsv-menu-anchor">
      <button
        ref={button}
        type="button"
        className={className ? `bsv-select ${className}` : "bsv-select"}
        data-size={size}
        aria-label={current ? `${label}: ${current.label}` : label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        {...marker}
      >
        <span className="bsv-select-value">{current?.label ?? ""}</span>
        <svg className="bsv-icon bsv-select-chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 10l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <SelectMenu
          id={id}
          label={label}
          anchor={button.current}
          options={options}
          value={value}
          onClose={close}
          onPick={(next) => {
            if (next !== value) onChange(next);
          }}
        />
      )}
    </span>
  );
}

function SelectMenu({
  id,
  label,
  anchor,
  options,
  value,
  onClose,
  onPick,
}: {
  id: string;
  label: string;
  anchor: HTMLElement | null;
  options: readonly StageSelectOption[];
  value: string;
  onClose(): void;
  onPick(value: string): void;
}) {
  const box = useDismiss(onClose);
  useAnchored(box, anchor, onClose);
  useEffect(() => {
    const el = box.current;
    (el?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ?? el?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus({ preventScroll: true });
  }, [box]);
  return (
    <div ref={box} id={id} className="bsv-menu" role="menu" aria-label={label} onKeyDown={(e) => moveFocus(e, '[role="menuitemradio"]:not([disabled])')} data-stage-select-menu>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="menuitemradio"
          aria-checked={option.value === value}
          data-menu-item={option.value}
          onClick={() => {
            onPick(option.value);
            onClose();
          }}
        >
          <svg className="bsv-icon bsv-menu-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PopoverPanel({ id, label, anchor, onClose, children, wide }: { id: string; label: string; anchor: HTMLElement | null; onClose(): void; children: ReactNode; wide: boolean }) {
  const box = useDismiss(onClose);
  useAnchored(box, anchor, onClose);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, select, button, [tabindex='0']")?.focus({ preventScroll: true });
  }, [box]);
  return (
    <div ref={box} id={id} className="bsv-menu bsv-popover" data-wide={wide ? "" : undefined} role="dialog" aria-label={label} onKeyDown={(e) => moveFocus(e, "input, select, button")}>
      {children}
    </div>
  );
}
