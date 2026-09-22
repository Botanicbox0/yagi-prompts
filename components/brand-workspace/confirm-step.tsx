"use client";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export interface ConfirmCopy {
  prompt: string;
  action: string;
}
export type ButtonTone = "primary" | "secondary" | "danger";

const CONFIRM_STEP = "confirm";
export const toneClass = (tone: ButtonTone) =>
  tone === "primary" ? "bw-button bw-primary" : tone === "danger" ? "bw-button bw-danger" : "bw-button";

/**
 * Only the confirmation button carries the marker, so Enter in a field or the first click never
 * sends a disclosure or removal on its own.
 */
export function isConfirmedSubmit(event: { nativeEvent?: unknown }): boolean {
  const submitter = (event.nativeEvent as { submitter?: { dataset?: Record<string, string | undefined> } } | undefined)?.submitter;
  return submitter?.dataset?.confirmStep === CONFIRM_STEP;
}

export function useConfirmStep(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const accept = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  useEffect(() => {
    if (open) accept.current?.focus();
    else if (restore.current) {
      restore.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  return {
    open,
    trigger,
    accept,
    /** True when this submit only opens the confirmation and must not be sent. */
    intercept(event: { nativeEvent?: unknown }): boolean {
      if (!enabled || isConfirmedSubmit(event)) return false;
      setOpen(true);
      return true;
    },
    close() {
      restore.current = true;
      setOpen(false);
    },
  };
}

export function ConfirmStep({ id, copy, cancel, busy, working, tone, accept, onCancel }: {
  id: string;
  copy: ConfirmCopy;
  cancel: string;
  busy: boolean;
  working: string;
  tone: ButtonTone;
  accept: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
}) {
  return (
    <div
      className="bw-confirm"
      role="group"
      aria-labelledby={id}
      data-confirm-step
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <p id={id}>{copy.prompt}</p>
      <div className="bw-form-actions">
        <button
          ref={accept}
          type="submit"
          data-confirm-step={CONFIRM_STEP}
          className={tone === "danger" ? "bw-button bw-danger-solid" : "bw-button bw-primary"}
          disabled={busy}
        >
          {busy ? working : copy.action}
        </button>
        <button type="button" className="bw-button" onClick={onCancel} disabled={busy}>
          {cancel}
        </button>
      </div>
    </div>
  );
}
