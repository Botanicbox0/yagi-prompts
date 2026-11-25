"use client";
/**
 * True while something a drop target takes is dragged anywhere over the window, so the target can say it is
 * one before the pointer reaches it (founder review 2026-11-25). `dragover` repeats while a drag is on the
 * page; when it stops (the drag left the window) the state clears after a short rest, and at once on drop or
 * dragend. `accepts` must be a stable function (module level).
 */
import { useEffect, useState } from "react";

const REST_MS = 500;

type Types = readonly string[] | DOMStringList | null | undefined;

/** A drag that carries files from the desktop. */
export function carriesFiles(types: Types): boolean {
  return Boolean(types) && Array.from(types as ArrayLike<string>).includes("Files");
}

export function usePageDrag(enabled: boolean, accepts: (types: Types) => boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setOn(false);
      return;
    }
    let rest = 0;
    const stop = () => {
      window.clearTimeout(rest);
      setOn(false);
    };
    const over = (event: DragEvent) => {
      if (!accepts(event.dataTransfer?.types)) return;
      setOn(true);
      window.clearTimeout(rest);
      rest = window.setTimeout(() => setOn(false), REST_MS);
    };
    window.addEventListener("dragenter", over);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", stop);
    window.addEventListener("dragend", stop);
    return () => {
      window.clearTimeout(rest);
      window.removeEventListener("dragenter", over);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", stop);
      window.removeEventListener("dragend", stop);
    };
  }, [enabled, accepts]);
  return on;
}
