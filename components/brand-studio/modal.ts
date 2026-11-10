"use client";
import { useEffect, useRef } from "react";

/**
 * A native modal `<dialog>`: `showModal()` makes the rest of the page inert (focus stays inside), Esc
 * fires `cancel`, and focus goes back to whatever opened it when the dialog goes away.
 */
export function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open && typeof dialog.showModal === "function") dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      opener?.focus();
    };
  }, []);
  return ref;
}
