"use client";
/** The rail's building blocks: a thumbnail (drag source, press to attach or open) and a small menu. */
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { startRefDrag, type RefSource } from "../refs";
import type { LibraryItemView } from "../seams";
import { RailIcon, type RailIconName } from "./icons";
import { clock, fill, itemName, type LibraryCopy } from "./text";

export interface ThumbAction {
  key: string;
  label: string;
  icon: RailIconName;
  /** A toggle: the label stays the same and `aria-pressed` carries the state. */
  pressed?: boolean;
  /** The pointer tooltip, when it should say more than the label (e.g. what pressing will undo). */
  title?: string;
  run(): void;
}

export interface ThumbProps {
  item: LibraryItemView;
  copy: LibraryCopy;
  /** Drag only where something can receive it (creators). */
  draggable: boolean;
  attachOnPress: boolean;
  onAttach(ref: RefSource): void;
  onView(ref: RefSource): void;
  /** Small buttons over the corner, shown on hover and focus (always on touch screens). */
  actions?: ThumbAction[];
  /** A menu after the actions (more). */
  menu?: ReactNode;
  /** One short label over the bottom-right corner (an upload's role), shown with the actions. */
  label?: string | null;
}

export function Thumb({ item, copy, draggable, attachOnPress, onAttach, onView, actions = [], menu, label }: ThumbProps) {
  const name = itemName(item, copy);
  const still = item.thumbUrl ?? (item.kind === "image" ? item.url : null);
  return (
    <li className="bsr-thumb" data-kind={item.kind} data-library-item={item.key}>
      <button
        type="button"
        className="bsr-thumb-main"
        draggable={draggable}
        onDragStart={(event) => startRefDrag(event, item.ref)}
        onClick={() => (attachOnPress ? onAttach(item.ref) : onView(item.ref))}
        aria-label={fill(attachOnPress ? copy.item.attach : copy.item.view, { name })}
        title={attachOnPress ? copy.item.dragHint : undefined}
      >
        {item.kind === "audio" ? (
          <span className="bsr-audio" aria-hidden="true">
            <RailIcon name="wave" />
            <span className="bsr-audio-name">{name}</span>
          </span>
        ) : still ? (
          <img src={still} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : (
          <video src={`${item.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />
        )}
        {item.kind !== "image" && item.seconds != null && <span className="bsr-dur">{clock(item.seconds)}</span>}
        {item.kind === "video" && item.seconds == null && <span className="bsr-dur">{copy.item.video}</span>}
        {label && (
          <span className="bsr-dur bsr-label" data-library-role>
            {label}
          </span>
        )}
      </button>
      <div className="bsr-thumb-actions">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="bsr-chip-btn"
            aria-label={action.label}
            title={action.title ?? action.label}
            aria-pressed={action.pressed}
            data-pressed={action.pressed ? "" : undefined}
            onClick={action.run}
          >
            <RailIcon name={action.icon} filled={action.pressed} />
          </button>
        ))}
        <button type="button" className="bsr-chip-btn" aria-label={fill(copy.item.view, { name })} title={copy.item.open} onClick={() => onView(item.ref)}>
          <RailIcon name="open" />
        </button>
        {menu}
      </div>
    </li>
  );
}

/** Matches `.bsr-menu { min-width }` in rail.css. */
const MENU_MIN_WIDTH = 168;

export interface MenuItem {
  key: string;
  label: string;
  tone?: "danger";
  /** A quiet group heading drawn above this item. */
  before?: string;
  /** Somewhere to go: the item is drawn as a link (it opens in a new tab like any link) and `run` is optional. */
  href?: string;
  /** `data-*` markers for tests and scripts. */
  attrs?: Record<`data-${string}`, string>;
  run?(): void;
}

/** What every tab shares: copy, permissions, the press targets and the one open menu. */
export interface RailKit {
  copy: LibraryCopy;
  canCreate: boolean;
  attachOnPress: boolean;
  onAttach(ref: RefSource): void;
  onView(ref: RefSource): void;
  /** The heart over a thumbnail. */
  likeAction(item: LibraryItemView): ThumbAction;
  /** "폴더에 담기" entries for a thumbnail's menu (empty when the member cannot file). */
  fileItems(item: LibraryItemView): MenuItem[];
  /** "부분 수정" / "꾸미기" entries for an image thumbnail's menu. */
  editItems?(item: LibraryItemView): MenuItem[];
  menu: string | null;
  setMenu(key: string | null): void;
  /** One short line in the rail's live region. */
  say(text: string): void;
}

/** A button that opens a short list of actions: arrows move, Esc closes, a press outside closes. */
export function RailMenu({
  open,
  label,
  items,
  onToggle,
  className = "bsr-chip-btn",
}: {
  open: boolean;
  label: string;
  items: MenuItem[];
  onToggle(open: boolean): void;
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  // The list sits on the page (a portal), placed against the trigger, so the rail's scrolling panel never
  // clips it. It opens upward when there is more room above.
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return setPlace(null);
    const box = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    // Right-aligned to the trigger, unless that would push the list (at least 168px wide) off the left edge.
    const side: CSSProperties = box.right - MENU_MIN_WIDTH < 8 ? { left: Math.max(8, box.left) } : { right: Math.max(8, window.innerWidth - box.right) };
    setPlace(
      below >= 220 || below >= box.top
        ? { ...side, top: box.bottom + 4, maxHeight: Math.min(280, below - 12) }
        : { ...side, bottom: window.innerHeight - box.top + 4, maxHeight: Math.min(280, box.top - 12) },
    );
  }, [open]);
  useEffect(() => {
    if (!open || !place) return;
    list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !list.current?.contains(target) && !trigger.current?.contains(target)) toggle.current(false);
    };
    const moved = (event: Event) => {
      if (!list.current?.contains(event.target as Node | null)) toggle.current(false);
    };
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open, place]);
  const close = () => {
    onToggle(false);
    trigger.current?.focus();
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      entries[(at + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      onToggle(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => onToggle(!open)}
      >
        <RailIcon name="more" />
      </button>
      {open &&
        place &&
        createPortal(
        <div id={id} ref={list} className="bsr-menu" role="menu" aria-label={label} onKeyDown={keys} style={place}>
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.before && (
                <p className="bsr-menu-heading" role="presentation">
                  {item.before}
                </p>
              )}
              {item.href ? (
                <a
                  role="menuitem"
                  href={item.href}
                  data-tone={item.tone}
                  {...item.attrs}
                  onClick={() => {
                    onToggle(false);
                    item.run?.();
                  }}
                >
                  {item.label}
                </a>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  data-tone={item.tone}
                  {...item.attrs}
                  onClick={() => {
                    onToggle(false);
                    item.run?.();
                  }}
                >
                  {item.label}
                </button>
              )}
            </Fragment>
          ))}
        </div>,
          document.body,
        )}
    </>
  );
}
