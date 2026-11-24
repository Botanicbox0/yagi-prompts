"use client";
/**
 * A small popover menu (the tile's more-menu, the folder list). Opens with focus on its first item;
 * ↑/↓/Home/End move, Escape or a press outside closes it and focus goes back to the button that opened it.
 */
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { StudioIcon, type StudioIconName } from "../icons";

/**
 * Places a popover next to the button that opened it, in the viewport (`position: fixed`), so no
 * scrolling wall or rounded tile clips it: below and right-aligned when it fits, above otherwise, never
 * past the screen's edges. A scroll or a resize closes it rather than leaving it floating.
 */
export function useAnchored(box: RefObject<HTMLElement | null>, anchor: HTMLElement | null | undefined, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    const below = a.bottom + gap + own.height <= window.innerHeight - margin;
    const top = below ? a.bottom + gap : Math.max(margin, a.top - gap - own.height);
    const left = Math.min(window.innerWidth - margin - own.width, Math.max(margin, a.right - own.width));
    el.style.position = "fixed";
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.dataset.anchored = "";
  }, [box, anchor]);
  useEffect(() => {
    if (!anchor) return;
    const away = (event: Event) => {
      if (event.target instanceof Node && box.current?.contains(event.target)) return;
      close.current();
    };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [anchor, box]);
}

export interface MenuEntry {
  key: string;
  label: string;
  icon?: StudioIconName;
  tone?: "danger";
  disabled?: boolean;
  /** Keep the menu open after this entry runs (it changes what the menu shows). */
  keepOpen?: boolean;
  /** A label the entry flips to in place while `done` ("복사했어요"); both share one cell, so nothing moves. */
  doneLabel?: string;
  done?: boolean;
  run(): void;
}

export function useDismiss(onClose: () => void, active = true) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    const down = (event: PointerEvent) => {
      const owner = box.current?.parentElement;
      if (owner && event.target instanceof Node && !owner.contains(event.target)) close.current();
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [active]);
  return box;
}

/**
 * Focuses an option of a menu that just opened without scrolling the page (the bar floats over the wall, so a
 * plain focus would scroll the wall); the menu's own list scrolls just enough to show the option.
 */
export function focusOption(box: HTMLElement | null, option: HTMLElement | null | undefined) {
  if (!box || !option) return;
  option.focus({ preventScroll: true });
  for (let scroller = option.parentElement; scroller; scroller = scroller.parentElement) {
    if (scroller.scrollHeight > scroller.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      const o = option.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (o.top < s.top) scroller.scrollTop -= s.top - o.top;
      else if (o.bottom > s.bottom) scroller.scrollTop += o.bottom - s.bottom;
      break;
    }
    if (scroller === box) break;
  }
  // A menu that runs past the window (one on the wall) still shows the option.
  const rect = option.getBoundingClientRect();
  if (rect.bottom > window.innerHeight || rect.top < 0) option.scrollIntoView({ block: "nearest" });
}

/** ↑/↓/Home/End between the focusable entries of a list. */
export function moveFocus(event: KeyboardEvent<HTMLElement>, selector = '[role="menuitem"]:not([disabled])') {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(selector));
  if (!items.length) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown" ? (at + 1) % items.length
    : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length
    : event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : -1;
  if (next < 0) return;
  event.preventDefault();
  focusOption(event.currentTarget, items[next]);
}

export function Menu({
  id,
  label,
  entries,
  onClose,
  footer,
  anchor,
  className = "bs-menu",
}: {
  id: string;
  label: string;
  entries: readonly MenuEntry[];
  onClose(): void;
  footer?: ReactNode;
  /** The button that opened it; the menu is placed beside it in the viewport. */
  anchor?: HTMLElement | null;
  className?: string;
}) {
  const box = useDismiss(onClose);
  useAnchored(box, anchor, onClose);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
  }, [box]);
  return (
    <div ref={box} id={id} className={className} role="menu" aria-label={label} onKeyDown={moveFocus} data-studio-menu>
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="menuitem"
          data-menu-item={entry.key}
          data-tone={entry.tone}
          data-copied={entry.doneLabel && entry.done ? "" : undefined}
          disabled={entry.disabled}
          onClick={() => {
            entry.run();
            if (!entry.keepOpen) onClose();
          }}
        >
          {entry.icon && <StudioIcon name={entry.icon} />}
          {entry.doneLabel ? (
            <span className="bs-menu-swap">
              <span>{entry.label}</span>
              <span>{entry.doneLabel}</span>
            </span>
          ) : (
            <span>{entry.label}</span>
          )}
        </button>
      ))}
      {footer}
    </div>
  );
}
