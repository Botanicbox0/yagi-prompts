"use client";
import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * A native modal `<dialog>`: `showModal()` makes the rest of the page inert (focus stays inside), Esc
 * fires `cancel`, and focus goes back to whatever opened it when the dialog goes away.
 *
 * `returnFocus` names where focus goes instead, for a dialog opened from something that is gone by then
 * (a menu item: the menu closes as the dialog opens). It is read when the dialog closes; when it finds
 * nothing, the opener is used if it is still on the page.
 */
export function useModal(options: { returnFocus?: () => HTMLElement | null | undefined } = {}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(options.returnFocus);
  returnFocus.current = options.returnFocus;
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      const target = returnFocus.current?.() ?? (opener?.isConnected ? opener : null);
      target?.focus();
    };
  }, []);
  return ref;
}

/**
 * Closes a modal dialog when a press starts and ends on its backdrop. The dialog has no padding, so only the
 * backdrop hits the `<dialog>` element itself; a drag that starts in a field and ends outside does not close it.
 */
export function useBackdropClose(onClose: () => void) {
  const fromBackdrop = useRef(false);
  return {
    onPointerDown: (event: PointerEvent<HTMLDialogElement>) => {
      fromBackdrop.current = event.target === event.currentTarget;
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const close = fromBackdrop.current && event.target === event.currentTarget;
      fromBackdrop.current = false;
      if (close) onClose();
    },
  };
}
