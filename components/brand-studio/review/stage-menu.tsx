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
