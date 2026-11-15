"use client";
/**
 * A chip of the prompt bar that opens its own dark list (ratio, resolution, quality, count, length,
 * sound). It replaces the native `<select>`: on Windows the system paints a native option list white
 * with pale text over the studio's dark surface. Same behaviour as the model list beside it
 * (./model-menu.tsx): a listbox, ↑/↓/Home/End move, Enter or a press picks, Escape closes and focus
 * goes back to the chip; ↓ on the chip opens it, and leaving it with Tab closes it.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StudioIcon } from "../icons";
import { moveFocus, useDismiss } from "./menu";

export interface ChipOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface ChipSelectProps {
  /** What the chip chooses ("비율"); read to screen readers with the current value. */
  label: string;
  value: string;
  options: readonly ChipOption[];
  /** `data-control` on the chip: which setting this is. */
  data: string;
  /** Numbers and ratios in the mono face. */
  mono?: boolean;
  /** Opens the list first (tests). */
  initialOpen?: boolean;
  onChange(value: string): void;
}

/** The outline of a ratio ("9:16" is a tall box) inside a 16 px square; a plain square when unreadable. */
export function aspectBox(ratio: string, size = 16): { width: number; height: number } {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
  const r = m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 1;
  const round = (n: number) => Math.max(4, Math.round(n * 2) / 2);
  return r >= 1 ? { width: size, height: round(size / r) } : { width: round(size * r), height: size };
}

/** A small outline in the shape of the ratio. Decorative: the option's text says the ratio. */
export function AspectShape({ ratio }: { ratio: string }) {
  const { width, height } = aspectBox(ratio);
  return (
    <svg className="bs-shape" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" data-shape={ratio}>
      <rect x={(18 - width) / 2} y={(18 - height) / 2} width={width} height={height} rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ChipSelect({ label, value, options, data, mono = false, initialOpen = false, onChange }: ChipSelectProps) {
  const [open, setOpen] = useState(initialOpen);
  const chip = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const close = (refocus = true) => {
    setOpen(false);
    if (!refocus) return;
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) chip.current?.focus();
    });
  };
  return (
    <span
      className="bs-model bs-pick"
      data-control={data}
      data-mono={mono ? "" : undefined}
      onBlur={(event) => {
        // Tab out of the list: close it and leave focus where it went.
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      <button
        ref={chip}
        type="button"
        className="bs-chip-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {current?.icon}
        <span className="bs-chip-value">{current?.label}</span>
        <StudioIcon name="chevron" />
      </button>
      {open && (
        <ChipList
          id={`${id}-list`}
          label={label}
          value={current?.value ?? value}
          options={options}
          data={data}
          onPick={(next) => {
            if (next !== value) onChange(next);
            close();
          }}
          onClose={close}
        />
      )}
    </span>
  );
}

function ChipList({
  id,
  label,
  value,
  options,
  data,
  onPick,
  onClose,
}: Pick<ChipSelectProps, "label" | "value" | "options" | "data"> & { id: string; onPick(value: string): void; onClose(): void }) {
  const box = useDismiss(onClose);
  useEffect(() => {
    (box.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? box.current?.querySelector<HTMLElement>('[role="option"]'))?.focus({ preventScroll: true });
  }, [box]);
  return (
    <div ref={box} className="bs-menu bs-pick-list" data-studio-pick-list={data}>
      <div id={id} role="listbox" aria-label={label} onKeyDown={(event) => moveFocus(event, '[role="option"]')}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button key={option.value} type="button" role="option" aria-selected={selected} data-value={option.value} onClick={() => onPick(option.value)}>
              {option.icon}
              <span className="bs-pick-label">{option.label}</span>
              {selected && <StudioIcon name="check" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
